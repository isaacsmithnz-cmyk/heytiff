import { rosterToday } from "../roster";
import type { LeaveRequest } from "@/lib/timepay/leave";

const TODAY = "2026-07-20";

const req = (over: Partial<LeaveRequest>): LeaveRequest => ({
  id: "r1",
  staffId: "s1",
  staffName: "Jordan Mills",
  kind: "annual",
  startDate: TODAY,
  endDate: TODAY,
  hours: 8,
  status: "approved",
  ...over,
});

describe("rosterToday", () => {
  it("is empty when nobody is off and it's a work day", () => {
    expect(rosterToday([], [], TODAY)).toEqual({ publicHoliday: null, onLeave: [] });
  });

  it("lists someone whose approved leave covers today", () => {
    const { onLeave } = rosterToday([req({ startDate: "2026-07-18", endDate: "2026-07-24" })], [], TODAY);
    expect(onLeave).toEqual([{ staffId: "s1", name: "Jordan Mills", kind: "annual", label: "Annual leave" }]);
  });

  it("excludes leave that ended before today or starts after it", () => {
    const rows = [
      req({ id: "past", startDate: "2026-07-01", endDate: "2026-07-19" }),
      req({ id: "future", startDate: "2026-07-21", endDate: "2026-07-25" }),
    ];
    expect(rosterToday(rows, [], TODAY).onLeave).toEqual([]);
  });

  it("treats the end date as inclusive", () => {
    const { onLeave } = rosterToday([req({ startDate: "2026-07-15", endDate: TODAY })], [], TODAY);
    expect(onLeave).toHaveLength(1);
  });

  it("sorts people alphabetically and labels each kind", () => {
    const rows = [
      req({ id: "a", staffId: "s2", staffName: "Sam Lee", kind: "personal" }),
      req({ id: "b", staffId: "s1", staffName: "Alex Ng", kind: "unpaid" }),
    ];
    const { onLeave } = rosterToday(rows, [], TODAY);
    expect(onLeave.map((r) => r.name)).toEqual(["Alex Ng", "Sam Lee"]);
    expect(onLeave.map((r) => r.label)).toEqual(["Unpaid leave", "Personal / carer's"]);
  });

  it("surfaces a public holiday that falls today", () => {
    const { publicHoliday } = rosterToday([], [{ date: TODAY, name: "Bank Holiday" }], TODAY);
    expect(publicHoliday).toBe("Bank Holiday");
  });

  it("ignores an upcoming holiday that isn't today", () => {
    const { publicHoliday } = rosterToday([], [{ date: "2026-07-27", name: "Bank Holiday" }], TODAY);
    expect(publicHoliday).toBeNull();
  });

  it("falls back to 'Unnamed' when a request carries no name", () => {
    const { onLeave } = rosterToday([req({ staffName: undefined })], [], TODAY);
    expect(onLeave[0].name).toBe("Unnamed");
  });
});
