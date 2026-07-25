import { supabaseAdmin } from "@/lib/supabase-server";
import { displayNameOf } from "@/lib/staff/name";
import { DEFAULT_SETTINGS, type DayEntry, type Settings, type StaffWeek } from "@/components/timepay/logic";
import { dateOfDay, periodEnd, periodLength, type PeriodConfig } from "./period";

/* Time & Pay queries. Org-scoped throughout, like lib/staff and lib/fleet.

   THE MONEY RULE, restated for this module: the wage column is named ONCE,
   in RATE_COLUMN, and exactly one query here reaches it — listStaffWeeks,
   and only with an explicit `pay: true`. The rule is SCOPE, not role:

     the *all* screen  includes rates only with `financials` — and then for
                       everyone, your own row included
     the *my* screen   NEVER reads a rate. A timesheet is hours; your own
                       rate lives on My profile → My Pay, a different query
                       on a screen that can give it context.

   One query each, no per-row branching. A timesheet payload has no rate
   anywhere, so StaffWeek.rate is null and derive() returns gross: null.
   There is nothing for a component to forget to hide. */

const RATE_COLUMN = "hourly_wage";

const STAFF_COLUMNS =
  "id, first_name, last_name, full_name, preferred_name, job_title, status";

export type TimesheetStatus = "draft" | "submitted" | "approved" | "sent_back";

export type SheetState = {
  status: TimesheetStatus;
  submittedAt: string | null;
  reviewNote: string | null;
  reviewedBy: string | null;
};

export const EMPTY_SHEET: SheetState = {
  status: "draft",
  submittedAt: null,
  reviewNote: null,
  reviewedBy: null,
};

/* ---- settings ---- */

export async function getPaySettings(
  orgId: string,
): Promise<{ settings: Settings; configured: boolean }> {
  const { data } = await supabaseAdmin
    .from("pay_settings")
    .select("*")
    .eq("org_id", orgId)
    .maybeSingle();
  if (!data) return { settings: DEFAULT_SETTINGS, configured: false };

  const rules = (data.rules ?? {}) as Partial<Settings["rules"]>;
  return {
    configured: !!data.configured,
    settings: {
      cycle: (data.cycle as Settings["cycle"]) ?? DEFAULT_SETTINGS.cycle,
      weekStart: (data.week_start as string) ?? DEFAULT_SETTINGS.weekStart,
      fortnightAnchor: (data.fortnight_anchor as string) ?? null,
      monthStartDay: Number(data.month_start_day ?? DEFAULT_SETTINGS.monthStartDay),
      standard: Number(data.standard ?? DEFAULT_SETTINGS.standard),
      otAfter: Number(data.ot_after ?? DEFAULT_SETTINGS.otAfter),
      otUnit: (data.ot_unit as Settings["otUnit"]) ?? DEFAULT_SETTINGS.otUnit,
      // a half-written rules blob must not silently disable a penalty rule
      rules: { ...DEFAULT_SETTINGS.rules, ...rules },
      dblAfter: Number(data.dbl_after ?? DEFAULT_SETTINGS.dblAfter),
      submitDay: (data.submit_day as string) ?? DEFAULT_SETTINGS.submitDay,
      submitTime: (data.submit_time as string) ?? DEFAULT_SETTINGS.submitTime,
      lock: data.lock ?? DEFAULT_SETTINGS.lock,
      exportDetail: data.export_detail ?? DEFAULT_SETTINGS.exportDetail,
    },
  };
}

/* ---- entries ---- */

/** One DayEntry cell per day of the period — 7, 14 or a calendar month. */
function toDays(
  rows: Record<string, unknown>[],
  periodStart: string,
  cfg: PeriodConfig,
): DayEntry[] {
  const byDate = new Map<string, Record<string, unknown>>();
  for (const r of rows) byDate.set(String(r.work_date).slice(0, 10), r);

  return Array.from({ length: periodLength(periodStart, cfg) }, (_, i) => {
    const r = byDate.get(dateOfDay(periodStart, i));
    if (!r) return { t: "empty" } as DayEntry;
    const h = Number(r.hours) || 0;
    if (r.kind === "work")
      return { t: "work", in: String(r.start_time ?? ""), out: String(r.end_time ?? ""), h };
    return { t: r.kind as "leave" | "sick" | "ph", h };
  });
}

