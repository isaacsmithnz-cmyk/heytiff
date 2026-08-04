import {
  AUDIO_FORMATS,
  EMPTY_TRANSCRIPT,
  REALTIME_KEYTERM_LIMIT,
  REALTIME_KEYTERM_MAX_CHARS,
  applyMessage,
  audioFormatFor,
  mergeCommitted,
  visibleText,
  type Transcript,
} from "../realtime";
import { TRADE_KEYTERMS, prepareKeyterms } from "../transcribe";
import { encodePcm } from "../realtime-stream";

/* The live transport's protocol, exercised without a microphone or a socket.
   That is the point of keeping `realtime.ts` pure: the parts most likely to
   be wrong are the parts hardest to reach in a browser. */

const fold = (messages: unknown[]): Transcript => {
  let state = EMPTY_TRANSCRIPT;
  for (const m of messages) {
    const applied = applyMessage(state, m);
    if (applied.kind === "transcript") state = applied.next;
  }
  return state;
};

describe("audio format", () => {
  it("names every rate the vendor accepts", () => {
    expect(audioFormatFor(16000)).toBe("pcm_16000");
    expect(audioFormatFor(48000)).toBe("pcm_48000");
    expect(audioFormatFor(44100)).toBe("pcm_44100");
  });

  it("rounds the fractional rates a browser can report", () => {
    expect(audioFormatFor(48000.0001)).toBe("pcm_48000");
  });

  // a rate outside the six means fall back to batch, not resample
  it("refuses a rate the socket can't carry", () => {
    expect(audioFormatFor(32000)).toBeNull();
    expect(Object.keys(AUDIO_FORMATS)).toHaveLength(6);
  });
});

/* The one part of the browser-side module that's pure — and the one where a
   mistake is silent: wrong-endian PCM still transcribes, just into noise. */
describe("pcm encoding", () => {
  const bytesOf = (b64: string) =>
    Array.from(Buffer.from(b64, "base64").values());

  it("writes little-endian signed 16-bit", () => {
    // 1.0 → 32767 → 0xFF 0x7F little-endian
    expect(bytesOf(encodePcm(Float32Array.from([1])))).toEqual([0xff, 0x7f]);
    expect(bytesOf(encodePcm(Float32Array.from([0])))).toEqual([0x00, 0x00]);
  });

  it("clamps rather than wrapping, so a loud site doesn't crackle", () => {
    // without the clamp, 2.0 overflows int16 and comes back as a negative
    expect(bytesOf(encodePcm(Float32Array.from([2])))).toEqual([0xff, 0x7f]);
    expect(bytesOf(encodePcm(Float32Array.from([-2])))).toEqual([0x01, 0x80]);
  });

  it("emits two bytes per sample and nothing for silence-length zero", () => {
    expect(bytesOf(encodePcm(new Float32Array(64)))).toHaveLength(128);
    expect(encodePcm(new Float32Array(0))).toBe("");
  });
});

describe("transcript accumulation", () => {
  it("shows the partial while the sentence is still in the air", () => {
    const state = fold([{ message_type: "partial_transcript", text: "tell Luke he needs" }]);
    expect(visibleText(state)).toBe("tell Luke he needs");
    expect(state.committed).toBe("");
  });

  it("clears the partial once it commits", () => {
    const state = fold([
      { message_type: "partial_transcript", text: "tell Luke he needs" },
      { message_type: "committed_transcript", text: "Tell Luke he needs to order the grilles." },
    ]);
    expect(state.partial).toBe("");
    expect(visibleText(state)).toBe("Tell Luke he needs to order the grilles.");
  });

  it("joins successive segments", () => {
    const state = fold([
      { message_type: "committed_transcript", text: "Tell Luke to order the grilles." },
      { message_type: "committed_transcript", text: "The rooftop unit tripped again." },
    ]);
    expect(state.committed).toBe("Tell Luke to order the grilles. The rooftop unit tripped again.");
  });

  /* The two readings of the docs, both handled — see mergeCommitted. If the
     vendor is sending cumulative text, appending would duplicate every word
     on screen; this is the test that says it doesn't. */
  it("replaces rather than duplicates when the vendor sends cumulative text", () => {
    const state = fold([
      { message_type: "committed_transcript", text: "Tell Luke" },
      { message_type: "committed_transcript", text: "Tell Luke to order the grilles" },
    ]);
    expect(state.committed).toBe("Tell Luke to order the grilles");
  });

  it("drops a segment it already ends with", () => {
    // vad commits produce final_transcript AND committed_transcript for one
    // utterance — the same words twice, which must not be written twice
    const state = fold([
      { message_type: "final_transcript", text: "The condensate pump is blocked." },
      { message_type: "committed_transcript", text: "The condensate pump is blocked." },
    ]);
    expect(state.committed).toBe("The condensate pump is blocked.");
  });

  it("ignores session_started and anything unrecognised", () => {
    expect(applyMessage(EMPTY_TRANSCRIPT, { message_type: "session_started" }).kind).toBe("ignored");
    expect(applyMessage(EMPTY_TRANSCRIPT, { message_type: "who_knows" }).kind).toBe("ignored");
    expect(applyMessage(EMPTY_TRANSCRIPT, null).kind).toBe("ignored");
    expect(applyMessage(EMPTY_TRANSCRIPT, "not an object").kind).toBe("ignored");
  });

  it("keeps blank commits from padding the transcript", () => {
    expect(mergeCommitted("Tell Luke", "   ")).toBe("Tell Luke");
    expect(mergeCommitted("", "Tell Luke")).toBe("Tell Luke");
  });
});

