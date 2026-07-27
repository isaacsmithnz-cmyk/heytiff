"use server";

import { revalidatePath } from "next/cache";
import { auth0 } from "@/lib/auth0";
import { supabaseAdmin } from "@/lib/supabase-server";
import { can } from "@/lib/permissions-server";
import { staffProfileIdFor } from "@/lib/fleet/query";
import { todayInAu } from "@/lib/au-dates";
import {
  dateOfDay,
  isIsoDate,
  periodConfig,
  periodDays,
  periodLength,
  periodStartFor,
  todayIndex,
  type PeriodConfig,
} from "@/lib/timepay/period";
import { getMyWeek, getPaySettings } from "@/lib/timepay/query";
import { stateFor } from "@/lib/timepay/leave-query";
import { presumeFor, presumptionCtx } from "@/lib/timepay/presume";
import { validateBlock } from "@/lib/timepay/availability";
import { parseClock, type DayEntry, type Settings } from "@/components/timepay/logic";

/* Time & Pay mutations.

   Two tiers, and the boundary between them is whose sheet it is:

     OWN     enter/clear a day, submit the week. No capability — your own
             timesheet is intrinsic. You may only ever touch your own rows,
             and a submitted or approved week is closed to you.
     REVIEW  approve, send back. Needs `approvals`. Never usable on your own
             sheet: approving your own hours is the thing approval exists to
             prevent.

   No action here writes a wage. Changing a rate is a Team action requiring
   `financials`; this module never names the column. */

export type TimepayResult = { ok: true } | { ok: false; error: string };

type Ctx = { orgId: string; staffId: string | null };

async function context(): Promise<Ctx | null> {
  const session = await auth0.getSession();
  const orgId = session?.orgId as string | undefined;
  const userId = session?.user?.sub as string | undefined;
  if (!orgId || !userId) return null;
  return { orgId, staffId: await staffProfileIdFor(orgId, userId) };
}

function refresh() {
  revalidatePath("/dashboard/my-timesheet");
  revalidatePath("/dashboard/timepay");
}

async function statusOf(orgId: string, staffId: string, periodStart: string): Promise<string> {
  const { data } = await supabaseAdmin
    .from("timesheets")
    .select("status")
    .eq("org_id", orgId)
    .eq("staff_profile_id", staffId)
    .eq("period_start", periodStart)
    .maybeSingle();
  return (data?.status as string) ?? "draft";
}

/** A week you may still edit: never once it's gone for review or been signed
    off. "Sent back" is editable again — that is what sending it back means. */
function editable(status: string): boolean {
  return status === "draft" || status === "sent_back";
}

/* The client NAMES a period; only the server decides where periods begin. A
   forged mid-week "period start" would carry days that belong to someone
   else's real period, while its own timesheets row doesn't exist — so its
   status reads as a fresh draft and every lock above silently passes. Every
   action that receives a period start re-derives the boundary and refuses any
   date the org's pay cycle wouldn't produce. */
async function guardPeriod(
  orgId: string,
  periodStart: string,
): Promise<{ ok: true; cfg: PeriodConfig } | { ok: false; error: string }> {
  if (!isIsoDate(periodStart)) return { ok: false, error: "That pay period isn't a real date." };
  const { settings } = await getPaySettings(orgId);
  const cfg = periodConfig(settings);
  if (periodStartFor(periodStart, cfg) !== periodStart)
    return { ok: false, error: "That date doesn't start a pay period for this organisation." };
  return { ok: true, cfg };
}

/* ---------------- your own sheet ---------------- */

