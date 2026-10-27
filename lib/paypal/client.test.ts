import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { json, mockPayPal, stubPayPalEnv } from "@/test/paypal";
import { clearTokenCache, getAccessToken, PayPalError, paypalRequest } from "./client";

const tokenCalls = (fetchMock: ReturnType<typeof mockPayPal>["fetchMock"]) =>
  fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/v1/oauth2/token")).length;

describe("paypalRequest", () => {
  beforeEach(() => {
    stubPayPalEnv();
    clearTokenCache();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("fetches one token for concurrent callers", async () => {
    const { fetchMock } = mockPayPal(() => json(200, {}));
    await Promise.all([getAccessToken(), getAccessToken(), paypalRequest("a", "/a"), paypalRequest("b", "/b")]);
    expect(tokenCalls(fetchMock)).toBe(1);
  });

  it("refreshes the token once on a 401", async () => {
    let n = 0;
    const { fetchMock } = mockPayPal(() => (n++ === 0 ? json(401, {}) : json(200, { ok: true })));
    expect(await paypalRequest("x", "/x")).toEqual({ ok: true });
    expect(tokenCalls(fetchMock)).toBe(2);
  });

  it("sends the request id header", async () => {
    const { calls } = mockPayPal(() => json(200, {}));
    await paypalRequest("x", "/x", { method: "POST", requestId: "create:1", body: {} });
    expect(calls[0]?.headers.get("PayPal-Request-Id")).toBe("create:1");
  });

  it("retries a 5xx once when the call has a request id", async () => {
    let n = 0;
    const { calls } = mockPayPal(() => (n++ === 0 ? json(503, {}) : json(201, { id: "O1" })));
    expect(await paypalRequest("x", "/x", { method: "POST", requestId: "create:1", body: {} })).toEqual({ id: "O1" });
    expect(calls).toHaveLength(2);
  });

  it("retries a network error on GET", async () => {
    let n = 0;
    const { calls } = mockPayPal(() => {
      if (n++ === 0) throw new TypeError("fetch failed");
      return json(200, { id: "O1" });
    });
    expect(await paypalRequest("x", "/x")).toEqual({ id: "O1" });
    expect(calls).toHaveLength(2);
  });

  it("never retries a POST without a request id", async () => {
    const { calls } = mockPayPal(() => json(503, {}));
    await expect(paypalRequest("x", "/x", { method: "POST", body: {} })).rejects.toBeInstanceOf(PayPalError);
    expect(calls).toHaveLength(1);
  });

  it("exposes the first error issue", async () => {
    mockPayPal(() => json(422, { name: "UNPROCESSABLE_ENTITY", details: [{ issue: "ORDER_ALREADY_CAPTURED" }] }));
    const err = await paypalRequest("x", "/x").catch((e: unknown) => e);
    expect(err).toMatchObject({ status: 422, issue: "ORDER_ALREADY_CAPTURED" });
  });

  it("parses with the schema and rejects a mismatch", async () => {
    mockPayPal(() => json(200, { id: 1 }));
    await expect(paypalRequest("x", "/x", { schema: z.object({ id: z.string() }) })).rejects.toThrow(
      /unexpected response/,
    );
  });
});
