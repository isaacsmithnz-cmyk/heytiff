import { cache } from "react";
import { supabaseAdmin } from "@/lib/supabase-server";
import { displayNameOf } from "@/lib/staff/name";
import { classifyEmployment, payBasisOf } from "@/lib/staff/employment";
import {
  DEFAULT_SETTINGS,
  type DayEntry,
  type NormalHours,
  type Settings,
  type StaffWeek,
} from "@/components/timepay/logic";
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
  "id, first_name, last_name, full_name, preferred_name, job_title, status, state, employment_type, pay_basis";

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

/* React-cached per request. Every Time & Pay surface opens by reading the
   settings — the cycle decides how long a period is and therefore which
   entries belong to it, so it is the first await in loadTimepay,
   loadMyTimesheet, loadMyLeave and loadTeamLeave alike. A screen that loads
   two of those (the team screen and its leave tab share a render) asked twice
   for a row that cannot change mid-request. */
export const getPaySettings = cache(async (
  orgId: string,
): Promise<{ settings: Settings; configured: boolean }> => {
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
      /* Both columns tolerate their own absence: the select is `*`, so a
         workspace whose database hasn't taken the breaks migration yet simply
         has no key here and lands on the defaults — 0 minutes, paid — which
         is exactly "no break configured" and changes nobody's hours. */
      breakMinutes: Number(data.break_minutes ?? DEFAULT_SETTINGS.breakMinutes),
      breakPaid: data.break_paid ?? DEFAULT_SETTINGS.breakPaid,
      /* Same tolerance, and the same reason it matters more here: these two
         drive the normal-day presumption, so an org whose database hasn't
         taken the migration presumes 7:00–3:00 rather than presuming nothing
         and showing everyone a week of missing days. */
      defaultStart: (data.default_start as string) || DEFAULT_SETTINGS.defaultStart,
      defaultEnd: (data.default_end as string) || DEFAULT_SETTINGS.defaultEnd,
      workDays: Array.isArray(data.work_days)
        ? (data.work_days as unknown[]).map(Number).filter((n) => n >= 0 && n <= 6)
        : DEFAULT_SETTINGS.workDays,
      submitDay: (data.submit_day as string) ?? DEFAULT_SETTINGS.submitDay,
      submitTime: (data.submit_time as string) ?? DEFAULT_SETTINGS.submitTime,
      lock: data.lock ?? DEFAULT_SETTINGS.lock,
      exportDetail: data.export_detail ?? DEFAULT_SETTINGS.exportDetail,
      // null = never set; My Pay and the Rate Calculator fall back to the
      // statutory default themselves rather than this row storing a guess
      superPct: data.super_pct == null ? null : Number(data.super_pct),
      // salaried overtime pays unless the org says it's absorbed
      salariedOtPaid: data.salaried_ot_paid ?? DEFAULT_SETTINGS.salariedOtPaid,
      // null is a real value here — "never ask" — so it can't fall back
      certAfterDays: data.certificate_after_days == null ? null : Number(data.certificate_after_days),
    },
  };
});

/* ---- personal normal hours ---- */

/* The org names the workspace's normal start and finish; a person may keep
   their own. An installer on site at 6:30 and someone in the office at 8:30
   both want their week presumed correctly, and neither should need the owner —
   or `financials` — to do it for them.

   It is a SEPARATE READ rather than two more columns on STAFF_COLUMNS, for two
   reasons. A named column that doesn't exist yet fails the whole select, and
   STAFF_COLUMNS is what draws every staff screen — a late migration would take
   out Team, not just this. And staff_profiles is where the wage lives, so the
   fewer places that select from it by hand, the fewer chances to add a column
   that shouldn't be in an hours-only payload. */
export async function shiftDefaultsFor(
  orgId: string,
  staffIds?: string[],
): Promise<{ hours: Map<string, NormalHours>; workDays: Map<string, number[]> }> {
  const hours = new Map<string, NormalHours>();
  const workDays = new Map<string, number[]>();
  let q = supabaseAdmin
    .from("staff_profiles")
    .select("id, default_start, default_end, work_days")
    .eq("org_id", orgId);
  if (staffIds) q = q.in("id", staffIds);
  const { data, error } = await q;
  // no migration yet → nobody has an override, and the org defaults stand
  if (error) return { hours, workDays };

  for (const r of (data ?? []) as Record<string, unknown>[]) {
    const id = String(r.id);
    const start = typeof r.default_start === "string" ? r.default_start : "";
    const end = typeof r.default_end === "string" ? r.default_end : "";
    if (start && end) hours.set(id, { start, end });
    /* An EMPTY array is a real answer — "no set days" — so it is kept, and
       only a null/absent column falls through to the org's pattern. */
    if (Array.isArray(r.work_days))
      workDays.set(id, (r.work_days as unknown[]).map(Number).filter((n) => n >= 0 && n <= 6));
  }
  return { hours, workDays };
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
    if (r.kind === "off") return { t: "off" };
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

/** The most recent sheet of YOURS an approver handed back, if there is one —
    the dashboard's sent-back chip.

    Asked as "which period is sent_back", not "what is the current period's
    status", on purpose. A question asked on the second-last day of a period is
    still unanswered the morning the period rolls over, and a chip that only
    ever looked at the CURRENT period would have gone quiet exactly then —
    leaving the one person who has to act with no signal at all, which is the
    hole this chip exists to close.

    Deliberately not `sheetStates` filtered down: that reads every sheet in the
    org so an approver can tally them, and this needs one row belonging to the
    person asking. It sits on the dashboard's critical path. */
export async function ownSentBackPeriod(
  orgId: string,
  staffProfileId: string,
): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from("timesheets")
    .select("period_start")
    .eq("org_id", orgId)
    .eq("staff_profile_id", staffProfileId)
    .eq("status", "sent_back")
    .order("period_start", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data ? ((data as Record<string, unknown>).period_start as string) : null;
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
    state: (r.state as string) ?? null,
    employment: classifyEmployment(r.employment_type as string | null),
    payBasis: payBasisOf(r.pay_basis as string | null),
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
    state: (r.state as string) ?? null,
    employment: classifyEmployment(r.employment_type as string | null),
    payBasis: payBasisOf(r.pay_basis as string | null),
    days: toDays(entries.get(staffProfileId) ?? [], periodStart, cfg),
  };
}
