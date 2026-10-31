// Spike 4.6: start workflow runs from app code, the way the Next server will.
// Local: run `render workflows dev -- <start command>` first, then
//   RENDER_USE_LOCAL_DEV=true pnpm spike:workflows
// Render: pnpm spike:workflows counter-workflows (RENDER_API_KEY from .env)
import { existsSync } from "node:fs";
import { createWorkflowsClient } from "@renderinc/sdk/workflows";

if (existsSync(".env")) process.loadEnvFile(".env");

const workflow = process.argv[2];
const slug = (name: string) => (workflow ? `${workflow}/${name}` : name);
const client = createWorkflowsClient();

// runTask waits on the /v1/task-runs/events stream, which never returned against Render (Oct 31),
// so start the run and poll it instead. "paused" means a parent waiting on its subtasks.
async function run(name: string, input: unknown[]) {
  const started = Date.now();
  const { taskRunId } = await client.startTask(slug(name), input);
  for (;;) {
    const result = await client.getTaskRun(taskRunId);
    if (["completed", "failed", "canceled"].includes(String(result.status))) {
      console.log(`${name}: ${result.status} in ${Date.now() - started}ms`, JSON.stringify(result.results));
      return;
    }
    if (Date.now() - started > 120_000) throw new Error(`${name} still ${result.status} after 120s`);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

await run("ping", ["from app code"]);
