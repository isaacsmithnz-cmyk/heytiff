/* Organisation profile — the company HeyTiff is being used FOR.
   Pure module: sections, validation, types. Server access in actions/org.ts.

   Field list (grouped by card):
     identity    trading name · legal name · ABN (checksummed) · ACN ·
                 GST registered · payment terms · website ·
                 logo (a real upload — org_logo)
     contact     email · phone · street address · suburb · state · postcode
                 (state doubles as the org's home state → public holidays)

   NO LONGER HERE: `compliance`. The ARC authorisation, the contractor licence
   and the insurance policy were five flat columns, which allowed exactly one of
   each. They are rows now — lib/org/credentials.ts and the org_credentials
   table — so this section is gone and nothing may patch those columns; they
   drop in a later cleanup migration (docs/migrations/org_credentials.sql).

   Deliberately NOT here:
     bank details        nothing invoices yet; add with invoicing, not before
     payroll settings    live in Time & Pay settings
     billing/subscription master-only, separate from the company profile
     charge-out rates    the Rate Calculator owns those */

import type { PreValidation } from "@/lib/staff/pre-validate";
import { buildSectionPatch, isSectionOf, type SectionConfig } from "../section-patch";

export type OrgSettings = {
  id: string;
  trading_name: string | null;
  legal_name: string | null;
  abn: string | null;
  acn: string | null;
  gst_registered: boolean | null;
  /** Days after an invoice is raised before it is overdue — the business's
      own policy, because ServiceM8 mirrors no invoice terms. NULL is unset
      and stays unset: the money block then says when a claim was RAISED and
      nothing about when it is due, rather than inventing a fortnight and
      calling somebody late against it. 0 is a real answer — due on receipt. */
  payment_terms_days: number | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  address: string | null;
  suburb: string | null;
  state: string | null;
  postcode: string | null;
  /** a storage ref (org/<id>/org_logo/<uuid>.png), signed at render */
  logo_url: string | null;
  /** the ONE colour a business picks; lowercase #rrggbb or null. Never
      painted raw — lib/org/theme.ts derives the legible roles from it. Not in
      ORG_EDITABLE_SECTIONS: it has its own control and saves itself, the way
      the logo does, rather than riding a card's edit cycle. */
  brand_color: string | null;
};

export const AU_STATES = ["NSW", "VIC", "QLD", "WA", "SA", "TAS", "ACT", "NT"] as const;

/* gst_registered is boolean in the DB but a Yes/No segmented control in the
   form — it travels through the patch as text and the action converts it. */
export const ORG_EDITABLE_SECTIONS = {
  identity: [
    "trading_name",
    "legal_name",
    "abn",
    "acn",
    "gst_registered",
    "payment_terms_days",
    "website",
  ],
  contact: ["email", "phone", "address", "suburb", "state", "postcode"],
} as const;

export type OrgSection = keyof typeof ORG_EDITABLE_SECTIONS;

const ORG_PATCH_CONFIG: SectionConfig = {
  sections: ORG_EDITABLE_SECTIONS,
  // no date column survives on the org row — the one that was here
  // (insurance_expiry) is a credential's expiry now
  dateColumns: new Set<string>(),
  enums: {
    state: AU_STATES,
    gst_registered: ["Yes", "No"],
  },
  // both columns are nullable — an empty submission clears them
  nullableEnums: new Set(["state", "gst_registered"]),
};

/** The terms field, read off the form's text. Three answers, because the
    caller has to tell them apart: a number, "clear it", or "that isn't a
    number of days". Whole days only — half a day is not a payment term, and
    the upper bound only keeps a typo'd 3000 out of a date constructor. It is
    the CHECK constraint's own range, said here so the browser answers first
    and the database never has to refuse a write. */
export const MAX_PAYMENT_TERMS_DAYS = 180;

export function readPaymentTerms(raw: string): number | null | "invalid" {
  const value = raw.trim();
  if (!value) return null;
  if (!/^\d{1,3}$/.test(value)) return "invalid";
  const days = Number(value);
  return days <= MAX_PAYMENT_TERMS_DAYS ? days : "invalid";
}

