/* What an ADMIN may write on someone else's card, and which capability each
   section needs. Kept in its own module, deliberately separate from
   SELF_EDITABLE_SECTIONS — merging the two would put a wage column one typo
   away from the self-profile allowlist.

   Pure: no server imports, so the rules are unit-testable without a session. */

import { buildSectionPatch, type SectionConfig } from "../section-patch";
import type { Capability } from "../permissions";

/* Each section names the capability that unlocks it. `permissions` is absent
   here because it doesn't write staff_profiles columns at all — it writes
   memberships, through its own path with its own guards. */
export const ADMIN_SECTIONS = {
  personal: {
    capability: "team" as Capability,
    columns: [
      "full_name",
      "preferred_name",
      "phone",
      "birthday",
      "address",
      "start_date",
      "employment_type",
      "job_title",
      "status",
    ],
  },
  emergency: {
    capability: "team" as Capability,
    columns: [
      "emergency_name",
      "emergency_phone",
      "emergency_relationship",
      "emergency_alt_phone",
    ],
  },
  workrights: {
    capability: "team" as Capability,
    columns: [
      "work_rights_status",
      "visa_type",
      "visa_expiry",
      "hours_condition",
      "vevo_checked_at",
    ],
  },
  licences: {
    capability: "team" as Capability,
    columns: ["qualifications"],
  },
  payroll: {
    capability: "financials" as Capability,
    columns: [
      "hourly_wage",
      "contracted_hours",
      "utilisation",
      "employment_type",
      // assembled from the three sliders — see buildAdminPatch
      "cost_install",
      "cost_service",
      "cost_admin",
    ],
  },
  notes: {
    capability: "team" as Capability,
    columns: ["notes"],
  },
} as const;

export type AdminSection = keyof typeof ADMIN_SECTIONS;

export function isAdminSection(v: unknown): v is AdminSection {
  return typeof v === "string" && Object.hasOwn(ADMIN_SECTIONS, v);
}

/** The capability a section needs. */
export function capabilityFor(section: AdminSection): Capability {
  return ADMIN_SECTIONS[section].capability;
}

const ADMIN_PATCH_CONFIG: SectionConfig = {
  sections: Object.fromEntries(
    Object.entries(ADMIN_SECTIONS).map(([k, v]) => [k, v.columns])
  ),
  dateColumns: new Set(["birthday", "start_date", "visa_expiry", "vevo_checked_at"]),
  enums: { status: ["Active", "Inactive"] },
};

/** Columns stored as numbers — the form sends text. */
const NUMERIC = new Set(["hourly_wage", "contracted_hours", "utilisation"]);

export type AdminPatch = {
  patch: Record<string, unknown>;
  invalid: string[];
};

/* Build the column patch for one admin-edited section.

   Beyond the shared allowlist/date handling this does two things:
   - numeric columns are parsed, and rejected rather than coerced, so "45o"
     doesn't silently become NULL or 45
   - the three cost sliders collapse into the single cost_split jsonb, and
     only when they total 100 — a split that doesn't add up is a bad number to
     hand the charge-out calculator */
export function buildAdminPatch(
  section: AdminSection,
  entries: Iterable<[string, string]>
): AdminPatch {
  const list = [...entries];
  const { patch: base, invalid } = buildSectionPatch(ADMIN_PATCH_CONFIG, section, list);
  const patch: Record<string, unknown> = { ...base };

  for (const key of NUMERIC) {
    if (!(key in patch)) continue;
    const raw = patch[key];
    if (raw === null || raw === "") {
      patch[key] = null;
      continue;
    }
    const n = Number(String(raw).replace(/[$,\s]/g, ""));
    if (!Number.isFinite(n) || n < 0) {
      invalid.push(key);
      delete patch[key];
      continue;
    }
    patch[key] = n;
  }

  if (section === "payroll") {
    const num = (k: string) => {
      const v = patch[k];
      delete patch[k];
      const n = Number(v);
      return Number.isFinite(n) ? Math.round(n) : null;
    };
    const install = num("cost_install");
    const service = num("cost_service");
    const admin = num("cost_admin");
    if (install !== null && service !== null && admin !== null) {
      if (install + service + admin !== 100) {
        invalid.push("cost_split");
      } else {
        patch.cost_split = { install, service, admin };
      }
    }
  }

  return { patch, invalid };
}
