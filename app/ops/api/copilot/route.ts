import { connection } from "next/server";
import { currentOpsRole } from "@/lib/auth/operator";
import { getDb } from "@/lib/db";
import { operatorRequest, type OperatorEvent } from "@/lib/schemas/operator";
import { operatorTurn } from "@/lib/shop/operator-copilot";

// Operator copilot chat (BUILDOUT §7.4). Under /ops because the operator cookie has `path: "/ops"`.
// Operator role only: judges don't spend Claude calls. Streams one OperatorEvent per line.

const TURN_TIMEOUT_MS = 120_000;

export async function POST(request: Request) {
  await connection();
  const role = await currentOpsRole();
  if (!role) return Response.json({ error: "unauthorized" }, { status: 401 });
  if (role !== "operator") return Response.json({ error: "forbidden" }, { status: 403 });
  const parsed = operatorRequest.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid_request" }, { status: 400 });

  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      let open = true;
      const emit = (event: OperatorEvent) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {
          open = false;
        }
      };
      await operatorTurn(getDb(), parsed.data, emit, { signal: AbortSignal.timeout(TURN_TIMEOUT_MS) });
      if (open) controller.close();
    },
  });
  return new Response(body, {
    headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store", "x-accel-buffering": "no" },
  });
}
