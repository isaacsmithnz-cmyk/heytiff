import type { Capability } from "@/lib/permissions";
import type { Role } from "@/lib/roles-shared";
import type { VehicleWithFacts } from "@/components/fleet/logic";

/* Shared prop shapes for the staff card. Kept in their own module so the
   server pages can import the types without pulling a "use client" module
   into the server graph. */

/** What a bound save action returns.

    `fields` is the ONLY addition to the actions' contract in this change: it
    carries the `invalid` array the builders already computed, so a rejected
    save can mark the field it choked on instead of just printing a sentence
    above the card. Optional — an action that has nothing to say omits it. */
export type SaveResult = { ok: true } | { ok: false; error: string; fields?: string[] };

export type SaveSection = (
  section: string,
  fields: Record<string, string>
) => Promise<SaveResult>;

export type LicenceInput = {
  typeName: string;
  licenceNumber?: string;
  expiryDate?: string;
  color?: string;
};

export type ProfileActions = {
  onSave: SaveSection;
  onAddLicence: (input: LicenceInput) => Promise<SaveResult>;
  onRemoveLicence: (licenceId: string) => Promise<SaveResult>;
  /** points the card at an already-uploaded staff_photo document */
  onSetPhoto: (documentId: string) => Promise<SaveResult>;
  onClearPhoto: () => Promise<SaveResult>;
};

/** "self" = My profile (own staff card). "admin" = Team viewing someone else. */
export type ProfileMode = "self" | "admin";

/** The hero's values. A StaffRow satisfies it. */
export type ProfileHeader = {
  id: string;
  initials: string;
  name: string;
  nickname?: string;
  email: string;
  /** job_title, or an em dash */
  role: string;
  employmentType: string;
  started: string;
  years: string;
  licenceCount: number;
  status: "Active" | "Inactive";
  photoUrl?: string | null;
};

/** Pay fields — only ever passed when the viewer holds `financials`. */
export type PayFields = {
  hourly_wage?: number | null;
  pay_basis?: string | null;
  contracted_hours?: number | null;
  utilisation?: number | null;
  super_override?: number | null;
  workers_comp_override?: number | null;
  cost_split?: unknown;
  employment_type?: string | null;
};

/** Everything the Permissions card needs to render honestly. */
export type PermissionsCtx = {
  role: Role | null;
  caps: ReadonlySet<Capability>;
  /** which of those the VIEWER may actually change */
  settable: ReadonlySet<Capability>;
  canChangeRole: boolean;
  /** false renders the whole card read-only, with no edit cycle */
  editable: boolean;
  lockedReason?: string;
};

/** Admin-only sections. A key that is absent is NOT RENDERED — that is how
    `financials` and owner-only gate Payroll and Permissions, rather than
    rendering them disabled. Mirrors the old renderer's `sections` exactly. */
export type AdminExtras = {
  payroll?: PayFields | null;
  /** What this person's ROSTER comes to in a week — their normal day times the
      days they're expected, from Time & Pay. Sits beside the typed
      `contracted_hours` on the Payroll card so the two can be seen to agree,
      or seen not to. Null for a casual (nothing is presumed for them) and when
      the org's times can't be read. See logic.ts::rosteredWeekHours. */
  rosteredWeek?: number | null;
  permissions?: PermissionsCtx;
  notes?: { notes?: string | null } | null;
};

/** Fleet is the source of the assignment — this card derives, never stores. */
export type AssignedVehicle = {
  vehicle: VehicleWithFacts;
  openIssues: number;
  lastFuel: { litres?: number; when: string } | null;
};

/* Summary leads, and everything after it is a section you FILL IN. That is the
   whole tab list, in order.

   `vehicle` is not here any more: the assignment is derived from Fleet and
   there was nothing on that tab to edit, so it reads on Summary instead. Old
   `?sec=vehicle` links still work — see LEGACY_SECTIONS. */
export const SECTION_KEYS = [
  "summary",
  "personal",
  "emergency",
  "licences",
  "workrights",
  "training",
  "mypay",
  "payroll",
  "permissions",
  "notes",
] as const;

export type SectionKey = (typeof SECTION_KEYS)[number];

/** Retired keys, and where a link carrying one should land. A bookmark that
    still says `?sec=vehicle` opens Summary, which is where that card's facts
    went — rather than silently falling back to the first tab as an unknown
    value would. */
const LEGACY_SECTIONS: Readonly<Record<string, SectionKey>> = {
  vehicle: "summary",
};

export function isSectionKey(v: unknown): v is SectionKey {
  return typeof v === "string" && (SECTION_KEYS as readonly string[]).includes(v);
}

/** The tab a `?sec=` value should open, or null when it names nothing. */
export function sectionFromParam(v: unknown): SectionKey | null {
  if (isSectionKey(v)) return v;
  if (typeof v === "string" && v in LEGACY_SECTIONS) return LEGACY_SECTIONS[v];
  return null;
}
