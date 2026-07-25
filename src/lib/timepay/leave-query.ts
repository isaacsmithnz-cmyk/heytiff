import { supabaseAdmin } from "@/lib/supabase-server";
import { displayNameOf } from "@/lib/staff/name";
import type {
  BalanceKind,
  BalanceSource,
  LeaveBalance,
  LeaveKind,
  LeaveRequest,
  LeaveStatus,
} from "./leave";

/* Leave queries. Org-scoped throughout, like the rest of lib/timepay.

   Leave carries no wage, so there is no money projection here — but who
   requested what stays scoped: the *my* screen reads only your own rows, the
   team screen reads the org's. */

const REQUEST_COLUMNS =
  "id, staff_profile_id, kind, start_date, end_date, hours, note, status, review_note, reviewed_by";

function toRequest(r: Record<string, unknown>, name?: (id: string) => string | undefined): LeaveRequest {
  const staffId = String(r.staff_profile_id);
  return {
    id: String(r.id),
    staffId,
    staffName: name?.(staffId),
    kind: r.kind as LeaveKind,
    startDate: String(r.start_date).slice(0, 10),
    endDate: String(r.end_date).slice(0, 10),
    hours: Number(r.hours) || 0,
    note: typeof r.note === "string" && r.note ? r.note : undefined,
    status: r.status as LeaveStatus,
    reviewNote: typeof r.review_note === "string" && r.review_note ? r.review_note : undefined,
    reviewedBy: (r.reviewed_by as string) ?? null,
  };
}

/** Your own leave requests, newest first. */
export async function myRequests(orgId: string, staffProfileId: string): Promise<LeaveRequest[]> {
  const { data } = await supabaseAdmin
    .from("leave_requests")
    .select(REQUEST_COLUMNS)
    .eq("org_id", orgId)
    .eq("staff_profile_id", staffProfileId)
    .order("start_date", { ascending: false });
  return ((data ?? []) as Record<string, unknown>[]).map((r) => toRequest(r));
}

/** Your entitlements. Missing rows mean "none recorded", not zero-forever — the
    request form treats an absent balance as nothing available. */
export async function myBalances(orgId: string, staffProfileId: string): Promise<LeaveBalance[]> {
  const { data } = await supabaseAdmin
    .from("leave_balances")
    .select("kind, balance_hours, as_at, source, synced_at")
    .eq("org_id", orgId)
    .eq("staff_profile_id", staffProfileId);
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    kind: r.kind as BalanceKind,
    balanceHours: Number(r.balance_hours) || 0,
    asAt: String(r.as_at).slice(0, 10),
    source: r.source as BalanceSource,
    syncedAt: (r.synced_at as string) ?? null,
  }));
}

/** One person's balances plus their live bookings, for the balance-set screen. */
export async function balancesFor(
  orgId: string,
  staffProfileId: string,
): Promise<{ balances: LeaveBalance[]; requests: LeaveRequest[] }> {
  const [balances, requests] = await Promise.all([
    myBalances(orgId, staffProfileId),
    myRequests(orgId, staffProfileId),
  ]);
  return { balances, requests };
}

async function staffNames(orgId: string): Promise<(id: string) => string | undefined> {
  const { data } = await supabaseAdmin
    .from("staff_profiles")
    .select("id, first_name, last_name, full_name, preferred_name")
    .eq("org_id", orgId);
  const map = new Map<string, string>();
  for (const r of data ?? []) map.set(r.id as string, displayNameOf(r));
  return (id: string) => map.get(id);
}

/** Pending requests across the org, oldest first (longest-waiting on top). */
export async function pendingRequests(orgId: string): Promise<LeaveRequest[]> {
  const [{ data }, name] = await Promise.all([
    supabaseAdmin
      .from("leave_requests")
      .select(REQUEST_COLUMNS)
      .eq("org_id", orgId)
      .eq("status", "pending")
      .order("start_date", { ascending: true }),
    staffNames(orgId),
  ]);
  return ((data ?? []) as Record<string, unknown>[]).map((r) => toRequest(r, name));
}

/** Approved leave overlapping a date span, for the team calendar. */
export async function approvedInSpan(
  orgId: string,
  spanStart: string,
  spanEnd: string,
): Promise<LeaveRequest[]> {
  const [{ data }, name] = await Promise.all([
    supabaseAdmin
      .from("leave_requests")
      .select(REQUEST_COLUMNS)
      .eq("org_id", orgId)
      .eq("status", "approved")
      .lte("start_date", spanEnd)
      .gte("end_date", spanStart),
    staffNames(orgId),
  ]);
  return ((data ?? []) as Record<string, unknown>[]).map((r) => toRequest(r, name));
}

/** Public-holiday dates for this org + state within a span (for suggested-hours,
    the leave calendar and the timesheet). The calendar is per-org, so it
    reflects the days THIS business closes for. Empty until seeded/entered —
    never guessed. */
export async function holidaysInSpan(
  orgId: string,
  state: string | null,
  spanStart: string,
  spanEnd: string,
): Promise<{ date: string; name: string }[]> {
  if (!state) return [];
  const { data } = await supabaseAdmin
    .from("public_holidays")
    .select("holiday_date, name")
    .eq("org_id", orgId)
    .eq("state", state)
    .gte("holiday_date", spanStart)
    .lte("holiday_date", spanEnd)
    .order("holiday_date");
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    date: String(r.holiday_date).slice(0, 10),
    name: String(r.name),
  }));
}

async function orgState(orgId: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from("organizations")
    .select("state")
    .eq("id", orgId)
    .maybeSingle();
  return (data?.state as string) ?? null;
}

export type Holiday = { id: string; state: string; date: string; name: string; source: string };

/** Every holiday in the org's calendar from `fromISO` on — the admin manager's
    list. All states, so a multi-state business sees the whole picture. */
export async function listOrgHolidays(orgId: string, fromISO: string): Promise<Holiday[]> {
  const { data } = await supabaseAdmin
    .from("public_holidays")
    .select("id, state, holiday_date, name, source")
    .eq("org_id", orgId)
    .gte("holiday_date", fromISO)
    .order("holiday_date");
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    id: String(r.id),
    state: String(r.state),
    date: String(r.holiday_date).slice(0, 10),
    name: String(r.name),
    source: String(r.source),
  }));
}

/** The state whose holiday calendar applies to a staff member (theirs, else
    the org's). Drives suggested leave hours. Empty staffProfileId → org state. */
export async function stateFor(orgId: string, staffProfileId: string): Promise<string | null> {
  if (!staffProfileId) return orgState(orgId);
  const { data } = await supabaseAdmin
    .from("staff_profiles")
    .select("state")
    .eq("org_id", orgId)
    .eq("id", staffProfileId)
    .maybeSingle();
  return (data?.state as string) ?? (await orgState(orgId));
}
