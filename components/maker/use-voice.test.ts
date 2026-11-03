import { describe, expect, it } from "vitest";
import { speechErrorAction } from "./use-voice";

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
