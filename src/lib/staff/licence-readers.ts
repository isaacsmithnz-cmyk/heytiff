/* Reading a staff licence or ticket into a term — the pure half.

   The server action in app/actions/staff-licence-ai.ts makes the call to Tiff;
   what to ASK for and what to BELIEVE lives here, where it runs without an API
   key and is tested to the field. Same split and same posture as
   lib/fleet/readers.ts and lib/org/cred-readers.ts.

   ============================================================
   WHAT THIS READER DELIBERATELY DOES NOT READ
   ============================================================
   A driver licence is a GOVERNMENT ID. Photographed, it carries a date of
   birth, a residential address, a signature, a face and a document/card
   number that is used as an identity token in its own right.

   NONE OF THAT IS ASKED FOR, and the parse would drop it if it arrived. The
   Compliance card exists to answer one question — is this person ticketed for
   this work, and when does it lapse — and the honest way to build it is to
   extract only what answers that. Every extra field would be a copy of
   somebody's personal information sitting in a table that has no use for it,
   for as long as the row lives.

   So: the licence NUMBER (which is what proves the ticket), who issued it,
   which state, what classes it authorises, and the two dates. The prompt says
   so explicitly, because a model asked to "read this licence" will otherwise
   helpfully return the lot.

   THE TYPE IS NOT READ EITHER, for the same reason the org reader does not
   read a policy's name: it is the person's word for the thing, it is what the
   card is filed under, and one oddly-worded certificate must not split a
   ticket's history in two. */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** The states and territories, as a licence prints them. Anything else is
    dropped rather than stored — "NSW" is a fact, "New South Wales, Australia"
    typed into a 12-character column is a truncation waiting to happen. */
export const AU_LICENCE_STATES = ["NSW", "VIC", "QLD", "SA", "WA", "TAS", "NT", "ACT"] as const;
export type AuLicenceState = (typeof AU_LICENCE_STATES)[number];

const text = (v: unknown, max = 120): string | null =>
  typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null;

const isoDate = (v: unknown): string | null =>
  typeof v === "string" && ISO_DATE.test(v) ? v : null;

const auState = (v: unknown): AuLicenceState | null => {
  const s = typeof v === "string" ? v.trim().toUpperCase() : "";
  return (AU_LICENCE_STATES as readonly string[]).includes(s) ? (s as AuLicenceState) : null;
};

export type LicenceRead = {
  number: string | null;
  issuer: string | null;
  issuingState: AuLicenceState | null;
  classes: string | null;
  startsOn: string | null;
  expiresOn: string | null;
};

const nullable = (t: "string") => ({ type: [t, "null"] });

export const LICENCE_READ_SCHEMA = {
  type: "object",
  properties: {
    number: nullable("string"),
    issuer: nullable("string"),
    issuingState: { anyOf: [{ type: "string", enum: [...AU_LICENCE_STATES] }, { type: "null" }] },
    classes: nullable("string"),
    startsOn: nullable("string"),
    expiresOn: nullable("string"),
  },
  required: ["number", "issuer", "issuingState", "classes", "startsOn", "expiresOn"],
  additionalProperties: false,
} as const;

export const LICENCE_READ_PROMPT =
  "This is an Australian work licence, ticket or competency card held by a tradesperson " +
  "— for example a state driver licence, an ARC refrigerant handling licence, a " +
  "construction induction (white) card, or a trade contractor licence.\n\n" +
  "Extract ONLY these fields:\n" +
  "- number: the licence, ticket or card number as printed\n" +
  "- issuer: the issuing body as printed (e.g. \"Service NSW\", \"Australian Refrigeration " +
  "Council\", \"SafeWork NSW\")\n" +
  "- issuingState: the Australian state or territory that issued it, as one of NSW, VIC, " +
  "QLD, SA, WA, TAS, NT, ACT. Null if the card does not name one.\n" +
  "- classes: the classes, categories or conditions the ticket authorises, as printed " +
  "(e.g. \"C\", \"C, LR\", \"Split systems — installation and decommissioning\"). Keep it " +
  "short; do not describe the card.\n" +
  "- startsOn: the date the licence or ticket was ISSUED or takes effect, as yyyy-mm-dd\n" +
  "- expiresOn: the date it EXPIRES or is due for renewal, as yyyy-mm-dd\n\n" +
  "DO NOT return, and do not mention anywhere in your answer, the holder's name, date of " +
  "birth, address, signature, photograph, height, eye colour, sex, or any document or " +
  "card-identifier other than the licence number itself. They are not asked for and are " +
  "not wanted. If the document shows them, ignore them.\n\n" +
  "expiresOn is the important one — it is the date this person's record will be updated " +
  "to. If the card shows a period like \"01/09/2026 to 01/09/2027\", the LATER date is " +
  "expiresOn. Use null for anything not clearly readable; a guessed expiry is worse than " +
  "a blank one, because it silences a real warning. If this is not a licence, ticket or " +
  "competency card at all, return null for every field.";

/** The model's answer, believed only where it is well-formed. A state it does
    not recognise is dropped rather than stored, and everything the prompt told
    it not to send has nowhere to land — the schema has no property for it. */
export function parseLicenceRead(raw: unknown): LicenceRead {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    number: text(r.number, 80),
    issuer: text(r.issuer, 120),
    issuingState: auState(r.issuingState),
    classes: text(r.classes, 160),
    startsOn: isoDate(r.startsOn),
    expiresOn: isoDate(r.expiresOn),
  };
}
