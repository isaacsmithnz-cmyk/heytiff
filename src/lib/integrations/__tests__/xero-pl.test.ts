import {
  exclusionFor,
  isExpenseSection,
  lastFinancialYear,
  mapProfitAndLoss,
  parseAmount,
  periodFor,
  trailingYear,
} from "../xero-pl";

/* Two judgements here decide whether someone's charge-out rate is right:
   which sections count as overheads, and which lines the calculator already
   has from somewhere else. Both are guesses about names, so both are tested
   hard and both are surfaced in the UI rather than applied silently. */

const section = (title: string, rows: [string, string][]) => ({
  rowType: "Section",
  title,
  rows: rows.map(([name, amount]) => ({
    rowType: "Row",
    cells: [{ value: name }, { value: amount }],
  })),
});

const report = (sections: unknown[]) => ({ reports: [{ rows: sections }] });

describe("isExpenseSection", () => {
  it("takes operating expenses under any of the usual names", () => {
    expect(isExpenseSection("Less Operating Expenses")).toBe(true);
    expect(isExpenseSection("Operating Expenses")).toBe(true);
    expect(isExpenseSection("Expenses")).toBe(true);
    expect(isExpenseSection("Administrative Expenses")).toBe(true);
  });

  /* The one that would quietly inflate every rate: cost of sales is materials
     consumed on jobs, which the calculator prices separately. */
  it("never takes cost of sales", () => {
    expect(isExpenseSection("Less Cost of Sales")).toBe(false);
    expect(isExpenseSection("Cost of Sales Expenses")).toBe(false);
    expect(isExpenseSection("Cost of Goods Sold")).toBe(false);
  });

  it("ignores income and totals", () => {
    expect(isExpenseSection("Income")).toBe(false);
    expect(isExpenseSection("Gross Profit")).toBe(false);
    expect(isExpenseSection("")).toBe(false);
  });
});

describe("exclusionFor", () => {
  /* Labour comes from the staff roster, with super and workers comp derived
     from it; vehicles have their own step. Importing them from the P&L too
     would count the same dollar twice and raise the rate. */
  it("catches wages by any of their usual names", () => {
    expect(exclusionFor("Wages")).toBe("wages");
    expect(exclusionFor("Wages & Salaries")).toBe("wages");
    expect(exclusionFor("Salaries")).toBe("wages");
    expect(exclusionFor("Payroll expenses")).toBe("wages");
    expect(exclusionFor("Workers Compensation")).toBe("wages");
    expect(exclusionFor("Workers comp insurance")).toBe("wages");
  });

  it("catches super before anything else claims it", () => {
    expect(exclusionFor("Superannuation")).toBe("super");
    expect(exclusionFor("Super")).toBe("super");
    // would otherwise read as a wage line
    expect(exclusionFor("Superannuation - Wages")).toBe("super");
  });

  it("catches vehicle running costs", () => {
    expect(exclusionFor("Motor Vehicle Expenses")).toBe("vehicle");
    expect(exclusionFor("Fuel")).toBe("vehicle");
    expect(exclusionFor("Vehicle registration")).toBe("vehicle");
    expect(exclusionFor("Tolls")).toBe("vehicle");
  });

  it("leaves genuine overheads alone", () => {
    for (const name of [
      "Public liability",
      "Accounting fees",
      "Rent",
      "Phones & internet",
      "Software subscriptions",
      "Advertising",
      "Insurance",
    ]) {
      expect(exclusionFor(name)).toBeNull();
    }
  });

  /* Guarding the word-boundary patterns: "supervisor" is not superannuation
     and "salary packaging software" is a subscription. */
  it("doesn't catch words that merely contain the pattern", () => {
    expect(exclusionFor("Supervisor training")).toBeNull();
    expect(exclusionFor("Superb Cleaning Co")).toBeNull();
  });
});

describe("parseAmount", () => {
  it("reads Xero's money strings", () => {
    expect(parseAmount("1234.56")).toBeCloseTo(1234.56);
    expect(parseAmount("1,234.56")).toBeCloseTo(1234.56);
    expect(parseAmount("$1,234.56")).toBeCloseTo(1234.56);
    expect(parseAmount(1234.56)).toBeCloseTo(1234.56);
  });

  it("reads bracketed negatives", () => {
    expect(parseAmount("(500.00)")).toBeCloseTo(-500);
  });

  it("is zero for anything unreadable, rather than inventing a number", () => {
    expect(parseAmount("")).toBe(0);
    expect(parseAmount(null)).toBe(0);
    expect(parseAmount("n/a")).toBe(0);
    expect(parseAmount(Number.NaN)).toBe(0);
  });
});

