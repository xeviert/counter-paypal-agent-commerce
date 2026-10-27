import type { z } from "zod";
import { getEnv } from "@/lib/env";
import { log, paypalErrorFields } from "@/lib/log";
import { tokenResponse } from "@/lib/schemas/paypal";

const BASE_URLS = {
  SANDBOX: "https://api-m.sandbox.paypal.com",
  LIVE: "https://api-m.paypal.com",
} as const;

// PayPal tokens last ~9h; refresh well before that (and on any 401).
const MAX_TOKEN_AGE_MS = 8 * 3600_000;

export class PayPalError extends Error {
  readonly status: number;
  readonly body: unknown;
  readonly debugId: string | undefined;
  readonly issue: string | undefined;

  constructor(operation: string, response: Response, body: unknown) {
    const fields = paypalErrorFields(response, body);
    super(`PayPal ${operation} failed: ${fields.http_status} ${fields.name ?? ""}`.trim());
    this.name = "PayPalError";
    this.status = response.status;
    this.body = body;
    this.debugId = fields.debug_id;
    const first: unknown = fields.details?.[0];
    this.issue =
      first !== null && typeof first === "object" && "issue" in first && typeof first.issue === "string"
        ? first.issue
        : undefined;
  }
}

export function paypalBaseUrl(): string {
  return BASE_URLS[getEnv().PAYPAL_ENVIRONMENT];
}

const TIMEOUT_MS = 20_000;
const RETRY_DELAY_MS = 1_000;

type Token = { value: string; expiresAt: number };

let token: Token | undefined;
// Shared so a cold start with concurrent requests fetches one token.
let pendingToken: Promise<Token> | undefined;

async function fetchToken(): Promise<Token> {
  const env = getEnv();
  const basic = Buffer.from(`${env.PLATFORM_CLIENT_ID}:${env.PLATFORM_CLIENT_SECRET}`).toString("base64");
  const response = await fetch(`${paypalBaseUrl()}/v1/oauth2/token`, {
    method: "POST",
    headers: { authorization: `Basic ${basic}`, "content-type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const body: unknown = await response.json().catch(() => undefined);
  if (!response.ok) {
    log.paypalError("oauth2.token", response, body);
    throw new PayPalError("oauth2.token", response, body);
  }
  const { access_token, expires_in } = tokenResponse.parse(body);
  const ttl = Math.min(expires_in * 1000 - 60_000, MAX_TOKEN_AGE_MS);
  return { value: access_token, expiresAt: Date.now() + ttl };
}

export async function getAccessToken(forceRefresh = false): Promise<string> {
  if (!forceRefresh && token && token.expiresAt > Date.now()) return token.value;
  pendingToken ??= fetchToken()
    .then((fresh) => (token = fresh))
    .finally(() => (pendingToken = undefined));
  return (await pendingToken).value;
}

/** Tests only. */
export function clearTokenCache(): void {
  token = undefined;
  pendingToken = undefined;
}

export type PayPalRequest<T> = {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  /** Objects are JSON-encoded; strings are sent as-is (needed for webhook verification). */
  body?: unknown;
  headers?: Record<string, string>;
  /** Sent as `PayPal-Request-Id`. PayPal replays the first result for a repeated id, which makes the call safe to retry. */
  requestId?: string;
  /** Parses a successful response. Without it the body is cast to `T` unchecked (scripts only). */
  schema?: z.ZodType<T>;
};

export async function paypalRequest<T>(operation: string, path: string, req: PayPalRequest<T> = {}): Promise<T> {
  const method = req.method ?? "GET";
  const send = async (accessToken: string) =>
    fetch(`${paypalBaseUrl()}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
        ...(req.requestId ? { "PayPal-Request-Id": req.requestId } : {}),
        ...req.headers,
      },
      body: req.body === undefined ? undefined : typeof req.body === "string" ? req.body : JSON.stringify(req.body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

  const attempt = async () => {
    const response = await send(await getAccessToken());
    return response.status === 401 ? send(await getAccessToken(true)) : response;
  };

  // A POST without a request id might have acted before failing, so only those are never retried.
  const retryable = method === "GET" || req.requestId !== undefined;
  let response: Response;
  try {
    response = await attempt();
    if (retryable && response.status >= 500) {
      log.warn(`paypal ${operation} retrying`, { operation, http_status: response.status });
      await sleep(RETRY_DELAY_MS);
      response = await attempt();
    }
  } catch (err) {
    if (!retryable) throw err;
    log.warn(`paypal ${operation} retrying`, { operation, error: err });
    await sleep(RETRY_DELAY_MS);
    response = await attempt();
  }

  const text = await response.text();
  let body: unknown = text;
  try {
    body = text ? JSON.parse(text) : undefined;
  } catch {
    // Non-JSON error bodies (e.g. gateway HTML) are kept as text.
  }
  if (!response.ok) {
    log.paypalError(operation, response, body);
    throw new PayPalError(operation, response, body);
  }
  if (!req.schema) return body as T;
  const parsed = req.schema.safeParse(body);
  if (!parsed.success) {
    log.error(`paypal ${operation} response did not match schema`, { operation, issues: parsed.error.issues });
    throw new Error(`PayPal ${operation} returned an unexpected response`);
  }
  return parsed.data;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
