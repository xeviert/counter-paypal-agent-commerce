import { createWorkflowsClient } from "@renderinc/sdk/workflows";
import { after } from "next/server";
import { getDb } from "@/lib/db";
import { log } from "@/lib/log";
import { runListingPipeline } from "./listing-pipeline";

// Starts the listing pipeline for a submitted draft (BUILDOUT §6.2). LISTING_RUNNER=workflow sends
// it to the Render Workflow task (retries, own compute); inline (the default, and the fallback when
// the workflow can't be started) runs it in this process after the response is sent.

export function listingRunner(): "inline" | "workflow" {
  return process.env.LISTING_RUNNER === "workflow" ? "workflow" : "inline";
}

/** Call from a server action or route handler: `after()` needs a request scope. */
export async function startListing(draftId: string): Promise<void> {
  if (listingRunner() === "workflow") {
    try {
      const slug = process.env.LISTING_WORKFLOW_SLUG ?? "counter-workflows/listingPipeline";
      const { taskRunId } = await createWorkflowsClient().startTask(slug, [draftId]);
      log.info("listing workflow started", { draft_id: draftId, task_run_id: taskRunId });
      return;
    } catch (err) {
      log.error("listing workflow start failed; running inline", { draft_id: draftId, error: err });
    }
  }
  after(async () => {
    try {
      await runListingPipeline(getDb(), draftId, { source: "web" });
    } catch (err) {
      log.error("inline listing pipeline failed", { draft_id: draftId, error: err });
    }
  });
}
