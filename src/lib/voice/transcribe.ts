/* Speech to text — the shared engine. Server only.

   ONE VENDOR ADAPTER, THREE CALLERS. Smart Notes needs it first; the Library and
   the tasks section adopt the same function rather than growing their own.
   That is why the surface is deliberately small — audio in, text out, one
   result type — and why the vendor lives behind it: swapping ElevenLabs for
   another provider should be this file changing and nothing else.

   ElevenLabs Scribe v2, verified against elevenlabs.io/docs/api-reference on
   2026-07-28 (house rule: a vendor's endpoint and field names are fetched,
   never recalled — the Xero invalid_scope lesson). What was verified:

     POST https://api.elevenlabs.io/v1/speech-to-text
     header  xi-api-key
     form    file (binary), model_id=scribe_v2, keyterms (JSON array)
     out     { text, language_code, language_probability, words[] }

   KEYTERMS COST MONEY — a documented 20% surcharge, and passing more than
   100 imposes a 20-second minimum billable duration per clip. That is why
   `keyterms` is capped hard below 100 here rather than "as many as we can
   think of": the point is the handful of words a general model gets wrong on
   an Australian site — staff first names, and trade vocabulary like grilles,
   condensate, plenum — not a dictionary.

   Unset key ⇒ transcription is simply unavailable, the same posture as the
   integrations: the caller degrades to a typed note rather than failing. */

const ENDPOINT = "https://api.elevenlabs.io/v1/speech-to-text";
const MODEL_ID = "scribe_v2";

/* Long enough for a two-minute site note over a bad connection, short enough
   that a wedged upstream fails the request rather than hanging it. */
const HTTP_TIMEOUT_MS = 120_000;

/** Per-keyterm rules from the API reference: under 50 characters, at most
    five words, and none of the characters their parser rejects. */
const KEYTERM_MAX_CHARS = 50;
const KEYTERM_MAX_WORDS = 5;
const KEYTERM_BANNED = /[<>{}[\]\\]/;

/** Well under the documented 100 at which a 20-second minimum billable
    duration kicks in — a short list is also a more accurate list. */
export const KEYTERM_LIMIT = 60;

/** The words a general-purpose model reliably mishears on an Australian
    HVAC site. Staff first names are added per-org on top of this. */
export const TRADE_KEYTERMS: readonly string[] = [
  "grille",
  "grilles",
  "condensate",
  "plenum",
  "flexible duct",
  "return air",
  "supply air",
  "refrigerant",
  "subcool",
  "superheat",
  "compressor",
  "condenser",
  "evaporator",
  "thermostat",
  "ducted",
  "cassette",
  "bulkhead",
  "penetration",
  "flashing",
  "brazing",
  "nitrogen purge",
  "vacuum pump",
  "micron",
  "TX valve",
  "capillary",
  "commissioning",
  "static pressure",
  "kilowatt",
  "three phase",
  "isolator",
  "switchboard",
  "RCD",
  "roof anchor",
  "harness",
  "scissor lift",
];

export function isTranscriptionConfigured(): boolean {
  return !!process.env.ELEVENLABS_API_KEY;
}

/** Clean a keyterm list to what the vendor documents it will accept: drop the
    unusable, de-duplicate case-insensitively, and cap the length. Exported
    because the rules are worth testing without a network call.

    `limits` exists because the two transports do NOT accept the same list —
    the realtime socket takes 50 terms of 20 characters where the batch
    endpoint takes far more of 50. One cleaner, the caller states its ceiling;
    omitting it keeps the batch numbers, so every existing call is unchanged. */
export function prepareKeyterms(
  raw: readonly string[],
  limits: { maxChars?: number; maxTerms?: number } = {}
): string[] {
  const maxChars = limits.maxChars ?? KEYTERM_MAX_CHARS;
  const maxTerms = limits.maxTerms ?? KEYTERM_LIMIT;
  const out: string[] = [];
  const seen = new Set<string>();
  for (const term of raw) {
    const t = typeof term === "string" ? term.trim() : "";
    if (!t || t.length >= maxChars) continue;
    if (t.split(/\s+/).length > KEYTERM_MAX_WORDS) continue;
    if (KEYTERM_BANNED.test(t)) continue;
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
    if (out.length >= maxTerms) break;
  }
  return out;
}

/* WHY THIS EXISTS: the sentence the person reads must never carry a vendor's
   words, but that is a rule about the RESPONSE, not about our own logs. The
   first build of this file conflated the two and discarded the status code
   entirely, so the first live failure — a rejected key on 2026-07-29 — could
   not be told apart from a malformed request without a redeploy. The status is
   the whole diagnosis: 401 bad key, 403 the key is scoped too tightly, 422 our
   request shape, 429 out of credit.

   The body is read defensively and truncated: it is a vendor's error text, so
   it goes to the server log and nowhere near a page. */
async function logUpstreamFailure(res: Response): Promise<string> {
  let detail = "";
  try {
    detail = (await res.text()).slice(0, 500);
  } catch {
    detail = "<unreadable body>";
  }
  console.error(`[transcribe] ElevenLabs ${res.status} ${res.statusText}: ${detail}`);
  return detail;
}

