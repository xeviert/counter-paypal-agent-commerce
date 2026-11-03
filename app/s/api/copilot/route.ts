import { connection } from "next/server";
import { currentSeller } from "@/lib/auth/seller";
import { getDb } from "@/lib/db";
import { copilotRequest, type CopilotEvent } from "@/lib/schemas/copilot";
import { copilotTurn } from "@/lib/shop/copilot";

// Seller copilot chat (BUILDOUT §7.1). Under /s because the maker cookie has `path: "/s"`. Streams
// one CopilotEvent per line. A closed tab doesn't stop the turn: it finishes and is stored, so the
// answer is there when the maker comes back.

const TURN_TIMEOUT_MS = 120_000;

export async function POST(request: Request) {
  await connection();
  const seller = await currentSeller();
  if (!seller) return Response.json({ error: "unauthorized" }, { status: 401 });
  const parsed = copilotRequest.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid_request" }, { status: 400 });

  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      let open = true;
      const emit = (event: CopilotEvent) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {
          open = false;
        }
      };
      await copilotTurn(getDb(), seller, parsed.data, emit, { signal: AbortSignal.timeout(TURN_TIMEOUT_MS) });
      if (open) controller.close();
    },
  });
  return new Response(body, {
    headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store", "x-accel-buffering": "no" },
  });
}
