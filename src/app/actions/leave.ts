"use server";

import { revalidatePath } from "next/cache";
import { auth0 } from "@/lib/auth0";
import { supabaseAdmin } from "@/lib/supabase-server";
import { can } from "@/lib/permissions-server";
import { staffProfileIdFor } from "@/lib/fleet/query";
import { overlappingRequests } from "@/lib/timepay/leave-query";
import { isBalanceKind, type BalanceKind, type LeaveKind } from "@/lib/timepay/leave";
import { adoptCertificate, cancelOwnLeave, lockedSheets, requestOwnLeave, type LeaveResult } from "@/lib/timepay/leave-actions";
import { sm8LeaveAllowed } from "@/lib/integrations/sm8-kinds";

/* Leave mutations. Your own leave's rules are lib/timepay/leave-actions',
   shared with the phone; this file adds the session, the page refresh and
   the ServiceM8 board.

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

/* THE SERVICEM8 BOARD, loaded only where the deployment sends leave
   (SM8_WRITES names `leave`): anywhere else not a module of it is read, and
   nothing about a decision changes. A press is minted here, from the
   signed-in session, so only a person's decision reaches the queue. */
async function sm8Board() {
  if (!sm8LeaveAllowed()) return null;
  const [{ sm8PressFromSession }, queue] = await Promise.all([
    import("@/lib/integrations/sm8-press"),
    import("@/app/actions/sm8-leave-queue"),
  ]);
  const press = await sm8PressFromSession().catch(() => null);
  return press ? { press, ...queue } : null;
}

export type { LeaveResult } from "@/lib/timepay/leave-actions";

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
  revalidatePath("/dashboard/team");
  // the timesheet derives leave days on read — a decision here changes it too
  revalidatePath("/dashboard/my-timesheet");
}

/* ---------------- your own leave ---------------- */

/** Ask for leave of your own, on the rules every screen shares
    (lib/timepay/leave-actions). */
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
  const r = await requestOwnLeave({ orgId: ctx.orgId, staffId: ctx.staffId }, input);
  if (r.ok) refresh();
  return r;
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
    not yet started), on the shared rules. A declined or already-taken
    request stays as history. */
export async function cancelLeave(requestId: string): Promise<LeaveResult> {
  const ctx = await context();
  if (!ctx?.staffId) return { ok: false, error: "No staff record for this account." };
  const r = await cancelOwnLeave({ orgId: ctx.orgId, staffId: ctx.staffId }, requestId);
  if (!r.ok) return r;
  refresh();
  /* approved leave may be on the ServiceM8 board: it comes off. Never
     fails the cancel, which has landed. */
  if (r.wasApproved) {
    const board = await sm8Board();
    if (board) await board.queueLeaveOffBoard(board.press, { source: "leave", id: requestId });
  }
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
    .select("staff_profile_id, status, kind, start_date, end_date")
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
  /* approved leave goes onto the person's day on the ServiceM8 board. The
     decision has landed whatever happens there. */
  if (status === "approved") {
    const board = await sm8Board();
    if (board) {
      const queued = await board.queueLeaveOnBoard(board.press, {
        source: "leave",
        id: requestId,
        staffProfileId: String(data.staff_profile_id),
        kind: typeof data.kind === "string" ? data.kind : null,
        from: String(data.start_date).slice(0, 10),
        to: String(data.end_date).slice(0, 10),
      });
      if (queued.note) return { ok: true, note: queued.note };
    }
  }
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
