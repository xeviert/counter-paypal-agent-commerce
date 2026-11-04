import type { Metadata } from "next";
import { Suspense } from "react";
import { requireOperatorWrite } from "@/lib/auth/operator";
import { OperatorChat } from "./operator-chat";

export const metadata: Metadata = { title: "Copilot" };

export default function CopilotPage() {
  return (
    <Suspense fallback={<p className="text-muted-foreground">Loading…</p>}>
      <Gate />
    </Suspense>
  );
}

async function Gate() {
  await requireOperatorWrite();
  return <OperatorChat />;
}