export async function saveDay(
  periodStart: string,
  dayIndex: number,
  entry: DayEntry,
): Promise<TimepayResult> {
  const ctx = await context();
  if (!ctx?.staffId) return { ok: false, error: "No staff record for this account." };
  const period = await guardPeriod(ctx.orgId, periodStart);
  if (!period.ok) return period;
  // the period is 7, 14 or a calendar month long depending on the pay cycle,
  // so the bound is not "6" — a fortnightly day 9 is perfectly valid
  if (!Number.isInteger(dayIndex) || dayIndex < 0 || dayIndex >= periodLength(periodStart, period.cfg))
    return { ok: false, error: "That day isn't in this pay period." };

  const workDate = dateOfDay(periodStart, dayIndex);
  // the lock is read off the WORK DATE's own period — equal to periodStart
  // after the guards above, but the day being written is what must be open
  const status = await statusOf(ctx.orgId, ctx.staffId, periodStartFor(workDate, period.cfg));
  if (!editable(status))
    return {
      ok: false,
      error:
        status === "approved"
          ? "This week has been approved and can't be changed."
          : "This week is with your manager — ask them to send it back to edit it.",
    };

  if (entry.t === "empty") {
    await supabaseAdmin
      .from("time_entries")
      .delete()
      .eq("org_id", ctx.orgId)
      .eq("staff_profile_id", ctx.staffId)
      .eq("work_date", workDate);
    refresh();
    return { ok: true };
  }

  if (entry.t !== "off") {
    if (!(entry.h >= 0 && entry.h <= 24))
      return { ok: false, error: "Hours must be between 0 and 24." };
    if (entry.t === "work" && (!entry.in.trim() || !entry.out.trim()))
      return { ok: false, error: "A worked day needs a start and finish time." };
  }

  const { error } = await supabaseAdmin.from("time_entries").upsert(
    rowFor(ctx.orgId, ctx.staffId, workDate, entry),
    { onConflict: "org_id,staff_profile_id,work_date" },
  );
  if (error) return { ok: false, error: "Couldn't save that day." };
  refresh();
  return { ok: true };
}

/** One day, as the table stores it. Shared by the single-day save and the
    materialisation below, so a day written by hand and the identical day
    written by submitting can't take different shapes. */
function rowFor(orgId: string, staffId: string, workDate: string, entry: DayEntry) {
  return {
    org_id: orgId,
    staff_profile_id: staffId,
    work_date: workDate,
    kind: entry.t,
    start_time: entry.t === "work" ? entry.in : null,
    end_time: entry.t === "work" ? entry.out : null,
    // `off` is a statement, not an amount — it carries no hours by construction
    hours: entry.t === "work" || entry.t === "leave" || entry.t === "sick" || entry.t === "ph" ? entry.h : 0,
    updated_at: new Date().toISOString(),
  };
}

/* Submitting is what makes the presumption permanent.

   Up to this point an ordinary Tuesday is DERIVED — no row exists, and the
   screen recomputes it every load so a late holiday or a corrected leave
   booking still lands. That is right for a week still being lived in and
   wrong the moment it goes for approval: an approved sheet has to be a record
   of what was agreed, not a calculation that keeps moving. If the org changed
   its normal finish time in August, a June sheet must not quietly restate
   itself.

   So on submit, every day that was presumed rather than entered is written
   down as it stood. Days the person actually entered are already rows and are
   left exactly alone. */
async function materialise(
  orgId: string,
  staffId: string,
  periodStart: string,
  /* the config `guardPeriod` already derived — passed in rather than rebuilt,
     so the boundary this writes rows against is provably the same one the
     caller validated the period start with */
  cfg: PeriodConfig,
): Promise<void> {
  const { settings } = await getPaySettings(orgId);
  const today = todayInAu();
  const me = await getMyWeek(orgId, staffId, periodStart, cfg);
  if (!me) return;

  /* The same staff→org fallback every screen resolves through. Writing rows
     with a null state here while the person's own screen showed the org's
     holidays would freeze a public holiday as a worked day. */
  const state = me.state ?? (await stateFor(orgId, ""));
  const p = await presumptionCtx(orgId, periodStart, cfg, today, [{ id: staffId, state }]);
  const ctxWeek = { week: periodDays(periodStart, cfg), today: todayIndex(periodStart, today, cfg) };
  const { days, sources } = presumeFor(me, state, settings, ctxWeek, p);

  const rows = days
    .map((entry, i) => ({ entry, i }))
    // "entered" is already a row; "expected" and "none" are days with nothing
    // on them, and writing a row for those would invent an entry nobody made
    .filter(({ i }) => sources[i] === "presumed" || sources[i] === "holiday" || sources[i] === "leave")
    .map(({ entry, i }) => rowFor(orgId, staffId, dateOfDay(periodStart, i), entry));

  if (rows.length) await supabaseAdmin.from("time_entries").upsert(rows, { onConflict: "org_id,staff_profile_id,work_date" });
}

