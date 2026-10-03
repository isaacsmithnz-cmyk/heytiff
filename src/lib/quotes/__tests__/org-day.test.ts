import { orgDayOf } from "../org-day";

/* Isaac, 2026-10-04: "Day rate only the charge out rate by set work hours…
   no made up figures… you can set the rate without completing the rate
   calc". */
const calc = { chargedCents: 14000, recommendedCents: 16500, workingHours: 8 };
const none = { chargeOutCents: null, dayHours: null };

describe("the business's day", () => {
  it("is the rate times the hours, from the Rate Calculator when Quoting is blank", () => {
    expect(orgDayOf(none, calc)).toEqual({
      rate: { perHourCents: 14000, from: "charged" },
      hours: { hours: 8, from: "rate_calc" },
      dayCents: 112000,
    });
  });

  it("takes what's set on the Quoting page first, with no Rate Calculator at all", () => {
    expect(orgDayOf({ chargeOutCents: 15000, dayHours: 7.5 }, null)).toEqual({
      rate: { perHourCents: 15000, from: "quoting" },
      hours: { hours: 7.5, from: "quoting" },
      dayCents: 112500,
    });
    expect(orgDayOf({ chargeOutCents: 15000, dayHours: null }, calc).dayCents).toBe(120000);
  });

  it("falls to the Rate Calculator's recommendation only when nothing is charged", () => {
    expect(orgDayOf(none, { ...calc, chargedCents: null }).rate).toEqual({ perHourCents: 16500, from: "recommended" });
  });

  it("is nothing set nowhere — no day, never a figure of ours", () => {
    expect(orgDayOf(none, null)).toEqual({ rate: null, hours: null, dayCents: null });
    expect(orgDayOf({ chargeOutCents: 15000, dayHours: null }, null).dayCents).toBeNull();
  });
});
