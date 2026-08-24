/* Staff card — shared types, the per-section write allowlist, and the
   dd/mm/yyyy <-> ISO date bridge the v3 design's text inputs need.

   Pure module: no server imports, so the renderer and the tests can use it. */

import { buildSectionPatch, type SectionConfig } from "../section-patch";
import { BOOT_SCALES, dropOrphanScale } from "./uniform";

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

  /* What to order them. Four sizes, no history: nobody asks what shirt size
     someone took two years ago. Free text with suggested ladders — see
     lib/staff/uniform.ts for why a CHECK constraint would be wrong here. */
  shirt_size: string | null;
  jacket_size: string | null;
  trousers_size: string | null;
  boot_size: string | null;
  /* Which system the boot number is quoted on — 'AU/UK', 'EU' or 'US'. Picked,
     not typed, and null wherever boot_size is: a scale with no number is not a
     fact. See lib/staff/uniform.ts. */
  boot_scale: string | null;

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
    /* Your own sizes are the one thing on this card you know better than the
       office does, and getting one wrong orders the wrong shirt — not a pay
       run. So unlike `status` and `job_title` below, these are yours. */
    "shirt_size",
    "jacket_size",
    "trousers_size",
    "boot_size",
    "boot_scale",
    /* `status` is NOT here, for the same reason `job_title` and `state` aren't:
       whether someone is on staff is a thing the business sets, not a thing
       they type about themselves. It also isn't cosmetic — `status="Active"`
       is the filter on the Time & Pay staff list, the leave page, dashboard
       tasks and the integrations drift sweep, so setting yourself Inactive
       drops you out of pay runs and task assignment. Team's own Deactivate
       arms before it fires and is gated on `team`; the same write reached
       through here as an unguarded toggle on your own card. */
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
  // boot_scale is PICKED from three values, so it is guarded like an enum
  // rather than trusted like the sizes beside it — and nullable, because
  // clearing the boot size clears the scale with it.
  enums: { status: ["Active", "Inactive"], boot_scale: BOOT_SCALES },
  nullableEnums: new Set(["boot_scale"]),
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
  const { patch, invalid } = buildSectionPatch(STAFF_PATCH_CONFIG, section, entries);
  return { patch: dropOrphanScale(patch), invalid };
}
