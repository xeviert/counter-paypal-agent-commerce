import { cacheLife } from "next/cache";
import { connection } from "next/server";
import { getDb } from "@/lib/db";
import { productFeed } from "@/lib/shop/feed";

// OpenAI product-feed rows over HTTP for any agent or crawler (BUILDOUT §7.5). We don't push to OpenAI.

async function cachedFeed() {
  "use cache";
  cacheLife("minutes");
  return productFeed(getDb());
}

export async function GET() {
  await connection();
  return Response.json(await cachedFeed(), { headers: { "Cache-Control": "public, max-age=300" } });
}
