/* Speech to text, live — the protocol half. Isomorphic on purpose.

   The batch path in `transcribe.ts` sends a finished recording and waits.
   This path opens a socket while the person is still talking, so the words
   are already there when they stop. Same vendor, different model, and a
   COMPLETELY different failure surface — which is why the parts that can be
   reasoned about without a microphone live here, pure and tested:
   the constants, the message shapes, and the accumulator.

   The runtime half (mic, worklet, socket) is `realtime-stream.ts`, browser
   only. Nothing in THIS file touches `window` or `process.env`, so the
   route handler that mints tokens and the client that opens the socket can
   both import it without dragging the other's world along.

   ElevenLabs Scribe v2 Realtime, verified against elevenlabs.io/docs on
   2026-08-04 (house rule: a vendor's strings are fetched, never recalled —
   the Xero invalid_scope lesson). What was verified:

     token   POST https://api.elevenlabs.io/v1/single-use-token/realtime_scribe
             header xi-api-key · body none · out { token } · 15 min · one use
     socket  wss://api.elevenlabs.io/v1/speech-to-text/realtime
             query  model_id, audio_format, commit_strategy, keyterms,
                    token, no_verbatim
     up      { message_type: "input_audio_chunk", audio_base_64, commit,
               sample_rate }
     down    { message_type: "partial_transcript" | "final_transcript" |
               "committed_transcript" | "session_started" | <an error>, text }

   KEYTERMS ARE SMALLER HERE than on the batch endpoint: at most 50 terms of
   20 characters, against the batch model's 1,000. `prepareKeyterms` takes
   the limits as an argument for exactly this reason — one cleaner, two
   transports. */

/** The socket. Regional residency hosts exist (`api.sg.residency…`) and
    Singapore is the near one for Australia, but they are an enterprise
    feature — pointing at one without the entitlement fails the handshake,
    so the default host is what ships until that's confirmed on the account. */
export const REALTIME_SOCKET = "wss://api.elevenlabs.io/v1/speech-to-text/realtime";

export const REALTIME_MODEL_ID = "scribe_v2_realtime";

/** Vendor cap: 50 terms. */
export const REALTIME_KEYTERM_LIMIT = 50;

/** Vendor cap: 20 characters. `prepareKeyterms` rejects at the boundary
    rather than on it, so a 20-character term is dropped too — deliberately
    conservative, and free: the longest trade keyterm we ship is "static
    pressure" at fifteen. */
export const REALTIME_KEYTERM_MAX_CHARS = 20;

/** Sample rates the vendor accepts, keyed to the `audio_format` value.
    We never resample: whatever rate the browser's AudioContext actually
    gives us picks the format, and a rate that isn't here means this
    transport can't carry the audio and the caller falls back to batch. */
export const AUDIO_FORMATS: Readonly<Record<number, string>> = {
  8000: "pcm_8000",
  16000: "pcm_16000",
  22050: "pcm_22050",
  24000: "pcm_24000",
  44100: "pcm_44100",
  48000: "pcm_48000",
};

export const audioFormatFor = (sampleRate: number): string | null =>
  AUDIO_FORMATS[Math.round(sampleRate)] ?? null;

/* ── what the socket says back ───────────────────────────────────────── */

/** Every documented failure `message_type`. They all carry `error: string`,
    and none of that string ever reaches a person — same rule as the batch
    adapter: the vendor's words go to the log, ours go on the screen. */
const ERROR_TYPES: ReadonlySet<string> = new Set([
  "error",
  "auth_error",
  "quota_exceeded",
  "commit_throttled",
  "unaccepted_terms",
  "rate_limited",
  "queue_overflow",
  "resource_exhausted",
  "session_time_limit_exceeded",
  "input_error",
  "chunk_size_exceeded",
  "insufficient_audio_activity",
  "transcriber_error",
]);

/** Two halves, because they behave differently: `committed` is text the
    model has finished with and will not revise, `partial` is the sentence
    currently in the air and is replaced wholesale on every message. */
export type Transcript = { committed: string; partial: string };

export const EMPTY_TRANSCRIPT: Transcript = { committed: "", partial: "" };

export type Applied =
  | { kind: "transcript"; next: Transcript }
  | { kind: "error"; message: string; detail: string }
  | { kind: "ignored" };

/** What the person reads while they're still talking. */
export const visibleText = (t: Transcript): string =>
  [t.committed, t.partial].filter(Boolean).join(" ").trim();

/* WHY THIS IS DEFENSIVE: the docs describe `committed_transcript.text` but
   never say whether it is the newest SEGMENT or the whole transcript so far.
   The vendor's own React example keeps `committedTranscripts` as an ARRAY,
   which reads as segments — but "reads as" is not "documented as", and the
   two interpretations differ by duplicating every word on screen.

   So the merge handles both without needing to know: text that extends what
   we have replaces it (the cumulative reading), text we already end with is
   dropped (the same segment twice, which `final_transcript` followed by
   `committed_transcript` produces), and anything else is appended (the
   segment reading). Whichever the vendor meant, the transcript is right. */
export function mergeCommitted(prev: string, incoming: string): string {
  const add = incoming.trim();
  if (!add) return prev;
  if (!prev) return add;
  const p = prev.toLowerCase();
  const a = add.toLowerCase();
  if (a.startsWith(p)) return add;
  if (p.endsWith(a)) return prev;
  return `${prev} ${add}`;
}

/** The one sentence a live failure is allowed to say. The caller's job on
    seeing it is not to explain it — it's to fall back to the recording it
    has been keeping all along. */
export const REALTIME_FAILED = "The live transcript dropped out.";

/** Fold one socket message into the transcript. Pure — the whole protocol
    can be exercised in jest without a microphone or a network. */
export function applyMessage(state: Transcript, raw: unknown): Applied {
  if (!raw || typeof raw !== "object") return { kind: "ignored" };
  const m = raw as Record<string, unknown>;
  const type = typeof m.message_type === "string" ? m.message_type : "";
  const text = typeof m.text === "string" ? m.text : "";

  if (ERROR_TYPES.has(type)) {
    return {
      kind: "error",
      message: REALTIME_FAILED,
      detail: `${type}: ${typeof m.error === "string" ? m.error : "<no detail>"}`,
    };
  }

  switch (type) {
    case "partial_transcript":
      return { kind: "transcript", next: { ...state, partial: text.trim() } };

    /* Both are final in the sense that matters — the model is done with
       those words. Sending them through the same merge is what makes it
       safe to receive both for one utterance, which `vad` commits do. */
    case "final_transcript":
    case "final_transcript_with_timestamps":
    case "committed_transcript":
    case "committed_transcript_with_timestamps":
      return {
        kind: "transcript",
        next: { committed: mergeCommitted(state.committed, text), partial: "" },
      };

    default:
      return { kind: "ignored" };
  }
}
