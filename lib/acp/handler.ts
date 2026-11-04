import type { z } from "zod";
import { getDb, type Db } from "@/lib/db";
import { events } from "@/lib/db/schema";
import { log } from "@/lib/log";
import { agentFromRequest, type Agent } from "@/lib/mcp/agent";
import { limitsFor, mcpRateLimiter, type RateLimiter } from "@/lib/mcp/rate-limit";
import {
  ACP_API_VERSION,
  acpCompleteRequest,
  acpCreateRequest,
  acpUpdateRequest,
  type AcpError,
  type AcpResult,
} from "@/lib/schemas/acp";
import {
  cancelAcpSession,
  completeAcpSession,
  createAcpSession,
  getAcpSession,
  updateAcpSession,
} from "@/lib/shop/acp";
import { claimKey, releaseKey, requestHash, storeResponse } from "./idempotency";

// HTTP layer for `/api/acp/checkout_sessions` (BUILDOUT §7.6): rate limits, JSON + Zod, Idempotency-Key,
// headers, and one `acp.<op>` event per request. Anonymous like `/api/mcp`.

export type AcpOp = "create" | "get" | "update" | "complete" | "cancel";

export type AcpDeps = { db: () => Db; limiter: RateLimiter };

const defaultDeps: AcpDeps = { db: getDb, limiter: mcpRateLimiter() };

const MAX_BODY_BYTES = 64 * 1024;

const failure = (status: number, body: AcpError): AcpResult => ({ status, body });

// Checkout creation shares create_checkout's per-agent limit; reads and edits only the agent/IP limits.
const LIMIT_AS: Record<AcpOp, string> = { create: "acp", get: "acp", update: "acp", complete: "create_checkout", cancel: "acp" };

function parse<T extends z.ZodType>(schema: T, raw: string): { ok: true; data: z.output<T> } | { ok: false; result: AcpResult } {
  let json: unknown = {};
  if (raw.trim()) {
    try {
      json = JSON.parse(raw);
    } catch {
      return { ok: false, result: failure(400, { type: "invalid_request", code: "invalid_json", message: "Body isn't valid JSON" }) };
    }
  }
  const parsed = schema.safeParse(json);
  if (parsed.success) return { ok: true, data: parsed.data };
  const issue = parsed.error.issues[0]!;
  const param = issue.path.length ? `$${issue.path.map((p) => (typeof p === "number" ? `[${p}]` : `.${String(p)}`)).join("")}` : undefined;
  return {
    ok: false,
    result: failure(400, { type: "invalid_request", code: "invalid", message: issue.message, ...(param && { param }) }),
  };
}

async function run(op: AcpOp, id: string | undefined, raw: string, db: Db, agent: Agent): Promise<AcpResult> {
  const caller = { agentId: agent.agentId };
  if (op === "get") return getAcpSession(db, id!);
  if (op === "cancel") return cancelAcpSession(db, id!, caller);
  if (op === "create") {
    const parsed = parse(acpCreateRequest, raw);
    return parsed.ok ? createAcpSession(db, parsed.data, caller) : parsed.result;
  }
  if (op === "update") {
    const parsed = parse(acpUpdateRequest, raw);
    return parsed.ok ? updateAcpSession(db, id!, parsed.data) : parsed.result;
  }
  const parsed = parse(acpCompleteRequest, raw);
  return parsed.ok ? completeAcpSession(db, id!, parsed.data, caller) : parsed.result;
}

export async function handleAcp(
  request: Request,
  op: AcpOp,
  id?: string,
  deps: AcpDeps = defaultDeps,
): Promise<Response> {
  const started = Date.now();
  const agent = agentFromRequest(request);
  const key = request.method === "POST" ? request.headers.get("idempotency-key")?.trim() || undefined : undefined;
  const headers = new Headers({ "API-Version": ACP_API_VERSION, "Cache-Control": "no-store" });
  const requestId = request.headers.get("request-id");
  if (requestId) headers.set("Request-Id", requestId);
  if (key) headers.set("Idempotency-Key", key);
  const respond = (result: AcpResult) => Response.json(result.body, { status: result.status, headers });

  const decision = deps.limiter.check(limitsFor(LIMIT_AS[op], agent));
  if (!decision.ok) {
    log.warn("acp rate limited", { op, agentId: agent.agentId, ip: agent.ip });
    headers.set("Retry-After", String(Math.ceil(decision.retryAfterMs / 1000)));
    return respond(failure(429, { type: "invalid_request", code: "rate_limited", message: "Too many requests" }));
  }

  const raw = request.method === "POST" ? await request.text() : "";
  if (raw.length > MAX_BODY_BYTES) {
    return respond(failure(413, { type: "invalid_request", code: "too_large", message: "Body is too large" }));
  }

  const db = deps.db();
  const scope = `acp:${op}${id ? `:${id}` : ""}`;
  let result: AcpResult;
  if (key) {
    if (key.length > 255) {
      return respond(failure(400, { type: "invalid_request", code: "invalid", message: "Idempotency-Key is too long" }));
    }
    const claim = await claimKey(db, scope, key, requestHash(raw));
    if (claim.kind === "conflict") {
      return respond(failure(422, {
        type: "request_not_idempotent",
        code: "idempotency_conflict",
        message: "This Idempotency-Key was used with a different request body",
      }));
    }
    if (claim.kind === "in_flight") {
      headers.set("Retry-After", "1");
      return respond(failure(409, {
        type: "request_not_idempotent",
        code: "idempotency_in_flight",
        message: "A request with this Idempotency-Key is still being processed",
      }));
    }
    if (claim.kind === "replay") {
      headers.set("Idempotent-Replayed", "true");
      return respond({ status: claim.status, body: claim.body as AcpResult["body"] });
    }
  }

  try {
    result = await run(op, id, raw, db, agent);
  } catch (err) {
    log.error("acp request failed", { op, agentId: agent.agentId, err });
    result = failure(500, { type: "processing_error", code: "internal_error", message: "Something went wrong on Counter's side. Try again shortly" });
  }
  if (key && result.status < 500) await storeResponse(db, scope, key, result.status, result.body);
  else if (key) await releaseKey(db, scope, key).catch(() => {});

  const ms = Date.now() - started;
  const body = result.body as { id?: string; status?: string; code?: string };
  try {
    await db.insert(events).values({
      type: `acp.${op}`,
      source: "acp",
      actor: agent.agentId,
      productId: result.refs?.productId,
      orderId: result.refs?.orderId,
      payload: {
        sessionId: body.id ?? id ?? null,
        httpStatus: result.status,
        ...(body.status && { status: body.status }),
        ...(body.code && { code: body.code }),
        idempotent: Boolean(key),
        apiVersion: request.headers.get("api-version"),
        ms,
        userAgent: agent.userAgent,
      },
    });
  } catch (err) {
    log.error("acp call not logged to events", { op, err });
  }
  log.info("acp request", { op, status: result.status, agentId: agent.agentId, ms });
  return respond(result);
}
