// Creates or repoints the Platform app's webhook: pnpm paypal:webhook <public base URL> [--all]
// --all subscribes to every event type ("*"), for discovering what PayPal actually sends.
import { existsSync } from "node:fs";
if (existsSync(".env")) process.loadEnvFile(".env");

const { paypalRequest } = await import("@/lib/paypal/client");
const { WEBHOOK_EVENT_TYPES } = await import("@/lib/paypal/webhooks");

const base = process.argv[2]?.replace(/\/+$/, "");
if (!base?.startsWith("https://")) {
  console.error("usage: pnpm paypal:webhook https://<public host>");
  process.exit(1);
}
const url = `${base}/api/webhooks/paypal`;
const all = process.argv.includes("--all");

type Webhook = { id: string; url: string; event_types: { name: string }[] };

const available = await paypalRequest<{ event_types: { name: string }[] }>(
  "webhooks.event-types",
  "/v1/notifications/webhooks-event-types",
);
const known = new Set(available.event_types.map((e) => e.name));
const unknown = all ? [] : WEBHOOK_EVENT_TYPES.filter((name) => !known.has(name));
// PayPal's list is incomplete (no referenced-payout events), so this only warns about typos.
if (unknown.length) console.warn(`not in PayPal's event-type list: ${unknown.join(", ")}`);

const { webhooks } = await paypalRequest<{ webhooks: Webhook[] }>("webhooks.list", "/v1/notifications/webhooks");
const existing = webhooks.find((w) => w.url.endsWith("/api/webhooks/paypal"));
const eventTypes = all ? [{ name: "*" }] : WEBHOOK_EVENT_TYPES.map((name) => ({ name }));

const webhook = existing
  ? await paypalRequest<Webhook>("webhooks.update", `/v1/notifications/webhooks/${existing.id}`, {
      method: "PATCH",
      body: [
        { op: "replace", path: "/url", value: url },
        { op: "replace", path: "/event_types", value: eventTypes },
      ],
    })
  : await paypalRequest<Webhook>("webhooks.create", "/v1/notifications/webhooks", {
      method: "POST",
      body: { url, event_types: eventTypes },
    });

console.log(`${existing ? "updated" : "created"} webhook ${webhook.id}`);
console.log(`  url: ${webhook.url}`);
console.log(`  events: ${webhook.event_types.map((e) => e.name).join(", ")}`);
console.log(`\nSet PAYPAL_WEBHOOK_ID=${webhook.id} in .env (and on Render).`);
