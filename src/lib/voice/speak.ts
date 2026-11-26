/* Text to speech: Tiff's voice. Server only for `synthesize`; `speakable` is
   pure and runs anywhere.

   Isaac, 26 November 2026: "give tiff a voice?", then "both" (she reads her
   answers out, and a hands-free talk), then "Flow's right" to the mock at
   https://claude.ai/artifact/2vtUgVFZHbJf5gamXZZBPm.

   THE SAME VENDOR AS HER EARS (transcribe.ts), the same key, the same rule
   that the vendor's words never reach a page. Verified against
   elevenlabs.io/docs/api-reference/text-to-speech/stream and
   /docs/overview/models on 2026-11-26:

     POST https://api.elevenlabs.io/v1/text-to-speech/{voice_id}/stream
     header  xi-api-key
     query   output_format (mp3_44100_128 by default; we ask mp3_44100_64)
     body    { text, model_id, voice_settings? }
     out     streaming audio

   `eleven_v4_turbo` is the docs' pick for low latency, about 100 ms to the
   first sound, at the cheaper rate ($0.04 per 1K characters, read from
   elevenlabs.io/pricing/api the same day). A spoken minute is about 1K.

   TWO THINGS HAVE TO BE SET, the key with Text to speech allowed and the
   voice. The voice is a setting and not a constant because it is his to
   pick from samples (the canvas's "Her voice" note), and because the key
   he has can't list voices yet. Either one missing, or the vendor refusing
   the key, is `fallback`: the screen plays nothing and says "Voice is
   unavailable at the moment." Never the device's own voice (Isaac, 27
   November 2026: "that's not TIFF and it just makes it sound quite shit"). */

import { capSaid, speakable, SPEAK_MAX_CHARS } from "./speak-words";

export { capSaid, speakable, SPEAK_MAX_CHARS };

const ENDPOINT = "https://api.elevenlabs.io/v1/text-to-speech";
const DEFAULT_MODEL = "eleven_v4_turbo";
/* 64 kbps is plenty for one voice and half the bytes of the default on a
   tradie's mobile data. */
const OUTPUT_FORMAT = "mp3_44100_64";
const HTTP_TIMEOUT_MS = 20_000;

export type SpeakResult =
  | { ok: true; audio: ReadableStream<Uint8Array>; contentType: string }
  /** `fallback`: her voice can't be had here. Not configured, or the
      vendor refused the key or ran dry. */
  | { ok: false; fallback: true }
  /** A failure worth trying again (a timeout, a 429, a 5xx). */
  | { ok: false; fallback: false };

/** True when this deployment can speak in her own voice. */
export function isSpeechConfigured(): boolean {
  return Boolean(process.env.ELEVENLABS_API_KEY && process.env.ELEVENLABS_VOICE_ID);
}

/** Turn words into her voice, streamed. Never throws. */
export async function synthesize(text: string): Promise<SpeakResult> {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  const voice = process.env.ELEVENLABS_VOICE_ID;
  if (!apiKey || !voice) return { ok: false, fallback: true };
  const model = process.env.ELEVENLABS_TTS_MODEL || DEFAULT_MODEL;

  try {
    const url = `${ENDPOINT}/${encodeURIComponent(voice)}/stream?output_format=${OUTPUT_FORMAT}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "xi-api-key": apiKey, "Content-Type": "application/json", Accept: "audio/mpeg" },
      body: JSON.stringify({ text, model_id: model }),
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });
    if (!res.ok || !res.body) {
      let detail = "";
      try {
        detail = (await res.text()).slice(0, 500);
      } catch {
        detail = "<unreadable body>";
      }
      /* The status is the diagnosis, to the log only: 401 the key can't
         speak (missing_permissions) or ran dry, 404 the voice is gone, 422
         our request, 429 too many at once. */
      console.error(`[speak] ElevenLabs ${res.status} ${res.statusText}: ${detail}`);
      const dead = res.status === 401 || res.status === 403 || res.status === 404 || /quota_exceeded/i.test(detail);
      return { ok: false, fallback: dead };
    }
    return { ok: true, audio: res.body, contentType: res.headers.get("content-type") || "audio/mpeg" };
  } catch (err) {
    console.error(`[speak] request failed: ${err instanceof Error ? err.message : String(err)}`);
    return { ok: false, fallback: false };
  }
}
