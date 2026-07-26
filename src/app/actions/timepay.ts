"use server";

import { revalidatePath } from "next/cache";
import { auth0 } from "@/lib/auth0";
import { supabaseAdmin } from "@/lib/supabase-server";
import { can } from "@/lib/permissions-server";
import { staffProfileIdFor } from "@/lib/fleet/query";
import {
  dateOfDay,
  isIsoDate,
  periodConfig,
  periodLength,
  periodStartFor,
  type PeriodConfig,
} from "@/lib/timepay/period";
import { getPaySettings } from "@/lib/timepay/query";
import type { DayEntry, Settings } from "@/components/timepay/logic";

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

  if (!(entry.h >= 0 && entry.h <= 24)) return { ok: false, error: "Hours must be between 0 and 24." };
  if (entry.t === "work" && (!entry.in.trim() || !entry.out.trim()))
    return { ok: false, error: "A worked day needs a start and finish time." };

  const { error } = await supabaseAdmin.from("time_entries").upsert(
    {
      org_id: ctx.orgId,
      staff_profile_id: ctx.staffId,
      work_date: workDate,
      kind: entry.t,
      start_time: entry.t === "work" ? entry.in : null,
      end_time: entry.t === "work" ? entry.out : null,
      hours: entry.h,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "org_id,staff_profile_id,work_date" },
  );
  if (error) return { ok: false, error: "Couldn't save that day." };
  refresh();
  return { ok: true };
}

export async function submitWeek(periodStart: string): Promise<TimepayResult> {
  const ctx = await context();
  if (!ctx?.staffId) return { ok: false, error: "No staff record for this account." };
  const period = await guardPeriod(ctx.orgId, periodStart);
  if (!period.ok) return period;

  const status = await statusOf(ctx.orgId, ctx.staffId, periodStart);
  if (!editable(status)) return { ok: false, error: "This week has already been sent." };

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
