import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { OPS_COOKIE } from "@/lib/auth/cookie";
import { signOpsToken } from "@/lib/auth/operator";
import type { Db } from "@/lib/db";
import { events, notifications, products } from "@/lib/db/schema";
import { RateLimiter } from "@/lib/mcp/rate-limit";
import { seedProduct, testDatabaseUrl, testDb, truncateAll } from "@/test/db";
import { stubPayPalEnv } from "@/test/paypal";

// Server actions and the copilot route without the Next runtime (BUILDOUT §7.4): request APIs are
// replaced by an in-memory cookie jar and a fixed client IP; notFound/redirect throw like Next's.

const request = vi.hoisted(() => ({ ip: "203.0.113.1", jar: new Map<string, string>() }));
const db = vi.hoisted(() => ({ current: undefined as unknown }));

vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "true-client-ip": request.ip }),
  cookies: async () => ({
    get: (name: string) => (request.jar.has(name) ? { name, value: request.jar.get(name) } : undefined),
    set: (name: string, value: string) => void request.jar.set(name, value),
    delete: ({ name }: { name: string }) => void request.jar.delete(name),
  }),
}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  redirect: (url: string) => {
    throw new Error(`NEXT_REDIRECT:${url}`);
  },
}));
vi.mock("next/server", () => ({ connection: async () => {} }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
// currentOpsRole is memoized per request in Next; here every call is its own request.
vi.mock("react", async (original) => ({ ...(await original<typeof import("react")>()), cache: <T>(fn: T) => fn }));
vi.mock("@/lib/db", async (original) => ({ ...(await original<typeof import("@/lib/db")>()), getDb: () => db.current }));

const OPS_PASSWORD = "operator-password";
const OPS_JUDGE_PASSWORD = "judge-password";
const SECRET = "test-session-secret-at-least-32-characters";

stubPayPalEnv();
vi.stubEnv("OPS_PASSWORD", OPS_PASSWORD);
vi.stubEnv("OPS_JUDGE_PASSWORD", OPS_JUDGE_PASSWORD);

const { approve, opsLogIn, reject } = await import("./actions");
const { POST: copilot } = await import("./api/copilot/route");

const globalForOps = globalThis as unknown as { opsLoginLimiter?: RateLimiter };

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
};
const logIn = (password: string) => opsLogIn({}, form({ password }));
const signInAs = (role: "operator" | "judge") => request.jar.set(OPS_COOKIE, signOpsToken(SECRET, role));
const eventTypes = async (d: Db) => (await d.select({ type: events.type }).from(events)).map((e) => e.type);

describe.skipIf(!testDatabaseUrl)("ops actions (DB)", () => {
  let d: Db;
  let now: number;

  beforeAll(() => {
    d = testDb();
    db.current = d;
  });
  beforeEach(async () => {
    await truncateAll(d);
    request.ip = "203.0.113.1";
    request.jar.clear();
    now = Date.parse("2026-11-05T12:00:00Z");
    globalForOps.opsLoginLimiter = new RateLimiter(() => now);
  });
  afterAll(async () => {
    delete globalForOps.opsLoginLimiter;
    await d.$client.end();
  });

  describe("login", () => {
    it("signs in as operator or judge and logs the hashed IP only", async () => {
      await expect(logIn(OPS_PASSWORD)).rejects.toThrow("NEXT_REDIRECT:/ops");
      expect(request.jar.get(OPS_COOKIE)).toMatch(/^operator\./);
      await expect(logIn(OPS_JUDGE_PASSWORD)).rejects.toThrow("NEXT_REDIRECT:/ops");
      expect(request.jar.get(OPS_COOKIE)).toMatch(/^judge\./);

      const rows = await d.select().from(events);
      expect(rows.map((e) => [e.type, e.actor])).toEqual([
        ["ops.login", "operator"],
        ["ops.login", "judge"],
      ]);
      expect(JSON.stringify(rows)).not.toContain(request.ip);
    });

    it("allows 5 tries per IP per 10 minutes, then refuses even the right password", async () => {
      for (let i = 0; i < 5; i++) expect(await logIn("nope")).toEqual({ error: "wrong" });
      expect(await logIn(OPS_PASSWORD)).toEqual({ error: "tooMany" });
      expect(request.jar.has(OPS_COOKIE)).toBe(false);
      // A refused try writes no event.
      expect(await eventTypes(d)).toEqual(Array(5).fill("ops.login_failed"));

      request.ip = "198.51.100.7";
      await expect(logIn(OPS_PASSWORD)).rejects.toThrow("NEXT_REDIRECT:/ops");

      request.ip = "203.0.113.1";
      now += 10 * 60_000;
      await expect(logIn(OPS_PASSWORD)).rejects.toThrow("NEXT_REDIRECT:/ops");
    });
  });

  describe("listing review", () => {
    const flagged = async () => (await seedProduct(d, { product: { status: "review", restrictedFlag: true } })).product;
    const statusOf = async (id: string) =>
      (await d.select({ status: products.status }).from(products).where(eq(products.id, id)))[0]!.status;

    it("refuses approve and reject for a judge and changes nothing", async () => {
      const product = await flagged();
      signInAs("judge");
      await expect(approve(form({ productId: product.id }))).rejects.toThrow("NEXT_NOT_FOUND");
      await expect(reject(form({ productId: product.id, reason: "fake brand" }))).rejects.toThrow("NEXT_NOT_FOUND");

      expect(await statusOf(product.id)).toBe("review");
      expect(await eventTypes(d)).toEqual([]);
      expect(await d.select().from(notifications)).toEqual([]);
    });

    it("sends a signed-out caller to the login page", async () => {
      const product = await flagged();
      await expect(approve(form({ productId: product.id }))).rejects.toThrow("NEXT_REDIRECT:/ops/login");
      expect(await statusOf(product.id)).toBe("review");
    });

    it("lets the operator approve", async () => {
      const product = await flagged();
      signInAs("operator");
      await approve(form({ productId: product.id }));
      expect(await statusOf(product.id)).toBe("live");
      expect(await eventTypes(d)).toEqual(["ops.listing_approved"]);
    });
  });

  describe("copilot route", () => {
    const ask = () =>
      copilot(new Request("https://counter.test/ops/api/copilot", { method: "POST", body: JSON.stringify({ messages: [] }) }));

    it("answers 401 signed out and 403 for a judge, before reading the body", async () => {
      expect((await ask()).status).toBe(401);
      signInAs("judge");
      const res = await ask();
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: "forbidden" });
    });
  });
});
