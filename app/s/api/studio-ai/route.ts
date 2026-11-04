import { connection } from "next/server";
import type { StudioErrorCode, StudioTurnEvent } from "@/lib/ai/studio";
import { currentSeller } from "@/lib/auth/seller";
import { getDb } from "@/lib/db";
import { translator } from "@/lib/i18n";
import { studioTurnRequest } from "@/lib/schemas/studio";
import { studioTurn } from "@/lib/shop/studio-ai";

// AG Studio's AI turns on Claude (BUILDOUT §7.3). Under /s because the maker cookie has
// `path: "/s"`. Streams one StudioTurnEvent per line; app/s/(wide)/dashboard/studio/adapter.ts
// turns them back into Studio's AgLlmResponseHandler.

const TURN_TIMEOUT_MS = 120_000;
const MAX_BODY_BYTES = 4 * 1024 * 1024;

export async function POST(request: Request) {
  await connection();
  const seller = await currentSeller();
  if (!seller) return Response.json({ error: "unauthorized" }, { status: 401 });
  const t = translator(seller.locale);
  const failure = (code: StudioErrorCode, status: number) =>
    Response.json({ error: code, message: t(`dashboard.ai.errors.${code}`) }, { status });

  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) return failure("invalid_request", 413);
  const parsed = studioTurnRequest.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return failure("invalid_request", 400);

  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(TURN_TIMEOUT_MS)]);
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      let open = true;
      const emit = (event: StudioTurnEvent) => {
        if (!open) return;
        const line = event.type === "error" ? { ...event, message: t(`dashboard.ai.errors.${event.code}`) } : event;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(line)}\n`));
        } catch {
          open = false;
        }
      };
      await studioTurn(getDb(), { id: seller.id, language: seller.locale, country: seller.country }, parsed.data, emit, { signal });
      if (open) controller.close();
    },
  });
  return new Response(body, {
    headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store", "x-accel-buffering": "no" },
  });
}
