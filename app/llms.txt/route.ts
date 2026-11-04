import { connection } from "next/server";
import { getDb } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { llmsTxt, sampleProductUrl } from "@/lib/shop/llms";

export async function GET() {
  await connection();
  const body = llmsTxt(getEnv().APP_BASE_URL, await sampleProductUrl(getDb()));
  return new Response(body, {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=300" },
  });
}
