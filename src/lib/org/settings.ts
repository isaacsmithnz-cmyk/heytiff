/* Organisation profile — the company HeyTiff is being used FOR.
   Pure module: sections, validation, types. Server access in actions/org.ts.

   Field list (grouped by card):
     identity    trading name · legal name · ABN (checksummed) · ACN ·
                 GST registered · website · logo (upload deferred — no bucket)
     contact     email · phone · street address · suburb · state · postcode
                 (state doubles as the org's home state → public holidays)
     compliance  ARC refrigerant trading authorisation · contractor licence ·
                 public liability insurer / policy / expiry

   Deliberately NOT here:
     bank details        nothing invoices yet; add with invoicing, not before
     payroll settings    live in Time & Pay settings
     billing/subscription master-only, separate from the company profile
     charge-out rates    the Rate Calculator owns those */

import { buildSectionPatch, isSectionOf, type SectionConfig } from "../section-patch";

export type OrgSettings = {
  id: string;
  trading_name: string | null;
  legal_name: string | null;
  abn: string | null;
  acn: string | null;
  gst_registered: boolean | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  address: string | null;
  suburb: string | null;
  state: string | null;
  postcode: string | null;
  arc_rta: string | null;
  contractor_licence: string | null;
  insurer: string | null;
  insurance_policy: string | null;
  insurance_expiry: string | null;
  logo_url: string | null;
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
    "website",
  ],
  contact: ["email", "phone", "address", "suburb", "state", "postcode"],
  compliance: [
    "arc_rta",
    "contractor_licence",
    "insurer",
    "insurance_policy",
    "insurance_expiry",
  ],
} as const;

export type OrgSection = keyof typeof ORG_EDITABLE_SECTIONS;

const ORG_PATCH_CONFIG: SectionConfig = {
  sections: ORG_EDITABLE_SECTIONS,
  dateColumns: new Set(["insurance_expiry"]),
  enums: {
    state: AU_STATES,
    gst_registered: ["Yes", "No"],
  },
  // both columns are nullable — an empty submission clears them
  nullableEnums: new Set(["state", "gst_registered"]),
};

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
