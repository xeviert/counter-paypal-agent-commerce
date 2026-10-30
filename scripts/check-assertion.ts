// Re-checks which read APIs accept PayPal-Auth-Assertion for a connected maker (ARCHITECTURE §11 #3).
// Read-only GETs. Usage: pnpm check:assertion [--merchant-id MPMWEFYQWQYUA]
import { existsSync } from "node:fs";
import { parseArgs } from "node:util";
if (existsSync(".env")) process.loadEnvFile(".env");

const { PayPalError, paypalRequest } = await import("@/lib/paypal/client");
const { authAssertion } = await import("@/lib/paypal/assertion");

const { values } = parseArgs({
  options: { "merchant-id": { type: "string", default: "MPMWEFYQWQYUA" } },
});

const assertion = authAssertion({ merchantId: values["merchant-id"] });
const end = new Date();
const start = new Date(end.getTime() - 30 * 24 * 3600_000);
const iso = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, "Z");

const checks: [label: string, path: string][] = [
  [
    "reporting: transactions (30 days)",
    `/v1/reporting/transactions?start_date=${iso(start)}&end_date=${iso(end)}&page_size=5`,
  ],
  ["reporting: balances", "/v1/reporting/balances"],
  ["disputes: list", "/v1/customer/disputes?page_size=5"],
];

for (const [label, path] of checks) {
  try {
    const body = await paypalRequest<Record<string, unknown>>(`check.${label}`, path, {
      headers: { "PayPal-Auth-Assertion": assertion },
    });
    const items = (body.transaction_details ?? body.balances ?? body.items) as unknown[] | undefined;
    console.log(`OK    ${label}${items ? ` (${items.length} items)` : ""}`);
  } catch (err) {
    if (!(err instanceof PayPalError)) throw err;
    console.log(`FAIL  ${label}: ${err.status} ${err.issue ?? ""} debug_id=${err.debugId ?? "?"}`);
  }
}