async function entriesFor(
  orgId: string,
  periodStart: string,
  cfg: PeriodConfig,
  staffIds?: string[],
): Promise<Map<string, Record<string, unknown>[]>> {
  let q = supabaseAdmin
    .from("time_entries")
    .select("staff_profile_id, work_date, kind, start_time, end_time, hours")
    .eq("org_id", orgId)
    .gte("work_date", periodStart)
    .lte("work_date", periodEnd(periodStart, cfg));
  if (staffIds) q = q.in("staff_profile_id", staffIds);
  const { data } = await q;

  const out = new Map<string, Record<string, unknown>[]>();
  for (const r of (data ?? []) as Record<string, unknown>[]) {
    const id = String(r.staff_profile_id);
    out.set(id, [...(out.get(id) ?? []), r]);
  }
  return out;
}

export async function sheetStates(
  orgId: string,
  periodStart: string,
): Promise<Map<string, SheetState>> {
  const { data } = await supabaseAdmin
    .from("timesheets")
    .select("staff_profile_id, status, submitted_at, review_note, reviewed_by")
    .eq("org_id", orgId)
    .eq("period_start", periodStart);

  const out = new Map<string, SheetState>();
  for (const r of data ?? []) {
    out.set(r.staff_profile_id as string, {
      status: (r.status as TimesheetStatus) ?? "draft",
      submittedAt: (r.submitted_at as string) ?? null,
      reviewNote: (r.review_note as string) ?? null,
      reviewedBy: (r.reviewed_by as string) ?? null,
    });
  }
  return out;
}

function nameOf(r: Record<string, unknown>): string {
  return displayNameOf(r);
}

/** Everyone's week — the `timepay_all` screen.

    `pay` comes from the caller's `financials`. When it is false the rate
    column is not in the select list at all, so no row can carry one. */
export async function listStaffWeeks(
  orgId: string,
  periodStart: string,
  opts: { pay: boolean; cfg: PeriodConfig },
): Promise<StaffWeek[]> {
  const { data } = await supabaseAdmin
    .from("staff_profiles")
    .select(opts.pay ? `${STAFF_COLUMNS}, ${RATE_COLUMN}` : STAFF_COLUMNS)
    .eq("org_id", orgId)
    .eq("status", "Active")
    .order("first_name")
    .order("last_name");

  const rows = (data ?? []) as unknown as Record<string, unknown>[];
  const entries = await entriesFor(orgId, periodStart, opts.cfg, rows.map((r) => String(r.id)));

  return rows.map((r) => ({
    id: String(r.id),
    name: nameOf(r),
    role: (r.job_title as string) || "—",
    rate: opts.pay && r[RATE_COLUMN] != null ? Number(r[RATE_COLUMN]) : null,
    days: toDays(entries.get(String(r.id)) ?? [], periodStart, opts.cfg),
  }));
}

/** Your own week — the intrinsic screen. HOURS ONLY: this no longer reads
    your wage. My timesheet is about days and hours, and a rate sitting on it
    made a gross figure one multiplication away from a screen that must not
    state one. Your rate is still yours to see — it lives on My profile → My
    Pay, which asks for it in its own query and can put it in context.

    So the select list here is identity + hours, `rate` is structurally null,
    and derive() returns gross: null. Nothing to forget to hide. */
export async function getMyWeek(
  orgId: string,
  staffProfileId: string,
  periodStart: string,
  cfg: PeriodConfig,
): Promise<StaffWeek | null> {
  const { data } = await supabaseAdmin
    .from("staff_profiles")
    .select(STAFF_COLUMNS)
    .eq("org_id", orgId)
    .eq("id", staffProfileId)
    .maybeSingle();
  if (!data) return null;

  const r = data as unknown as Record<string, unknown>;
  const entries = await entriesFor(orgId, periodStart, cfg, [staffProfileId]);
  return {
    id: staffProfileId,
    name: nameOf(r),
    role: (r.job_title as string) || "—",
    rate: null,
    days: toDays(entries.get(staffProfileId) ?? [], periodStart, cfg),
  };
}
