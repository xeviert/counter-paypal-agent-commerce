import type { AgPageState, AgReportState, AgWidgetLayoutState } from "ag-studio";
import type { T } from "@/lib/i18n/core";
import { payoutTimelineWidget } from "./payout-timeline";

// The dashboard a maker starts with, and goes back to on reset: a Sales page (what they earned,
// what PayPal still holds, who bought) and an Agents page (what shopping agents did with their
// listings). Field ids refer to ./data.ts. 24-column canvas.

const at = (xTrack: number, yTrack: number, xSpan: number, ySpan: number): AgWidgetLayoutState => ({ xTrack, yTrack, xSpan, ySpan });
const titled = (text: string) => ({ title: { enabled: true, text } });
const withLegend = (text: string) => ({ ...titled(text), style: { theme: { common: { legend: { enabled: true } } } } });
const sum = (id: string) => ({ id, aggregation: "sum" as const });
const countd = (id: string) => ({ id, aggregation: "countd" as const });

const kpi = (text: string, value: { id: string; aggregation: "sum" | "countd" }) => ({
  type: "value" as const,
  dataMapping: { value: [value], sparklineX: [{ id: "calendar::week" }] },
  format: titled(text),
});

export function defaultReport(t: T): AgReportState {
  const sales: AgPageState = {
    id: "sales",
    widgets: {
      dates: { type: "date-filter", dataMapping: { value: [{ id: "orders.day" }] }, format: { style: { filterType: "between" } } },
      "kpi-net": kpi(t("dashboard.widgets.net"), sum("orders.net")),
      "kpi-gross": kpi(t("dashboard.widgets.gross"), sum("orders.gross")),
      "kpi-orders": kpi(t("dashboard.widgets.orders"), countd("orders.ref")),
      "kpi-held": kpi(t("dashboard.widgets.held"), sum("orders.heldNet")),
      earnings: {
        type: "column-chart-grouped",
        dataMapping: { categoryKey: [{ id: "calendar::week" }], valueKey: [sum("orders.net")] },
        format: titled(t("dashboard.widgets.earnings")),
      },
      payouts: {
        type: "donut-chart",
        dataMapping: { categoryKey: [{ id: "orders.payout" }], valueKey: [sum("orders.gross")] },
        format: withLegend(t("dashboard.widgets.payouts")),
      },
      countries: {
        type: "bar-chart-grouped",
        dataMapping: { categoryKey: [{ id: "orders.countryName" }], valueKey: [sum("orders.net")] },
        sort: [{ field: sum("orders.net"), direction: "desc" }],
        format: titled(t("dashboard.widgets.countries")),
      },
      "top-products": {
        type: "bar-chart-grouped",
        dataMapping: { categoryKey: [{ id: "products.title" }], valueKey: [sum("orders.net")] },
        sort: [{ field: sum("orders.net"), direction: "desc" }],
        format: titled(t("dashboard.widgets.topProducts")),
      },
      timeline: payoutTimelineWidget({
        dataMapping: {
          order: [{ id: "orders.ref" }],
          start: [{ id: "orders.day" }],
          end: [{ id: "orders.payoutDay" }],
          value: [sum("orders.net")],
          status: [{ id: "orders.payout" }],
        },
        format: titled(t("dashboard.widgets.payoutTimeline")),
      }),
      "order-list": {
        type: "grid",
        dataMapping: {
          cols: [
            { id: "orders.day" },
            { id: "orders.ref" },
            { id: "products.title" },
            { id: "orders.countryName" },
            { id: "orders.payout" },
            sum("orders.gross"),
            sum("orders.net"),
          ],
        },
        sort: [{ field: { id: "orders.day" }, direction: "desc" }],
        format: titled(t("dashboard.widgets.orderList")),
      },
    },
    widgetLayout: {
      "kpi-net": at(0, 0, 4, 7),
      "kpi-gross": at(4, 0, 4, 7),
      "kpi-orders": at(8, 0, 4, 7),
      "kpi-held": at(12, 0, 4, 7),
      dates: at(16, 0, 8, 7),
      earnings: at(0, 7, 16, 16),
      payouts: at(16, 7, 8, 16),
      countries: at(0, 23, 12, 16),
      "top-products": at(12, 23, 12, 16),
      timeline: at(0, 39, 24, 18),
      "order-list": at(0, 57, 24, 20),
    },
  };

  const agents: AgPageState = {
    id: "agents",
    widgets: {
      dates: { type: "date-filter", dataMapping: { value: [{ id: "activity.day" }] }, format: { style: { filterType: "between" } } },
      funnel: {
        type: "funnel-chart",
        dataMapping: { categoryKey: [{ id: "activity.stage" }], valueKey: [sum("activity.count")] },
        sort: [{ field: { id: "activity.stage" }, direction: "asc" }],
        format: titled(t("dashboard.widgets.funnel")),
      },
      "by-product": {
        type: "bar-chart-stacked",
        dataMapping: {
          categoryKey: [{ id: "products.title" }],
          valueKey: [sum("activity.count")],
          legendKey: [{ id: "activity.stage" }],
        },
        format: withLegend(t("dashboard.widgets.agentsByProduct")),
      },
      "by-day": {
        type: "line-chart",
        dataMapping: {
          categoryKey: [{ id: "calendar::week" }],
          valueKey: [sum("activity.count")],
          legendKey: [{ id: "activity.stage" }],
        },
        format: withLegend(t("dashboard.widgets.agentsByDay")),
      },
    },
    widgetLayout: {
      dates: at(10, 0, 14, 7),
      funnel: at(0, 0, 10, 22),
      "by-day": at(10, 7, 14, 15),
      "by-product": at(0, 22, 24, 18),
    },
  };

  return { selectedPageId: sales.id, pages: [sales, agents] };
}

/** Page names live with the host, not in Studio's state. AI-added pages get a number. */
export function pageTitle(id: string, index: number, t: T): string {
  if (id === "sales") return t("dashboard.pages.sales");
  if (id === "agents") return t("dashboard.pages.agents");
  return `${t("dashboard.title")} ${index + 1}`;
}
