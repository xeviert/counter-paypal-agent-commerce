"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

// Voice note capture (BUILDOUT §6.1): MediaRecorder always records the audio, so a paid STT can
// re-transcribe it later. Web Speech gives a live transcript where the browser has it. Whether both
// can share the mic on iOS is part of the real-phone test matrix.

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

export type VoiceState = "idle" | "recording" | "denied" | "unsupported";

export type Recording = { blob: Blob; mime: string; durationMs: number };

export function useVoice(opts: {
  lang: string;
  onTranscript: (text: string) => void;
  onRecorded: (recording: Recording) => void;
}) {
  const [recState, setState] = useState<Exclude<VoiceState, "unsupported">>("idle");
  const [seconds, setSeconds] = useState(0);
  const supported = useSyncExternalStore(noop, canRecord, () => true);
  const state: VoiceState = supported ? recState : "unsupported";
  const recorder = useRef<MediaRecorder | null>(null);
  const recognition = useRef<Recognition | null>(null);
  const recording = useRef(false);
  const callbacks = useRef(opts);
  useEffect(() => {
    callbacks.current = opts;
  });

  const stop = useCallback(() => {
    recording.current = false;
    recognition.current?.stop();
    if (recorder.current?.state === "recording") recorder.current.stop();
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
    rec.ondataavailable = (e) => e.data.size > 0 && chunks.push(e.data);
    rec.onstop = () => {
      stream.getTracks().forEach((track) => track.stop());
      setState("idle");
      const type = rec.mimeType || mime || "audio/webm";
      if (chunks.length) callbacks.current.onRecorded({ blob: new Blob(chunks, { type }), mime: type, durationMs: Date.now() - startedAt });
    };
    recorder.current = rec;
    recording.current = true;
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
    speech.onresult = (event) => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i]!;
        if (result.isFinal) finals += `${result[0]!.transcript.trim()} `;
        else interim += result[0]!.transcript;
      }
      callbacks.current.onTranscript(`${finals}${interim}`.trim());
    };
    // Chrome ends recognition after a pause; keep listening while the recorder runs.
    speech.onend = () => {
      if (recording.current) {
        try {
          speech.start();
        } catch {
          // Already restarting.
        }
      }
    };
    speech.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") recording.current = false;
    };
    recognition.current = speech;
    try {
      speech.start();
    } catch {
      // Live transcript is a bonus; the recording continues.
    }
  }, []);

  return { state, seconds, start, stop };
}
