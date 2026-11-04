import type { AgAiEvent, AgLlmAdapter, AgLlmRequest, AgLlmResponse, AgLlmResponseHandler } from "ag-studio";
import type { StudioTurnEvent } from "@/lib/ai/studio";

// AG Studio's LLM boundary, pointed at Counter's Claude proxy (app/s/api/studio-ai). Studio hands us
// one turn; the server streams Studio events back as NDJSON and ends with the full response or an
// error, which becomes the turn's failure. The API key and model choice stay on the server.

const ENDPOINT = "/s/api/studio-ai";

export function claudeAdapter(): AgLlmAdapter {
  return { executeTurn: (request, options) => runTurn(request, options?.signal) };
}

function runTurn(request: AgLlmRequest, signal?: AbortSignal): AgLlmResponseHandler {
  let resolve!: (response: AgLlmResponse) => void;
  let reject!: (error: Error) => void;
  const complete = new Promise<AgLlmResponse>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  // A consumer that stops reading the stream early may never await `complete`.
  void complete.catch(() => {});

  async function* events(): AsyncIterableIterator<AgAiEvent> {
    let outcome: AgLlmResponse | Error | undefined;
    try {
      const response = await fetch(ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(request),
        signal,
      });
      if (!response.ok || !response.body) {
        const body = (await response.json().catch(() => ({}))) as { message?: string };
        throw new Error(body.message ?? `HTTP ${response.status}`);
      }
      const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += value;
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const event = JSON.parse(line) as StudioTurnEvent;
          if (event.type === "event") yield event.event;
          else if (event.type === "complete") outcome = event.response;
          else outcome = new Error(event.message);
        }
      }
    } catch (err) {
      outcome = err instanceof Error ? err : new Error(String(err));
    }
    if (outcome instanceof Error) reject(outcome);
    else if (outcome) resolve(outcome);
    else reject(new Error("The response ended early."));
  }

  const stream = events();
  return { stream: { [Symbol.asyncIterator]: () => stream }, complete };
}
