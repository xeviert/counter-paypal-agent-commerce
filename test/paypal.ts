import { vi } from "vitest";

/** Fake credentials so `getEnv()` parses in CI, where no PayPal secrets exist. */
export function stubPayPalEnv(): void {
  vi.stubEnv("APP_BASE_URL", "https://counter.test");
  vi.stubEnv("PAYPAL_ENVIRONMENT", "SANDBOX");
  vi.stubEnv("PLATFORM_CLIENT_ID", "test-client-id");
  vi.stubEnv("PLATFORM_CLIENT_SECRET", "test-client-secret");
  vi.stubEnv("PLATFORM_MERCHANT_ID", "9MGXZVWN9N9EE");
  vi.stubEnv("DATABASE_URL", "postgres://counter:counter@localhost:5433/counter");
}

export type Call = { method: string; path: string; headers: Headers; body: unknown };

export const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

export const paypalIssue = (status: number, issue: string) =>
  json(status, { name: "UNPROCESSABLE_ENTITY", debug_id: "dbg-1", details: [{ issue }] });

/**
 * Replaces `fetch` with a PayPal fake. The token endpoint always succeeds; every other request
 * goes to `handler`. Unhandled requests throw so a test can never reach the real sandbox.
 */
export function mockPayPal(handler: (call: Call) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.pathname === "/v1/oauth2/token") return json(200, { access_token: "tok", expires_in: 32400 });
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
    const call = { method: init?.method ?? "GET", path: url.pathname + url.search, headers: new Headers(init?.headers), body };
    calls.push(call);
    return handler(call);
  });
  vi.stubGlobal("fetch", fetchMock);
  return { calls, fetchMock };
}
