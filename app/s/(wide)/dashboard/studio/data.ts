import type { AgDataSourcesDefinition, AgFieldDefinition, AgFormat, AgRelationDefinition } from "ag-studio";
import { countryName, LOCALE_TAGS, type Locale, type MessageKey, type T } from "@/lib/i18n/core";
import { FUNNEL_STAGES, type DashboardDataset } from "@/lib/schemas/dashboard";

// The maker's dataset as AG Studio data sources: three tables, joined on product id, sharing one
// calendar. Labels are in the maker's language; descriptions are for Studio's AI agents.
// Money arrives in cents and becomes major units here, for display only.

export const CALENDAR_ID = "calendar";

const toMajor = (cents: number) => cents / 100;

type FieldSpec = [id: string, label: MessageKey, format: AgFormat, description?: string, hide?: boolean];

export function buildStudioData(dataset: DashboardDataset, t: T, locale: Locale): AgDataSourcesDefinition {
  const currency = dataset.orders[0]?.currency ?? dataset.products[0]?.currency ?? "USD";
  const money = new Intl.NumberFormat(LOCALE_TAGS[locale], { style: "currency", currency });

  const fields = (specs: FieldSpec[]): AgFieldDefinition[] =>
    specs.map(([id, label, format, description, hide]) => ({
      id,
      name: t(label),
      format,
      ...(description && { description }),
      ...(hide && { hide }),
      ...(format === "currencyFormat" && { formatOptions: { format: money } }),
    }));

  const manyToOne = (id: string, tableId: string): AgRelationDefinition => ({
    id,
    source: { tableId, fieldId: "productId" },
    target: { tableId: "products", fieldId: "id" },
    type: "many-to-one",
  });

  const orders = dataset.orders.map((o) => ({
    ref: o.ref,
    day: o.day,
    productId: o.productId,
    country: o.buyerCountry,
    countryName: countryName(o.buyerCountry, locale),
    payout: t(`dashboard.payout.${o.payout}`),
    currency: o.currency,
    units: o.units,
    gross: toMajor(o.grossCents),
    refunded: toMajor(o.refundedCents),
    counterFee: toMajor(o.counterFeeCents),
    paypalFee: toMajor(o.paypalFeeCents),
    net: toMajor(o.netCents),
    heldNet: o.payout === "held" || o.payout === "pending" ? toMajor(o.netCents) : 0,
    paidOutNet: o.payout === "released" ? toMajor(o.netCents) : 0,
  }));

  // Start the calendar at the first day with data, so a new shop has no run of empty weeks.
  const firstDay = [...dataset.orders, ...dataset.activity].reduce((min, r) => (r.day < min ? r.day : min), dataset.to);

  return {
    description:
      `One maker's shop on Counter from ${dataset.from} to ${dataset.to}, days in the maker's time zone (${dataset.timeZone}). ` +
      `Money is in ${currency}. Orders are paid orders only. Agent activity counts what AI shopping agents did with the maker's products ` +
      "(found in search, viewed, asked a question, made an offer, started checkout) plus paid orders, one row per day, product and step.",
    sources: [
      {
        id: "orders",
        name: t("dashboard.tables.orders"),
        description: "One row per paid order. Net is what the maker keeps after the Counter and PayPal fees and any refund.",
        data: orders,
        fields: fields([
          ["ref", "dashboard.fields.ref", "textFormat", "Order reference the maker sees, e.g. 3F9A12BC."],
          ["day", "dashboard.fields.day", "dateFormat", "Day the buyer paid."],
          ["productId", "dashboard.fields.product", "textFormat", undefined, true],
          ["country", "dashboard.fields.country", "textFormat", "Buyer's ISO country code.", true],
          ["countryName", "dashboard.fields.country", "textFormat", "Buyer's country, in the maker's language."],
          ["payout", "dashboard.fields.payout", "textFormat", "Held by PayPal until shipped and released, paid to the maker, or refunded."],
          ["currency", "dashboard.fields.currency", "textFormat", undefined, true],
          ["units", "dashboard.fields.units", "integerFormat"],
          ["gross", "dashboard.fields.gross", "currencyFormat", "Item plus shipping, what the buyer paid."],
          ["refunded", "dashboard.fields.refunded", "currencyFormat"],
          ["counterFee", "dashboard.fields.counterFee", "currencyFormat"],
          ["paypalFee", "dashboard.fields.paypalFee", "currencyFormat"],
          ["net", "dashboard.fields.net", "currencyFormat", "What the maker keeps."],
          ["heldNet", "dashboard.widgets.held", "currencyFormat", "Net still held by PayPal (0 once paid out or refunded)."],
          ["paidOutNet", "dashboard.payout.released", "currencyFormat", "Net already paid out to the maker."],
        ]),
      },
      {
        id: "products",
        name: t("dashboard.tables.products"),
        description: "The maker's listings. Title is in the maker's own words.",
        data: dataset.products.map((p) => ({
          id: p.id,
          title: p.title,
          category: t(`categories.${p.category}`),
          listPrice: toMajor(p.listPriceCents),
          live: p.live,
          stock: p.stock,
        })),
        fields: fields([
          ["id", "dashboard.fields.product", "textFormat", undefined, true],
          ["title", "dashboard.fields.product", "textFormat"],
          ["category", "dashboard.fields.category", "textFormat"],
          ["listPrice", "dashboard.fields.listPrice", "currencyFormat"],
          ["live", "dashboard.fields.live", "booleanFormat"],
          ["stock", "dashboard.fields.stock", "integerFormat"],
        ]),
      },
      {
        id: "activity",
        name: t("dashboard.tables.activity"),
        description:
          "Counts of AI shopping agent steps per day and product, in funnel order (step order 1 = found in search … 6 = paid). " +
          "Sum Times to count; several buyers' agents can share one identity, so these are events, not people.",
        data: dataset.activity.map((a) => ({
          day: a.day,
          productId: a.productId,
          // Numbered so the funnel and any agent-built chart sort steps in order.
          stage: `${FUNNEL_STAGES.indexOf(a.stage) + 1} · ${t(`dashboard.stages.${a.stage}`)}`,
          stageOrder: FUNNEL_STAGES.indexOf(a.stage) + 1,
          count: a.count,
        })),
        fields: fields([
          ["day", "dashboard.fields.day", "dateFormat"],
          ["productId", "dashboard.fields.product", "textFormat", undefined, true],
          ["stage", "dashboard.fields.stage", "textFormat"],
          ["stageOrder", "dashboard.fields.stageOrder", "integerFormat", undefined, true],
          ["count", "dashboard.fields.count", "integerFormat"],
        ]),
      },
    ],
    relationships: [
      manyToOne("order-product", "orders"),
      manyToOne("activity-product", "activity"),
      { id: "orders-day-calendar", source: { tableId: "orders", fieldId: "day" }, target: { calendarId: CALENDAR_ID } },
      { id: "activity-day-calendar", source: { tableId: "activity", fieldId: "day" }, target: { calendarId: CALENDAR_ID } },
    ],
    calendars: [
      {
        id: CALENDAR_ID,
        label: t("dashboard.widgets.dates"),
        range: { from: { type: "date", value: firstDay }, to: { type: "date", value: dataset.to } },
        fragments: ["year", "month", "week", "day", "dayOfWeek"],
      },
    ],
  };
}

