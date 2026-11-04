import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { Tx } from "@/lib/db";
import { sellerDashboards } from "@/lib/db/schema";

// The maker's saved AG Studio report. Studio validates its own state on load (`onErrorRaised`), so
// we only check the outer shape and size; a broken save falls back to the default report.

export const MAX_DASHBOARD_BYTES = 256 * 1024;

export const reportState = z.looseObject({
  pages: z.array(z.looseObject({ id: z.string().min(1).max(100) })).min(1).max(20),
  selectedPageId: z.string().min(1).max(100),
});

export type SavedReport = z.infer<typeof reportState>;

export async function loadDashboard(db: Tx, sellerId: string): Promise<SavedReport | null> {
  const [row] = await db.select({ state: sellerDashboards.state }).from(sellerDashboards).where(eq(sellerDashboards.sellerId, sellerId));
  const parsed = reportState.safeParse(row?.state);
  return parsed.success ? parsed.data : null;
}

type Filters = { page?: unknown[]; widget?: Record<string, unknown[]> };

/**
 * Studio 3.0 saves relative date filters ("this month") in a shape it then rejects on load ("must be
 * a two-element range"), which would throw away the whole report. They're dropped before saving.
 */
export function withoutRelativeFilters(state: SavedReport): SavedReport {
  const keep = (filter: unknown) => !JSON.stringify(filter).includes('"inRelativeRange"');
  return {
    ...state,
    pages: state.pages.map((page) => {
      const filter = page.filter as Filters | undefined;
      if (!filter) return page;
      return {
        ...page,
        filter: {
          ...filter,
          ...(filter.page && { page: filter.page.filter(keep) }),
          ...(filter.widget && {
            widget: Object.fromEntries(Object.entries(filter.widget).map(([id, list]) => [id, list.filter(keep)])),
          }),
        },
      };
    }),
  };
}

/** False when the state is too big or not report-shaped. */
export async function saveDashboard(db: Tx, sellerId: string, state: unknown): Promise<boolean> {
  const parsed = reportState.safeParse(state);
  if (!parsed.success || JSON.stringify(parsed.data).length > MAX_DASHBOARD_BYTES) return false;
  const clean = withoutRelativeFilters(parsed.data);
  await db
    .insert(sellerDashboards)
    .values({ sellerId, state: clean })
    .onConflictDoUpdate({ target: sellerDashboards.sellerId, set: { state: clean, updatedAt: sql`now()` } });
  return true;
}

export async function resetDashboard(db: Tx, sellerId: string): Promise<void> {
  await db.delete(sellerDashboards).where(eq(sellerDashboards.sellerId, sellerId));
}
