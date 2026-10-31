// Connect a maker's PayPal account (BUILDOUT §5.3) and store the result on `sellers`.
// New maker:      pnpm onboard MX --name "Ana Ruiz" --language es [--locality Oaxaca] [--email ana@...]
// Resume:         pnpm onboard --seller <sellers.id>
// Already linked: pnpm onboard PH --name "Rosa" --language fil --merchant-id MPMWEFYQWQYUA
// The browser step: open the printed link and log in as that country's sandbox business account.
import { existsSync } from "node:fs";
import { parseArgs } from "node:util";
if (existsSync(".env")) process.loadEnvFile(".env");

const { eq } = await import("drizzle-orm");
const { getEnv } = await import("@/lib/env");
const { getDb } = await import("@/lib/db");
const { sellers } = await import("@/lib/db/schema");
const { language, sellerCountry } = await import("@/lib/schemas/common");
const { createReferral, findMerchantIdByTrackingId } = await import("@/lib/paypal/referrals");
const { syncOnboarding } = await import("@/lib/shop/onboarding");

const POLL_MS = 5_000;
const TIMEOUT_MS = 15 * 60_000;

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    name: { type: "string" },
    language: { type: "string" },
    locality: { type: "string" },
    email: { type: "string" },
    seller: { type: "string" },
    "merchant-id": { type: "string" },
  },
});

const db = getDb();

async function loadOrCreateSeller() {
  if (values.seller) {
    const [found] = await db.select().from(sellers).where(eq(sellers.id, values.seller));
    if (!found) throw new Error(`no seller ${values.seller}`);
    return found;
  }
  const merchantId = values["merchant-id"];
  if (merchantId) {
    const [found] = await db.select().from(sellers).where(eq(sellers.merchantId, merchantId));
    if (found) return found;
  }
  if (!values.name || !values.language) throw new Error("--name and --language are required for a new seller");
  const [created] = await db
    .insert(sellers)
    .values({
      name: values.name,
      country: sellerCountry.parse(positionals[0]?.toUpperCase()),
      language: language.parse(values.language),
      locality: values.locality,
    })
    .returning();
  console.log(`created seller ${created!.id}`);
  return created!;
}

async function waitForMerchantId(trackingId: string): Promise<string> {
  const deadline = Date.now() + TIMEOUT_MS;
  for (;;) {
    const merchantId = await findMerchantIdByTrackingId(trackingId);
    if (merchantId) return merchantId;
    if (Date.now() > deadline) throw new Error(`timed out; resume with: pnpm onboard --seller ${trackingId}`);
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
}

try {
  const seller = await loadOrCreateSeller();
  let merchantId = values["merchant-id"] ?? seller.merchantId ?? (await findMerchantIdByTrackingId(seller.id));

  if (!merchantId) {
    const actionUrl = await createReferral(seller.id, `${getEnv().APP_BASE_URL}/`, values.email);
    console.log(`\nOPEN AND CONNECT AS THE ${seller.country} SANDBOX BUSINESS ACCOUNT:\n${actionUrl}\n`);
    console.log("waiting for PayPal to link the account...");
    merchantId = await waitForMerchantId(seller.id);
  }

  const status = await syncOnboarding(db, seller, { source: "script", merchantId });
  if (!status) throw new Error("unreachable: the merchant id is known");

  console.log(`\nseller ${seller.id} (${seller.name}, ${seller.country})`);
  console.log(`merchant_id              ${status.merchantId}`);
  console.log(`payments_receivable      ${status.paymentsReceivable}`);
  console.log(`primary_email_confirmed  ${status.primaryEmailConfirmed}`);
  console.log(`granted scopes (${status.grantedScopes.length}):`);
  for (const scope of status.grantedScopes) console.log(`  ${scope}`);
  if (!status.paymentsReceivable) console.log("\nWARNING: payments_receivable is false; listings must stay unpublished");
} finally {
  await db.$client.end();
}
