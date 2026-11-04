import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { proxy } from "@/proxy";
import { OPS_COOKIE, SESSION_COOKIE } from "./cookie";
import { matchOpsPassword, signOpsToken, verifyOpsToken } from "./operator";
import { signSession, signToken, verifySession } from "./token";

const secret = "s".repeat(32);

describe("ops password", () => {
  const env = { OPS_PASSWORD: "operator-pass", OPS_JUDGE_PASSWORD: "judge-pass" };

  it("maps each password to its role", () => {
    expect(matchOpsPassword(env, "operator-pass")).toBe("operator");
    expect(matchOpsPassword(env, "judge-pass")).toBe("judge");
    expect(matchOpsPassword(env, "wrong")).toBeUndefined();
    expect(matchOpsPassword(env, "")).toBeUndefined();
    expect(matchOpsPassword(env, "operator-pass ")).toBeUndefined();
  });

  it("unlocks nothing while the console is off, even with a judge password set", () => {
    expect(matchOpsPassword({ OPS_JUDGE_PASSWORD: "judge-pass" }, "judge-pass")).toBeUndefined();
    expect(matchOpsPassword({}, "")).toBeUndefined();
  });

  it("has no judge role without a judge password", () => {
    expect(matchOpsPassword({ OPS_PASSWORD: "operator-pass" }, "")).toBeUndefined();
  });
});

describe("ops cookie", () => {
  it("round-trips the role and expires after 12 h", () => {
    const now = Date.now();
    expect(verifyOpsToken(secret, signOpsToken(secret, "operator", now), now)).toBe("operator");
    expect(verifyOpsToken(secret, signOpsToken(secret, "judge", now), now)).toBe("judge");
    expect(verifyOpsToken(secret, signOpsToken(secret, "operator", now), now + 12 * 3600_000 + 1000)).toBeUndefined();
  });

  it("doesn't accept a maker cookie, and a maker session doesn't accept an ops cookie", () => {
    const maker = signSession(secret, "operator");
    expect(verifyOpsToken(secret, maker)).toBeUndefined();
    expect(verifySession(secret, signOpsToken(secret, "operator"))).toBeUndefined();
  });

  it("rejects a tampered role or an unknown one signed in scope", () => {
    const [, exp, sig] = signOpsToken(secret, "judge").split(".");
    expect(verifyOpsToken(secret, `operator.${exp}.${sig}`)).toBeUndefined();
    expect(verifyOpsToken(secret, signToken(secret, "ops", "admin", 3600))).toBeUndefined();
    expect(verifyOpsToken("t".repeat(32), signOpsToken(secret, "operator"))).toBeUndefined();
  });
});

describe("proxy", () => {
  beforeEach(() => vi.stubEnv("OPS_PASSWORD", "operator-pass"));
  afterEach(() => vi.unstubAllEnvs());

  const request = (path: string, cookie?: string) =>
    new NextRequest(new URL(path, "https://counter.test"), cookie ? { headers: { cookie: `${cookie}=x` } } : undefined);
  const location = (res: Response) => res.headers.get("location");

  it("sends signed-out /ops visitors to the ops login, not the maker one", () => {
    expect(location(proxy(request("/ops")))).toBe("https://counter.test/ops/login");
    expect(location(proxy(request("/ops/events", SESSION_COOKIE)))).toBe("https://counter.test/ops/login");
    expect(location(proxy(request("/ops/login")))).toBeNull();
    expect(location(proxy(request("/ops/fees", OPS_COOKIE)))).toBeNull();
  });

  it("404s every /ops path while the console is off", () => {
    vi.stubEnv("OPS_PASSWORD", " ");
    for (const path of ["/ops", "/ops/login", "/ops/api/copilot"]) expect(proxy(request(path, OPS_COOKIE)).status).toBe(404);
    expect(proxy(request("/s/orders", SESSION_COOKIE)).status).toBe(200);
  });

  it("lets /ops/api routes answer for themselves", () => {
    expect(location(proxy(request("/ops/api/copilot")))).toBeNull();
  });

  it("keeps the maker app on the maker cookie", () => {
    expect(location(proxy(request("/s/orders", OPS_COOKIE)))).toBe("https://counter.test/s/login");
    expect(location(proxy(request("/s/orders", SESSION_COOKIE)))).toBeNull();
  });
});