export async function submitWeek(periodStart: string): Promise<TimepayResult> {
  const ctx = await context();
  if (!ctx?.staffId) return { ok: false, error: "No staff record for this account." };
  const period = await guardPeriod(ctx.orgId, periodStart);
  if (!period.ok) return period;

  const status = await statusOf(ctx.orgId, ctx.staffId, periodStart);
  if (!editable(status)) return { ok: false, error: "This week has already been sent." };

  await materialise(ctx.orgId, ctx.staffId, periodStart, period.cfg);

  const { error } = await supabaseAdmin.from("timesheets").upsert(
    {
      org_id: ctx.orgId,
      staff_profile_id: ctx.staffId,
      period_start: periodStart,
      status: "submitted",
      submitted_at: new Date().toISOString(),
      // a resubmission clears the previous question
      review_note: null,
      reviewed_by: null,
      reviewed_at: null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "org_id,staff_profile_id,period_start" },
  );
  if (error) return { ok: false, error: "Couldn't submit this week." };
  refresh();
  return { ok: true };
}

/* ---------------- review ---------------- */

async function review(
  staffProfileId: string,
  periodStart: string,
  patch: { status: "approved" | "sent_back"; review_note: string | null },
): Promise<TimepayResult> {
  const ctx = await context();
  if (!ctx) return { ok: false, error: "Not signed in." };
  if (!(await can("approvals"))) return { ok: false, error: "You can't approve timesheets." };
  // the whole point of approval — you don't sign off your own hours
  if (ctx.staffId && ctx.staffId === staffProfileId)
    return { ok: false, error: "You can't review your own timesheet." };
  const period = await guardPeriod(ctx.orgId, periodStart);
  if (!period.ok) return period;

  const { data: target } = await supabaseAdmin
    .from("staff_profiles")
    .select("id")
    .eq("org_id", ctx.orgId)
    .eq("id", staffProfileId)
    .maybeSingle();
  if (!target) return { ok: false, error: "That person isn't in this organisation." };

  const { error } = await supabaseAdmin.from("timesheets").upsert(
    {
      org_id: ctx.orgId,
      staff_profile_id: staffProfileId,
      period_start: periodStart,
      ...patch,
      reviewed_by: ctx.staffId,
      reviewed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "org_id,staff_profile_id,period_start" },
  );
  if (error) return { ok: false, error: "Couldn't record that decision." };
  refresh();
  return { ok: true };
}

export async function approveWeek(
  staffProfileId: string,
  periodStart: string,
): Promise<TimepayResult> {
  return review(staffProfileId, periodStart, { status: "approved", review_note: null });
}

export async function sendBackWeek(
  staffProfileId: string,
  periodStart: string,
  question: string,
): Promise<TimepayResult> {
  if (!question.trim())
    return { ok: false, error: "Say what needs changing — a sent-back sheet without a reason is a dead end." };
  return review(staffProfileId, periodStart, {
    status: "sent_back",
    review_note: question.trim().slice(0, 500),
  });
}

/* ---------------- unavailability (casuals) ---------------- */

/* OWN tier, like your own hours and for a stronger reason: this is a person
   telling the business when they can't work. There is no capability to hold
   and nothing to approve — see lib/timepay/availability.ts for why it isn't a
   request. You may only ever write your own rows. */

export async function markUnavailable(
  from: string,
  to: string,
  note?: string,
): Promise<TimepayResult> {
  const ctx = await context();
  if (!ctx?.staffId) return { ok: false, error: "No staff record for this account." };

  const check = validateBlock(from, to, todayInAu());
  if (!check.ok) return { ok: false, error: check.error };

  const { error } = await supabaseAdmin.from("staff_unavailability").insert({
    org_id: ctx.orgId,
    staff_profile_id: ctx.staffId,
    from_date: from,
    to_date: to,
    note: note?.trim().slice(0, 200) || null,
  });
  if (error) return { ok: false, error: "Couldn't save that." };
  refresh();
  return { ok: true };
}

