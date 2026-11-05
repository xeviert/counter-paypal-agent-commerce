import type { PayoutState } from "@/lib/schemas/dashboard";

// Geometry for the payout timeline widget (./payout-timeline.tsx), kept free of Studio and React so
// it can be tested. One bar per order from the day the buyer paid to the day PayPal released the
// money (or will). Refunds have no payout and are left out.

export type TimelineKind = "paid" | "scheduled" | "waiting";
export const TIMELINE_KINDS: readonly TimelineKind[] = ["paid", "scheduled", "waiting"];

export type TimelineRow = {
  order: string;
  /** `YYYY-MM-DD`. */
  start: string;
  end: string | null;
  /** Unknown when the payout field isn't mapped or holds something else. */
  state: PayoutState | null;
  value: unknown;
};

export type TimelineBar = TimelineRow & {
  kind: TimelineKind;
  /** Left edge and width as a percentage of the track. */
  left: number;
  width: number;
};

export type Timeline = { from: string; to: string; today: number; bars: TimelineBar[] };

const DAY_MS = 86_400_000;
const toMs = (day: string) => Date.parse(`${day}T00:00:00Z`);

/** Studio hands dates back as `Date`, epoch ms or ISO strings depending on the field; all become `YYYY-MM-DD`. */
export function toDay(value: unknown): string | null {
  if (value == null || value === "") return null;
  if (typeof value === "string") return /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : null;
  const date = value instanceof Date ? value : typeof value === "number" ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return null;
  // Studio builds dates at local midnight, so read them back in local time.
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function kindOf(row: Pick<TimelineRow, "end" | "state">, today: string): TimelineKind {
  if (row.state === "released") return "paid";
  if (row.end === null) return "waiting";
  if (row.state === null && row.end <= today) return "paid";
  return "scheduled";
}

/** Bars on one shared day axis that always includes today. A waiting bar runs to today, open-ended. */
export function buildTimeline(rows: TimelineRow[], today: string): Timeline {
  const kept = rows.filter((r) => r.state !== "refunded");
  const days = [today, ...kept.flatMap((r) => (r.end ? [r.start, r.end] : [r.start]))];
  const from = days.reduce((a, b) => (b < a ? b : a));
  const to = days.reduce((a, b) => (b > a ? b : a));
  // One extra day so a bar that starts and ends on the same day still has width.
  const span = toMs(to) - toMs(from) + DAY_MS;
  const pct = (day: string) => ((toMs(day) - toMs(from)) / span) * 100;

  return {
    from,
    to,
    // End of today, where a bar paid or waiting today stops.
    today: pct(today) + (DAY_MS / span) * 100,
    bars: kept.map((r) => {
      const end = r.end ?? (today > r.start ? today : r.start);
      const left = pct(r.start);
      return { ...r, kind: kindOf(r, today), left, width: pct(end) + (DAY_MS / span) * 100 - left };
    }),
  };
}
