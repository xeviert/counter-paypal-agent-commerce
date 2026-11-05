"use client";

import type {
  AgDefaultRegistry,
  AgTypeScriptComponent,
  AgWidgetData,
  AgWidgetDataFormat,
  AgWidgetFieldReference,
  AgWidgetParams,
  AgWidgetsConfig,
  AgWidgetState,
} from "ag-studio";
import { createWidgets, type AgRegistry, type AgWidgetDefinition } from "ag-studio-react";
import { useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { LOCALE_TAGS, type Locale, type T } from "@/lib/i18n/core";
import { PAYOUT_STATES, type PayoutState } from "@/lib/schemas/dashboard";
import { buildTimeline, TIMELINE_KINDS, toDay, type TimelineKind, type TimelineRow } from "./timeline";

// Counter's custom AG Studio widget (BUILDOUT §7.3): when each order's money reaches the maker.
// Registered next to Studio's own widgets and described for its AI agents, so "when do I get paid?"
// can place it. Bars run from the day the buyer paid to the day PayPal released the money, or will.

export const PAYOUT_TIMELINE = "payout-timeline";
const MAX_BARS = 15;

type Mapping = {
  order: AgWidgetFieldReference[];
  start: AgWidgetFieldReference[];
  end: AgWidgetFieldReference[];
  value?: AgWidgetFieldReference[];
  status?: AgWidgetFieldReference[];
};
export interface PayoutTimelineState extends AgWidgetData<Mapping, AgWidgetDataFormat<undefined>> {
  type: typeof PAYOUT_TIMELINE;
}
type Options = { t: T; locale: Locale; today: string };
type Params = AgWidgetParams<PayoutTimelineState, Options>;
type Definition = AgWidgetDefinition<typeof PAYOUT_TIMELINE, PayoutTimelineState, PayoutTimelineState, Options>;

interface CounterRegistry extends AgRegistry {
  widgets: readonly (AgDefaultRegistry["widgets"][number] | Definition)[];
}

// Validated with the dataviz checker (CVD + normal vision pass; contrast WARN → every bar has a text label).
const COLOR: Record<TimelineKind, string> = { paid: "var(--chart-3)", scheduled: "var(--chart-1)", waiting: "var(--chart-4)" };
// Studio's menu icons are 16 px line drawings in the current text color.
const ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M2 4h7M5 8h8M3 12h5"/><path d="M14 2v12" stroke-dasharray="1.5 1.5"/></svg>';
const STRIPES = "repeating-linear-gradient(135deg, transparent 0 3px, rgb(255 255 255 / 0.55) 3px 6px)";

function Swatch({ kind }: { kind: TimelineKind }) {
  return (
    <span
      aria-hidden
      className="inline-block size-3 shrink-0 rounded-sm"
      style={{ background: kind === "waiting" ? `${STRIPES}, ${COLOR[kind]}` : COLOR[kind] }}
    />
  );
}

function PayoutTimeline(params: Params) {
  const { t, locale, today } = params.config.options!;
  const [rows, setRows] = useState<TimelineRow[] | null>(null);

  // Studio passes new params on every filter or data change; refetch then.
  useEffect(() => {
    const { widgetApi, dataMapping } = params;
    const [order, start, end] = [dataMapping.order?.[0], dataMapping.start?.[0], dataMapping.end?.[0]];
    const value = dataMapping.value?.[0];
    const status = dataMapping.status?.[0];
    if (!order || !start || !end) {
      widgetApi.setDisplayState("incompleteDataMapping");
      return;
    }
    let live = true;
    widgetApi.setDisplayState("loading");
    // The payout field holds translated labels; map them back to states for the colors.
    const stateOf = new Map<string, PayoutState>(PAYOUT_STATES.flatMap((s) => [[t(`dashboard.payout.${s}`), s], [s, s]]));
    widgetApi
      .getData({
        fields: [order, start, end, ...(status ? [status] : []), ...(value ? [value] : [])],
        sort: [{ field: start, direction: "desc" }],
        limit: { count: MAX_BARS },
      })
      .then(({ results }) => {
        if (!live) return;
        const next = results.rows.flatMap((r): TimelineRow[] => {
          const day = toDay(r[start.key]);
          if (!day) return [];
          return [
            {
              order: String(r[order.key] ?? ""),
              start: day,
              end: toDay(r[end.key]),
              state: status ? (stateOf.get(String(r[status.key])) ?? null) : null,
              value: value ? widgetApi.formatFieldValue(value, r[value.key]) : null,
            },
          ];
        });
        setRows(next);
        widgetApi.setDisplayState(next.some((r) => r.state !== "refunded") ? "displayed" : "noData");
      })
      .catch(() => {
        if (live) widgetApi.setDisplayState("noData");
      });
    return () => {
      live = false;
    };
  }, [params, t]);

  if (!rows) return null;
  const timeline = buildTimeline(rows, today);
  const date = new Intl.DateTimeFormat(LOCALE_TAGS[locale], { month: "short", day: "numeric", timeZone: "UTC" });
  const fmt = (day: string) => date.format(new Date(`${day}T00:00:00Z`));
  const caption = (kind: TimelineKind, end: string | null) =>
    kind === "paid" && end
      ? t("dashboard.timeline.paidOn", { date: fmt(end) })
      : kind === "scheduled" && end
        ? t("dashboard.timeline.releasesOn", { date: fmt(end) })
        : t("dashboard.timeline.waiting");

  return (
    <div className="flex h-full flex-col gap-2 overflow-y-auto px-3 pb-3 text-xs">
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground">
        {TIMELINE_KINDS.map((kind) => (
          <li key={kind} className="flex items-center gap-1.5">
            <Swatch kind={kind} />
            {t(`dashboard.timeline.${kind}`)}
          </li>
        ))}
      </ul>
      <div className="relative flex justify-between border-b pb-1 text-muted-foreground tabular-nums" aria-hidden>
        <span>{fmt(timeline.from)}</span>
        <span>{fmt(timeline.to)}</span>
      </div>
      <ol className="relative flex flex-col gap-1">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-0 border-l border-dashed border-foreground/40"
          style={{ left: `${timeline.today}%` }}
        >
          <span
            className={`absolute -top-0.5 rounded bg-background px-1 text-[10px] text-muted-foreground ${timeline.today > 85 ? "right-1" : "left-1"}`}
          >
            {t("dashboard.timeline.today")}
          </span>
        </div>
        {timeline.bars.map((bar, i) => (
          <li key={`${bar.order}-${i}`} className="rounded px-1 py-0.5 hover:bg-muted">
            <p className="flex flex-wrap gap-x-2">
              <span className="font-mono font-medium">{bar.order}</span>
              {typeof bar.value === "string" && <span className="tabular-nums">{bar.value}</span>}
              <span className="text-muted-foreground">
                {fmt(bar.start)} → {caption(bar.kind, bar.end)}
              </span>
            </p>
            <div className="relative mt-0.5 h-2.5" aria-hidden>
              <div
                className={bar.kind === "waiting" ? "absolute inset-y-0 rounded-l-sm" : "absolute inset-y-0 rounded-sm"}
                style={{
                  left: `${bar.left}%`,
                  width: `max(${bar.width}%, 4px)`,
                  background: bar.kind === "waiting" ? `${STRIPES}, ${COLOR.waiting}` : COLOR[bar.kind],
                }}
              />
            </div>
          </li>
        ))}
      </ol>
      {timeline.bars.length === 0 && <p className="text-muted-foreground">{t("dashboard.timeline.empty")}</p>}
    </div>
  );
}

// Registered as a plain component class rather than a React component: in edit mode, Studio's React
// wrapper never re-rendered a widget the AI created empty and mapped afterwards (built-in widgets,
// which are classes, refresh fine). Each instance renders into its own React root instead.
class PayoutTimelineComp implements AgTypeScriptComponent<Params> {
  private readonly gui = document.createElement("div");
  private readonly root: Root = createRoot(this.gui);

  constructor() {
    this.gui.style.height = "100%";
  }

  getGui() {
    return this.gui;
  }
  init(params: Params) {
    this.root.render(<PayoutTimeline {...params} />);
  }
  refresh(params: Params) {
    this.root.render(<PayoutTimeline {...params} />);
  }
  destroy() {
    // Unmounting synchronously while Studio is mid-render warns; defer it.
    setTimeout(() => this.root.unmount());
  }
}

function definition(options: Options): Definition {
  const { t } = options;
  return {
    id: PAYOUT_TIMELINE,
    label: t("dashboard.widgets.payoutTimeline"),
    icon: ICON,
    comp: PayoutTimelineComp,
    options,
    defaultSize: { width: 600, height: 360 },
    minSize: { width: 280, height: 200 },
    dataMapping: {
      order: { type: "field", supportedRoles: ["category"], required: true, aiDescription: "Order reference, one bar per order (orders.ref)." },
      start: { type: "field", supportedRoles: ["temporal"], required: true, aiDescription: "Day the buyer paid (orders.day)." },
      end: {
        type: "field",
        supportedRoles: ["temporal"],
        required: true,
        aiDescription: "Day PayPal released the money or will release it (orders.payoutDay).",
      },
      value: { type: "field", supportedRoles: ["numeric"], aiDescription: "Amount shown next to each order, usually the sum of orders.net." },
      status: { type: "field", supportedRoles: ["category"], aiDescription: "Payout state, used for the bar colors (orders.payout)." },
    },
    defaultState: { format: { title: { enabled: true, text: t("dashboard.widgets.payoutTimeline") } } },
    form: ({ createDefaults }) =>
      createDefaults({
        dataMappingItems: [
          { key: "order", label: t("dashboard.timeline.order") },
          { key: "start", label: t("dashboard.timeline.start") },
          { key: "end", label: t("dashboard.timeline.end") },
          { key: "value", label: t("dashboard.timeline.value") },
          { key: "status", label: t("dashboard.timeline.status") },
        ],
      }),
    ai: {
      label: "Payout timeline",
      description:
        "One horizontal bar per recent order (newest first, up to 15), from the day the buyer paid to the day PayPal released the money to the maker or is due to. Colors: paid out, release date set, waiting for tracking (open bar). A dashed line marks today.",
      usage:
        "Use when the maker asks when they get paid, what PayPal is still holding, or when money will arrive. Not for totals or trends; use a value or column chart for those.",
      configuration:
        "Map order = orders.ref, start = orders.day, end = orders.payoutDay, value = sum of orders.net, status = orders.payout. Filter on orders.day to change the period.",
    },
  };
}

// Studio's typed props and events only know the built-in widgets (its events aren't generic over a
// registry), so ours crosses into them here, once each for the registry and the report state.

/** For Studio's `widgets` prop: the built-in widgets plus ours, in its own menu group so the edit panel and the AI catalogue list it. */
export function counterWidgets(options: Options) {
  const timeline = definition(options);
  return (defaults: AgWidgetsConfig<AgDefaultRegistry>) =>
    createWidgets<CounterRegistry>({
      additionalTypes: [timeline],
      menu: [...defaults.menu, { label: "Counter", widgetIds: [PAYOUT_TIMELINE] }],
    }) as unknown as AgWidgetsConfig<AgDefaultRegistry>;
}

export const payoutTimelineWidget = (state: Omit<PayoutTimelineState, "type">) =>
  ({ type: PAYOUT_TIMELINE, ...state }) as unknown as AgWidgetState<AgDefaultRegistry>;
