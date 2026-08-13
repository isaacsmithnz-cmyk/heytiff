/* Staff card — shared types, the per-section write allowlist, and the
   dd/mm/yyyy <-> ISO date bridge the v3 design's text inputs need.

   Pure module: no server imports, so the renderer and the tests can use it. */

import { buildSectionPatch, type SectionConfig } from "../section-patch";

export type StaffProfile = {
  id: string;
  org_id: string;
  user_id: string | null;

  first_name: string | null;
  last_name: string | null;
  /* Derived — written as "first last" whenever either half is saved. Never
     split back apart; see lib/staff/name.ts. */
  full_name: string | null;
  preferred_name: string | null;
  phone: string | null;
  birthday: string | null;
  address: string | null;
  start_date: string | null;
  employment_type: string | null;
  job_title: string | null;
  status: "Active" | "Inactive";
  /* Which state's public-holiday calendar applies to their timesheet. Null
     means the organisation's own state — the common case. Every holiday
     consumer resolves through the same staff→org fallback (stateFor). */
  state: string | null;
  photo_url: string | null;

  emergency_name: string | null;
  emergency_phone: string | null;
  emergency_relationship: string | null;
  emergency_alt_phone: string | null;

  work_rights_status: string | null;
  visa_type: string | null;
  visa_expiry: string | null;
  hours_condition: string | null;
  vevo_checked_at: string | null;
  work_rights_doc_url: string | null;

  qualifications: string | null;
};

/* Sections a user may edit on their OWN card. Payroll, permissions and notes
   are deliberately absent — there is no key here that reaches them, so a
   direct POST cannot either. The UI hiding them is a convenience, not the
   control. */
export const SELF_EDITABLE_SECTIONS = {
  personal: [
    // full_name is absent deliberately: it is derived from these two, so a
    // direct POST must not be able to set it out of step with them.
    "first_name",
    "last_name",
    "preferred_name",
    "phone",
    "birthday",
    "address",
    "start_date",
    "employment_type",
    "status",
  ],
  emergency: [
    "emergency_name",
    "emergency_phone",
    "emergency_relationship",
    "emergency_alt_phone",
  ],
  workrights: [
    "work_rights_status",
    "visa_type",
    "visa_expiry",
    "hours_condition",
    "vevo_checked_at",
  ],
  licences: ["qualifications"],
} as const;

export type SelfSection = keyof typeof SELF_EDITABLE_SECTIONS;

export function isSelfSection(v: unknown): v is SelfSection {
  return typeof v === "string" && Object.hasOwn(SELF_EDITABLE_SECTIONS, v);
}

/** Columns stored as a real `date` — their form values arrive as dd/mm/yyyy. */
export const DATE_COLUMNS = new Set([
  "birthday",
  "start_date",
  "visa_expiry",
  "vevo_checked_at",
]);

// dd/mm/yyyy helpers moved to the shared module; re-exported so existing
// importers (profile renderer, tests) are untouched.
export { formatAuDate, parseAuDate } from "../au-dates";

/* Section-patch config: status is a NOT NULL CHECK column, so an empty
   submission is dropped (not nulled) — see section-patch.ts. */
const STAFF_PATCH_CONFIG: SectionConfig = {
  sections: SELF_EDITABLE_SECTIONS,
  dateColumns: DATE_COLUMNS,
  enums: { status: ["Active", "Inactive"] },
};

/* Turn submitted form entries into a column patch for one section.
   Anything outside that section's allowlist is dropped silently — the caller
   has already decided the section is legitimate; this decides the columns.
   Returns `invalid` so the UI can say which date it could not read rather
   than quietly discarding what the user typed. */
export function buildPatch(
  section: SelfSection,
  entries: Iterable<[string, string]>
): { patch: Record<string, string | null>; invalid: string[] } {
  return buildSectionPatch(STAFF_PATCH_CONFIG, section, entries);
}