export const PAYMENT_TERMS_ERROR = `Payment terms are whole days — 0 to ${MAX_PAYMENT_TERMS_DAYS}.`;

/** How the setting reads back on the card: "14 days", and "On receipt" for
    the zero, which is what nought days actually means to a person. */
export function paymentTermsLabel(days: number | null): string {
  if (days === null) return "";
  if (days === 0) return "On receipt";
  return days === 1 ? "1 day" : `${days} days`;
}

export function isOrgSection(v: unknown): v is OrgSection {
  return isSectionOf(ORG_PATCH_CONFIG, v);
}

export function buildOrgPatch(
  section: OrgSection,
  entries: Iterable<[string, string]>
): { patch: Record<string, string | null>; invalid: string[] } {
  return buildSectionPatch(ORG_PATCH_CONFIG, section, entries);
}

/** Strip spaces so "51 824 753 556" and "51824753556" are the same ABN. */
export function normalizeAbn(raw: string): string {
  return raw.replace(/\s+/g, "");
}

/* ABN checksum (ATO algorithm): 11 digits; subtract 1 from the first digit,
   weight by [10,1,3,5,7,9,11,13,15,17,19], and the sum must divide by 89.
   Catches typos and transpositions before they're stored as fact. */
const ABN_WEIGHTS = [10, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19];

export function isValidAbn(raw: string): boolean {
  const abn = normalizeAbn(raw);
  if (!/^\d{11}$/.test(abn)) return false;
  let sum = 0;
  for (let i = 0; i < 11; i++) {
    const digit = Number(abn[i]) - (i === 0 ? 1 : 0);
    sum += digit * ABN_WEIGHTS[i];
  }
  return sum % 89 === 0;
}

/** ACN: 9 digits. (Format check only — the ASIC check-digit can come later.) */
export function isValidAcn(raw: string): boolean {
  return /^\d{9}$/.test(raw.replace(/\s+/g, ""));
}

/* An ABN is STORED bare and READ in the ATO's 2-3-3-3 grouping: 51 824 753 556.
   That is how it appears on an invoice and how anyone checks it against a
   document, and eleven unbroken digits is how a transposition hides. */
export function formatAbn(raw: string | null | undefined): string {
  const abn = normalizeAbn(String(raw ?? ""));
  if (!/^\d{11}$/.test(abn)) return String(raw ?? "").trim();
  return `${abn.slice(0, 2)} ${abn.slice(2, 5)} ${abn.slice(5, 8)} ${abn.slice(8)}`;
}

/** ACN in its 3-3-3 grouping, for the same reason. */
export function formatAcn(raw: string | null | undefined): string {
  const acn = String(raw ?? "").replace(/\s+/g, "");
  if (!/^\d{9}$/.test(acn)) return String(raw ?? "").trim();
  return `${acn.slice(0, 3)} ${acn.slice(3, 6)} ${acn.slice(6)}`;
}

/* The card's pre-flight, mirroring lib/staff/pre-validate.ts: the SAME rules
   the action runs, run in the browser first, so a mistyped ABN is answered on
   the field instead of after a round trip that would re-render the card
   underneath what was being typed.

   Not a security control — saveOrgSection re-checks both, and its section
   allowlist is the real gate. The messages are copied from the action verbatim
   so one mistake reads the same wherever it was caught. */
export function preValidateOrg(
  section: string,
  fields: Record<string, string>
): PreValidation | null {
  if (section !== "identity") return null;

  const abn = (fields.abn ?? "").trim();
  if (abn && !isValidAbn(abn)) {
    return { error: "That ABN doesn't check out — it should be 11 digits.", fields: ["abn"] };
  }
  const acn = (fields.acn ?? "").trim();
  if (acn && !isValidAcn(acn)) {
    return { error: "An ACN is 9 digits.", fields: ["acn"] };
  }
  if (readPaymentTerms(fields.payment_terms_days ?? "") === "invalid") {
    return { error: PAYMENT_TERMS_ERROR, fields: ["payment_terms_days"] };
  }
  return null;
}
