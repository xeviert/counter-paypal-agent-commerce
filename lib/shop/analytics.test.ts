import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Db } from "@/lib/db";
import { events, orders, sellerDashboards } from "@/lib/db/schema";
import { orderValues, seedProduct, testDatabaseUrl, testDb, truncateAll } from "@/test/db";
import { sseAnthropic } from "@/test/anthropic-sse";
import { dashboardDataset } from "./analytics";
import { loadDashboard, MAX_DASHBOARD_BYTES, resetDashboard, saveDashboard, withoutRelativeFilters } from "./dashboards";
import { localDate, MAKER_DAILY_STUDIO, studioTurn } from "./studio-ai";

describe.skipIf(!testDatabaseUrl)("maker dashboard (DB)", () => {
  let db: Db;

  beforeAll(() => {
    db = testDb();
  });
  beforeEach(async () => {
    await truncateAll(db);
  });
  afterAll(async () => {
    await db.$client.end();
  });

  describe("dashboardDataset", () => {
    it("has only the maker's own paid orders, by day in their time zone, without buyer details", async () => {
      const { seller, product } = await seedProduct(db);
      const { seller: other, product: theirs } = await seedProduct(db);
      // 03:00 UTC on Nov 3 is still Nov 2 in Mexico City.
      const capturedAt = new Date("2026-11-03T03:00:00Z");
      const now = new Date("2026-11-04T12:00:00Z");
      const sale = (patch: Partial<typeof orders.$inferInsert>, sellerId = seller.id, productId = product.id) =>
        db.insert(orders).values({
          ...orderValues(sellerId, productId),
          capturedAt,
          buyerName: "Jane Buyer",
          buyerEmail: "jane@example.com",
          shippingAddress: { address: { address_line_1: "1 Main St", country_code: "DE" } },
          ...patch,
        });
      await sale({ status: "Released", netAmount: 16000, paypalFee: 750 });
      await sale({ status: "PaidHeld", netAmount: 16000, refundedAmount: 2000, platformFeeRefunded: 100 });
      await sale({ status: "CheckoutCreated", capturedAt: null });
      await sale({ status: "Released", netAmount: 16000 }, other.id, theirs.id);

      const data = await dashboardDataset(db, seller, { now });
      expect(data.timeZone).toBe("America/Mexico_City");
      expect(data.to).toBe("2026-11-04");
      expect(data.products.map((p) => p.id)).toEqual([product.id]);
      expect(data.orders).toHaveLength(2);
      expect(data.orders.map((o) => [o.day, o.payout, o.netCents, o.counterFeeCents])).toEqual([
        ["2026-11-02", "released", 16000, 750],
        ["2026-11-02", "held", 16000 - 2000 + 100, 650],
      ]);
      const json = JSON.stringify(data);
      for (const secret of ["Jane", "jane@example.com", "Main St", "statusToken", seller.merchantId!]) expect(json).not.toContain(secret);
    });

    it("counts agent steps per product, including search results, and only the maker's", async () => {
      const { seller, product } = await seedProduct(db);
      const { product: theirs } = await seedProduct(db);
      const at = new Date();
      const mcp = (type: string, productId: string | null, payload: Record<string, unknown> = {}) => ({
        type,
        source: "mcp" as const,
        actor: "agent-1",
        productId,
        createdAt: at,
        payload: { outcome: "ok", ...payload },
      });
      await db.insert(events).values([
        mcp("mcp.search_products", null, { productIds: [product.id, theirs.id] }),
        mcp("mcp.search_products", null, { productIds: [product.id] }),
        mcp("mcp.get_product", product.id),
        mcp("mcp.get_product", product.id, { outcome: "error" }),
        mcp("mcp.ask_question", product.id),
        mcp("mcp.make_offer", theirs.id),
        mcp("mcp.create_checkout", product.id),
        { ...mcp("ai.call", product.id), source: "copilot" as const },
      ]);
      await db.insert(orders).values({ ...orderValues(seller.id, product.id), status: "Released", capturedAt: at });

      const totals = Object.fromEntries(
        Object.entries(
          (await dashboardDataset(db, seller)).activity.reduce<Record<string, number>>((acc, a) => {
            expect(a.productId).toBe(product.id);
            acc[a.stage] = (acc[a.stage] ?? 0) + a.count;
            return acc;
          }, {}),
        ),
      );
      expect(totals).toEqual({ search: 2, view: 1, question: 1, checkout: 1, paid: 1 });
    });
  });

  describe("saved dashboards", () => {
    const report = { selectedPageId: "sales", pages: [{ id: "sales", widgets: {} }] };

    it("saves, loads and resets per maker", async () => {
      const { seller } = await seedProduct(db);
      const { seller: other } = await seedProduct(db);
      expect(await loadDashboard(db, seller.id)).toBeNull();
      expect(await saveDashboard(db, seller.id, report)).toBe(true);
      expect(await saveDashboard(db, seller.id, { ...report, selectedPageId: "agents" })).toBe(true);
      expect(await loadDashboard(db, seller.id)).toMatchObject({ selectedPageId: "agents" });
      expect(await loadDashboard(db, other.id)).toBeNull();
      await resetDashboard(db, seller.id);
      expect(await loadDashboard(db, seller.id)).toBeNull();
    });

    it("refuses state that isn't a report or is too big", async () => {
      const { seller } = await seedProduct(db);
      expect(await saveDashboard(db, seller.id, { pages: [] })).toBe(false);
      expect(await saveDashboard(db, seller.id, "nope")).toBe(false);
      const big = { ...report, blob: "x".repeat(MAX_DASHBOARD_BYTES) };
      expect(await saveDashboard(db, seller.id, big)).toBe(false);
      expect(await db.select().from(sellerDashboards)).toHaveLength(0);
    });

    it("drops relative date filters, which Studio 3.0 can't reload", () => {
      const relative = { field: { id: "orders.day" }, model: { operator: "inRelativeRange", value: { unit: "month" } } };
      const between = { field: { id: "orders.day" }, model: { operator: "between", value: ["2026-11-01", "2026-11-30"] } };
      const clean = withoutRelativeFilters({
        ...report,
        pages: [{ id: "sales", filter: { page: [relative, between], widget: { countries: [relative], top: [between] } } }],
      });
      expect(clean.pages[0]!.filter).toEqual({ page: [between], widget: { countries: [], top: [between] } });
    });
  });

  describe("studioTurn", () => {
    const turn = { input: [{ kind: "input", type: "message", role: "user", content: [{ type: "text", text: "hola" }] }], responseFormat: { type: "text" as const } };

    it("streams Claude's turn, records one ai.call, and stops at the maker's daily cap", async () => {
      const { seller } = await seedProduct(db);
      const { client, requests } = sseAnthropic([{ content: [{ type: "text", text: "Listo." }] }]);
      const out: { type: string }[] = [];
      const studioSeller = { id: seller.id, language: "es", country: "MX" };
      await studioTurn(db, studioSeller, turn, (e) => out.push(e), { client });
      expect(out.map((e) => e.type)).toEqual(["event", "event", "event", "complete"]);
      expect(JSON.stringify(requests[0]!.system)).toContain(`Today in the maker's time zone: ${localDate("MX")}`);
      const calls = await db.select().from(events);
      expect(calls).toMatchObject([{ type: "ai.call", sellerId: seller.id, payload: { role: "studio", model: "claude-opus-5-5" } }]);

      await db.insert(events).values(
        Array.from({ length: MAKER_DAILY_STUDIO }, () => ({ type: "ai.call", source: "web" as const, sellerId: seller.id, payload: { role: "studio" } })),
      );
      const capped: { type: string; code?: string }[] = [];
      await studioTurn(db, studioSeller, turn, (e) => capped.push(e), { client });
      expect(capped).toEqual([expect.objectContaining({ type: "error", code: "capped" })]);
      expect(requests).toHaveLength(1);
    });

    it("turns an API failure into an error line and still records the call", async () => {
      const { seller } = await seedProduct(db);
      const { client } = sseAnthropic([{ status: 500 }]);
      const out: { type: string; code?: string }[] = [];
      await studioTurn(db, { id: seller.id, language: "es", country: "MX" }, turn, (e) => out.push(e), { client });
      expect(out).toEqual([expect.objectContaining({ type: "error", code: "error" })]);
      expect(await db.select().from(events)).toMatchObject([{ type: "ai.call", payload: { role: "studio", error: expect.any(String) } }]);
    });
  });
});
