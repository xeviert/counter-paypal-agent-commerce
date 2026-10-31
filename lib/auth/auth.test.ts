import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "./password";
import { SESSION_TTL_S, signSession, verifySession } from "./token";

const secret = "s".repeat(32);
const sellerId = "0b6f7c1e-6a4e-4c39-9d7a-1f0c1b2c3d4e";

describe("session token", () => {
  it("round-trips the seller id", () => {
    expect(verifySession(secret, signSession(secret, sellerId))).toBe(sellerId);
  });

  it("rejects a tampered seller id or signature", () => {
    const value = signSession(secret, sellerId);
    const [, exp, sig] = value.split(".");
    expect(verifySession(secret, `ffffffff-6a4e-4c39-9d7a-1f0c1b2c3d4e.${exp}.${sig}`)).toBeUndefined();
    expect(verifySession(secret, `${sellerId}.${Number(exp) + 999}.${sig}`)).toBeUndefined();
    expect(verifySession(secret, `${value.slice(0, -2)}xx`)).toBeUndefined();
    expect(verifySession("t".repeat(32), value)).toBeUndefined();
  });

  it("rejects malformed values", () => {
    for (const bad of ["", "a.b", "a.b.c.d", `${sellerId}.soon.sig`]) {
      expect(verifySession(secret, bad)).toBeUndefined();
    }
  });

  it("expires after the TTL", () => {
    const now = Date.UTC(2026, 9, 31);
    const value = signSession(secret, sellerId, now);
    expect(verifySession(secret, value, now + (SESSION_TTL_S - 1) * 1000)).toBe(sellerId);
    expect(verifySession(secret, value, now + SESSION_TTL_S * 1000)).toBeUndefined();
  });
});

describe("password", () => {
  it("verifies the right password only", async () => {
    const stored = await hashPassword("correct horse");
    expect(stored).toMatch(/^scrypt:/);
    expect(await verifyPassword("correct horse", stored)).toBe(true);
    expect(await verifyPassword("correct hors", stored)).toBe(false);
  });

  it("salts each hash", async () => {
    expect(await hashPassword("same")).not.toBe(await hashPassword("same"));
  });

  it("rejects unknown formats", async () => {
    expect(await verifyPassword("x", "bcrypt:abc:def")).toBe(false);
    expect(await verifyPassword("x", "")).toBe(false);
  });
});
