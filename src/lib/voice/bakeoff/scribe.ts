/* ElevenLabs Scribe v2 — the batch transcription call, for the bake-off.

   Deliberately NOT the production adapter. This one takes bytes and returns
   text with no auth, no org, no storage and no error dressing, because the
   harness needs to compare vendors on raw output and nothing else. The
   production engine at src/lib/voice/transcribe.ts is written against the
   winner once this has picked it.

   API facts verified 2026-07-28 against elevenlabs.io/docs/api-reference —
   do not re-derive these from memory (house rule: a vendor's endpoints, enums
   and parameter names get checked against their docs, never recalled):
     POST https://api.elevenlabs.io/v1/speech-to-text
     header  xi-api-key
     form    file, model_id="scribe_v2", keyterms (JSON array string),
             language_code (a HINT — auto-detect still runs and wins),
             diarize, tag_audio_events
     returns { text, language_code, language_probability, words[] } */

export type TranscriptionRequest = {
  audio: Uint8Array;
  filename: string;
  /** ISO-639-1 hint. Omit entirely to lean fully on auto-detect. */
  language?: string;
  keyterms?: readonly string[];
  timeoutMs?: number;
};

export type TranscriptionResult = {
  text: string;
  /** What the model decided was actually spoken — worth reporting, since a
      wrong detection on a short clip explains an otherwise baffling score. */
  detectedLanguage: string | null;
  languageConfidence: number | null;
};

export type Transcriber = {
  label: string;
  transcribe(req: TranscriptionRequest): Promise<TranscriptionResult>;
};

const ENDPOINT = "https://api.elevenlabs.io/v1/speech-to-text";

const MIME: Record<string, string> = {
  m4a: "audio/mp4",
  mp4: "audio/mp4",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  webm: "audio/webm",
  ogg: "audio/ogg",
  flac: "audio/flac",
  aac: "audio/aac",
};

export function mimeFor(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  return MIME[ext] ?? "application/octet-stream";
}

export class TranscriptionError extends Error {
  constructor(readonly status: number, readonly body: string) {
    super(`Scribe v2 returned ${status}: ${body.slice(0, 400)}`);
    this.name = "TranscriptionError";
  }
}

/** Build the multipart body. Split out so a test can assert the field names
    without a network call — they are the part most likely to be wrong, and
    wrong field names fail as a 422 that reads like a bad audio file. */
export function scribeForm(req: TranscriptionRequest): FormData {
  const form = new FormData();
  // Copy into a fresh buffer: a Uint8Array view over a larger pooled buffer
  // (which is what fs.readFile can hand back) would otherwise upload the
  // neighbouring bytes too.
  const bytes = new Uint8Array(req.audio);
  form.append("file", new Blob([bytes], { type: mimeFor(req.filename) }), req.filename);
  form.append("model_id", "scribe_v2");
  if (req.language) form.append("language_code", req.language);
  if (req.keyterms && req.keyterms.length > 0) {
    form.append("keyterms", JSON.stringify([...req.keyterms]));
  }
  // Diarisation and event tagging are off: one speaker dictating, and
  // "(footsteps)" in the text would count against every WER.
  form.append("diarize", "false");
  form.append("tag_audio_events", "false");
  return form;
}

export function scribeV2(apiKey: string): Transcriber {
  return {
    label: "scribe_v2",
    async transcribe(req) {
      const res = await fetch(ENDPOINT, {
        method: "POST",
        headers: { "xi-api-key": apiKey },
        body: scribeForm(req),
        signal: AbortSignal.timeout(req.timeoutMs ?? 120_000),
      });
      if (!res.ok) throw new TranscriptionError(res.status, await res.text());

      const body = (await res.json()) as {
        text?: unknown;
        language_code?: unknown;
        language_probability?: unknown;
      };
      if (typeof body.text !== "string") {
        throw new TranscriptionError(res.status, 'response had no "text" field');
      }
      return {
        text: body.text,
        detectedLanguage: typeof body.language_code === "string" ? body.language_code : null,
        languageConfidence:
          typeof body.language_probability === "number" ? body.language_probability : null,
      };
    },
  };
}
