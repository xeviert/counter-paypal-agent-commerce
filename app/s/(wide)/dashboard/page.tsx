import { Suspense } from "react";
import { requireSeller } from "@/lib/auth/seller";
import { getDb } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { dashboardDataset } from "@/lib/shop/analytics";
import { loadDashboard } from "@/lib/shop/dashboards";
import { Dashboard } from "./dashboard";

export default function DashboardPage() {
  return (
    <Suspense fallback={<Loading />}>
      <MakerDashboard />
    </Suspense>
  );
}

function Loading() {
  return <div className="m-4 flex-1 animate-pulse rounded-lg bg-muted" aria-busy="true" />;
}

async function MakerDashboard() {
  const seller = await requireSeller();
  const db = getDb();
  const [dataset, saved] = await Promise.all([dashboardDataset(db, seller), loadDashboard(db, seller.id)]);
  return <Dashboard dataset={dataset} saved={saved} licenseKey={getEnv().AG_STUDIO_LICENSE_KEY} />;
}
