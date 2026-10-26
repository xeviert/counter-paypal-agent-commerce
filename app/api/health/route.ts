import { sql } from "drizzle-orm";
import { connection } from "next/server";
import { getDb } from "@/lib/db";
import { log } from "@/lib/log";

export async function GET() {
  await connection();
  const started = performance.now();
  try {
    await getDb().execute(sql`select 1`);
    return Response.json(
      { ok: true, db: "up", latencyMs: Math.round(performance.now() - started) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    log.error("health check failed", { err });
    return Response.json({ ok: false, db: "down" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
