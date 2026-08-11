"use server";

import { revalidatePath } from "next/cache";
import { auth0 } from "@/lib/auth0";
import { supabaseAdmin } from "@/lib/supabase-server";
import { can } from "@/lib/permissions-server";
import { staffProfileIdFor } from "@/lib/fleet/query";
import { todayInAu } from "@/lib/au-dates";
import { balancesFor, overlappingRequests } from "@/lib/timepay/leave-query";
import { getPaySettings } from "@/lib/timepay/query";
import { dateOfDay, periodConfig, periodLength, periodStartFor } from "@/lib/timepay/period";
import { isBalanceKind, shortfall, type BalanceKind, type LeaveKind } from "@/lib/timepay/leave";

/* Leave mutations.

   Same two tiers as timesheets, and the same rule that the UI is not a
   control — everything is re-decided here.

     OWN     request / cancel your own leave. No capability. A request for a
             balance-drawing kind is re-checked against what's actually
             available, whatever the form allowed.
     REVIEW  approve / decline. Needs `approvals`, and never on your own
             request — you don't sign off your own leave.
     BALANCE set an entitlement. Needs `team` (it's an HR figure, not a wage).
             Marked source='manual'; a future accounting sync writes the same
             row with its own source and this path leaves those alone.
*/

export type LeaveResult = { ok: true } | { ok: false; error: string };

type Ctx = { orgId: string; staffId: string | null };

async function context(): Promise<Ctx | null> {
  const session = await auth0.getSession();
  const orgId = session?.orgId as string | undefined;
  const userId = session?.user?.sub as string | undefined;
  if (!orgId || !userId) return null;
  return { orgId, staffId: await staffProfileIdFor(orgId, userId) };
}

function refresh() {
  revalidatePath("/dashboard/my-leave");
  revalidatePath("/dashboard/timepay");
  // the timesheet derives leave days on read — a decision here changes it too
  revalidatePath("/dashboard/my-timesheet");
}

/** Pay periods in the span whose sheet has already gone for review. A leave
    decision that lands inside a submitted or approved week would change what
    those frozen rows should have said — so the sheet has to come back first.
    Returns the period starts that are locked; empty means nothing stands in
    the way. */
async function lockedSheets(
  orgId: string,
  staffProfileId: string,
  startISO: string,
  endISO: string,
): Promise<string[]> {
  const { settings } = await getPaySettings(orgId);
  const cfg = periodConfig(settings);
  const starts: string[] = [];
  // walk period by period across the span (a request is capped at 366 days)
  for (let s = periodStartFor(startISO, cfg); s <= endISO; s = dateOfDay(s, periodLength(s, cfg)))
    starts.push(s);
  if (!starts.length) return [];
  const { data } = await supabaseAdmin
    .from("timesheets")
    .select("period_start, status")
    .eq("org_id", orgId)
    .eq("staff_profile_id", staffProfileId)
    .in("period_start", starts)
    .in("status", ["submitted", "approved"]);
  return ((data ?? []) as Record<string, unknown>[]).map((r) =>
    String(r.period_start).slice(0, 10),
  );
}

const ONE_DAY = 86_400_000;
function validSpan(startISO: string, endISO: string): boolean {
  const s = Date.parse(`${startISO}T00:00:00Z`);
  const e = Date.parse(`${endISO}T00:00:00Z`);
  return Number.isFinite(s) && Number.isFinite(e) && e >= s && (e - s) / ONE_DAY <= 366;
}

/* ---------------- your own leave ---------------- */

/* ADOPT A CERTIFICATE. The file is already in storage against a signed slot
   and already has a `documents` row — this is the step that says which request
   it belongs to, exactly as an expense claim adopts its receipt.

   Three things are re-checked here and none of them are the caller's word for
   it: the row is in THIS org, it was uploaded by THIS person, and its kind is
   `medical_certificate`. The last one is what stops a request adopting
   somebody's licence scan or a job photo by passing its id. A document already
   attached to another request is refused rather than moved — the id came from
   a form, and silently re-pointing health information at a different absence
   is not a thing a typo should be able to do. */
async function adoptCertificate(
  orgId: string,
  staffId: string,
  requestId: string,
  documentId: string,
): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from("documents")
    .select("id, leave_request_id")
    .eq("org_id", orgId)
    .eq("id", documentId)
    .eq("kind", "medical_certificate")
    .eq("uploaded_by", staffId)
    .maybeSingle();
  if (!data || (data.leave_request_id && data.leave_request_id !== requestId)) return false;

  const { error } = await supabaseAdmin
    .from("documents")
    .update({ leave_request_id: requestId })
    .eq("org_id", orgId)
    .eq("id", documentId);
  return !error;
}

