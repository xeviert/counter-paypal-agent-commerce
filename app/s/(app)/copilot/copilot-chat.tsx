"use client";

import { MicIcon, SendIcon, SquareIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/components/i18n";
import { useVoice } from "@/components/maker/use-voice";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { LOCALE_TAGS, type MessageKey } from "@/lib/i18n/core";
import { COPILOT_TEXT_MAX, type CopilotActionView, type CopilotErrorCode, type CopilotEvent } from "@/lib/schemas/copilot";
import type { ChatMessage } from "@/lib/shop/copilot";
import { ActionCard } from "./action-card";

type Item = { kind: "message"; message: ChatMessage } | { kind: "action"; action: CopilotActionView };

const TOOL_LABELS: Record<string, MessageKey> = {
  list_orders: "copilot.tools.list_orders",
  get_order: "copilot.tools.get_order",
  sales_summary: "copilot.tools.sales_summary",
  payout_status: "copilot.tools.payout_status",
  add_tracking: "copilot.tools.add_tracking",
  propose_refund: "copilot.tools.propose_refund",
};

const SUGGESTIONS: MessageKey[] = ["copilot.suggestions.today", "copilot.suggestions.payout", "copilot.suggestions.week"];

function timeline(messages: ChatMessage[], actions: CopilotActionView[]): Item[] {
  const items: (Item & { at: string })[] = [
    ...messages.map((message) => ({ kind: "message" as const, message, at: message.createdAt })),
    ...actions.map((action) => ({ kind: "action" as const, action, at: action.createdAt })),
  ];
  return items.sort((a, b) => a.at.localeCompare(b.at));
}

export function CopilotChat(props: {
  conversationId: string | null;
  messages: ChatMessage[];
  actions: CopilotActionView[];
  full: boolean;
}) {
  const { t, locale } = useI18n();
  const [conversationId, setConversationId] = useState(props.conversationId);
  const [items, setItems] = useState<Item[]>(() => timeline(props.messages, props.actions));
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [tool, setTool] = useState<string | null>(null);
  const [error, setError] = useState<CopilotErrorCode | null>(props.full ? "turn_limit" : null);
  const endRef = useRef<HTMLDivElement>(null);
  const voice = useVoice({ lang: LOCALE_TAGS[locale], onTranscript: setText, onRecorded: () => {} });

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [items, tool]);

  function newChat() {
    setConversationId(null);
    setItems([]);
    setError(null);
  }

  /** Appends streamed text to this turn's live reply, or starts one after a tool call or card. */
  function appendText(delta: string) {
    setItems((prev) => {
      const last = prev.at(-1);
      if (last?.kind === "message" && last.message.role === "assistant" && last.message.id.startsWith("live-")) {
        return [...prev.slice(0, -1), { kind: "message", message: { ...last.message, text: last.message.text + delta } }];
      }
      const message = { id: `live-${Date.now()}`, role: "assistant" as const, text: delta, createdAt: new Date().toISOString() };
      return [...prev, { kind: "message", message }];
    });
  }

  /** Text streamed just before a tool call was working notes, not an answer: the stored chat hides it too. */
  function dropLiveText() {
    setItems((prev) => {
      const last = prev.at(-1);
      return last?.kind === "message" && last.message.id.startsWith("live-") ? prev.slice(0, -1) : prev;
    });
  }

  async function send(input: string) {
    const said = input.trim();
    if (!said || busy) return;
    if (voice.state === "recording") voice.stop();
    setText("");
    setError(null);
    setBusy(true);
    setItems((prev) => [
      ...prev,
      { kind: "message", message: { id: `mine-${Date.now()}`, role: "user", text: said, createdAt: new Date().toISOString() } },
    ]);
    try {
      const response = await fetch("/s/api/copilot", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: said, conversationId }),
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
          const event = JSON.parse(line) as CopilotEvent;
          if (event.type === "conversation") setConversationId(event.id);
          else if (event.type === "tool") {
            setTool(event.name);
            dropLiveText();
          } else if (event.type === "text") {
            setTool(null);
            appendText(event.delta);
          } else if (event.type === "action") {
            setItems((prev) => [...prev, { kind: "action", action: event.action }]);
          } else if (event.type === "error") setError(event.code);
        }
      }
    } catch {
      setError("error");
    } finally {
      setBusy(false);
      setTool(null);
      // Live bubbles become ordinary ones, so the next turn's text starts its own bubble.
      setItems((prev) =>
        prev.map((item) =>
          item.kind === "message" && item.message.id.startsWith("live-")
            ? { kind: "message", message: { ...item.message, id: `done-${item.message.id}` } }
            : item,
        ),
      );
    }
  }

  const full = error === "turn_limit";

  return (
    <div className="flex flex-1 flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="font-heading text-2xl font-semibold tracking-tight">{t("copilot.title")}</h1>
        {items.length > 0 && (
          <Button type="button" variant="outline" size="sm" onClick={newChat} disabled={busy}>
            {t("copilot.newChat")}
          </Button>
        )}
      </div>

      {items.length === 0 && (
        <div className="flex flex-col gap-3">
          <p className="text-muted-foreground">{t("copilot.intro")}</p>
          <div className="flex flex-wrap gap-2">
            {SUGGESTIONS.map((key) => (
              <Button key={key} type="button" variant="secondary" onClick={() => void send(t(key))} disabled={busy}>
                {t(key)}
              </Button>
            ))}
          </div>
        </div>
      )}

      <ol className="flex flex-col gap-3" aria-live="polite">
        {items.map((item) =>
          item.kind === "action" ? (
            <li key={item.action.id}>
              <ActionCard action={item.action} />
            </li>
          ) : (
            <li
              key={item.message.id}
              className={
                item.message.role === "user"
                  ? "ml-8 self-end rounded-2xl rounded-br-sm bg-primary px-3 py-2 whitespace-pre-wrap text-primary-foreground"
                  : "mr-8 self-start rounded-2xl rounded-bl-sm bg-muted px-3 py-2 whitespace-pre-wrap"
              }
            >
              {item.message.text}
            </li>
          ),
        )}
        {busy && (
          <li className="self-start text-sm text-muted-foreground">
            {tool && TOOL_LABELS[tool] ? t(TOOL_LABELS[tool]) : t("copilot.thinking")}
          </li>
        )}
      </ol>

      {error && (
        <p role="alert" className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
          {t(`copilot.errors.${error}`)}
        </p>
      )}
      <div ref={endRef} />

      <form
        className="sticky bottom-20 mt-auto flex flex-col gap-2 bg-background pt-2"
        onSubmit={(e) => {
          e.preventDefault();
          void send(text);
        }}
      >
        {full ? (
          <Button type="button" size="lg" className="h-12 text-base" onClick={newChat}>
            {t("copilot.newChat")}
          </Button>
        ) : (
          <>
            <Textarea
              aria-label={t("copilot.placeholder")}
              placeholder={t("copilot.placeholder")}
              rows={2}
              maxLength={COPILOT_TEXT_MAX}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send(text);
                }
              }}
            />
            {voice.speechError && <p className="text-sm text-destructive">{t("capture.speechFailed", { error: voice.speechError })}</p>}
            {voice.state === "denied" && <p className="text-sm text-destructive">{t("capture.micDenied")}</p>}
            <div className="flex gap-2">
              {voice.state === "recording" ? (
                <Button type="button" variant="destructive" className="h-11 flex-1" onClick={voice.stop}>
                  <SquareIcon aria-hidden />
                  {t("copilot.stop")} · {t("copilot.listening", { seconds: voice.seconds })}
                </Button>
              ) : (
                voice.state !== "unsupported" && (
                  <Button type="button" variant="outline" className="h-11 flex-1" onClick={() => void voice.start()} disabled={busy}>
                    <MicIcon aria-hidden />
                    {t("copilot.record")}
                  </Button>
                )
              )}
              <Button type="submit" className="h-11 flex-1" disabled={busy || !text.trim()}>
                <SendIcon aria-hidden />
                {t("copilot.send")}
              </Button>
            </div>
          </>
        )}
      </form>
    </div>
  );
}
