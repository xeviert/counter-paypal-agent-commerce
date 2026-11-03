"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

// Voice note capture (BUILDOUT §6.1): MediaRecorder always records the audio, so a paid STT can
// re-transcribe it later. Web Speech gives a live transcript where the browser has it. Android Chrome
// won't let both hold the mic (Web Speech fails with `audio-capture`), so there the recorder stops and
// the live transcript carries on alone.

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

/** What to do with a Web Speech `error` code. */
export function speechErrorAction(error: string, speechOnly: boolean): "ignore" | "speech-only" | "show" {
  if (error === "no-speech" || error === "aborted") return "ignore";
  if (error === "audio-capture" && !speechOnly) return "speech-only";
  return "show";
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
    const mime = MIME_CANDIDATES.find((m) => MediaRecorder.isTypeSupported(m));
    const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    const chunks: Blob[] = [];
    const startedAt = Date.now();
    const releaseMic = () => stream.getTracks().forEach((track) => track.stop());
    rec.ondataavailable = (e) => e.data.size > 0 && chunks.push(e.data);
    rec.onstop = () => {
      releaseMic();
      if (speechOnly.current) return;
      setState("idle");
      const type = rec.mimeType || mime || "audio/webm";
      if (chunks.length) callbacks.current.onRecorded({ blob: new Blob(chunks, { type }), mime: type, durationMs: Date.now() - startedAt });
    };
    recorder.current = rec;
    recording.current = true;
    speechOnly.current = false;
    setSpeechError(undefined);
    rec.start(1000);
    setSeconds(0);
    setState("recording");

    const Ctor = recognitionCtor();
    if (!Ctor) return;
    const speech = new Ctor();
    speech.lang = callbacks.current.lang;
    speech.continuous = true;
    speech.interimResults = true;
    let finals = "";
    let failed = false;
    speech.onresult = (event) => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i]!;
        if (result.isFinal) finals += `${result[0]!.transcript.trim()} `;
        else interim += result[0]!.transcript;
      }
      callbacks.current.onTranscript(`${finals}${interim}`.trim());
    };
    // Chrome ends recognition after a pause, and after an error; keep listening while recording.
    speech.onend = () => {
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
        rec.stop();
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