export async function requestLeave(input: {
  kind: LeaveKind;
  startDate: string;
  endDate: string;
  hours: number;
  note?: string;
  /** a `medical_certificate` document already uploaded by this person */
  certificateDocumentId?: string;
}): Promise<LeaveResult> {
  const ctx = await context();
  if (!ctx?.staffId) return { ok: false, error: "No staff record for this account." };

  const { kind, startDate, endDate } = input;
  if (!["annual", "personal", "unpaid"].includes(kind))
    return { ok: false, error: "Pick a leave type." };
  if (!validSpan(startDate, endDate)) return { ok: false, error: "Check the leave dates." };
  const hours = Math.round(Number(input.hours) * 100) / 100;
  if (!(hours > 0)) return { ok: false, error: "Leave has to be more than zero hours." };

  /* One live booking per day. Overlapping requests would each draw the
     balance while only one could land on the timesheet — and which one won
     was down to row order. */
  const clash = await overlappingRequests(ctx.orgId, ctx.staffId, startDate, endDate);
  if (clash.length)
    return {
      ok: false,
      error: "Those dates overlap leave you've already got in — cancel or change that request first.",
    };

  // re-check the balance server-side — the form only offered what it could see
  const { balances, requests } = await balancesFor(ctx.orgId, ctx.staffId);
  const short = shortfall(kind, hours, balances, requests);
  if (short > 0)
    return {
      ok: false,
      error: `That's ${short}h more ${kind} leave than you have available.`,
    };

  const { data: created, error } = await supabaseAdmin
    .from("leave_requests")
    .insert({
      org_id: ctx.orgId,
      staff_profile_id: ctx.staffId,
      kind,
      start_date: startDate,
      end_date: endDate,
      hours,
      note: input.note?.trim() || null,
      status: "pending",
    })
    .select("id")
    .maybeSingle();
  if (error || !created) return { ok: false, error: "Couldn't submit that leave request." };

  /* The request stands whatever happens to the attachment. A certificate that
     failed to adopt is a file the person can attach again from the list; a
     request that failed because of it is an absence nobody recorded. */
  if (input.certificateDocumentId)
    await adoptCertificate(ctx.orgId, ctx.staffId, String(created.id), input.certificateDocumentId);

  refresh();
  return { ok: true };
}

/** Attach a certificate to a request that already exists.

    This is the common case, not the fallback: somebody rings in sick on
    Tuesday, books the day, and sees a doctor on Wednesday. Requiring the
    document at booking time would mean either a late booking or no booking. */
export async function attachCertificate(
  requestId: string,
  documentId: string,
): Promise<LeaveResult> {
  const ctx = await context();
  if (!ctx?.staffId) return { ok: false, error: "No staff record for this account." };

  const { data } = await supabaseAdmin
    .from("leave_requests")
    .select("id, kind, status")
    .eq("org_id", ctx.orgId)
    .eq("id", requestId)
    .eq("staff_profile_id", ctx.staffId) // only ever your own
    .maybeSingle();
  if (!data) return { ok: false, error: "That leave request isn't yours." };
  if (data.kind !== "personal")
    return { ok: false, error: "Only personal leave takes a certificate." };
  /* A cancelled or declined request is history — attaching to it would file a
     medical certificate against an absence that never happened. */
  if (data.status === "cancelled" || data.status === "declined")
    return { ok: false, error: "That request is closed." };

  const ok = await adoptCertificate(ctx.orgId, ctx.staffId, requestId, documentId);
  if (!ok) return { ok: false, error: "Couldn't attach that certificate." };
  refresh();
  return { ok: true };
}

/** Withdraw your own request — only while it's still pending or approved (and
    not yet started). A declined or already-taken request stays as history. */
export async function cancelLeave(requestId: string): Promise<LeaveResult> {
  const ctx = await context();
  if (!ctx?.staffId) return { ok: false, error: "No staff record for this account." };

  const { data } = await supabaseAdmin
    .from("leave_requests")
    .select("status, start_date, end_date")
    .eq("org_id", ctx.orgId)
    .eq("id", requestId)
    .eq("staff_profile_id", ctx.staffId) // only ever your own
    .maybeSingle();
  if (!data) return { ok: false, error: "That request isn't yours or no longer exists." };
  if (data.status !== "pending" && data.status !== "approved")
    return { ok: false, error: "That request can't be cancelled." };

  /* An approved booking is a record other things already lean on. Once it has
     started it stays as history — and once a sheet covering it has gone for
     review, cancelling would credit the balance back while the frozen sheet
     keeps paying the days. A pending request leans on nothing and can always
     be withdrawn. */
  if (data.status === "approved") {
    const start = String(data.start_date).slice(0, 10);
    const end = String(data.end_date).slice(0, 10);
    if (start <= todayInAu())
      return { ok: false, error: "Leave that has already started stays as history." };
    const locked = await lockedSheets(ctx.orgId, ctx.staffId, start, end);
    if (locked.length)
      return {
        ok: false,
        error:
          "That leave is already on a timesheet that's gone for review — ask your manager to send the sheet back, then cancel.",
      };
  }

  const { error } = await supabaseAdmin
    .from("leave_requests")
    .update({ status: "cancelled", updated_at: new Date().toISOString() })
    .eq("org_id", ctx.orgId)
    .eq("id", requestId)
    .eq("staff_profile_id", ctx.staffId);
  if (error) return { ok: false, error: "Couldn't cancel that request." };
  refresh();
  return { ok: true };
}

