import { DEFAULT_SETTINGS, type Settings } from "@/components/timepay/logic";
import { cleanVisits, dayName, dowOfDay, fmtHours, labourDays, paidHours, planHours, planWords, qtyWord, trackerLabour, trackerMaterials } from "../job-tracker";

/* Saturday at double time, as 1352's crew was paid, and no weekday overtime */
const DOUBLE_SAT: Settings = { ...DEFAULT_SETTINGS, otAfter: 24, dblAfter: 24, rules: { ...DEFAULT_SETTINGS.rules, sat: { on: true, rate: 2, up: null } } };

describe("the job tracker's labour", () => {
  it("names days as the trade says them", () => {
    expect(dayName("2026-10-31")).toBe("Sat 31 Oct");
    expect(dowOfDay("2026-10-31")).toBe(5);
    expect(dowOfDay("2026-11-02")).toBe(0);
    expect(fmtHours(95.25)).toBe("95.25 h");
    expect(fmtHours(28)).toBe("28 h");
  });

  it("pays a Saturday as the pay settings say", () => {
    expect(paidHours(5, "2026-10-31", DOUBLE_SAT)).toBe(10);
    /* the default Saturday: time and a half for two hours, then double */
    expect(paidHours(5, "2026-10-31", DEFAULT_SETTINGS)).toBe(9);
    expect(paidHours(8, "2026-10-30", DEFAULT_SETTINGS)).toBe(8);
    expect(paidHours(9, "2026-10-30", DEFAULT_SETTINGS)).toBe(9.5);
  });

  it("adds up the days, newest first, with who and what they were paid as", () => {
    const people = [
      { name: "David Hann", days: [{ day: "2026-10-31", minutes: 300 }, { day: "2026-10-30", minutes: 510 }] },
      { name: "Oleksii Khalameida", days: [{ day: "2026-10-31", minutes: 300 }] },
    ];
    const r = labourDays(people, DOUBLE_SAT);
    expect(r.days).toEqual([
      { day: "Sat 31 Oct", who: "David and Oleksii", hours: 10, paidAs: 20 },
      { day: "Fri 30 Oct", who: "David", hours: 8.5, paidAs: null },
    ]);
    expect(r.worked).toBe(18.5);
    expect(r.paid).toBe(28.5);
  });

  it("is red only for what the paid hours pass the quote by", () => {
    const l = trackerLabour({ quotedHours: 101, workedHours: 95.25, paidHours: 105.25, days: [], leftOn: 0 });
    expect(l.tone).toBe("wrong");
    expect(l.word).toBe("4.25 h over");
    expect(l.under).toBe("Overtime adds 10 h, paid as 105.25 h");
    const share = Object.fromEntries(l.parts.map((p) => [p.kind, Math.round(p.share * 105.25 * 100) / 100]));
    expect(share).toEqual({ used: 95.25, ot: 5.75, over: 4.25 });
  });

  it("says what's left while under, and nothing red", () => {
    const l = trackerLabour({ quotedHours: 112, workedHours: 95.25, paidHours: 105.25, days: [], leftOn: 0 });
    expect(l.tone).toBe("good");
    expect(l.word).toBe("6.75 h left");
    expect(l.parts.map((p) => p.kind)).toEqual(["used", "ot"]);
  });

  it("has no bar without quoted hours", () => {
    const l = trackerLabour({ quotedHours: null, workedHours: 95.25, paidHours: 95.25, days: [], leftOn: 0 });
    expect(l).toMatchObject({ tone: "info", word: "Hours not quoted", parts: [], under: null });
  });
});

describe("the job tracker's materials", () => {
  it("says what's left of the quote's materials", () => {
    const m = trackerMaterials({ allowance: 200240, spent: 39561, unpriced: 1, count: 5, items: [] });
    expect(m).toMatchObject({ tone: "good", word: "$1,606.79 left", under: "1 without a price" });
  });

  it("goes red past the allowance", () => {
    const m = trackerMaterials({ allowance: 10000, spent: 12500, unpriced: 0, count: 2, items: [] });
    expect(m.tone).toBe("wrong");
    expect(m.word).toBe("$25 over");
    expect(m.parts.map((p) => p.kind)).toEqual(["used", "over"]);
  });

  it("shows only what was used to whoever doesn't see costs", () => {
    expect(trackerMaterials({ allowance: null, spent: null, unpriced: 0, count: 4, items: [] })).toMatchObject({ tone: "info", word: "As used", parts: [] });
  });

  it("says a quantity as it was said", () => {
    expect(qtyWord(0.5, "roll")).toBe("0.5 roll");
    expect(qtyWord(3, null)).toBe("3 used");
  });
});

describe("what a job was priced at, where the quote doesn't say", () => {
  it("adds visits up as people times days times the working day", () => {
    const visits = [
      { people: 3, days: 2 },
      { people: 4, days: 2 },
    ];
    expect(planHours(visits, 8)).toBe(112);
    expect(planHours([{ people: 2, days: 0.5 }], 7.6)).toBe(7.6);
    expect(planHours([], 8)).toBe(0);
  });

  it("says the plan as the trade would", () => {
    expect(planWords([{ people: 3, days: 2 }, { people: 4, days: 2 }])).toBe("3 people for 2 days, then 4 for 2 days");
    expect(planWords([{ people: 1, days: 1 }])).toBe("1 person for 1 day");
    expect(planWords([{ people: 2, days: 0.5 }])).toBe("2 people for 0.5 days");
  });

  it("keeps only real visits", () => {
    expect(cleanVisits([{ people: "2", days: "1.5" }])).toEqual([{ people: 2, days: 1.5 }]);
    expect(cleanVisits([])).toEqual([]);
    expect(cleanVisits([{ people: 0, days: 1 }])).toBeNull();
    expect(cleanVisits([{ people: 2.5, days: 1 }])).toBeNull();
    expect(cleanVisits([{ people: 2, days: 0 }])).toBeNull();
    expect(cleanVisits([{ people: 2, days: 101 }])).toBeNull();
    expect(cleanVisits("3 guys")).toBeNull();
    expect(cleanVisits(Array.from({ length: 21 }, () => ({ people: 1, days: 1 })))).toBeNull();
  });

  it("judges planned hours like quoted ones", () => {
    const l = trackerLabour({ quotedHours: planHours([{ people: 3, days: 2 }, { people: 4, days: 2 }], 8), workedHours: 95.25, paidHours: 105.25, days: [], leftOn: 0 });
    expect(l).toMatchObject({ tone: "good", word: "6.75 h left" });
  });

  it("says materials weren't quoted where nothing gives an allowance", () => {
    expect(trackerMaterials({ allowance: null, spent: 39561, unpriced: 0, count: 5, items: [] })).toMatchObject({ tone: "info", word: "Not quoted", parts: [] });
  });
});
