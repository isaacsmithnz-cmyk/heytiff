/* One answer to "when is this due, and is it late", shared by the new Home's
   list and its calendar. The thing to hold is that it IS the bell's answer:
   a licence the bell calls late is late here, one it warns about is inside
   the window here, and one it says nothing about is further off. */

import { expiryDue } from "../expiry-due";
import { expiryState } from "@/components/fleet/logic";
import { licenceChip } from "@/lib/dashboard/chips";
import { daysUntil } from "@/lib/au-dates";

const TODAY = "2026-09-25";

/** yyyy-mm-dd, `n` days from TODAY. */
const plus = (n: number) => new Date(Date.parse(`${TODAY}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

describe("expiryDue", () => {
  it("is the day itself, the days to it, and the bell's state", () => {
    expect(expiryDue("2026-10-20", TODAY, 30)).toEqual({ due: "2026-10-20", days: 25, state: "warn" });
    expect(expiryDue("2026-09-17", TODAY, 30)).toEqual({ due: "2026-09-17", days: -8, state: "bad" });
    expect(expiryDue("2027-01-22", TODAY, 30)).toEqual({ due: "2027-01-22", days: 119, state: "ok" });
  });

  it("calls today due, not late", () => {
    expect(expiryDue(TODAY, TODAY, 30)?.state).toBe("warn");
    expect(expiryDue(plus(-1), TODAY, 30)?.state).toBe("bad");
  });

  it("follows the org's window, never a number of its own", () => {
    expect(expiryDue(plus(20), TODAY, 14)?.state).toBe("ok");
    expect(expiryDue(plus(20), TODAY, 30)?.state).toBe("warn");
    expect(expiryDue(plus(14), TODAY, 14)?.state).toBe("warn");
    expect(expiryDue(plus(15), TODAY, 14)?.state).toBe("ok");
  });

  it("agrees with the bell's licence chip on every day either side of the window", () => {
    for (const warnDays of [14, 30]) {
      for (let n = -40; n <= 60; n++) {
        const iso = plus(n);
        const chip = licenceChip(
          { id: "l1", typeName: "White Card", expiryDate: iso },
          { subject: "Luke", href: "/dashboard/profile", today: TODAY, warnDays },
        );
        const due = expiryDue(iso, TODAY, warnDays)!;
        expect([iso, warnDays, due.state]).toEqual([iso, warnDays, chip?.state ?? "ok"]);
        expect(due.state).toBe(expiryState(daysUntil(iso, TODAY), warnDays));
      }
    }
  });

  it("says nothing without a real day to chase", () => {
    for (const v of [null, undefined, "", "  ", "soon", "2026-9-1", "2026-02-31", "2026-13-01", "2026-10-20T00:00:00Z"]) {
      expect(expiryDue(v, TODAY, 30)).toBeNull();
    }
    expect(expiryDue("2026-10-20", "yesterday", 30)).toBeNull();
    // a leap day is a day
    expect(expiryDue("2028-02-29", TODAY, 30)?.due).toBe("2028-02-29");
  });
});
