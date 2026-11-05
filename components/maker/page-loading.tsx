"use client";

import { useOptionalI18n } from "@/components/i18n";

/** Suspense fallback for maker pages: a skeleton in the page's shape instead of a blank screen. */
export function PageLoading() {
  const i18n = useOptionalI18n();
  return (
    <div role="status" aria-busy="true" className="flex flex-col gap-4">
      <span className="sr-only">{i18n ? i18n.t("common.loading") : "Loading…"}</span>
      <div className="h-8 w-2/3 animate-pulse rounded-md bg-muted" />
      <div className="h-20 animate-pulse rounded-lg bg-muted" />
      <div className="h-20 animate-pulse rounded-lg bg-muted" />
      <div className="h-20 animate-pulse rounded-lg bg-muted" />
    </div>
  );
}
