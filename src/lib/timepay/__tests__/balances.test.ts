import { teamBalanceRows } from "../balances";
import type { LeaveBalance, LeaveRequest } from "../leave";

/* The team Balances card's shaping. The load-bearing rule it inherits: a
   balance is the ENTITLEMENT as at a date, and live bookings on or after that
   date net off it — the same balanceView arithmetic the request form uses, so
   the manager's "available" and the requester's "available" cannot differ. */

const bal = (kind: LeaveBalance["kind"], hours: number, asAt = "2026-07-01"): LeaveBalance => ({
  kind,
  balanceHours: hours,
  asAt,
  source: "manual",
  syncedAt: null,
});

const req = (
  kind: LeaveRequest["kind"],
  hours: number,
  startDate: string,
  status: LeaveRequest["status"] = "approved",
): LeaveRequest => ({
  id: `${kind}-${startDate}`,
  staffId: "s1",
  kind,
  startDate,
  endDate: startDate,
  hours,
  status,
});

const staff = [
  { id: "s1", name: "Priya Sharma" },
  { id: "s2", name: "Marcus Webb" },
];

describe("teamBalanceRows", () => {
  it("nets live bookings off each person's entitlement", () => {
    const rows = teamBalanceRows(
      staff,
      new Map([["s1", [bal("annual", 152), bal("personal", 76)]]]),
      new Map([["s1", [req("annual", 7.6, "2026-08-03"), req("annual", 15.2, "2026-09-01", "pending")]]]),
    );

    // `available` is rounded for display; `booked` is a raw float sum
    expect(rows[0].annual).toMatchObject({ balanceHours: 152, available: 129.2 });
    expect(rows[0].annual?.booked).toBeCloseTo(22.8);
    expect(rows[0].personal).toMatchObject({ balanceHours: 76, booked: 0, available: 76 });
  });

  it("a person with nothing recorded gets null cells, not zeros", () => {
    const rows = teamBalanceRows(staff, new Map(), new Map());
    expect(rows[1]).toEqual({ staffId: "s2", name: "Marcus Webb", annual: null, personal: null });
  });

  it("bookings before the as-at date are already baked in — never re-counted", () => {
    const rows = teamBalanceRows(
      staff,
      new Map([["s1", [bal("annual", 100, "2026-07-01")]]]),
      new Map([["s1", [req("annual", 38, "2026-06-15")]]]),
    );
    expect(rows[0].annual).toMatchObject({ booked: 0, available: 100 });
  });

  it("unpaid bookings never draw down a balance", () => {
    const rows = teamBalanceRows(
      staff,
      new Map([["s1", [bal("annual", 100)]]]),
      new Map([["s1", [req("unpaid", 38, "2026-08-03")]]]),
    );
    expect(rows[0].annual).toMatchObject({ booked: 0, available: 100 });
  });

  it("keeps the roster's order and covers everyone, balances or not", () => {
    const rows = teamBalanceRows(
      staff,
      new Map([["s2", [bal("personal", 40)]]]),
      new Map(),
    );
    expect(rows.map((r) => r.staffId)).toEqual(["s1", "s2"]);
    expect(rows[0].personal).toBeNull();
    expect(rows[1].personal).toMatchObject({ available: 40 });
  });
});
