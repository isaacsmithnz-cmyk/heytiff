"use server";

import { revalidatePath } from "next/cache";
import { auth0 } from "@/lib/auth0";
import { supabaseAdmin } from "@/lib/supabase-server";
import { can } from "@/lib/permissions-server";
import { staffProfileIdFor } from "@/lib/fleet/query";
import { dateOfDay, periodLength } from "@/lib/timepay/period";
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

/* ---------------- your own sheet ---------------- */

export async function saveDay(
  periodStart: string,
  dayIndex: number,
  entry: DayEntry,
): Promise<TimepayResult> {
  const ctx = await context();
  if (!ctx?.staffId) return { ok: false, error: "No staff record for this account." };
  // the period is 7, 14 or a calendar month long depending on the pay cycle,
  // so the bound is not "6" — a fortnightly day 9 is perfectly valid
  const { settings } = await getPaySettings(ctx.orgId);
  const cfg = {
    cycle: settings.cycle,
    weekStart: settings.weekStart,
    fortnightAnchor: settings.fortnightAnchor,
    monthStartDay: settings.monthStartDay,
  };
  if (dayIndex < 0 || dayIndex >= periodLength(periodStart, cfg))
    return { ok: false, error: "That day isn't in this pay period." };

  const status = await statusOf(ctx.orgId, ctx.staffId, periodStart);
  if (!editable(status))
    return {
      ok: false,
      error:
        status === "approved"
          ? "This week has been approved and can't be changed."
          : "This week is with your manager — ask them to send it back to edit it.",
    };

  const workDate = dateOfDay(periodStart, dayIndex);

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
