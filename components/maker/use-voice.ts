"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

// Voice note capture (BUILDOUT §6.1): MediaRecorder always records the audio, so a paid STT can
// re-transcribe it later. Web Speech gives a live transcript where the browser has it. Android Chrome
// won't let both hold the mic: Web Speech either fails with `audio-capture` or, on the Pixel 9a
// (Nov 10), hears nothing and never errors. So on Android with Web Speech we skip the recorder and run
// the live transcript alone; elsewhere `audio-capture` still switches to speech-only mid-take.

// Not in TypeScript's DOM lib yet.
type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: { resultIndex: number; results: SpeechRecognitionResultList }) => void) | null;
  onend: (() => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  start(): void;
  stop(): void;
};
type RecognitionCtor = new () => Recognition;

const MIME_CANDIDATES = ["audio/webm;codecs=opus", "audio/mp4", "audio/webm", "audio/ogg;codecs=opus"];
const MAX_SECONDS = 180;

function recognitionCtor(): RecognitionCtor | undefined {
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}

const noop = () => () => {};
const canRecord = () => typeof MediaRecorder !== "undefined" && Boolean(navigator.mediaDevices?.getUserMedia);
const isAndroid = () => /Android/i.test(navigator.userAgent);

/** What to do with a Web Speech `error` code. */
export function speechErrorAction(error: string, speechOnly: boolean): "ignore" | "speech-only" | "show" {
  if (error === "no-speech" || error === "aborted") return "ignore";
  if (error === "audio-capture" && !speechOnly) return "speech-only";
  return "show";
}

/**
 * Text heard in one recognition session. The result list is the whole session, so it's rebuilt each
 * event instead of appended to (Android repeats `resultIndex` and re-sends finals). Android results
 * are cumulative ("es", "es un", "es un tapete"): only the last one counts there.
 */
export function sessionTranscript(results: readonly { transcript: string }[], cumulative: boolean): string {
  const parts = cumulative ? results.slice(-1) : results;
  return parts.map((r) => r.transcript.trim()).filter(Boolean).join(" ");
}

export type VoiceState = "idle" | "recording" | "denied" | "unsupported";

export type Recording = { blob: Blob; mime: string; durationMs: number };

export function useVoice(opts: {
  lang: string;
  onTranscript: (text: string) => void;
  onRecorded: (recording: Recording) => void;
}) {
  const [recState, setState] = useState<Exclude<VoiceState, "unsupported">>("idle");
  const [seconds, setSeconds] = useState(0);
  const [speechError, setSpeechError] = useState<string>();
  const supported = useSyncExternalStore(noop, canRecord, () => true);
  const state: VoiceState = supported ? recState : "unsupported";
  const recorder = useRef<MediaRecorder | null>(null);
  const recognition = useRef<Recognition | null>(null);
  const recording = useRef(false);
  const speechOnly = useRef(false);
  const callbacks = useRef(opts);
  useEffect(() => {
    callbacks.current = opts;
  });

  const stop = useCallback(() => {
    recording.current = false;
    recognition.current?.stop();
    if (recorder.current?.state === "recording") recorder.current.stop();
    else setState("idle");
  }, []);

  useEffect(() => {
    if (recState !== "recording") return;
    const started = Date.now();
    const timer = setInterval(() => {
      const elapsed = Math.floor((Date.now() - started) / 1000);
      setSeconds(elapsed);
      if (elapsed >= MAX_SECONDS) stop();
    }, 250);
    return () => clearInterval(timer);
  }, [recState, stop]);

  useEffect(() => stop, [stop]);

  const start = useCallback(async () => {
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setState("denied");
      return;
    }
    const Ctor = recognitionCtor();
    const releaseMic = () => stream.getTracks().forEach((track) => track.stop());
    recording.current = true;
    speechOnly.current = Boolean(Ctor) && isAndroid();
    setSpeechError(undefined);
    setSeconds(0);
    setState("recording");

    let rec: MediaRecorder | null = null;
    if (speechOnly.current) {
      // The permission prompt is done; hand the mic to Web Speech.
      releaseMic();
      recorder.current = null;
    } else {
      const mime = MIME_CANDIDATES.find((m) => MediaRecorder.isTypeSupported(m));
      const r = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      const chunks: Blob[] = [];
      const startedAt = Date.now();
      r.ondataavailable = (e) => e.data.size > 0 && chunks.push(e.data);
      r.onstop = () => {
        releaseMic();
        if (speechOnly.current) return;
        setState("idle");
        const type = r.mimeType || mime || "audio/webm";
        if (chunks.length) callbacks.current.onRecorded({ blob: new Blob(chunks, { type }), mime: type, durationMs: Date.now() - startedAt });
      };
      recorder.current = r;
      rec = r;
      r.start(1000);
    }

    if (!Ctor) return;
    const speech = new Ctor();
    speech.lang = callbacks.current.lang;
    // Android's continuous mode duplicates words; one utterance per session, restarted on end, doesn't.
    const android = isAndroid();
    speech.continuous = !android;
    speech.interimResults = true;
    let committed = "";
    let current = "";
    let failed = false;
    speech.onresult = (event) => {
      const results = Array.from({ length: event.results.length }, (_, i) => ({ transcript: event.results[i]![0]!.transcript }));
      current = sessionTranscript(results, android);
      callbacks.current.onTranscript(`${committed} ${current}`.trim());
    };
    // Chrome ends recognition after a pause, and after an error; keep listening while recording.
    speech.onend = () => {
      committed = `${committed} ${current}`.trim();
      current = "";
      if (!recording.current || failed) return;
      // Give Android a moment to hand over the mic the recorder just let go of.
      setTimeout(
        () => {
          try {
            if (recording.current) speech.start();
          } catch {
            // Already restarting.
          }
        },
        speechOnly.current ? 300 : 0,
      );
    };
    speech.onerror = (e) => {
      const action = speechErrorAction(e.error, speechOnly.current);
      if (action === "ignore") return;
      if (action === "speech-only") {
        speechOnly.current = true;
        rec?.stop();
        releaseMic();
        return;
      }
      failed = true;
      setSpeechError(e.error);
      // Nothing is listening any more without the recorder.
      if (speechOnly.current) stop();
    };
    recognition.current = speech;
    try {
      speech.start();
    } catch {
      setSpeechError("start-failed");
    }
  }, [stop]);

  return { state, seconds, speechError, start, stop };
}
