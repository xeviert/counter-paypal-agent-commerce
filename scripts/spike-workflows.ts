// Spike 4.6: start workflow runs from app code, the way the Next server will.
// Local: run `render workflows dev -- <start command>` first, then
//   RENDER_USE_LOCAL_DEV=true pnpm spike:workflows
// Render: RENDER_API_KEY=... pnpm spike:workflows <workflow-slug>
import { createWorkflowsClient } from "@renderinc/sdk/workflows";

const workflow = process.argv[2];
const slug = (name: string) => (workflow ? `${workflow}/${name}` : name);
const client = createWorkflowsClient();

const started = Date.now();
const ping = await client.runTask(slug("ping"), ["from app code"]);
console.log(`ping: ${ping.status} in ${Date.now() - started}ms`, JSON.stringify(ping.results));

const t2 = Date.now();
const twice = await client.runTask(slug("pingTwice"), []);
console.log(`pingTwice: ${twice.status} in ${Date.now() - t2}ms`, JSON.stringify(twice.results));
