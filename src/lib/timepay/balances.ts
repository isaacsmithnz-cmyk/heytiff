import { balanceView, type BalanceKind, type BalanceView, type LeaveBalance, type LeaveRequest } from "./leave";

/* The team Balances card — pure shaping, jest-covered like leave.ts; the DB
   reads live in balances-query.ts. leave-query reads one person at a time
   (my-leave, and the server re-check inside requestLeave); this shapes the
   manager's view of everyone at once, netted by the same balanceView
   arithmetic, so what a manager sees as available is exactly what the
   request form would offer that person. */

export type TeamBalanceCell = BalanceView | null; // null = nothing recorded yet

export type TeamBalanceRow = {
  staffId: string;
  name: string;
  annual: TeamBalanceCell;
  personal: TeamBalanceCell;
};

/* `requests` must be the org's LIVE bookings (pending + approved) —
   bookedAgainst nets each balance by kind and as-at, so a request that
   predates the entitlement figure never double-counts. */
export function teamBalanceRows(
  staff: { id: string; name: string }[],
  balances: Map<string, LeaveBalance[]>,
  requests: Map<string, LeaveRequest[]>,
): TeamBalanceRow[] {
  return staff.map((s) => {
    const own = balances.get(s.id) ?? [];
    const booked = requests.get(s.id) ?? [];
    const cell = (kind: BalanceKind): TeamBalanceCell => {
      const bal = own.find((b) => b.kind === kind);
      return bal ? balanceView(bal, booked) : null;
    };
    return { staffId: s.id, name: s.name, annual: cell("annual"), personal: cell("personal") };
  });
}
