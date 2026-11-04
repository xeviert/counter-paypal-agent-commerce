"use client";

import { SendIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { OPERATOR_HISTORY_MAX, OPERATOR_TEXT_MAX, type OperatorErrorCode, type OperatorEvent } from "@/lib/schemas/operator";

// Same NDJSON stream as the maker copilot (app/s/(app)/copilot/copilot-chat.tsx), without i18n, voice
// or refund cards. The chat lives in this tab only; nothing is stored.

type Message = { id: string; role: "user" | "assistant"; text: string; live?: boolean };

const TOOL_LABELS: Record<string, string> = {
  ops_query: "Checking Counter's numbers…",
  find_order: "Looking up the order…",
  recent_events: "Reading the audit log…",
  paypal_order: "Asking PayPal about the order…",
  paypal_transactions: "Reading Counter's PayPal activity…",
};

const ERRORS: Record<OperatorErrorCode, string> = {
  capped: "The daily Claude limit is reached. Try again tomorrow (UTC).",
  refused: "Claude declined to answer that.",
  too_many_steps: "That took too many lookups. Ask a narrower question.",
  error: "Something went wrong. Try again.",
};

const SUGGESTIONS = ["How much did we earn in fees this week?", "Which orders are stuck?", "How much money is held for Lucía?", "Did any agent try to manipulate an offer today?"];

export function OperatorChat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [tool, setTool] = useState<string | null>(null);
  const [error, setError] = useState<OperatorErrorCode | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages, tool]);

  function appendText(delta: string) {
    setMessages((prev) => {
      const last = prev.at(-1);
      if (last?.live) return [...prev.slice(0, -1), { ...last, text: last.text + delta }];
      return [...prev, { id: `a-${Date.now()}`, role: "assistant", text: delta, live: true }];
    });
  }

  /** Text streamed just before a tool call was working notes, not the answer. */
  function dropLiveText() {
    setMessages((prev) => (prev.at(-1)?.live ? prev.slice(0, -1) : prev));
  }

  async function send(input: string) {
    const said = input.trim();
    if (!said || busy) return;
    const history = messages.slice(-OPERATOR_HISTORY_MAX).map(({ role, text }) => ({ role, text }));
    setText("");
    setError(null);
    setBusy(true);
    setMessages((prev) => [...prev, { id: `u-${Date.now()}`, role: "user", text: said }]);
    try {
      const response = await fetch("/ops/api/copilot", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages: history, text: said }),
      });
      if (!response.ok || !response.body) throw new Error(`copilot ${response.status}`);
      const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffered = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffered += value;
        const lines = buffered.split("\n");
        buffered = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const event = JSON.parse(line) as OperatorEvent;
          if (event.type === "tool") {
            setTool(event.name);
            dropLiveText();
          } else if (event.type === "text") {
            setTool(null);
            appendText(event.delta);
          } else if (event.type === "error") setError(event.code);
        }
      }
    } catch {
      setError("error");
    } finally {
      setBusy(false);
      setTool(null);
      setMessages((prev) => prev.map((m) => (m.live ? { ...m, live: false } : m)));
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="font-heading text-2xl font-semibold tracking-tight">Copilot</h1>
        {messages.length > 0 && (
          <Button type="button" variant="outline" size="sm" onClick={() => setMessages([])} disabled={busy}>
            New chat
          </Button>
        )}
      </div>

      {messages.length === 0 && (
        <div className="flex flex-col gap-3">
          <p className="text-muted-foreground">
            Ask about fees, held money, stuck orders or agent activity. It reads Counter&apos;s database and PayPal; it can&apos;t change anything.
          </p>
          <div className="flex flex-wrap gap-2">
            {SUGGESTIONS.map((s) => (
              <Button key={s} type="button" variant="secondary" onClick={() => void send(s)} disabled={busy}>
                {s}
              </Button>
            ))}
          </div>
        </div>
      )}

      <ol className="flex flex-col gap-3" aria-live="polite">
        {messages.map((m) => (
          <li
            key={m.id}
            className={
              m.role === "user"
                ? "ml-12 self-end rounded-2xl rounded-br-sm bg-primary px-3 py-2 whitespace-pre-wrap text-primary-foreground"
                : "mr-12 self-start rounded-2xl rounded-bl-sm bg-muted px-3 py-2 whitespace-pre-wrap"
            }
          >
            {m.text}
          </li>
        ))}
        {busy && <li className="self-start text-sm text-muted-foreground">{(tool && TOOL_LABELS[tool]) ?? "Thinking…"}</li>}
      </ol>

      {error && (
        <p role="alert" className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
          {ERRORS[error]}
        </p>
      )}
      <div ref={endRef} />

      <form
        className="sticky bottom-0 mt-auto flex gap-2 bg-background py-2"
        onSubmit={(e) => {
          e.preventDefault();
          void send(text);
        }}
      >
        <Textarea
          aria-label="Ask the copilot"
          placeholder="Ask about the platform…"
          rows={2}
          maxLength={OPERATOR_TEXT_MAX}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send(text);
            }
          }}
        />
        <Button type="submit" className="h-auto" disabled={busy || !text.trim()}>
          <SendIcon aria-hidden />
          Send
        </Button>
      </form>
    </div>
  );
}
