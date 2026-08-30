/* Reading a job photo: what we ask, and what we are willing to believe back.

   PURE AND CLIENT-SAFE ON PURPOSE. The action that calls Claude is a
   `"use server"` module, and such a module may only export async Server
   Functions — so a plain predicate or a prompt constant cannot live there.
   Putting them here also means the parse can be tested against the shapes a
   model actually returns, which is the half that goes wrong.

   THE PROMPT IS BUILT FROM THE SUBJECT LIST, never written out beside it. Two
   copies of a vocabulary is one copy and a bug waiting for somebody to edit
   the wrong one. */

import { PHOTO_SUBJECTS, SUBJECT_MEANING, isPhotoSubject } from "./photo-subjects";

/** The four media types Claude's image block accepts. A photo we can show in
    a browser is not automatically one of these — AVIF is the live example, and
    399 of them sit in the account — so anything else is recorded as looked-at
    and left unplaced rather than sent under a type it isn't. */
export const SENDABLE_IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
] as const;

export type SendableImageType = (typeof SENDABLE_IMAGE_TYPES)[number];

export function isSendableImage(mime: string | null | undefined): mime is SendableImageType {
  return (SENDABLE_IMAGE_TYPES as readonly string[]).includes(mime ?? "");
}

/** What Claude must answer in.

    NO `maxItems` ANYWHERE. The structured-output validator rejects it
    outright — "For 'array' type, property 'maxItems' is not supported" — and
    every call 400s, surfacing only as "couldn't read that photo". The limit
    lives in the prompt and in `parseReading`, which is where a limit belongs:
    a schema constrains shape, not sense.

    `subject` admits null because a photo the model cannot place must be able
    to say so. Forced to choose, it picks the least-wrong option, and a filter
    fills with confident nonsense. */
export const READING_SCHEMA = {
  type: "object",
  properties: {
    subject: { anyOf: [{ type: "string", enum: [...PHOTO_SUBJECTS] }, { type: "null" }] },
    tags: { type: "array", items: { type: "string" } },
    caption: { type: "string" },
    text: { type: "string" },
  },
  required: ["subject", "tags", "caption", "text"],
  additionalProperties: false,
} as const;

/* THE TRANSCRIPTION IS THE POINT, not a bonus. These photographs are
   dataplates, model stickers, switchboard labels and serial numbers, and the
   model reads them for free while it is already looking at the frame. The
   first version of this asked only for six tags and threw the rest away —
   `PUZ-M125VKA2-A` is the single most useful searchable string on a rating
   plate and it needs somewhere to go.

   THE PRIVACY RULE IS IN THE PROMPT, not only in the reviewer's head. This
   collection is shown to OTHER clients, so a face, a plate, or a customer's
   name on paperwork must not be transcribed in the first place — the cheapest
   place to not have data is to never write it down. */
export const READ_PROMPT =
  "This is one photograph from an Australian air-conditioning job — taken on " +
  "site by the tradesperson, kept so it can be found again later.\n\n" +
  "Say what the photo is OF, choosing exactly one subject from this list:\n" +
  PHOTO_SUBJECTS.map((s) => `- ${s}: ${SUBJECT_MEANING[s]}`).join("\n") +
  "\n\nRules:\n" +
  "- subject: the MAIN thing in the frame. If a dataplate fills the picture " +
  "it is dataplate, even though the plate is on an outdoor unit. If you " +
  "genuinely cannot tell, return null — a wrong subject is worse than none, " +
  "because it hides the photo under a filter nobody will look in.\n" +
  "- tags: up to six short lowercase terms for anything else worth searching " +
  '— equipment type, mounting, setting, condition (e.g. "bulkhead", ' +
  '"roof mounted", "mitsubishi", "before"). Only what you can SEE. Never ' +
  "guess a brand or a model from context.\n" +
  "- caption: one plain sentence under 90 characters describing the picture, " +
  'in English. No preamble, no "this image shows".\n' +
  "- text: EVERY word visible in the frame, transcribed exactly as printed — " +
  "model numbers, serial numbers, ratings, capacities, warning labels, " +
  "switchboard legends, handwriting on a wall. This is what makes the photo " +
  "findable later, so transcribe generously and do not summarise. Empty " +
  "string if there is genuinely no legible text.\n" +
  "- NEVER transcribe or describe a person, a face, a phone number, a number " +
  "plate, a street address, or a customer's name — including where those " +
  "appear on paperwork in shot. These photographs get shown to OTHER clients.";

export type PhotoReading = {
  subject: string | null;
  tags: string[];
  caption: string;
  ocrText: string;
};

/** Validate a reading. A SCHEMA CONSTRAINS SHAPE, NOT SENSE — every field is
    re-checked here, the same rule fleet-ai and expense-ai follow, and the six
    the prompt asks for is enforced here rather than trusted.

    Returns null only when the answer was not even JSON. A well-formed answer
    with an unusable subject is NOT null: it is a reading with a null subject,
    because the photo was still looked at and must leave the queue. */
export function parseReading(text: string): PhotoReading | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object") return null;
  const o = raw as { subject?: unknown; tags?: unknown; caption?: unknown; text?: unknown };
  return {
    subject: isPhotoSubject(o.subject) ? o.subject : null,
    tags: Array.isArray(o.tags)
      ? [
          ...new Set(
            o.tags
              .filter((t): t is string => typeof t === "string")
              .map((t) => t.trim().toLowerCase().slice(0, 40))
              .filter(Boolean)
          ),
        ].slice(0, 6)
      : [],
    caption: typeof o.caption === "string" ? o.caption.trim().slice(0, 140) : "",
    /* Generous but bounded. A dense switchboard legend is worth keeping whole;
       a model that starts hallucinating a novel is not, and 4,000 characters
       is far past any real label. */
    ocrText: typeof o.text === "string" ? o.text.trim().slice(0, 4000) : "",
  };
}
