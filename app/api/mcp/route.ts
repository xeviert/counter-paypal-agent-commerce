import { connection } from "next/server";
import { mcpHandler } from "@/lib/mcp/handler";

async function handle(request: Request) {
  await connection();
  return mcpHandler.fetch(request);
}

export { handle as GET, handle as POST, handle as DELETE };
