// Demo history for the AG Studio dashboard (BUILDOUT §7.3): ~30 days of paid orders and MCP agent
// events for one maker (default: the MX hero, Lucía). Deterministic, and safe to re-run: every run
// first removes what the last one wrote.
// Usage: pnpm seed:activity [--persona MX] [--days 30] [--reset]
//
// Orders are only in terminal states (Released, Refunded) with `SEED-` PayPal ids, so the sweep and
// webhooks never touch them and no PayPal call is ever made for them. Events carry `payload.seeded`.
import { existsSync } from "node:fs";
import { parseArgs } from "node:util";
if (existsSync(".env")) process.loadEnvFile(".env");

const { and, eq, inArray, like, sql } = await import("drizzle-orm");
const { getDb } = await import("@/lib/db");
const { events, orders, products, refunds, sellers } = await import("@/lib/db/schema");
const { platformFeeCents } = await import("@/lib/policy/fees");
const { shippingQuote } = await import("@/lib/policy/shipping");
const { PERSONAS } = await import("@/seed/catalog");

const { values } = parseArgs({
  options: {
    persona: { type: "string", default: "MX" },
    days: { type: "string", default: "30" },
    reset: { type: "boolean", default: false },
  },
});

const persona = PERSONAS.find((p) => p.country === values.persona);
if (!persona) throw new Error(`unknown persona ${values.persona}; one of ${PERSONAS.map((p) => p.country).join(", ")}`);
const days = Number(values.days);
const db = getDb();

// Buyer countries the MX catalog ships to, weighted toward the demo's story (US and Germany).
const COUNTRIES = ["US", "US", "US", "DE", "DE", "CA", "GB", "FR", "ES", "JP", "AU", "NL"];
const FEE_BPS = Number(process.env.PLATFORM_FEE_BPS ?? 500);
const PAYPAL_PCT = 349; // ~3.49% + 49¢, close to the sandbox fees in §6 "P2 exit run"

// mulberry32: same history on every run.
let seed = 0x5eed;
const rand = () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let r = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
  return ((r ^ (r >>> 14)) >>> 0) / 4_294_967_296;
};
const pick = <T>(list: readonly T[]) => list[Math.floor(rand() * list.length)]!;
const hex = (n: number) => Array.from({ length: n }, () => Math.floor(rand() * 16).toString(16)).join("").toUpperCase();

