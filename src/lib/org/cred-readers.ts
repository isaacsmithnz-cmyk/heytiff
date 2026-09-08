import type { OrgCredKind } from "./credentials";

/* Reading the business's own certificate into a record — the pure half.

   The server action in app/actions/org-credential-ai.ts makes the call to
   Tiff; what to ASK for and what to BELIEVE lives here, where it runs without
   an API key and is tested to the field. Same split, and the same posture, as
   lib/fleet/readers.ts: the model's answer is INPUT. Every value is checked
   before it becomes a form value, because a value that lands in a form is one
   that gets saved — and what gets saved here is whether the business is
   licensed and insured to work.

   TWO KINDS, ONE READER, because they carry the same core facts (who it is
   with, its number, what it covers, from when, until when, what it cost) and
   differ only in the words printed above them. A certificate of currency and a
   contractor licence are the same document to a filing cabinet.

   THE NAME IS NOT READ. The credential's name is the person's word for it —
   "Public liability", "Contractor licence" — and it is what the card is
   filed under and what the renewal history hangs off. Letting a scan rewrite
   it would let one badly-worded certificate split a policy's history in two.
   A scan fills a TERM; the person names the thing. */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const text = (v: unknown, max = 120): string | null =>
  typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null;

const isoDate = (v: unknown): string | null =>
  typeof v === "string" && ISO_DATE.test(v) ? v : null;

/** Dollars: finite and non-negative. A negative premium or a NaN is not a
    figure anyone would write into this table. */
const money = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) && v >= 0 ? Math.round(v * 100) / 100 : null;

export type OrgCredRead = {
  issuer: string | null;
  number: string | null;
  cover: string | null;
  sumInsured: number | null;
  premium: number | null;
  excess: number | null;
  startsOn: string | null;
  expiresOn: string | null;
};

const nullable = (t: "string" | "number") => ({ type: [t, "null"] });

export const ORG_CRED_READ_SCHEMA = {
  type: "object",
  properties: {
    issuer: nullable("string"),
    number: nullable("string"),
    cover: nullable("string"),
    sumInsured: nullable("number"),
    premium: nullable("number"),
    excess: nullable("number"),
    startsOn: nullable("string"),
    expiresOn: nullable("string"),
  },
  required: ["issuer", "number", "cover", "sumInsured", "premium", "excess", "startsOn", "expiresOn"],
  additionalProperties: false,
} as const;

/* What each kind of paper is, and who it comes FROM.

   The insurance wording names a CERTIFICATE OF CURRENCY specifically, because
   that is the document a builder or a head contractor actually asks a
   subcontractor for, and it is the one that prints the limit of liability the
   business is being judged on. The licence wording names the state regulators
   by role rather than by name — VBA, NSW Fair Trading, QBCC and the rest all
   print the same four facts under different letterheads. */
const CRED_WHAT: Record<OrgCredKind, { what: string; issuer: string; extras: string }> = {
  insurance: {
    what:
      "an Australian business insurance document — a certificate of currency, a policy " +
      "schedule or a certificate of insurance for a company (public liability, " +
      "professional indemnity, workers compensation or similar)",
    issuer: 'the insurer or underwriter\'s name (e.g. "QBE", "Allianz", "CGU")',
    extras:
      "- cover: what the policy covers, as printed — the class of insurance and the " +
      "business/interest insured (e.g. \"Public and products liability\", \"Air " +
      "conditioning and refrigeration contracting\"). Keep it short; do not summarise " +
      "the whole schedule.\n" +
      "- sumInsured: the LIMIT OF LIABILITY / sum insured in dollars as a plain number " +
      "(so \"$20,000,000\" is 20000000). Null if not printed.\n" +
      "- excess: the standard or basic excess in dollars, if printed\n",
  },
  licence: {
    what:
      "an Australian business or contractor licence document — a licence certificate, " +
      "registration or authorisation issued to a COMPANY (e.g. an ARC refrigerant " +
      "trading authorisation, a state building or electrical contractor licence)",
    issuer:
      'the issuing authority (e.g. "Australian Refrigeration Council", "NSW Fair Trading", ' +
      '"Victorian Building Authority")',
    extras:
      "- cover: the classes or categories of work the licence authorises, as printed " +
      "(e.g. \"Split system air conditioning — installation and decommissioning\"). " +
      "Keep it short.\n" +
      "- sumInsured: null (a licence has no sum insured)\n" +
      "- excess: null (a licence has no excess)\n",
  },
};

/** The prompt for one kind. */
export function orgCredPrompt(kind: OrgCredKind): string {
  const k = CRED_WHAT[kind];
  return (
    `This is ${k.what}. Extract:\n` +
    `- issuer: ${k.issuer}\n` +
    `- number: the policy or licence number as printed\n` +
    k.extras +
    `- premium: the total amount payable in AUD, GST inclusive. Null if the document ` +
    `does not print a price — a certificate of currency usually does not.\n` +
    "- startsOn: the date cover or the licence period BEGINS, as yyyy-mm-dd\n" +
    "- expiresOn: the date it ENDS or is due for renewal, as yyyy-mm-dd\n" +
    "\nexpiresOn is the important one — it is the date the business's record will be " +
    'updated to. If the document shows a period like "01/09/2026 to 01/09/2027", the ' +
    "LATER date is expiresOn. This is the COMPANY's document: if it names an individual " +
    "tradesperson rather than a business, read it anyway, but do not invent a company " +
    "name for the issuer. Use null for anything not clearly readable; a guessed expiry " +
    "is worse than a blank one, because it silences a real warning. If this is not that " +
    "kind of document at all, return null for every field."
  );
}

/** The model's answer, believed only where it is well-formed AND belongs to
    this kind of document. A licence cannot carry a sum insured or an excess,
    so a model that offers one has misread the page. */
export function parseOrgCredRead(raw: unknown, kind: OrgCredKind): OrgCredRead {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    issuer: text(r.issuer, 120),
    number: text(r.number, 80),
    cover: text(r.cover, 160),
    sumInsured: kind === "insurance" ? money(r.sumInsured) : null,
    premium: money(r.premium),
    excess: kind === "insurance" ? money(r.excess) : null,
    startsOn: isoDate(r.startsOn),
    expiresOn: isoDate(r.expiresOn),
  };
}
