import type { StaffProfile } from "./profile";

/* What is still missing from a staff card — one model, three consumers.

   The ring, the checklist under it and the amber dot on a tab all have to
   agree, so all three read THIS rather than each counting for themselves.

   ONLY FIELDS THE SCREEN CAN ACTUALLY SET GET IN. A checklist item with no
   control behind it is a list that never empties — which is why preferred_name
   is absent (most people have no nickname, so counting it would cap an honest
   card below 100% forever). Add a field here the day the control exists, not
   before.

   NOT EVERY FIELD WITH A CONTROL BELONGS HERE, though. The uniform sizes on
   the Personal card have controls and are deliberately absent: a size is
   wanted by whoever places the next order, not by payroll or by the law, and
   four more entries would drop every existing card by a third of the ring for
   a shirt nobody has ordered yet. Same rule as preferred_name — the list is
   what the business is short of, not everything the screen can write.

   photo_url joined on that rule, not despite it: the camera badge on the
   identity block is the control, so the field became answerable and went in
   the same change. It counts against `summary` because that is the tab the
   badge lives on — the only entry whose section is not a form. */

/** The sections that own a completeness field. A subset of SectionKey. */
export type CompletenessSection = "summary" | "personal" | "emergency" | "workrights";

export type ProfileFieldSpec = {
  /** the StaffProfile column */
  key: keyof StaffProfile;
  label: string;
  section: CompletenessSection;
  /** the business is obliged to hold it — payroll (STP reporting) or the law.
      Everything else here is wanted, not required, and says so. */
  required: boolean;
};

export const PROFILE_FIELDS: readonly ProfileFieldSpec[] = [
  // Single Touch Payroll reports a name, a date of birth and an address, and
  // the award the person is on follows from their employment type — so these
  // are what payroll is actually blocked on.
  { key: "first_name", label: "First name", section: "personal", required: true },
  { key: "last_name", label: "Last name", section: "personal", required: true },
  { key: "birthday", label: "Date of birth", section: "personal", required: true },
  { key: "address", label: "Address", section: "personal", required: true },
  { key: "start_date", label: "Start date", section: "personal", required: true },
  { key: "employment_type", label: "Employment type", section: "personal", required: true },
  // Not payroll, but every employer must hold evidence of the right to work.
  { key: "work_rights_status", label: "Work rights", section: "workrights", required: true },
  // Wanted, not required: nothing stops payroll running without them, but a
  // crew you cannot phone and a person nobody can be called for is worse.
  { key: "phone", label: "Mobile number", section: "personal", required: false },
  { key: "emergency_name", label: "Emergency contact", section: "emergency", required: false },
  { key: "emergency_phone", label: "Emergency phone", section: "emergency", required: false },
  { key: "photo_url", label: "Profile photo", section: "summary", required: false },
];

export type Completeness = {
  filled: number;
  total: number;
  /** 0–100, rounded — what the ring draws */
  percent: number;
  missing: readonly ProfileFieldSpec[];
  /** how many of `missing` the business is obliged to hold */
  requiredMissing: number;
  /** sections holding at least one missing field */
  sectionsMissing: ReadonlySet<CompletenessSection>;
  /** section → how many of its fields are missing — the tabs' count badges.
      A COUNT, not a flag: the checklist that used to spell the fields out is
      gone, so this badge is now the only thing saying which tab is short and
      by how much. */
  sectionCounts: ReadonlyMap<CompletenessSection, number>;
  complete: boolean;
};

/** A value counts as present only if it survives trimming — a column holding
    a space is not an address. */
function has(profile: StaffProfile | null, key: keyof StaffProfile): boolean {
  const v = profile?.[key];
  return typeof v === "string" ? v.trim().length > 0 : v != null;
}

export function profileCompleteness(profile: StaffProfile | null): Completeness {
  const missing = PROFILE_FIELDS.filter((f) => !has(profile, f.key));
  const total = PROFILE_FIELDS.length;
  const filled = total - missing.length;

  const sectionCounts = new Map<CompletenessSection, number>();
  for (const f of missing) sectionCounts.set(f.section, (sectionCounts.get(f.section) ?? 0) + 1);

  return {
    filled,
    total,
    // A card with nothing on it reads 0%, not NaN — total is a constant here,
    // but the guard keeps that true if the list is ever built dynamically.
    percent: total === 0 ? 100 : Math.round((filled / total) * 100),
    missing,
    requiredMissing: missing.filter((f) => f.required).length,
    sectionsMissing: new Set(missing.map((f) => f.section)),
    sectionCounts,
    complete: missing.length === 0,
  };
}

/** "6 of 10 fields missing · 2 required" — the line under the ring. */
export function completenessSummary(c: Completeness): string {
  if (c.complete) return "Every field we ask for is filled in";
  const fields = `${c.missing.length} of ${c.total} field${c.total === 1 ? "" : "s"} missing`;
  return c.requiredMissing > 0 ? `${fields} · ${c.requiredMissing} required` : fields;
}
