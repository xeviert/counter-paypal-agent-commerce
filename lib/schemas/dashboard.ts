import type { Category } from "./common";

// The maker dashboard's dataset (BUILDOUT §7.3), shared by lib/shop/analytics.ts (builds it) and the
// browser (hands it to AG Studio). Client-safe: no DB imports.

export const DASHBOARD_DAYS = 90;

export const PAYOUT_STATES = ["pending", "held", "released", "refunded"] as const;
export type PayoutState = (typeof PAYOUT_STATES)[number];

/** Agent shopping steps, in funnel order. `paid` comes from orders, the rest from MCP events. */
export const FUNNEL_STAGES = ["search", "view", "question", "offer", "checkout", "paid"] as const;
export type FunnelStage = (typeof FUNNEL_STAGES)[number];

export type DashboardOrder = {
  ref: string;
  /** Capture day in the maker's time zone, `YYYY-MM-DD`. */
  day: string;
  productId: string;
  buyerCountry: string;
  payout: PayoutState;
  currency: string;
  units: number;
  grossCents: number;
  refundedCents: number;
  counterFeeCents: number;
  paypalFeeCents: number;
  netCents: number;
};

export type DashboardProduct = {
  id: string;
  title: string;
  category: Category;
  listPriceCents: number;
  currency: string;
  live: boolean;
  stock: number;
};

export type DashboardActivity = { day: string; productId: string; stage: FunnelStage; count: number };

export type DashboardDataset = {
  timeZone: string;
  /** First and last day of the window, `YYYY-MM-DD` in `timeZone`. */
  from: string;
  to: string;
  orders: DashboardOrder[];
  products: DashboardProduct[];
  activity: DashboardActivity[];
};
