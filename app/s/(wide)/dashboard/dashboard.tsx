"use client";

import type { AgReportState } from "ag-studio";
import { ChartColumnIcon } from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useI18n } from "@/components/i18n";
import { buttonVariants } from "@/components/ui/button";
import type { DashboardDataset } from "@/lib/schemas/dashboard";

// AG Studio (plus AG Grid and AG Charts Enterprise) is a few MB, so it loads only on this page and
// only in the browser.
const Studio = dynamic(() => import("./studio"), { ssr: false, loading: () => <Loading /> });

function Loading() {
  const { t } = useI18n();
  return (
    <p className="p-6 text-sm text-muted-foreground" aria-busy="true">
      {t("dashboard.loading")}
    </p>
  );
}

export function Dashboard(props: { dataset: DashboardDataset; saved: AgReportState | null; licenseKey?: string }) {
  const { t } = useI18n();
  const { orders, activity } = props.dataset;
  if (!orders.length && !activity.length) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center gap-3 p-8 text-center">
        <ChartColumnIcon className="size-10 text-muted-foreground" aria-hidden />
        <h1 className="font-heading text-xl font-semibold">{t("dashboard.empty.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("dashboard.empty.body")}</p>
        <Link href="/s/listings" className={buttonVariants({ variant: "outline" })}>
          {t("dashboard.empty.cta")}
        </Link>
      </div>
    );
  }
  return <Studio {...props} />;
}
