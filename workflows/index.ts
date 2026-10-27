// Render Workflows entrypoint. Importing this file registers the tasks; the SDK starts the
// task server itself when Render (or `render workflows dev`) sets RENDER_SDK_SOCKET_PATH.
import { task, type TaskContext } from "@renderinc/sdk/workflows";

// Spike for BUILDOUT §4.6. Real tasks (listing pipeline) replace this in P2.
export const ping = task(
  { name: "ping", timeoutSeconds: 30, retry: { maxRetries: 0, waitDurationMs: 0, backoffScaling: 1 } },
  function ping(_ctx: TaskContext, message: string): { pong: string; at: string; node: string } {
    return { pong: message, at: new Date().toISOString(), node: process.version };
  },
);

// Chains a run of `ping` on separate compute, to check ctx.run works end to end.
export const pingTwice = task({ name: "pingTwice", timeoutSeconds: 60 }, async function pingTwice(ctx: TaskContext) {
  const [a, b] = await Promise.all([ctx.run(ping, "a"), ctx.run(ping, "b")]);
  return [a.pong, b.pong];
});
