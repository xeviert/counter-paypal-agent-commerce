import { getEnv } from "@/lib/env";
import { log, paypalErrorFields } from "@/lib/log";

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

let token: { value: string; expiresAt: number } | undefined;

async function fetchToken(): Promise<{ value: string; expiresAt: number }> {
  const env = getEnv();
  const basic = Buffer.from(`${env.PLATFORM_CLIENT_ID}:${env.PLATFORM_CLIENT_SECRET}`).toString("base64");
  const response = await fetch(`${paypalBaseUrl()}/v1/oauth2/token`, {
    method: "POST",
    headers: { authorization: `Basic ${basic}`, "content-type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
  });
  const body: unknown = await response.json().catch(() => undefined);
  if (!response.ok) {
    log.paypalError("oauth2.token", response, body);
    throw new PayPalError("oauth2.token", response, body);
  }
  const { access_token, expires_in } = body as { access_token: string; expires_in: number };
  const ttl = Math.min(expires_in * 1000 - 60_000, MAX_TOKEN_AGE_MS);
  return { value: access_token, expiresAt: Date.now() + ttl };
}

export async function getAccessToken(forceRefresh = false): Promise<string> {
  if (forceRefresh || !token || token.expiresAt <= Date.now()) token = await fetchToken();
  return token.value;
}

export type PayPalRequest = {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  /** Objects are JSON-encoded; strings are sent as-is (needed for webhook verification). */
  body?: unknown;
  headers?: Record<string, string>;
};

export async function paypalRequest<T>(operation: string, path: string, req: PayPalRequest = {}): Promise<T> {
  const send = async (accessToken: string) =>
    fetch(`${paypalBaseUrl()}${path}`, {
      method: req.method ?? "GET",
      headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json", ...req.headers },
      body: req.body === undefined ? undefined : typeof req.body === "string" ? req.body : JSON.stringify(req.body),
    });

  let response = await send(await getAccessToken());
  if (response.status === 401) response = await send(await getAccessToken(true));

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
  return body as T;
}
