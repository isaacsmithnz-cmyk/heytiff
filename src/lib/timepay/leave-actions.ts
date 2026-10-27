import "server-only";

import { supabaseAdmin } from "@/lib/supabase-server";
import { todayInAu } from "@/lib/au-dates";
import { balancesFor, overlappingRequests } from "@/lib/timepay/leave-query";
import { getPaySettings } from "@/lib/timepay/query";
import { dateOfDay, periodConfig, periodLength, periodStartFor } from "@/lib/timepay/period";
import { shortfall, type LeaveKind } from "@/lib/timepay/leave";

/* YOUR OWN LEAVE, ONE SET OF RULES for every screen that asks for it: the
   web's (actions/leave, behind its session) and the phone's
   (app/api/mobile/leave, behind its token). Whoever calls names the
   workspace and the person's staff card; these decide everything else, in
   the words a person reads. Nothing here refreshes a page or touches the
   ServiceM8 board: the caller does, with its own press.

     ASK     one live booking a day, and never more than a balance that is
             set has available, whatever the form allowed.
     CANCEL  only your own, only while pending or approved, and an approved
             one only before it starts and while no sheet covering it has
             gone for review. */

/** `note`: a sentence to say beside a decision that landed. `id`: the
    request a new one made, which Ask for leave's Undo withdraws. */
export type LeaveResult = { ok: true; note?: string; id?: string } | { ok: false; error: string };

/** Who is asking: their workspace and their staff card. */
export type LeaveActor = { orgId: string; staffId: string };

/** Pay periods in the span whose sheet has already gone for review. A leave
    decision that lands inside a submitted or approved week would change what
    those frozen rows should have said — so the sheet has to come back first.
    Returns the period starts that are locked; empty means nothing stands in
    the way. */
export async function lockedSheets(orgId: string, staffProfileId: string, startISO: string, endISO: string): Promise<string[]> {
  const { settings } = await getPaySettings(orgId);
  const cfg = periodConfig(settings);
  const starts: string[] = [];
  // walk period by period across the span (a request is capped at 366 days)
  for (let s = periodStartFor(startISO, cfg); s <= endISO; s = dateOfDay(s, periodLength(s, cfg))) starts.push(s);
  if (!starts.length) return [];
  const { data } = await supabaseAdmin
    .from("timesheets")
    .select("period_start, status")
    .eq("org_id", orgId)
    .eq("staff_profile_id", staffProfileId)
    .in("period_start", starts)
    .in("status", ["submitted", "approved"]);
  return ((data ?? []) as Record<string, unknown>[]).map((r) => String(r.period_start).slice(0, 10));
}

const ONE_DAY = 86_400_000;
function validSpan(startISO: string, endISO: string): boolean {
  const s = Date.parse(`${startISO}T00:00:00Z`);
  const e = Date.parse(`${endISO}T00:00:00Z`);
  return Number.isFinite(s) && Number.isFinite(e) && e >= s && (e - s) / ONE_DAY <= 366;
}

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
export async function adoptCertificate(orgId: string, staffId: string, requestId: string, documentId: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from("documents")
    .select("id, leave_request_id")
    .eq("org_id", orgId)
    .eq("id", documentId)
    .eq("kind", "medical_certificate")
    .eq("uploaded_by", staffId)
    .maybeSingle();
  if (!data || (data.leave_request_id && data.leave_request_id !== requestId)) return false;

  const { error } = await supabaseAdmin.from("documents").update({ leave_request_id: requestId }).eq("org_id", orgId).eq("id", documentId);
  return !error;
}

/** Ask for leave of your own. */
export async function requestOwnLeave(
  a: LeaveActor,
  input: {
    kind: LeaveKind;
    startDate: string;
    endDate: string;
    hours: number;
    note?: string;
    /** a `medical_certificate` document already uploaded by this person */
    certificateDocumentId?: string;
  }
): Promise<LeaveResult> {
  const { kind, startDate, endDate } = input;
  if (!["annual", "personal", "unpaid"].includes(kind)) return { ok: false, error: "Pick a leave type." };
  if (!validSpan(startDate, endDate)) return { ok: false, error: "Check the leave dates." };
  const hours = Math.round(Number(input.hours) * 100) / 100;
  if (!(hours > 0)) return { ok: false, error: "Leave has to be more than zero hours." };

  /* One live booking per day. Overlapping requests would each draw the
     balance while only one could land on the timesheet — and which one won
     was down to row order. */
  const clash = await overlappingRequests(a.orgId, a.staffId, startDate, endDate);
  if (clash.length)
    return {
      ok: false,
      error: "Those dates overlap leave you've already got in — cancel or change that request first.",
    };

  // re-check the balance server-side — the form only offered what it could see
  const { balances, requests } = await balancesFor(a.orgId, a.staffId);
  const short = shortfall(kind, hours, balances, requests);
  if (short > 0)
    return {
      ok: false,
      error: `That's ${short}h more ${kind} leave than you have available.`,
    };

  const { data: created, error } = await supabaseAdmin
    .from("leave_requests")
    .insert({
      org_id: a.orgId,
      staff_profile_id: a.staffId,
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
  if (input.certificateDocumentId) await adoptCertificate(a.orgId, a.staffId, String(created.id), input.certificateDocumentId);

  return { ok: true, id: String(created.id) };
}

/** Withdraw your own request — only while it's still pending or approved (and
    not yet started). A declined or already-taken request stays as history.
    `wasApproved`: it may be on the ServiceM8 board, for the caller to take off. */
export async function cancelOwnLeave(a: LeaveActor, requestId: string): Promise<{ ok: true; wasApproved: boolean } | { ok: false; error: string }> {
  const { data } = await supabaseAdmin
    .from("leave_requests")
    .select("status, start_date, end_date")
    .eq("org_id", a.orgId)
    .eq("id", requestId)
    .eq("staff_profile_id", a.staffId) // only ever your own
    .maybeSingle();
  if (!data) return { ok: false, error: "That request isn't yours or no longer exists." };
  if (data.status !== "pending" && data.status !== "approved") return { ok: false, error: "That request can't be cancelled." };

  /* An approved booking is a record other things already lean on. Once it has
     started it stays as history — and once a sheet covering it has gone for
     review, cancelling would credit the balance back while the frozen sheet
     keeps paying the days. A pending request leans on nothing and can always
     be withdrawn. */
  if (data.status === "approved") {
    const start = String(data.start_date).slice(0, 10);
    const end = String(data.end_date).slice(0, 10);
    if (start <= todayInAu()) return { ok: false, error: "Leave that has already started stays as history." };
    const locked = await lockedSheets(a.orgId, a.staffId, start, end);
    if (locked.length)
      return {
        ok: false,
        error: "That leave is already on a timesheet that's gone for review — ask your manager to send the sheet back, then cancel.",
      };
  }

  const { error } = await supabaseAdmin
    .from("leave_requests")
    .update({ status: "cancelled", updated_at: new Date().toISOString() })
    .eq("org_id", a.orgId)
    .eq("id", requestId)
    .eq("staff_profile_id", a.staffId);
  if (error) return { ok: false, error: "Couldn't cancel that request." };
  return { ok: true, wasApproved: data.status === "approved" };
}
