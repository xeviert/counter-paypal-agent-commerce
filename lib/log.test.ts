import { afterEach, describe, expect, it, vi } from "vitest";
import { log, paypalErrorFields } from "./log";

afterEach(() => vi.restoreAllMocks());

function captured(spy: ReturnType<typeof vi.spyOn>) {
  return JSON.parse(spy.mock.calls[0][0] as string);
}

describe("log", () => {
  it("writes one JSON line with level and fields", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    log.info("order created", { orderId: "o_1" });
    expect(captured(spy)).toMatchObject({ level: "info", msg: "order created", orderId: "o_1" });
  });

  it("sends warn and error to stderr", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    log.warn("slow");
    expect(captured(spy).level).toBe("warn");
  });

  it("redacts secret-looking keys at any depth", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    log.info("x", { headers: { Authorization: "Bearer abc" }, status_token: "t", client_secret: "s" });
    const line = captured(spy);
    expect(line.headers.Authorization).toBe("[redacted]");
    expect(line.status_token).toBe("[redacted]");
    expect(line.client_secret).toBe("[redacted]");
  });

  it("serializes errors", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    log.error("boom", { err: new Error("bad") });
    expect(captured(spy).err).toMatchObject({ name: "Error", message: "bad" });
  });
});

describe("paypalErrorFields", () => {
  it("extracts status, name and debug_id from a PayPal error body", () => {
    const fields = paypalErrorFields(
      { status: 422 },
      { name: "UNPROCESSABLE_ENTITY", debug_id: "abc123", message: "x", details: [{ issue: "ORDER_ALREADY_CAPTURED" }] },
    );
    expect(fields).toEqual({
      http_status: 422,
      name: "UNPROCESSABLE_ENTITY",
      debug_id: "abc123",
      message: "x",
      details: [{ issue: "ORDER_ALREADY_CAPTURED" }],
    });
  });

  it("falls back to the paypal-debug-id header and OAuth error shape", () => {
    const fields = paypalErrorFields(
      { status: 401, headers: new Headers({ "paypal-debug-id": "hdr1" }) },
      { error: "invalid_client", error_description: "Client Authentication failed" },
    );
    expect(fields).toMatchObject({ http_status: 401, name: "invalid_client", debug_id: "hdr1" });
  });

  it("handles a non-JSON body", () => {
    expect(paypalErrorFields({ status: 502 }, "Bad Gateway")).toMatchObject({ http_status: 502, name: undefined });
  });

  it("log.paypalError emits the fields", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    log.paypalError("orders.capture", { status: 422 }, { name: "UNPROCESSABLE_ENTITY", debug_id: "d1" });
    expect(captured(spy)).toMatchObject({ operation: "orders.capture", http_status: 422, debug_id: "d1" });
  });
});
