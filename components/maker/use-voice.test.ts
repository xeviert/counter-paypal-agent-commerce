import { describe, expect, it } from "vitest";
import { sessionTranscript, speechErrorAction } from "./use-voice";

describe("speechErrorAction", () => {
  it("ignores the pauses Chrome reports as errors", () => {
    expect(speechErrorAction("no-speech", false)).toBe("ignore");
    expect(speechErrorAction("aborted", true)).toBe("ignore");
  });

  it("drops the recorder when Web Speech can't get the mic (Android Chrome)", () => {
    expect(speechErrorAction("audio-capture", false)).toBe("speech-only");
  });

  it("shows anything else, and audio-capture once the mic is already free", () => {
    expect(speechErrorAction("audio-capture", true)).toBe("show");
    expect(speechErrorAction("not-allowed", false)).toBe("show");
    expect(speechErrorAction("network", false)).toBe("show");
  });
});

describe("sessionTranscript", () => {
  const r = (...texts: string[]) => texts.map((transcript) => ({ transcript }));

  it("joins a desktop session's results in order", () => {
    expect(sessionTranscript(r("Es un tapete ", " de lana"), false)).toBe("Es un tapete de lana");
  });

  it("keeps only the last cumulative result on Android, so words don't repeat", () => {
    expect(sessionTranscript(r("es", "es un", "es un tapete de lana"), true)).toBe("es un tapete de lana");
  });

  it("is empty for an empty session", () => {
    expect(sessionTranscript([], true)).toBe("");
  });
});
