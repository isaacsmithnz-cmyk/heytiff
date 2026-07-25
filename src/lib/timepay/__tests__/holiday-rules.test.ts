/* The statutory holiday engine, checked against what the states actually
   gazetted. This is pay-affecting data: the fixtures in fixtures/ are a hand
   transcription of the official 2026 and 2027 lists, and the NSW block is
   anchored a second time to the 25 rows already seeded in prod. */

import { certainHolidays, easterSunday, provisionalHolidays, RULE_STATES } from "../holiday-rules";
import { GAZETTED } from "./fixtures/gazetted-holidays";
import seed from "./fixtures/nsw-seed-rows.json";

const on = (state: string, year: number, date: string) =>
  certainHolidays(state, year).find((h) => h.date === date);
const dates = (state: string, year: number) => certainHolidays(state, year).map((h) => h.date);

describe("easterSunday", () => {
  // the three years every state dossier computed and cross-checked
  it("matches the dossier's computus", () => {
    expect(easterSunday(2026)).toBe("2026-04-05");
    expect(easterSunday(2027)).toBe("2027-03-28");
    expect(easterSunday(2028)).toBe("2028-04-16");
  });

  it("puts Good Friday two days before and Easter Monday one after", () => {
    expect(on("NSW", 2026, "2026-04-03")?.name).toBe("Good Friday");
    expect(on("NSW", 2026, "2026-04-06")?.name).toBe("Easter Monday");
  });
});

/* The dossier's own back-tests of the NSW weekday-of-month formulas against the
   official Guide PDF's 2024 and 2025 columns — two more gazetted years. */
describe("NSW back-tests from the official Guide PDF", () => {
  it("King's Birthday: 10 Jun 2024, 9 Jun 2025", () => {
    expect(on("NSW", 2024, "2024-06-10")?.name).toBe("King's Birthday");
    expect(on("NSW", 2025, "2025-06-09")?.name).toBe("King's Birthday");
  });
  it("Labour Day: 7 Oct 2024, 6 Oct 2025", () => {
    expect(on("NSW", 2024, "2024-10-07")?.name).toBe("Labour Day");
    expect(on("NSW", 2025, "2025-10-06")?.name).toBe("Labour Day");
  });
});

/* ---- the fixtures: what each state published, date for date and name for name */

describe.each(RULE_STATES)("%s reproduces the gazetted list", (state) => {
  it.each([2026, 2027])("%d", (year) => {
    expect(certainHolidays(state, year)).toEqual(GAZETTED[state][year]);
  });
});

it("covers all eight states — no silently empty jurisdiction", () => {
  for (const state of RULE_STATES) {
    expect(certainHolidays(state, 2026).length).toBeGreaterThan(8);
  }
  expect(certainHolidays("XX", 2026)).toEqual([]);
});

/* ---- the prod anchor: the 25 NSW rows already seeded from nsw.gov.au */

describe("NSW prod seed anchor", () => {
  const rows = seed.rows;

  it("has every seeded row in the engine's output, same date and same name", () => {
    for (const row of rows) {
      const year = Number(row.date.slice(0, 4));
      expect(on("NSW", year, row.date)).toEqual({ date: row.date, name: row.name });
    }
  });

  it("adds exactly the two confirmed Anzac-trial days over the seed", () => {
    const seeded = new Set(rows.map((r) => r.date));
    const extra = [2026, 2027].flatMap((y) => certainHolidays("NSW", y)).filter((h) => !seeded.has(h.date));
    expect(extra).toEqual([
      { date: "2026-04-27", name: "Additional public holiday for Anzac Day" },
      { date: "2027-04-26", name: "Additional public holiday for Anzac Day" },
    ]);
  });
});

/* ---- behaviour pins: the differences that decide pay */

