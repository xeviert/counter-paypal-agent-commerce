import { connection } from "next/server";
import { handleAcp } from "@/lib/acp/handler";

export async function POST(request: Request, { params }: RouteContext<"/api/acp/checkout_sessions/[id]/cancel">) {
  await connection();
  return handleAcp(request, "cancel", (await params).id);
}