describe("errors", () => {
  const ERRORS = [
    "auth_error",
    "quota_exceeded",
    "rate_limited",
    "session_time_limit_exceeded",
    "transcriber_error",
    "insufficient_audio_activity",
  ];

  it.each(ERRORS)("reports %s as one of our sentences, never the vendor's", (message_type) => {
    const applied = applyMessage(EMPTY_TRANSCRIPT, { message_type, error: "raw vendor detail" });
    expect(applied.kind).toBe("error");
    if (applied.kind !== "error") return;
    expect(applied.message).not.toContain("raw vendor detail");
    expect(applied.message).not.toMatch(/eleven ?labs|scribe/i);
    // the detail is for the log, and it must carry enough to diagnose
    expect(applied.detail).toContain(message_type);
    expect(applied.detail).toContain("raw vendor detail");
  });

  it("survives an error with no detail", () => {
    const applied = applyMessage(EMPTY_TRANSCRIPT, { message_type: "error" });
    expect(applied.kind).toBe("error");
  });
});

describe("keyterms on the live transport", () => {
  const NAMES = ["Luke", "Dane", "Isaac", "Tiffany"];

  it("obeys the socket's smaller caps, not the batch endpoint's", () => {
    const raw = Array.from({ length: 120 }, (_, i) => `term${i}`);
    const terms = prepareKeyterms(raw, {
      maxChars: REALTIME_KEYTERM_MAX_CHARS,
      maxTerms: REALTIME_KEYTERM_LIMIT,
    });
    expect(terms).toHaveLength(50);
    expect(terms.every((t) => t.length < 20)).toBe(true);
  });

  it("drops a term too long for the socket that batch would have kept", () => {
    const long = "commissioning paperwork handover"; // 32 chars, three words
    expect(prepareKeyterms([long])).toEqual([long]);
    expect(prepareKeyterms([long], { maxChars: REALTIME_KEYTERM_MAX_CHARS })).toEqual([]);

    // exactly at the boundary — rejected on it, deliberately conservative
    const edge = "static pressure drop"; // 20 chars
    expect(prepareKeyterms([edge])).toEqual([edge]);
    expect(prepareKeyterms([edge], { maxChars: REALTIME_KEYTERM_MAX_CHARS })).toEqual([]);
  });

  /* Fifty slots for four names and thirty-five trade terms: the names have
     to survive the cut, because a misheard name routes a task to nobody. */
  it("keeps every staff name when names are passed first", () => {
    const terms = prepareKeyterms([...NAMES, ...TRADE_KEYTERMS], {
      maxChars: REALTIME_KEYTERM_MAX_CHARS,
      maxTerms: REALTIME_KEYTERM_LIMIT,
    });
    for (const name of NAMES) expect(terms).toContain(name);
  });

  it("keeps every shipped trade keyterm inside the socket's character limit", () => {
    const kept = prepareKeyterms(TRADE_KEYTERMS, { maxChars: REALTIME_KEYTERM_MAX_CHARS });
    expect(kept).toEqual(prepareKeyterms(TRADE_KEYTERMS));
  });

  it("leaves the batch caller's behaviour untouched", () => {
    expect(prepareKeyterms(TRADE_KEYTERMS)).toEqual(prepareKeyterms(TRADE_KEYTERMS, {}));
  });
});