/** The only sentences either transport is allowed to hand to a person. */
const UNAVAILABLE = "Voice notes aren't switched on yet — type it instead.";
const FAILED = "That recording couldn't be transcribed. Try again, or type it.";
const EMPTY = "Nothing was said in that recording.";
/* The account has run dry. Named for what it is, because "couldn't be
   transcribed" sent Isaac hunting a bug in the microphone for an afternoon —
   and the one person who can clear it is the one who pays the bill. */
const OUT_OF_CREDIT = "Voice notes have run out of credit — type it instead, and tell the office.";

/* WHICH FAILURE IT WAS, in the one dimension a person can act on: is trying
   again worth anything?

   Live on 2026-08-17, with Isaac walking the card: every recording came back
   "That recording couldn't be transcribed. Try again, or type it." The mic
   was fine, the upload was fine, and the vendor was answering 401
   `quota_exceeded` — one credit left of ten thousand. So the card spent an
   afternoon inviting a retry that could not succeed, for a reason no amount
   of retrying could reach, and the diagnosis was sitting in a server log
   nobody had cause to open.

   RUNNING OUT IS NOT AN ERROR, IT IS A BILL. It says so plainly, and it does
   not say "try again" — the person holding the phone cannot fix it and must
   not be sent round the loop discovering that. A rejected key is the same
   shape of dead end and takes the sentence this file already has for a
   deployment that cannot hear. Everything else keeps the retry, because
   everything else might work next time — a 429 genuinely does.

   The vendor's own words never reach the page. This reads the body only to
   tell the two kinds apart; the sentence handed back is always ours. */
function upstreamMessage(status: number, detail: string): string {
  if (/quota_exceeded|insufficient[_ ]?credit|out of credits/i.test(detail)) return OUT_OF_CREDIT;
  if (status === 401 || status === 403) return UNAVAILABLE;
  return FAILED;
}

/* ── the live transport's key ──

   A browser cannot hold `ELEVENLABS_API_KEY`, and the socket has to be
   opened BY the browser: Vercel Hobby functions can't hold a WebSocket
   open, so proxying the audio through us isn't a thing we get to choose.
   The vendor's answer is a single-use token — 15 minutes, consumed on use,
   no account access — minted here where the real key already lives.

   This is still the one vendor adapter. The token is the same key by
   another name, so it comes from the same file as the key. */
export type TokenResult = { ok: true; token: string } | { ok: false; error: string };

const TOKEN_ENDPOINT = "https://api.elevenlabs.io/v1/single-use-token/realtime_scribe";
const TOKEN_TIMEOUT_MS = 10_000;

export async function mintRealtimeToken(): Promise<TokenResult> {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) return { ok: false, error: UNAVAILABLE };

  try {
    const res = await fetch(TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "xi-api-key": apiKey },
      signal: AbortSignal.timeout(TOKEN_TIMEOUT_MS),
    });
    if (!res.ok) {
      return { ok: false, error: upstreamMessage(res.status, await logUpstreamFailure(res)) };
    }
    const body: unknown = await res.json();
    const token =
      body && typeof body === "object" && typeof (body as Record<string, unknown>).token === "string"
        ? ((body as Record<string, unknown>).token as string)
        : "";
    if (!token) return { ok: false, error: FAILED };
    return { ok: true, token };
  } catch (err) {
    console.error(`[transcribe] token request failed: ${err instanceof Error ? err.message : String(err)}`);
    return { ok: false, error: FAILED };
  }
}

export type TranscriptionResult =
  | { ok: true; text: string; languageCode: string | null }
  | { ok: false; error: string };

/** Transcribe one recording. `keyterms` biases the model toward words it
    would otherwise mishear — pass staff first names plus TRADE_KEYTERMS.

    Never throws: every failure is one of our own sentences, because the
    caller's job is to offer the person a typed note instead, not to explain
    a vendor's error. */
export async function transcribeAudio(
  audio: Blob,
  opts: { keyterms?: readonly string[] } = {}
): Promise<TranscriptionResult> {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) return { ok: false, error: UNAVAILABLE };

  const form = new FormData();
  form.append("file", audio, "note.webm");
  form.append("model_id", MODEL_ID);

  // One form field PER TERM, never a JSON-stringified array. The docs say
  // only "array of strings"; the live API (proven 2026-07-29, A/B against
  // production) parses a JSON blob as ONE keyword — brackets, quotes and all —
  // so a real list blows the 50-char per-keyword limit and the whole request
  // 400s. Repeated fields is how multipart spells an array.
  for (const term of prepareKeyterms(opts.keyterms ?? [])) form.append("keyterms", term);

  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "xi-api-key": apiKey },
      body: form,
      signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
    });
    if (!res.ok) {
      return { ok: false, error: upstreamMessage(res.status, await logUpstreamFailure(res)) };
    }

    const body: unknown = await res.json();
    if (!body || typeof body !== "object") return { ok: false, error: FAILED };
    const r = body as Record<string, unknown>;

    const text = typeof r.text === "string" ? r.text.trim() : "";
    if (!text) return { ok: false, error: EMPTY };

    return {
      ok: true,
      text,
      languageCode: typeof r.language_code === "string" ? r.language_code : null,
    };
  } catch (err) {
    // The same blindness as a discarded status, one level out: a timeout, a
    // DNS failure and a TypeError all reach the person as one sentence, and
    // without this line they reach us as one too.
    console.error(`[transcribe] request failed: ${err instanceof Error ? err.message : String(err)}`);
    return { ok: false, error: FAILED };
  }
}
