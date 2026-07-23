import { supabaseAdmin } from "@/lib/supabase-server";
import type { StaffMember } from "@/components/rate-calculator/engine";

/* The roster, shaped for the Rate Calculator. This is the single source of a
   person's pay inputs now — the calculator reads it and never writes it.

   It is WAGE DATA, so the caller must already hold `financials` (the page does,
   and the columns selected here are exactly the ones lib/staff/query.ts names
   only under that capability). Active staff only: the calculator prices the
   crew you have now.

   `payroll_complete` is DERIVED here, not stored — a person is ready to price
   when they have a wage, an employment type and an allocation that adds up.
   Gaps are surfaced in the tool with a link back to their Team card. */

const ROSTER_COLUMNS =
  "id, full_name, preferred_name, job_title, employment_type, status, " +
  "hourly_wage, contracted_hours, utilisation, cost_split, super_override, workers_comp_override";

type Split = { install?: number; service?: number; admin?: number };

function pct(split: Split | null, key: keyof Split): number {
  const v = split?.[key];
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

const numOrNull = (v: unknown): number | null =>
  v === null || v === undefined ? null : Number(v);

export function toStaffMember(r: Record<string, unknown>): StaffMember {
  const split = (r.cost_split ?? null) as Split | null;
  const install = pct(split, "install");
  const service = pct(split, "service");
  const admin = pct(split, "admin");
  const wage = Number(r.hourly_wage) || 0;
  const employment = (r.employment_type as string) || "";
  // ready to price = has a wage, a type, and an allocation that sums to 100
  const payroll_complete = wage > 0 && !!employment && install + service + admin === 100;

  return {
    id: String(r.id),
    name: ((r.preferred_name as string) || (r.full_name as string) || "Unnamed").trim(),
    role: (r.job_title as string) || undefined,
    hourly_wage: wage,
    employment_type: employment,
    contracted_hours_per_week: numOrNull(r.contracted_hours) ?? undefined,
    install_pct: install,
    service_pct: service,
    admin_pct: admin,
    super_override: numOrNull(r.super_override),
    workers_comp_override: numOrNull(r.workers_comp_override),
    payroll_complete,
  };
}

/** Active staff as calculator inputs. Caller must hold `financials`. */
export async function rosterForRateCalc(orgId: string): Promise<StaffMember[]> {
  const { data } = await supabaseAdmin
    .from("staff_profiles")
    .select(ROSTER_COLUMNS)
    .eq("org_id", orgId)
    .eq("status", "Active")
    .order("full_name");
  return ((data ?? []) as unknown as Record<string, unknown>[]).map(toStaffMember);
}
