import { odoRecompute } from "../logic";

/* Putting a vehicle back where its surviving logs say it is.

   The interesting cases are all about what CANNOT be recovered — a vehicle is
   added with an odometer already on it, and that number is stored nowhere but
   the vehicle itself. */

const current = { odometer: 90000, lastServiceOdo: 80000 };

describe("odoRecompute", () => {
  it("takes the highest surviving reading", () => {
    const r = odoRecompute(
      [{ kind: "fuel", odo: 84800 }, { kind: "odo", odo: 86200 }, { kind: "fuel", odo: 84120 }],
      current,
    );
    expect(r.odometer).toBe(86200);
  });

  it("ignores logs with no reading at all", () => {
    const r = odoRecompute([{ kind: "issue" }, { kind: "fuel", odo: 84800 }], current);
    expect(r.odometer).toBe(84800);
  });

  it("leaves the odometer alone when nothing survives", () => {
    // reading high is safe: the guardrail only ever refuses readings too LOW
    expect(odoRecompute([], current).odometer).toBe(90000);
    expect(odoRecompute([{ kind: "issue" }], current).odometer).toBe(90000);
  });

  it("resets the service cycle from the latest surviving service", () => {
    const r = odoRecompute(
      [{ kind: "service", odo: 85000 }, { kind: "service", odo: 82000 }, { kind: "fuel", odo: 86000 }],
      current,
    );
    expect(r.lastServiceOdo).toBe(85000);
  });

  it("never lets a fuel log move the service cycle", () => {
    const r = odoRecompute([{ kind: "fuel", odo: 88000 }], current);
    expect(r.lastServiceOdo).toBe(80000);
  });

  it("keeps the vehicle's own service figure when no service log survives", () => {
    /* lastServiceOdo is a field a manager sets directly on the vehicle; logs
       only push it forward. Wiping it because the last service log was deleted
       would throw away something nobody asked to delete — and would make the
       van look overdue when it isn't, or the reverse. */
    expect(odoRecompute([{ kind: "fuel", odo: 88000 }], current).lastServiceOdo).toBe(80000);
    expect(odoRecompute([], current).lastServiceOdo).toBe(80000);
  });

  it("is a recomputation, not a reversal — order of the logs is irrelevant", () => {
    const logs = [{ kind: "fuel" as const, odo: 84120 }, { kind: "odo" as const, odo: 86200 }];
    expect(odoRecompute(logs, current)).toEqual(odoRecompute([...logs].reverse(), current));
  });
});
