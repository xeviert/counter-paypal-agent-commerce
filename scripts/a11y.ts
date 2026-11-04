// axe-core scan of the buyer pages and the maker app at phone size (BUILDOUT §7.7).
// Usage: pnpm a11y [--base-url http://localhost:3000] [--all]
//
// Run against a server on the same database and SESSION_SECRET as this script: it signs a demo maker's
// cookie itself and adds a throwaway `ready` draft for the review screen, removed at the end.
// Exits 1 on any serious or critical violation (--all also prints moderate/minor ones).
// /checkout/cancel isn't scanned: it cancels the order, then redirects to the /o page scanned here.
import { existsSync } from "node:fs";
import { parseArgs } from "node:util";
if (existsSync(".env")) process.loadEnvFile(".env");

const { AxeBuilder } = await import("@axe-core/playwright");
const { chromium } = await import("playwright");
const { and, desc, eq, inArray } = await import("drizzle-orm");
const { getDb } = await import("@/lib/db");
const { drafts, orders, products, sellers } = await import("@/lib/db/schema");
const { SESSION_COOKIE } = await import("@/lib/auth/cookie");
const { signSession } = await import("@/lib/auth/token");
const { sellableConditions } = await import("@/lib/shop/catalog");
const { listDemoSellers } = await import("@/lib/shop/sellers");

const { values } = parseArgs({
  options: {
    "base-url": { type: "string", default: "http://localhost:3000" },
    all: { type: "boolean", default: false },
  },
});
const base = values["base-url"].replace(/\/+$/, "");
const secret = process.env.SESSION_SECRET;
if (!secret) throw new Error("SESSION_SECRET is not set; use the same value as the server");

const db = getDb();
const [product] = await db
  .select({ slug: products.slug, sellerId: products.sellerId })
  .from(products)
  .innerJoin(sellers, eq(products.sellerId, sellers.id))
  .where(and(...sellableConditions()))
  .limit(1);
const demoIds = (await listDemoSellers(db)).map((s) => s.id);
const [order] = demoIds.length
  ? await db
      .select({ id: orders.id, statusToken: orders.statusToken, sellerId: orders.sellerId })
      .from(orders)
      .where(inArray(orders.sellerId, demoIds))
      .orderBy(desc(orders.createdAt))
      .limit(1)
  : [];
if (!product || !order) throw new Error("needs a sellable product and a demo maker's order: pnpm seed && pnpm seed:activity");
const maker = { id: order.sellerId };

const [draft] = await db
  .insert(drafts)
  .values({
    sellerId: maker.id,
    stage: "ready",
    transcript: "a11y fixture",
    result: {
      draft: {
        category: "textiles",
        weightClass: "medium",
        listing: {
          language: "es",
          en: { title: "Wool rug", description: "Handwoven wool rug with a Zapotec pattern." },
          native: { title: "Tapete de lana", description: "Tapete de lana tejido a mano, diseño zapoteco." },
        },
      },
      priceGuidance: { low: 18000, high: 26000, rationale: "Similar handwoven rugs sell in this range." },
    },
  })
  .returning({ id: drafts.id });

const pages = [
  { path: "/", maker: false },
  { path: `/p/${product.slug}`, maker: false },
  { path: `/o/${order.statusToken}`, maker: false },
  { path: "/s/login", maker: false },
  { path: "/s", maker: true },
  { path: "/s/new", maker: true },
  { path: `/s/drafts/${draft!.id}`, maker: true },
  { path: "/s/listings", maker: true },
  { path: "/s/orders", maker: true },
  { path: `/s/orders/${order.id}`, maker: true },
  { path: "/s/inbox", maker: true },
  { path: "/s/copilot", maker: true },
];

const browser = await chromium.launch();
let blocking = 0;
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const makerContext = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  await makerContext.addCookies([
    { name: SESSION_COOKIE, value: signSession(secret, maker.id), url: `${base}/s` },
  ]);

  for (const { path, maker: signedIn } of pages) {
    const page = await (signedIn ? makerContext : context).newPage();
    const response = await page.goto(`${base}${path}`, { waitUntil: "networkidle" });
    if (signedIn && new URL(page.url()).pathname === "/s/login") throw new Error(`${path} redirected to login: SESSION_SECRET differs from the server's`);
    const { violations } = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
    const serious = violations.filter((v) => v.impact === "serious" || v.impact === "critical");
    blocking += serious.length;
    const shown = values.all ? violations : serious;
    console.log(`${shown.length === 0 ? "ok  " : "FAIL"} ${response?.status()} ${path.replace(/[^/]{20,}/, "…")} (${violations.length} total)`);
    for (const v of shown) {
      console.log(`     ${v.impact} ${v.id}: ${v.help}`);
      for (const node of v.nodes.slice(0, 5)) console.log(`       ${node.target.join(" ")}`);
    }
    await page.close();
  }
} finally {
  await browser.close();
  await db.delete(drafts).where(eq(drafts.id, draft!.id));
  await db.$client.end();
}

console.log(blocking === 0 ? "\nNo serious or critical violations" : `\n${blocking} serious/critical violation(s)`);
process.exit(blocking === 0 ? 0 : 1);