/* ---------------- review ---------------- */

async function decide(
  requestId: string,
  status: "approved" | "declined",
  note: string | null,
): Promise<LeaveResult> {
  const ctx = await context();
  if (!ctx) return { ok: false, error: "Not signed in." };
  if (!(await can("approvals"))) return { ok: false, error: "You can't approve leave." };

  const { data } = await supabaseAdmin
    .from("leave_requests")
    .select("staff_profile_id, status, start_date, end_date")
    .eq("org_id", ctx.orgId)
    .eq("id", requestId)
    .maybeSingle();
  if (!data) return { ok: false, error: "That request no longer exists." };
  if (ctx.staffId && ctx.staffId === data.staff_profile_id)
    return { ok: false, error: "You can't review your own leave." };
  if (data.status !== "pending")
    return { ok: false, error: "That request has already been decided." };

  /* Approving is what puts days on a timesheet, so approving is where the
     collisions are refused. Declining changes nothing downstream and stays
     always possible. */
  if (status === "approved") {
    const staffId = String(data.staff_profile_id);
    const start = String(data.start_date).slice(0, 10);
    const end = String(data.end_date).slice(0, 10);

    // one approved booking per day — a second would double-draw the balance
    // while only one of them could ever land on the sheet
    const clash = (await overlappingRequests(ctx.orgId, staffId, start, end, requestId)).filter(
      (r) => r.status === "approved",
    );
    if (clash.length)
      return { ok: false, error: "That overlaps leave already approved for them." };

    /* A submitted or approved sheet already froze those days — most likely as
       presumed work. Approving on top would draw the balance while the sheet
       keeps paying the days as worked: the audit's double-pay. The sheet
       comes back first, so the leave lands on it honestly. */
    const locked = await lockedSheets(ctx.orgId, staffId, start, end);
    if (locked.length)
      return {
        ok: false,
        error:
          "Their timesheet covering those dates has already gone for review — send it back first, then approve.",
      };
  }

  const { error } = await supabaseAdmin
    .from("leave_requests")
    .update({
      status,
      review_note: note,
      reviewed_by: ctx.staffId,
      reviewed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("org_id", ctx.orgId)
    .eq("id", requestId);
  if (error) return { ok: false, error: "Couldn't record that decision." };
  refresh();
  return { ok: true };
}

export async function approveLeave(requestId: string): Promise<LeaveResult> {
  return decide(requestId, "approved", null);
}

export async function declineLeave(requestId: string, reason: string): Promise<LeaveResult> {
  if (!reason.trim())
    return { ok: false, error: "Give a reason — a declined request without one is a dead end." };
  return decide(requestId, "declined", reason.trim().slice(0, 500));
}

/* ---------------- balances (team) ---------------- */

export async function setLeaveBalance(input: {
  staffProfileId: string;
  kind: BalanceKind;
  balanceHours: number;
  asAt?: string;
}): Promise<LeaveResult> {
  const ctx = await context();
  if (!ctx) return { ok: false, error: "Not signed in." };
  if (!(await can("team"))) return { ok: false, error: "You can't manage leave balances." };
  if (!isBalanceKind(input.kind)) return { ok: false, error: "Unpaid leave has no balance." };

  const hours = Math.round(Number(input.balanceHours) * 100) / 100;
  if (!(hours >= 0)) return { ok: false, error: "A balance can't be negative." };

  const { data: target } = await supabaseAdmin
    .from("staff_profiles")
    .select("id")
    .eq("org_id", ctx.orgId)
    .eq("id", input.staffProfileId)
    .maybeSingle();
  if (!target) return { ok: false, error: "That person isn't in this organisation." };

  const asAt = input.asAt && /^\d{4}-\d{2}-\d{2}$/.test(input.asAt) ? input.asAt : undefined;

  /* A synced balance belongs to the sync. The comment above always promised
     "this path leaves those alone" — the audit found the upsert unconditionally
     stamping source='manual' over whatever was there, which would have made
     the first accounting sync fight a hand edit for the same row. */
  const { data: existing } = await supabaseAdmin
    .from("leave_balances")
    .select("source")
    .eq("org_id", ctx.orgId)
    .eq("staff_profile_id", input.staffProfileId)
    .eq("kind", input.kind)
    .maybeSingle();
  if (existing && existing.source !== "manual")
    return {
      ok: false,
      error: "That balance is synced from your accounting system — change it there instead.",
    };

  const { error } = await supabaseAdmin.from("leave_balances").upsert(
    {
      org_id: ctx.orgId,
      staff_profile_id: input.staffProfileId,
      kind: input.kind,
      balance_hours: hours,
      // a hand-set balance is always manual; a sync owns its own source and is
      // never overwritten from here
      source: "manual",
      ...(asAt ? { as_at: asAt } : {}),
      synced_at: null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "org_id,staff_profile_id,kind" },
  );
  if (error) return { ok: false, error: "Couldn't save that balance." };
  refresh();
  return { ok: true };
}
