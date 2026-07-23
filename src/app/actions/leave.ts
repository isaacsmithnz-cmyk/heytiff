"use server";

import { revalidatePath } from "next/cache";
import { auth0 } from "@/lib/auth0";
import { supabaseAdmin } from "@/lib/supabase-server";
import { can } from "@/lib/permissions-server";
import { staffProfileIdFor } from "@/lib/fleet/query";
import { balancesFor } from "@/lib/timepay/leave-query";
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
}

const ONE_DAY = 86_400_000;
function validSpan(startISO: string, endISO: string): boolean {
  const s = Date.parse(`${startISO}T00:00:00Z`);
  const e = Date.parse(`${endISO}T00:00:00Z`);
  return Number.isFinite(s) && Number.isFinite(e) && e >= s && (e - s) / ONE_DAY <= 366;
}

/* ---------------- your own leave ---------------- */

export async function requestLeave(input: {
  kind: LeaveKind;
  startDate: string;
  endDate: string;
  hours: number;
  note?: string;
}): Promise<LeaveResult> {
  const ctx = await context();
  if (!ctx?.staffId) return { ok: false, error: "No staff record for this account." };

  const { kind, startDate, endDate } = input;
  if (!["annual", "personal", "unpaid"].includes(kind))
    return { ok: false, error: "Pick a leave type." };
  if (!validSpan(startDate, endDate)) return { ok: false, error: "Check the leave dates." };
  const hours = Math.round(Number(input.hours) * 100) / 100;
  if (!(hours > 0)) return { ok: false, error: "Leave has to be more than zero hours." };

  // re-check the balance server-side — the form only offered what it could see
  const { balances, requests } = await balancesFor(ctx.orgId, ctx.staffId);
  const short = shortfall(kind, hours, balances, requests);
  if (short > 0)
    return {
      ok: false,
      error: `That's ${short}h more ${kind} leave than you have available.`,
    };

  const { error } = await supabaseAdmin.from("leave_requests").insert({
    org_id: ctx.orgId,
    staff_profile_id: ctx.staffId,
    kind,
    start_date: startDate,
    end_date: endDate,
    hours,
    note: input.note?.trim() || null,
    status: "pending",
  });
  if (error) return { ok: false, error: "Couldn't submit that leave request." };
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
    .select("status")
    .eq("org_id", ctx.orgId)
    .eq("id", requestId)
    .eq("staff_profile_id", ctx.staffId) // only ever your own
    .maybeSingle();
  if (!data) return { ok: false, error: "That request isn't yours or no longer exists." };
  if (data.status !== "pending" && data.status !== "approved")
    return { ok: false, error: "That request can't be cancelled." };

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
    .select("staff_profile_id, status")
    .eq("org_id", ctx.orgId)
    .eq("id", requestId)
    .maybeSingle();
  if (!data) return { ok: false, error: "That request no longer exists." };
  if (ctx.staffId && ctx.staffId === data.staff_profile_id)
    return { ok: false, error: "You can't review your own leave." };
  if (data.status !== "pending")
    return { ok: false, error: "That request has already been decided." };

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
