import { supabaseAdmin } from "@/lib/supabase-server";
import type { BalanceKind, BalanceSource, LeaveBalance, LeaveRequest } from "./leave";

/* Org-wide balance reads for the team Balances card. The pure shaping lives
   in balances.ts (same pure/query split as leave.ts / leave-query.ts).

   Row mappings match leave-query's myBalances/toRequest column-for-column —
   fold them together when the leave files are next open, so the shape is
   named once. */

/** Every balance row in the org, grouped by staff id. */
export async function orgBalances(orgId: string): Promise<Map<string, LeaveBalance[]>> {
  const { data } = await supabaseAdmin
    .from("leave_balances")
    .select("staff_profile_id, kind, balance_hours, as_at, source, synced_at")
    .eq("org_id", orgId);
  const map = new Map<string, LeaveBalance[]>();
  for (const r of (data ?? []) as Record<string, unknown>[]) {
    const id = r.staff_profile_id as string;
    const list = map.get(id) ?? [];
    list.push({
      kind: r.kind as BalanceKind,
      balanceHours: Number(r.balance_hours) || 0,
      asAt: String(r.as_at).slice(0, 10),
      source: r.source as BalanceSource,
      syncedAt: (r.synced_at as string) ?? null,
    });
    map.set(id, list);
  }
  return map;
}

/** The org's live bookings (pending + approved), grouped by staff id — just
    the fields the balance arithmetic reads. */
export async function orgLiveRequests(orgId: string): Promise<Map<string, LeaveRequest[]>> {
  const { data } = await supabaseAdmin
    .from("leave_requests")
    .select("id, staff_profile_id, kind, start_date, end_date, hours, status")
    .eq("org_id", orgId)
    .in("status", ["pending", "approved"]);
  const map = new Map<string, LeaveRequest[]>();
  for (const r of (data ?? []) as Record<string, unknown>[]) {
    const id = r.staff_profile_id as string;
    const list = map.get(id) ?? [];
    list.push({
      id: r.id as string,
      staffId: id,
      kind: r.kind as LeaveRequest["kind"],
      startDate: String(r.start_date).slice(0, 10),
      endDate: String(r.end_date).slice(0, 10),
      hours: Number(r.hours) || 0,
      status: r.status as LeaveRequest["status"],
    });
    map.set(id, list);
  }
  return map;
}
