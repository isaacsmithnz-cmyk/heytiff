import { WORK_RIGHTS } from "./work-rights";

/* Reading a VEVO result or a visa grant notice into a check — the pure half.

   ============================================================
   WHAT THIS READER DELIBERATELY DOES NOT READ
   ============================================================
   This is the most sensitive document the app reads, and it is worth being
   explicit about why the list is short.

   A VEVO check result and a visa grant notice carry the holder's full name,
   date of birth, NATIONALITY, passport number, document number and often an
   address. None of it is asked for, the schema has no property for it, and the
   parse would drop it if it arrived.

   NATIONALITY IS THE ONE WORTH NAMING TWICE. It answers no question this
   feature has — "may this person work, and until when" is answered by the
   entitlement and the date — and storing it would put a protected attribute in
   a table that managers browse, next to the people it describes. A passport
   number is an identity token that belongs to the holder and to Home Affairs,
   not in a workspace's document store.

   So: the entitlement, the visa as it is named, the work condition as printed,
   the expiry, and the date of the check. That is the whole of it.

   THE STATUS IS READ BUT CONSTRAINED, because "no work limitation" on a VEVO
   printout and "Full working rights (visa)" in this app are the same fact in
   two vocabularies and a person should not have to translate. It is offered
   from the closed list and the person confirms it against the document before
   anything is saved — the same scan-then-confirm contract as everywhere else,
   and it matters more here than anywhere else. */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const text = (v: unknown, max = 120): string | null =>
  typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null;

const isoDate = (v: unknown): string | null =>
  typeof v === "string" && ISO_DATE.test(v) ? v : null;

const oneOf = (v: unknown): string | null =>
  typeof v === "string" && (WORK_RIGHTS as readonly string[]).includes(v) ? v : null;

export type WorkRightsRead = {
  status: string | null;
  visaType: string | null;
  hoursCondition: string | null;
  expiresOn: string | null;
  checkedOn: string | null;
};

const nullable = (t: "string") => ({ type: [t, "null"] });

export const WORK_RIGHTS_READ_SCHEMA = {
  type: "object",
  properties: {
    status: { anyOf: [{ type: "string", enum: [...WORK_RIGHTS] }, { type: "null" }] },
    visaType: nullable("string"),
    hoursCondition: nullable("string"),
    expiresOn: nullable("string"),
    checkedOn: nullable("string"),
  },
  required: ["status", "visaType", "hoursCondition", "expiresOn", "checkedOn"],
  additionalProperties: false,
} as const;

export const WORK_RIGHTS_READ_PROMPT =
  "This is an Australian work-entitlement document — a VEVO (Visa Entitlement Verification " +
  "Online) check result, a visa grant notice, or similar evidence of a person's right to " +
  "work in Australia.\n\n" +
  "Extract ONLY these fields:\n" +
  `- status: the work entitlement, as ONE of exactly these: ${WORK_RIGHTS.map((s) => `"${s}"`).join(", ")}. ` +
  'A visa with no work limitation is "Full working rights (visa)"; one limited by hours or ' +
  'by employer is "Conditional working rights (visa)"; a visa with no work rights at all is ' +
  '"No working rights". Null if the document does not make the entitlement clear.\n' +
  '- visaType: the visa as the document names it (e.g. "482 Temporary Skill Shortage", ' +
  '"500 Student", "Bridging visa A"). Null for a citizen or permanent resident.\n' +
  '- hoursCondition: the work limitation exactly as printed (e.g. "No work limitation", ' +
  '"48 hours per fortnight while course is in session"). Do not summarise it into a number.\n' +
  "- expiresOn: the date the visa or entitlement ceases, as yyyy-mm-dd. Null if it does not " +
  "expire or the document does not say.\n" +
  "- checkedOn: the date this check was performed or the notice was issued, as yyyy-mm-dd.\n\n" +
  "DO NOT return, and do not mention anywhere in your answer, the person's name, date of " +
  "birth, NATIONALITY or country of citizenship, passport number, travel document number, " +
  "VEVO reference or transaction number, address, or sex. None of them are asked for and " +
  "none are wanted. If the document shows them, ignore them.\n\n" +
  "Use null for anything not clearly readable. A guessed entitlement or a guessed expiry is " +
  "much worse than a blank one: this record is what an employer relies on to decide whether " +
  "someone may legally work. If this is not a work-entitlement document at all, return null " +
  "for every field.";

/** The model's answer, believed only where it is well-formed. A status outside
    the closed list is dropped — a made-up entitlement is the one value here
    that must never reach a form. */
export function parseWorkRightsRead(raw: unknown): WorkRightsRead {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    status: oneOf(r.status),
    visaType: text(r.visaType, 80),
    hoursCondition: text(r.hoursCondition, 120),
    expiresOn: isoDate(r.expiresOn),
    checkedOn: isoDate(r.checkedOn),
  };
}