describe("mapProfitAndLoss", () => {
  const body = report([
    { rowType: "Header", cells: [{ value: "" }, { value: "FY 2024-25" }] },
    section("Income", [["Sales", "500000.00"]]),
    section("Less Cost of Sales", [["Materials purchased", "180000.00"]]),
    section("Less Operating Expenses", [
      ["Accounting fees", "4200.00"],
      ["Wages", "220000.00"],
      ["Superannuation", "25300.00"],
      ["Motor Vehicle Expenses", "18400.00"],
      ["Public liability", "3100.00"],
      ["Advertising", "0.00"],
    ]),
  ]);

  it("takes operating expenses and nothing else", () => {
    const out = mapProfitAndLoss(body);
    expect(out.lines.map((l) => l.name)).toEqual(["Accounting fees", "Public liability"]);
    expect(out.sections).toEqual(["Less Operating Expenses"]);
  });

  it("never imports sales or materials", () => {
    const names = mapProfitAndLoss(body).lines.map((l) => l.name);
    expect(names).not.toContain("Sales");
    expect(names).not.toContain("Materials purchased");
  });

  /* The double-count guard, and the reason it is a LIST rather than a filter:
     a person has to be able to see what was taken out and put it back. */
  it("reports every exclusion with its amount and reason", () => {
    expect(mapProfitAndLoss(body).excluded).toEqual([
      { name: "Wages", amount: 220000, reason: "wages" },
      { name: "Superannuation", amount: 25300, reason: "super" },
      { name: "Motor Vehicle Expenses", amount: 18400, reason: "vehicle" },
    ]);
  });

  it("drops accounts with no activity", () => {
    expect(mapProfitAndLoss(body).lines.map((l) => l.name)).not.toContain("Advertising");
  });

  it("allocates everything to shared — the split is a HeyTiff judgement", () => {
    for (const line of mapProfitAndLoss(body).lines) {
      expect(line.allocated_to).toBe("shared");
    }
  });

  /* A SummaryRow is the section's own total. Including it beside its members
     would double every section. */
  it("ignores summary rows", () => {
    const withTotal = report([
      {
        rowType: "Section",
        title: "Operating Expenses",
        rows: [
          { rowType: "Row", cells: [{ value: "Rent" }, { value: "24000" }] },
          { rowType: "SummaryRow", cells: [{ value: "Total Expenses" }, { value: "24000" }] },
        ],
      },
    ]);
    expect(mapProfitAndLoss(withTotal).lines).toEqual([
      { name: "Rent", amount: 24000, allocated_to: "shared" },
    ]);
  });

  it("takes the last period's column when several were returned", () => {
    const multi = report([
      {
        rowType: "Section",
        title: "Operating Expenses",
        rows: [{ rowType: "Row", cells: [{ value: "Rent" }, { value: "20000" }, { value: "24000" }] }],
      },
    ]);
    expect(mapProfitAndLoss(multi).lines[0].amount).toBe(24000);
  });

  it("degrades to nothing on a body it can't read", () => {
    for (const junk of [null, undefined, {}, { reports: [] }, { reports: [{}] }, "nope"]) {
      expect(mapProfitAndLoss(junk)).toEqual({ lines: [], excluded: [], sections: [] });
    }
  });
});

describe("lastFinancialYear", () => {
  it("gives the last complete AU year once this one has ended", () => {
    // 26 July 2026 — the year to 30 June 2026 is complete
    expect(lastFinancialYear("2026-07-26")).toEqual({
      from: "2025-07-01",
      to: "2026-06-30",
      label: "FY 2025–26",
    });
  });

  it("gives the year before when this one hasn't ended yet", () => {
    expect(lastFinancialYear("2026-05-10")).toMatchObject({
      from: "2024-07-01",
      to: "2025-06-30",
    });
  });

  it("treats the year-end day itself as not yet complete", () => {
    expect(lastFinancialYear("2026-06-30").to).toBe("2025-06-30");
    expect(lastFinancialYear("2026-07-01").to).toBe("2026-06-30");
  });

  /* Read from Xero rather than hardcoded: a business on a different year end
     would otherwise get the wrong twelve months, silently. */
  it("honours a non-Australian year end", () => {
    expect(lastFinancialYear("2026-07-26", 31, 12)).toEqual({
      from: "2025-01-01",
      to: "2025-12-31",
      label: "Year to December 2025",
    });
  });

  it("falls back to 30 June when Xero doesn't say", () => {
    expect(lastFinancialYear("2026-07-26", null, null).to).toBe("2026-06-30");
    expect(lastFinancialYear("2026-07-26", 0, 13).to).toBe("2026-06-30");
  });
});

describe("trailingYear", () => {
  it("is the twelve months ending yesterday", () => {
    expect(trailingYear("2026-07-26")).toEqual({
      from: "2025-07-26",
      to: "2026-07-25",
      label: "Last 12 months",
    });
  });
});

describe("periodFor", () => {
  it("picks the right window for each choice", () => {
    expect(periodFor("last-fy", "2026-07-26").to).toBe("2026-06-30");
    expect(periodFor("trailing-12", "2026-07-26").to).toBe("2026-07-25");
  });
});
