// Render Workflows entrypoint. Importing this file registers the tasks; the SDK starts the
// task server itself when Render (or `render workflows dev`) sets RENDER_SDK_SOCKET_PATH.
import { task, type TaskContext } from "@renderinc/sdk/workflows";
import { createDb, type Db } from "@/lib/db";
import { runListingPipeline } from "@/lib/shop/listing-pipeline";

// getDb() needs getEnv(), which requires the PayPal secrets this service doesn't have.
let db: Db | undefined;
function workflowDb(): Db {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  db ??= createDb(url);
  return db;
}

/** BUILDOUT §6.2: photos + transcript → listing draft. A run that throws is retried by Render. */
export const listingPipeline = task(
  { name: "listingPipeline", timeoutSeconds: 120, retry: { maxRetries: 2, waitDurationMs: 2_000, backoffScaling: 2 } },
  async function listingPipeline(_ctx: TaskContext, draftId: string) {
    return { draftId, result: await runListingPipeline(workflowDb(), draftId, { source: "workflow", retryable: true }) };
  },
);

// Kept for `pnpm spike:workflows` connectivity checks.
export const ping = task(
  { name: "ping", timeoutSeconds: 30, retry: { maxRetries: 0, waitDurationMs: 0, backoffScaling: 1 } },
  function ping(_ctx: TaskContext, message: string): { pong: string; at: string; node: string } {
    return { pong: message, at: new Date().toISOString(), node: process.version };
  },
);
