import { connection } from "next/server";
import { handleAcp } from "@/lib/acp/handler";

export async function POST(request: Request, { params }: RouteContext<"/api/acp/checkout_sessions/[id]/complete">) {
  await connection();
  return handleAcp(request, "complete", (await params).id);
}
