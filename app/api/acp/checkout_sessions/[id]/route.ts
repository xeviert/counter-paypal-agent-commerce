import { connection } from "next/server";
import { handleAcp } from "@/lib/acp/handler";

type Context = RouteContext<"/api/acp/checkout_sessions/[id]">;

export async function GET(request: Request, { params }: Context) {
  await connection();
  return handleAcp(request, "get", (await params).id);
}

export async function POST(request: Request, { params }: Context) {
  await connection();
  return handleAcp(request, "update", (await params).id);
}
