import { termFieldsFor, type OrgCredKind, type TermField } from "./credentials";

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

/* WHAT TIFF IS ASKED FOR IS NARROWED BY THE PAPER, not just by the kind.

   Asking a model for a limit of liability that a workers compensation
   certificate does not print invites it to find one — the WIC wages figure and
   the "full amount of the employer's liability" wording are both close enough
   to tempt it. A field that is not on the form is not on the prompt either,
   and `parseOrgCredRead` drops it a second time if it comes back anyway. */
const FIELD_ASK: Record<TermField, string> = {
  cover: "",
  sumInsured:
    "- sumInsured: the LIMIT OF LIABILITY / sum insured in dollars as a plain number " +
    '(so "$20,000,000" is 20000000). Null if not printed.\n',
  premium:
    "- premium: the total amount payable in AUD, GST inclusive. Null if the document " +
    "does not print a price — a certificate of currency usually does not.\n",
  excess: "- excess: the standard or basic excess in dollars, if printed\n",
};

/* What each kind of paper is, and who it comes FROM.

   The insurance wording names a CERTIFICATE OF CURRENCY specifically, because
   that is the document a builder or a head contractor actually asks a
   subcontractor for, and it is the one that prints the limit of liability the
   business is being judged on. The licence wording names the state regulators
   by role rather than by name — VBA, NSW Fair Trading, QBCC and the rest all
   print the same four facts under different letterheads. */
const CRED_WHAT: Record<OrgCredKind, { what: string; issuer: string; cover: string }> = {
  insurance: {
    what:
      "an Australian business insurance document — a certificate of currency, a policy " +
      "schedule or a certificate of insurance for a company (public liability, " +
      "professional indemnity, workers compensation or similar)",
    issuer: 'the insurer or underwriter\'s name (e.g. "QBE", "Allianz", "CGU")',
    cover:
      "- cover: what the policy covers, as printed — the class of insurance and the " +
      "business/interest insured (e.g. \"Public and products liability\", \"Air " +
      "conditioning and refrigeration contracting\"). Keep it short; do not summarise " +
      "the whole schedule.\n",
  },
  licence: {
    what:
      "an Australian business or contractor licence document — a licence certificate, " +
      "registration or authorisation issued to a COMPANY (e.g. an ARC refrigerant " +
      "trading authorisation, a state building or electrical contractor licence)",
    issuer:
      'the issuing authority (e.g. "Australian Refrigeration Council", "NSW Fair Trading", ' +
      '"Victorian Building Authority")',
    cover:
      "- cover: the classes or categories of work the licence authorises, as printed " +
      "(e.g. \"Split system air conditioning — installation and decommissioning\"). " +
      "Keep it short.\n",
  },
};

/** The prompt for one paper — the kind says what it IS, the name says which
    facts it can carry. An unnamed card gets the kind's full set. */
export function orgCredPrompt(kind: OrgCredKind, name = ""): string {
  const k = CRED_WHAT[kind];
  const fields = termFieldsFor(kind, name);
  const ask = (f: TermField) => (fields.includes(f) ? (f === "cover" ? k.cover : FIELD_ASK[f]) : "");
  /* The fields this paper cannot have are named as absent rather than left
     unmentioned. A model handed a certificate of currency and no instruction
     about an excess will still offer one from the policy wording it half
     remembers; told there is none, it does not. */
  const absent = (["sumInsured", "excess"] as const)
    .filter((f) => !fields.includes(f))
    .map((f) =>
      f === "sumInsured"
        ? "- sumInsured: null — this paper has no sum insured or limit of liability\n"
        : "- excess: null — this paper has no excess\n"
    )
    .join("");
  return (
    `This is ${k.what}. Extract:\n` +
    `- issuer: ${k.issuer}\n` +
    `- number: the policy or licence number as printed\n` +
    ask("cover") +
    ask("sumInsured") +
    ask("excess") +
    ask("premium") +
    absent +
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
    THIS paper. A licence cannot carry a sum insured; nor can a workers
    compensation policy, whose cover is statutory and uncapped. A model that
    offers one has read something else on the page. */
export function parseOrgCredRead(raw: unknown, kind: OrgCredKind, name = ""): OrgCredRead {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const fields = termFieldsFor(kind, name);
  const keep = (f: TermField, v: number | null) => (fields.includes(f) ? v : null);
  return {
    issuer: text(r.issuer, 120),
    number: text(r.number, 80),
    cover: fields.includes("cover") ? text(r.cover, 160) : null,
    sumInsured: keep("sumInsured", money(r.sumInsured)),
    premium: keep("premium", money(r.premium)),
    excess: keep("excess", money(r.excess)),
    startsOn: isoDate(r.startsOn),
    expiresOn: isoDate(r.expiresOn),
  };
}