await db.transaction(async (tx) => {
  const seeded = await tx.select({ id: orders.id }).from(orders).where(and(eq(orders.sellerId, persona.id), like(orders.paypalOrderId, "SEED-%")));
  const ids = seeded.map((o) => o.id);
  if (ids.length) {
    await tx.delete(events).where(inArray(events.orderId, ids));
    await tx.delete(refunds).where(inArray(refunds.orderId, ids));
    await tx.delete(orders).where(inArray(orders.id, ids));
  }
  const removed = await tx.delete(events).where(sql`${events.payload}->>'seeded' = ${persona.id}`).returning({ id: events.id });
  console.log(`removed ${ids.length} seeded orders, ${removed.length} seeded events`);
  if (values.reset) return;

  const [seller] = await tx.select().from(sellers).where(eq(sellers.id, persona.id));
  if (!seller) throw new Error(`maker ${persona.id} not found; run pnpm seed first`);
  const catalog = await tx
    .select({ id: products.id, listPrice: products.listPrice, weightClass: products.weightClass })
    .from(products)
    .where(and(eq(products.sellerId, persona.id), eq(products.status, "live"), inArray(products.slug, persona.products.map((p) => p.slug))));
  if (!catalog.length) throw new Error("no live products for this maker; onboard and re-run pnpm seed");

  // A few products sell well, most a little: a believable "top products" chart.
  const popular = [...catalog].sort(() => rand() - 0.5);
  const weight = (i: number) => (i < 3 ? 6 : i < 8 ? 2 : 1);
  const weighted = popular.flatMap((p, i) => Array<typeof p>(weight(i)).fill(p));

  const now = Date.now();
  const orderRows: (typeof orders.$inferInsert)[] = [];
  const refundRows: { orderIndex: number; amount: number; fee: number }[] = [];
  const eventRows: (typeof events.$inferInsert)[] = [];
  const agent = (n: number) => `seed-agent-${n}`;
  const mcp = (type: string, at: Date, productId: string | null, payload: Record<string, unknown>) =>
    eventRows.push({
      type,
      source: "mcp",
      actor: agent(Math.floor(rand() * 40)),
      productId,
      createdAt: at,
      payload: { outcome: "ok", ms: 40 + Math.floor(rand() * 200), userAgent: "Claude-User", seeded: persona.id, ...payload },
    });

  for (let d = days; d >= 1; d--) {
    const dayStart = now - d * 86_400_000;
    const at = () => new Date(dayStart + Math.floor(rand() * 86_400_000));
    // Agent traffic grows over the month; weekends a bit busier.
    const traffic = 4 + Math.floor(((days - d) / days) * 10 + rand() * 6);

    for (let s = 0; s < traffic; s++) {
      const shown = [...catalog].sort(() => rand() - 0.5).slice(0, 3 + Math.floor(rand() * 5));
      mcp("mcp.search_products", at(), null, { count: shown.length, productIds: shown.map((p) => p.id), args: { query: "handwoven rug" } });
      for (const p of shown) {
        if (rand() < 0.45) mcp("mcp.get_product", at(), p.id, { args: { productId: p.id } });
        if (rand() < 0.18) mcp("mcp.ask_question", at(), p.id, { args: { productId: p.id }, audit: { answered: rand() < 0.8, answerer: "model" } });
        if (rand() < 0.1) mcp("mcp.make_offer", at(), p.id, { args: { productId: p.id }, audit: { decision: pick(["accept", "counter", "counter"]) } });
        if (rand() < 0.06) mcp("mcp.create_checkout", at(), p.id, { args: { productId: p.id, quantity: 1 } });
      }
    }

    const sales = Math.floor(rand() * 3 + (days - d) / 12);
    for (let s = 0; s < sales; s++) {
      const product = pick(weighted);
      const country = pick(COUNTRIES);
      const quantity = rand() < 0.85 ? 1 : 2;
      const unit = rand() < 0.3 ? Math.round((product.listPrice * (0.88 + rand() * 0.1)) / 100) * 100 : product.listPrice;
      const item = unit * quantity;
      const shipping = shippingQuote(persona.country, country, product.weightClass).cents;
      const fee = platformFeeCents(item, FEE_BPS);
      const gross = item + shipping;
      const paypalFee = Math.round((gross * PAYPAL_PCT) / 10_000) + 49;
      const capturedAt = at();
      const refunded = rand() < 0.07;
      const partial = !refunded && rand() < 0.05;
      const refundedAmount = refunded ? gross : partial ? Math.round(item * 0.2) : 0;
      const feeReturned = refunded ? fee : partial ? Math.round((fee * refundedAmount) / item) : 0;
      const releasedAt = new Date(Math.min(now, capturedAt.getTime() + (2 + rand() * 5) * 86_400_000));
      const ref = hex(17);
      orderRows.push({
        statusToken: hex(22),
        paypalOrderId: `SEED-${ref}`,
        captureId: `SEED-C${ref}`,
        sellerId: persona.id,
        productId: product.id,
        agentId: agent(Math.floor(rand() * 40)),
        quantity,
        unitAmount: unit,
        itemAmount: item,
        shippingAmount: shipping,
        currency: "USD",
        platformFee: fee,
        paypalFee,
        netAmount: gross - paypalFee - fee,
        refundedAmount,
        platformFeeRefunded: feeReturned,
        buyerCountry: country,
        status: refunded ? "Refunded" : "Released",
        captureStatus: refunded ? "REFUNDED" : partial ? "PARTIALLY_REFUNDED" : "COMPLETED",
        releaseStatus: refunded ? "held" : "released",
        releasedAt: refunded ? null : releasedAt,
        shippedAt: refunded ? null : new Date(capturedAt.getTime() + 86_400_000),
        expiresAt: new Date(capturedAt.getTime() + 3 * 3_600_000),
        approvedAt: capturedAt,
        capturedAt,
        createdAt: capturedAt,
      });
      if (refundedAmount) refundRows.push({ orderIndex: orderRows.length - 1, amount: refundedAmount, fee: feeReturned });
    }
  }

  const inserted = orderRows.length ? await tx.insert(orders).values(orderRows).returning({ id: orders.id }) : [];
  if (refundRows.length) {
    await tx.insert(refunds).values(
      refundRows.map((r) => ({
        orderId: inserted[r.orderIndex]!.id,
        n: 1,
        paypalRefundId: `SEED-R${hex(15)}`,
        amount: r.amount,
        platformFeeReturned: r.fee,
        reason: "Demo history",
        status: "COMPLETED",
        createdAt: orderRows[r.orderIndex]!.capturedAt!,
      })),
    );
  }
  for (let i = 0; i < eventRows.length; i += 1000) await tx.insert(events).values(eventRows.slice(i, i + 1000));
  console.log(`seeded ${persona.name}: ${inserted.length} orders (${refundRows.length} with refunds), ${eventRows.length} MCP events over ${days} days`);
});

await db.$client.end();
