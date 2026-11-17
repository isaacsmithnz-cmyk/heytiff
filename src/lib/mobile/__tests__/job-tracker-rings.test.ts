import type { TrackerRead } from "@/lib/jobs/job-tracker";
import { phoneTracker, shortDollars } from "../job-tracker-rings";

const read = (over: { labour?: Partial<TrackerRead["labour"]>; materials?: Partial<TrackerRead["materials"]>; equipment?: Partial<TrackerRead["equipment"]> } = {}): TrackerRead => ({
  labour: { quotedHours: 32, workedHours: 28, paidHours: 28, days: [], leftOn: 0, ...over.labour },
  materials: { allowance: 60000, spent: 42000, unpriced: 0, count: 3, items: [], ...over.materials },
  equipment: { total: 680000, items: [{ name: "FTXM50", detail: null, amount: "$6,800" }], ...over.equipment },
});

describe("the job tracker's rings on the phone", () => {
  it("says the hours worked of the quote's while they hold", () => {
    const t = phoneTracker(read());
    expect(t.labour).toMatchObject({ tone: "good", word: "28 of 32 h", centre: "88%", under: null });
    expect(t.labour.parts).toEqual([
      { kind: "used", share: 28 / 32 },
      { kind: "ot", share: 0 },
    ]);
  });

  it("follows the worked hours with overtime's extra, and is red only past the quote", () => {
    const ot = phoneTracker(read({ labour: { workedHours: 26, paidHours: 30 } })).labour;
    expect(ot.tone).toBe("good");
    expect(ot.parts.map((p) => p.kind)).toEqual(["used", "ot"]);
    expect(ot.under).toBe("Overtime adds 4 h, paid as 30 h");
    const over = phoneTracker(read({ labour: { workedHours: 30, paidHours: 36 } })).labour;
    expect(over).toMatchObject({ tone: "wrong", word: "4 h over", centre: "94%" });
    expect(over.parts.map((p) => p.kind)).toEqual(["used", "ot", "over"]);
  });

  it("says materials over or left in whole dollars", () => {
    expect(phoneTracker(read({ materials: { spent: 78047 } })).materials).toMatchObject({ tone: "wrong", word: "$180 over", centre: "130%" });
    expect(phoneTracker(read()).materials).toMatchObject({ tone: "good", word: "$180 left", centre: "70%" });
  });

  it("keeps the rings on a job with nothing quoted, each saying so", () => {
    const t = phoneTracker(
      read({ labour: { quotedHours: null, workedHours: 3 }, materials: { allowance: null, spent: 5000 }, equipment: { total: null, items: [] } }),
    );
    expect(t.labour).toMatchObject({ tone: "info", word: "Hours not quoted", parts: [], centre: "—" });
    expect(t.materials).toMatchObject({ tone: "info", word: "Not quoted", parts: [], centre: "—" });
    expect(t.equipment).toMatchObject({ tone: "info", word: "No units on the quote", parts: [], centre: "—" });
  });

  it("leaves the dollars out for whoever doesn't see costs", () => {
    const t = phoneTracker(read({ materials: { allowance: null, spent: null, count: 2 }, equipment: { total: null } }));
    expect(t.materials).toMatchObject({ word: "As used", centre: "—" });
    expect(t.equipment).toMatchObject({ word: "As quoted", centre: "1", parts: [{ kind: "used", share: 1 }] });
  });

  it("draws the quote's units whole, their cost short", () => {
    expect(phoneTracker(read()).equipment).toMatchObject({ tone: "info", word: "As quoted", centre: "$6.8k" });
    expect(shortDollars(42000)).toBe("$420");
    expect(shortDollars(680000)).toBe("$6.8k");
    expect(shortDollars(1240000)).toBe("$12.4k");
    expect(shortDollars(15000000)).toBe("$150k");
    expect(shortDollars(120000000)).toBe("$1.2m");
  });
});