describe("Anzac Day 2026 — 25 April is a Saturday", () => {
  it("NSW keeps the Saturday and adds the gazetted Monday (not a standing rule)", () => {
    expect(on("NSW", 2026, "2026-04-25")?.name).toBe("Anzac Day");
    expect(on("NSW", 2026, "2026-04-27")?.name).toBe("Additional public holiday for Anzac Day");
    // 2028 Anzac Day is a Tuesday, but the trial is also simply over: no extra day either way
    expect(dates("NSW", 2032)).toContain("2032-04-25"); // Sunday Anzac Day, still a holiday
    expect(dates("NSW", 2032)).not.toContain("2032-04-26"); // and no substitute is generated
  });

  it("WA adds a statutory Monday — both days, by formula", () => {
    expect(on("WA", 2026, "2026-04-25")?.name).toBe("Anzac Day");
    expect(on("WA", 2026, "2026-04-27")?.name).toBe("Additional public holiday for Anzac Day");
    // and it keeps working past the published years, because it is in the Act
    expect(on("WA", 2037, "2037-04-27")?.name).toBe("Additional public holiday for Anzac Day");
  });

  it("VIC, SA and TAS give nothing at all", () => {
    for (const state of ["VIC", "SA", "TAS"]) {
      expect(dates(state, 2026)).toContain("2026-04-25");
      expect(dates(state, 2026)).not.toContain("2026-04-27");
    }
  });

  it("QLD and NT keep the Saturday only — they substitute from Sunday, not Saturday", () => {
    for (const state of ["QLD", "NT"]) {
      expect(dates(state, 2026)).toContain("2026-04-25");
      expect(dates(state, 2026)).not.toContain("2026-04-27");
    }
  });

  it("ACT has both days, but only because of the 2026 declaration", () => {
    expect(dates("ACT", 2026)).toContain("2026-04-25");
    expect(on("ACT", 2026, "2026-04-27")?.name).toBe("Anzac Day — additional public holiday");
    // never extrapolated: the next Saturday Anzac Day gets nothing from the Act
    expect(dates("ACT", 2037)).toContain("2037-04-25");
    expect(dates("ACT", 2037)).not.toContain("2037-04-27");
  });
});

describe("Anzac Day 2027 — 25 April is a Sunday", () => {
  it("QLD, NT and ACT transfer it: the Sunday stops being a holiday", () => {
    for (const state of ["QLD", "NT", "ACT"]) {
      expect(dates(state, 2027)).not.toContain("2027-04-25");
      expect(on(state, 2027, "2027-04-26")?.name).toBe("Anzac Day");
    }
  });

  it("NSW and WA keep the Sunday and add the Monday", () => {
    for (const state of ["NSW", "WA"]) {
      expect(on(state, 2027, "2027-04-25")?.name).toBe("Anzac Day");
      expect(dates(state, 2027)).toContain("2027-04-26");
    }
  });
});

describe("additional vs transferred inside one state", () => {
  it("NSW: Australia Day 2030 moves off the Saturday, Christmas 2027 does not", () => {
    // 26 Jan 2030 is a Saturday — the next year the transfer engages
    expect(dates("NSW", 2030)).not.toContain("2030-01-26");
    expect(on("NSW", 2030, "2030-01-28")?.name).toBe("Australia Day");
    // Christmas 2027 is a Saturday and stays a holiday, with a day added on top
    expect(on("NSW", 2027, "2027-12-25")?.name).toBe("Christmas Day");
    expect(on("NSW", 2027, "2027-12-27")?.name).toBe("Christmas Day (additional day)");
  });

  it("NSW December 2027 runs four days, with Boxing Day's extra pushed to the Tuesday", () => {
    expect(dates("NSW", 2027).filter((d) => d >= "2027-12-25")).toEqual([
      "2027-12-25",
      "2027-12-26",
      "2027-12-27",
      "2027-12-28",
    ]);
    expect(on("NSW", 2027, "2027-12-28")?.name).toBe("Boxing Day (additional day)");
  });

  it("TAS: Christmas adds a day, Boxing Day moves — 26 Dec 2027 is not a holiday", () => {
    expect(on("TAS", 2027, "2027-12-25")?.name).toBe("Christmas Day");
    expect(on("TAS", 2027, "2027-12-27")?.name).toBe("Additional public holiday for Christmas Day");
    expect(dates("TAS", 2027)).not.toContain("2027-12-26");
    expect(on("TAS", 2027, "2027-12-28")?.name).toBe("Boxing Day");
  });

  it("TAS transfers New Year's Day off a Saturday; NT and ACT add a day instead", () => {
    expect(dates("TAS", 2028)).not.toContain("2028-01-01");
    expect(on("TAS", 2028, "2028-01-03")?.name).toBe("New Year's Day");
    for (const state of ["NT", "ACT", "SA", "QLD", "VIC", "WA", "NSW"]) {
      expect(dates(state, 2028)).toContain("2028-01-01");
      expect(dates(state, 2028)).toContain("2028-01-03");
    }
  });
});

