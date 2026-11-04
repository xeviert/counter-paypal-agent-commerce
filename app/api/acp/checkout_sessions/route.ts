import { connection } from "next/server";
import { handleAcp } from "@/lib/acp/handler";

// ACP-shaped checkout (BUILDOUT §7.6), spec 2025-09-29. Deviations: ARCHITECTURE §7.2.

export async function POST(request: Request) {
  await connection();
  return handleAcp(request, "create");
}