export async function clearUnavailable(id: string): Promise<TimepayResult> {
  const ctx = await context();
  if (!ctx?.staffId) return { ok: false, error: "No staff record for this account." };

  // scoped to YOUR row: an id alone must never be enough to clear someone
  // else's block off the roster
  const { error } = await supabaseAdmin
    .from("staff_unavailability")
    .delete()
    .eq("org_id", ctx.orgId)
    .eq("staff_profile_id", ctx.staffId)
    .eq("id", id);
  if (error) return { ok: false, error: "Couldn't remove that." };
  refresh();
  return { ok: true };
}

/* ---------------- pay settings (owner-tier: it defines how pay is computed) ---------------- */

export async function savePaySettings(settings: Settings): Promise<TimepayResult> {
  const ctx = await context();
  if (!ctx) return { ok: false, error: "Not signed in." };
  if (!(await can("financials")))
    return { ok: false, error: "Only someone with financial access can change pay settings." };

  const { error } = await supabaseAdmin.from("pay_settings").upsert({
    org_id: ctx.orgId,
    cycle: settings.cycle,
    week_start: settings.weekStart,
    fortnight_anchor: settings.fortnightAnchor,
    month_start_day: settings.monthStartDay,
    standard: settings.standard,
    ot_after: settings.otAfter,
    ot_unit: settings.otUnit,
    rules: settings.rules,
    dbl_after: settings.dblAfter,
    break_minutes: settings.breakMinutes,
    break_paid: settings.breakPaid,
    default_start: settings.defaultStart,
    default_end: settings.defaultEnd,
    work_days: settings.workDays,
    submit_day: settings.submitDay,
    submit_time: settings.submitTime,
    lock: settings.lock,
    export_detail: settings.exportDetail,
    configured: true,
    updated_at: new Date().toISOString(),
  });
  if (error) return { ok: false, error: "Couldn't save pay settings." };
  refresh();
  return { ok: true };
}

/* ---------------- your own normal hours ---------------- */

/** Change the hours your week is presumed to be.

    OWN tier, deliberately: the org names a default, but the times you start
    and finish are a fact about your job, not a pay decision — an early start
    doesn't change a rate, it changes which hours get presumed onto YOUR
    timesheet. Requiring `financials` for it would mean every tradesperson on
    a different start had to ask the owner.

    Passing null for both clears the override and puts you back on the org's
    hours. Both times must be readable: half an override would presume your
    start against the workspace's finish. */
export async function saveMyHours(
  start: string | null,
  end: string | null,
  /** which days you normally work (Mon 0 … Sun 6). Undefined leaves the
      pattern alone; null clears it back to the workspace's. */
  workDays?: number[] | null,
): Promise<TimepayResult> {
  const ctx = await context();
  if (!ctx?.staffId) return { ok: false, error: "No staff record for this account." };

  const clearing = !start && !end;
  if (!clearing && (parseClock(start ?? "") == null || parseClock(end ?? "") == null))
    return { ok: false, error: "Pick a start and a finish." };
  if (Array.isArray(workDays) && workDays.some((d) => !Number.isInteger(d) || d < 0 || d > 6))
    return { ok: false, error: "That isn't a day of the week." };

  const { error } = await supabaseAdmin
    .from("staff_profiles")
    .update({
      default_start: clearing ? null : start,
      default_end: clearing ? null : end,
      ...(workDays === undefined
        ? {}
        : { work_days: workDays === null ? null : Array.from(new Set(workDays)).sort() }),
      updated_at: new Date().toISOString(),
    })
    .eq("org_id", ctx.orgId)
    .eq("id", ctx.staffId);
  if (error) return { ok: false, error: "Couldn't save your normal hours." };
  refresh();
  return { ok: true };
}