describe("state-specific formulas that are easy to share by mistake", () => {
  it("King's Birthday: QLD in October, NSW in June", () => {
    expect(on("QLD", 2026, "2026-10-05")?.name).toBe("King's Birthday");
    expect(dates("QLD", 2026)).not.toContain("2026-06-08");
    expect(on("NSW", 2026, "2026-06-08")?.name).toBe("King's Birthday");
  });

  it("Labour Day differs in month and week by state", () => {
    expect(dates("NSW", 2026)).toContain("2026-10-05"); // 1st Mon Oct
    expect(dates("VIC", 2026)).toContain("2026-03-09"); // 2nd Mon Mar
    expect(dates("QLD", 2026)).toContain("2026-05-04"); // 1st Mon May
    expect(dates("WA", 2026)).toContain("2026-03-02"); // Mon on/after 1 Mar
    expect(on("TAS", 2026, "2026-03-09")?.name).toBe("Eight Hours Day");
    expect(on("NT", 2026, "2026-05-04")?.name).toBe("May Day");
  });

  it("Easter days are not shared: TAS has no Saturday or Sunday, WA has no Saturday", () => {
    expect(dates("TAS", 2026)).not.toContain("2026-04-04");
    expect(dates("TAS", 2026)).not.toContain("2026-04-05");
    expect(dates("WA", 2026)).not.toContain("2026-04-04");
    expect(dates("WA", 2026)).toContain("2026-04-05");
  });
});

describe("provisional stays out of the certain tier", () => {
  it("WA King's Birthday: gazetted for 2026/2027, absent for 2028", () => {
    expect(on("WA", 2026, "2026-09-28")?.name).toBe("King's Birthday");
    expect(on("WA", 2027, "2027-09-27")?.name).toBe("King's Birthday");
    expect(certainHolidays("WA", 2028).some((h) => h.name === "King's Birthday")).toBe(false);
  });

  it("and shows up as a suggestion for exactly the years it isn't gazetted", () => {
    expect(provisionalHolidays("WA", 2026)).toEqual([]);
    expect(provisionalHolidays("WA", 2028)).toEqual([
      {
        name: "King's Birthday",
        usual: expect.stringContaining("proclaimed each year"),
      },
    ]);
  });

  it("VIC Grand Final Friday: 2026 published, 2027 still fixture-dependent", () => {
    expect(on("VIC", 2026, "2026-09-25")?.name).toBe("Friday before the AFL Grand Final");
    expect(certainHolidays("VIC", 2027).some((h) => h.name.includes("Grand Final"))).toBe(false);
    expect(provisionalHolidays("VIC", 2027).map((p) => p.name)).toEqual([
      "Friday before the AFL Grand Final",
    ]);
  });

  it("NSW suggests the Anzac Monday only for weekend Anzac years it hasn't gazetted", () => {
    expect(provisionalHolidays("NSW", 2026)).toEqual([]); // already gazetted
    expect(provisionalHolidays("NSW", 2028)).toEqual([]); // Anzac Day is a Tuesday
    expect(provisionalHolidays("NSW", 2032).map((p) => p.name)).toEqual([
      "Additional public holiday for Anzac Day",
    ]);
  });

  it("the fully computable states suggest nothing", () => {
    for (const state of ["QLD", "SA", "TAS", "NT"]) {
      expect(provisionalHolidays(state, 2027)).toEqual([]);
    }
    expect(provisionalHolidays("XX", 2027)).toEqual([]);
  });

  it("every suggestion carries a timing hint", () => {
    for (const state of RULE_STATES) {
      for (let year = 2026; year <= 2045; year++) {
        for (const p of provisionalHolidays(state, year)) {
          expect(p.name.length).toBeGreaterThan(0);
          expect(p.usual.length).toBeGreaterThan(20);
        }
      }
    }
  });
});

/* ---- the floor: whatever the tables say, the output has to be well-formed */

describe("contract", () => {
  it("emits only ISO dates inside the asked-for year, sorted and unique", () => {
    for (const state of RULE_STATES) {
      for (let year = 2024; year <= 2045; year++) {
        const rows = certainHolidays(state, year);
        const seen = new Set<string>();
        let previous = "";
        for (const row of rows) {
          expect(row.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
          expect(new Date(`${row.date}T00:00:00Z`).toISOString().slice(0, 10)).toBe(row.date);
          expect(row.date.slice(0, 4)).toBe(String(year));
          expect(row.name.trim()).toBe(row.name);
          expect(row.name.length).toBeGreaterThan(0);
          expect(seen.has(row.date)).toBe(false);
          expect(row.date > previous).toBe(true);
          seen.add(row.date);
          previous = row.date;
        }
        // a plausible spread — no state has fewer than 8 or more than 18 full days
        expect(rows.length).toBeGreaterThanOrEqual(8);
        expect(rows.length).toBeLessThanOrEqual(18);
      }
    }
  });
});
