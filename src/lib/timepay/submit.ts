import { supabaseAdmin } from "@/lib/supabase-server";
import { todayInAu } from "@/lib/au-dates";
import { remindAtFrom } from "@/lib/dashboard/reminders";
import type { DayEntry, Settings } from "@/components/timepay/logic";
import { dateOfDay, periodDays, todayIndex, type PeriodConfig } from "./period";
import { getMyWeek, getPaySettings } from "./query";
import { stateFor } from "./leave-query";
import { presumeFor, presumptionCtx } from "./presume";
import type { SubmitMoment } from "./auto-submit";

/* Writing a week down — the one place a submission is recorded, whoever or
   whatever sends it.

   This lived inside the actions module until a sheet could send itself. A
   `"use server"` file may export nothing but actions, and the page loaders
   now write a submission too: the first read after the workspace's send
   moment finds the draft and sends it (lib/timepay/auto-submit). So the rows,
   the materialisation and the sheet's own row live here, and the button, the
   approver and the loaders all go through them. */

/** One day, as the table stores it. Shared by the single-day save and the
    materialisation below, so a day written by hand and the identical day
    written by submitting can't take different shapes. */
export function rowFor(
  orgId: string,
  staffId: string,
  workDate: string,
  entry: DayEntry,
  /* the approved request a leave/sick/off day came from. Provenance, so a
     materialised absence and the booking that paid for it stay findable from
     each other; hand-entered days carry null. */
  leaveRequestId: string | null = null,
) {
  return {
    org_id: orgId,
    staff_profile_id: staffId,
    work_date: workDate,
    kind: entry.t,
    start_time: entry.t === "work" ? entry.in : null,
    end_time: entry.t === "work" ? entry.out : null,
    // `off` is a statement, not an amount — it carries no hours by construction
    hours: entry.t === "work" || entry.t === "leave" || entry.t === "sick" || entry.t === "ph" ? entry.h : 0,
    leave_request_id: leaveRequestId,
    updated_at: new Date().toISOString(),
  };
}

/** What a presumption hands over that submitting needs. */
export type Presumed = Pick<ReturnType<typeof presumeFor>, "days" | "sources" | "absences">;

/** The rows a submission writes: every day that was presumed rather than
    entered. "entered" is already a row; "expected" and "none" are days with
    nothing on them, and writing a row for those would invent an entry nobody
    made. */
export function rowsFor(orgId: string, staffId: string, periodStart: string, presumed: Presumed) {
  const { days, sources, absences } = presumed;
  return days
    .map((entry, i) => ({ entry, i }))
    .filter(({ i }) => sources[i] === "presumed" || sources[i] === "holiday" || sources[i] === "leave")
    .map(({ entry, i }) => {
      const date = dateOfDay(periodStart, i);
      // a leave-sourced day is stamped with the request that paid it
      const from = sources[i] === "leave" ? (absences.get(date)?.id ?? null) : null;
      return rowFor(orgId, staffId, date, entry, from);
    });
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
export async function materialise(
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
  const rows = rowsFor(orgId, staffId, periodStart, presumeFor(me, state, settings, ctxWeek, p));

  if (rows.length) await supabaseAdmin.from("time_entries").upsert(rows, { onConflict: "org_id,staff_profile_id,work_date" });
}

/** The sheet's own row, marked sent. A resubmission clears the previous
    question. */
export async function writeSubmitted(
  orgId: string,
  staffId: string,
  periodStart: string,
  submittedAt: string,
): Promise<{ error: unknown }> {
  const now = new Date().toISOString();
  return supabaseAdmin.from("timesheets").upsert(
    {
      org_id: orgId,
      staff_profile_id: staffId,
      period_start: periodStart,
      status: "submitted",
      submitted_at: submittedAt,
      review_note: null,
      reviewed_by: null,
      reviewed_at: null,
      updated_at: now,
    },
    { onConflict: "org_id,staff_profile_id,period_start" },
  );
}

/** The instant a send moment names, for `submitted_at` — so a sheet that sent
    itself records when it went, not when somebody next opened the screen.
    `remindAtFrom` is the app's one wall-clock-to-instant conversion (two
    passes, so daylight saving can't move it an hour); the fallback is only
    for a time it can't read, which `submitMomentOf` has already refused. */
export function momentInstant(moment: SubmitMoment, settings: Pick<Settings, "submitTime">): string {
  return remindAtFrom(moment.date, settings.submitTime, null) ?? new Date().toISOString();
}

export type SelfSent = { staffId: string; presumed: Presumed };

/** Send every sheet in `sent` as if its owner had pressed Submit at the
    moment: the presumed days written down first, then the sheet marked sent —
    one write per table however many people, and the sheet never goes ahead of
    its days.

    BOTH WRITES ONLY FILL GAPS (`ignoreDuplicates`). The caller read these
    sheets as drafts and these days as unwritten a moment ago; an approver
    deciding, or a person saving a day, in between must not be overwritten by
    the presumption. A row that exists already wins. Returns whether both
    writes landed, so the caller only reports a sheet as sent once it is. */
export async function sendThemselves(
  orgId: string,
  periodStart: string,
  sent: SelfSent[],
  submittedAt: string,
): Promise<boolean> {
  if (!sent.length) return true;
  const rows = sent.flatMap(({ staffId, presumed }) => rowsFor(orgId, staffId, periodStart, presumed));
  if (rows.length) {
    const { error } = await supabaseAdmin
      .from("time_entries")
      .upsert(rows, { onConflict: "org_id,staff_profile_id,work_date", ignoreDuplicates: true });
    if (error) return false;
  }
  const now = new Date().toISOString();
  const { error } = await supabaseAdmin.from("timesheets").upsert(
    sent.map(({ staffId }) => ({
      org_id: orgId,
      staff_profile_id: staffId,
      period_start: periodStart,
      status: "submitted",
      submitted_at: submittedAt,
      review_note: null,
      reviewed_by: null,
      reviewed_at: null,
      updated_at: now,
    })),
    { onConflict: "org_id,staff_profile_id,period_start", ignoreDuplicates: true },
  );
  return !error;
}
