import {
  annualFactor,
  coverageFrom,
  dormantAccounts,
  exclusionFor,
  finalMonthOf,
  isExpenseSection,
  lastFinancialYear,
  mapProfitAndLoss,
  noteFor,
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

  /* `registration` on its own used to read as vehicle cost, which DELETED
     these from the pool — an exclusion says "counted in Vehicles", and the
     Vehicles step has never heard of a trademark. */
  it("doesn't call every registration a vehicle", () => {
    expect(exclusionFor("Trademark registration")).toBeNull();
    expect(exclusionFor("Company registration fees")).toBeNull();
    expect(exclusionFor("Registration & licences")).toBeNull();
    // the unambiguous ones still go
    expect(exclusionFor("Rego")).toBe("vehicle");
    expect(exclusionFor("Car registration")).toBe("vehicle");
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

  /* This used to assert the LAST column, on the reasoning that the requested
     period would be rightmost. A Xero P&L run year-on-year shows the opposite:
     2026 is the left column and the 2025 comparative sits to its right. Reading
     the last cell would have imported LAST YEAR'S costs — silently, and
     plausibly, because they look like perfectly good numbers. */
  it("takes the requested period, which is the FIRST column, not a comparative", () => {
    const comparative = report([
      {
        rowType: "Section",
        title: "Operating Expenses",
        rows: [
          // Xero's own layout: this year, then last year
          { rowType: "Row", cells: [{ value: "Rent" }, { value: "24000" }, { value: "20000" }] },
        ],
      },
    ]);
    expect(mapProfitAndLoss(comparative).lines[0].amount).toBe(24000);
  });

  it("still reads a plain single-column report", () => {
    const single = report([section("Operating Expenses", [["Rent", "24000"]])]);
    expect(mapProfitAndLoss(single).lines[0].amount).toBe(24000);
  });

  it("degrades to nothing on a body it can't read", () => {
    for (const junk of [null, undefined, {}, { reports: [] }, { reports: [{}] }, "nope"]) {
      expect(mapProfitAndLoss(junk)).toEqual({
        lines: [],
        excluded: [],
        notes: [],
        sections: [],
        columnTotals: [],
      });
    }
  });

  /* Flagged, not filtered. Each of these is real money in the pool; the note
     asks a question only the person who set up the accounts can answer. */
  it("flags kept lines that may not belong in overheads", () => {
    const flagged = report([
      section("Operating Expenses", [
        ["Depreciation", "18000.00"],
        ["Subcontractors", "96000.00"],
        ["Entertainment", "1200.00"],
        ["Rent", "24000.00"],
      ]),
    ]);
    const out = mapProfitAndLoss(flagged);
    // every one of them is still priced
    expect(out.lines.map(l => l.name)).toEqual([
      "Depreciation",
      "Subcontractors",
      "Entertainment",
      "Rent",
    ]);
    expect(out.notes).toEqual([
      { name: "Depreciation", amount: 18000, note: "depreciation" },
      { name: "Subcontractors", amount: 96000, note: "subcontract" },
      { name: "Entertainment", amount: 1200, note: "entertainment" },
    ]);
  });

  it("totals each returned column across every expense row", () => {
    const monthly = report([
      {
        rowType: "Section",
        title: "Operating Expenses",
        rows: [
          { rowType: "Row", cells: [{ value: "Rent" }, { value: "2000" }, { value: "2000" }, { value: "0" }] },
          { rowType: "Row", cells: [{ value: "Wages" }, { value: "9000" }, { value: "9500" }, { value: "0" }] },
          { rowType: "SummaryRow", cells: [{ value: "Total" }, { value: "11000" }, { value: "11500" }, { value: "0" }] },
        ],
      },
    ]);
    // the excluded wage line counts too: it is evidence the business traded
    expect(mapProfitAndLoss(monthly).columnTotals).toEqual([11000, 11500, 0]);
  });
});

/* Every account in the Demo Company (AU) chart of accounts that Xero types as
   an expense, so it renders in Operating Expenses and reaches this mapper.
   Taken from the exported ChartOfAccounts.csv rather than invented — the point
   is to pin what happens to accounts that REALLY exist, including the ones with
   no activity in any one period. */
const DEMO_EXPENSE_ACCOUNTS = [
  "Advertising",
  "Bank Fees",
  "Cleaning",
  "Consulting & Accounting",
  "Depreciation",
  "Entertainment",
  "Freight & Courier",
  "General Expenses",
  "Insurance",
  "Interest Expense",
  "Legal expenses",
  "Light, Power, Heating",
  "Motor Vehicle Expenses",
  "Office Expenses",
  "Printing & Stationery",
  "Rent",
  "Wages and Salaries",
  "Superannuation",
  "Commission",
  "Subscriptions",
  "Telephone & Internet",
  "Travel - National",
  "Travel - International",
  "Income Tax Expense",
];

describe("the real Demo Company (AU) chart of accounts", () => {
  const verdict = (name: string) => exclusionFor(name) ?? noteFor(name) ?? "overhead";

  it("classifies every expense account the way a person would", () => {
    const got = Object.fromEntries(DEMO_EXPENSE_ACCOUNTS.map(n => [n, verdict(n)]));
    expect(got).toEqual({
      // plain overheads — straight into the pool
      "Advertising": "overhead",
      "Bank Fees": "overhead",
      "Cleaning": "overhead",
      "Consulting & Accounting": "overhead",
      "Freight & Courier": "overhead",
      "General Expenses": "overhead",
      "Interest Expense": "overhead",
      "Legal expenses": "overhead",
      "Light, Power, Heating": "overhead",
      "Office Expenses": "overhead",
      "Printing & Stationery": "overhead",
      "Rent": "overhead",
      "Subscriptions": "overhead",
      "Telephone & Internet": "overhead",
      "Travel - National": "overhead",
      "Travel - International": "overhead",
      // the calculator already has these from somewhere else
      "Motor Vehicle Expenses": "vehicle",
      "Wages and Salaries": "wages",
      "Superannuation": "super",
      // not a cost to recover at all
      "Income Tax Expense": "tax",
      // kept and priced, but worth a look
      "Depreciation": "depreciation",
      "Entertainment": "entertainment",
      "Insurance": "insurance",
      "Commission": "staff-cost",
    });
  });

  /* Xero types these `Direct Costs`, so they render under Cost of Sales and
     never reach the overhead pool — the calculator prices materials separately
     and folding them in would inflate every hourly rate. */
  it("keeps materials out via the section, not the name", () => {
    expect(isExpenseSection("Less Cost of Sales")).toBe(false);
    for (const materials of ["Purchases", "Cost of Goods Sold"]) {
      // nothing in the name marks these out — the section is what saves us
      expect(exclusionFor(materials)).toBeNull();
    }
  });
});

describe("dormantAccounts", () => {
  const acct = (name: string, over = {}) => ({
    name,
    code: null,
    active: true,
    operatingExpense: true,
    ...over,
  });

  const pl = {
    lines: [{ name: "Advertising", amount: 1830.18, allocated_to: "shared" }],
    excluded: [{ name: "Wages and Salaries", amount: 26800, reason: "wages" as const }],
  };

  /* The worked example. Nil in every period we had to look at, typed EXPENSE so
     it renders under Operating Expenses, and it would be priced as an overhead
     AND then marked up. Invisible in a P&L; named here. */
  it("names an account the report never mentioned, with what would happen to it", () => {
    expect(dormantAccounts([acct("Income Tax Expense"), acct("Subcontractors")], pl)).toEqual([
      { name: "Income Tax Expense", code: null, verdict: "tax" },
      { name: "Subcontractors", code: null, verdict: "subcontract" },
    ]);
  });

  it("says nothing about accounts the report DID mention, kept or excluded", () => {
    const out = dormantAccounts([acct("Advertising"), acct("Wages and Salaries")], pl);
    expect(out).toEqual([]);
  });

  /* Matched on name because a report row carries nothing else, so the match has
     to survive Xero rendering the same account with different spacing. */
  it("matches regardless of case and spacing", () => {
    expect(dormantAccounts([acct("  ADVERTISING  ")], pl)).toEqual([]);
    expect(dormantAccounts([acct("Light,  Power,  Heating")], {
      lines: [{ name: "Light, Power, Heating", amount: 645, allocated_to: "shared" }],
      excluded: [],
    })).toEqual([]);
  });

  /* An archived account can't take a transaction, and a Cost of Sales account
     never reaches the pool — neither can explain a gap worth reporting. */
  it("ignores archived accounts and anything outside operating expenses", () => {
    const out = dormantAccounts(
      [
        acct("Old Marketing Account", { active: false }),
        acct("Purchases", { operatingExpense: false }),
        acct("Legal expenses"),
      ],
      pl
    );
    expect(out.map(d => d.name)).toEqual(["Legal expenses"]);
  });

  it("calls a plain overhead a plain overhead", () => {
    expect(dormantAccounts([acct("Legal expenses", { code: "441" })], pl)).toEqual([
      { name: "Legal expenses", code: "441", verdict: "overhead" },
    ]);
  });
});

describe("noteFor", () => {
  it("leaves plain overheads unflagged", () => {
    for (const name of ["Rent", "Advertising", "Consulting & Accounting", "Office Expenses"]) {
      expect(noteFor(name)).toBeNull();
    }
  });

  it("doesn't mistake consulting or contract cleaning for subcontract labour", () => {
    expect(noteFor("Consulting & Accounting")).toBeNull();
    expect(noteFor("Contract cleaning")).toBeNull();
    expect(noteFor("Subcontractor labour")).toBe("subcontract");
    expect(noteFor("Sub-contract installs")).toBe("subcontract");
  });
});

/* ── the partial-year guard ──────────────────────────────────────────────
   The failure being prevented: a business that started in February has five
   months inside a July–June window. Every amount Xero returns is correct; the
   WINDOW is wrong, and read as a year it under-states overheads by more than
   half — silently, with the screen still saying "FY 2025–26". */

describe("coverageFrom", () => {
  const windowTotal = 60000;

  it("counts the months that actually have activity", () => {
    const monthly = { columnTotals: [0, 0, 0, 0, 0, 0, 0, 12000, 12000, 12000, 12000, 12000] } as never;
    expect(coverageFrom(monthly, windowTotal)).toEqual({ monthsCovered: 5, columns: 12 });
  });

  it("reports a full year as a full year", () => {
    const monthly = { columnTotals: Array(12).fill(5000) } as never;
    expect(coverageFrom(monthly, windowTotal)).toEqual({ monthsCovered: 12, columns: 12 });
  });

  /* The whole reason the monthly breakdown is a SECOND call whose columns we
     don't control: if they don't add up to the window we already trust, they
     are not twelve tiles of it, and "unknown" beats a confident wrong answer. */
  it("refuses to guess when the columns don't reconcile", () => {
    const doubled = { columnTotals: [60000, ...Array(11).fill(5000)] } as never;
    expect(coverageFrom(doubled, windowTotal).monthsCovered).toBeNull();
    const short = { columnTotals: [1000, 2000] } as never;
    expect(coverageFrom(short, windowTotal).monthsCovered).toBeNull();
  });

  it("refuses to guess from a single column", () => {
    expect(coverageFrom({ columnTotals: [60000] } as never, windowTotal).monthsCovered).toBeNull();
  });

  it("tolerates rounding between two reports of the same window", () => {
    const monthly = { columnTotals: [...Array(11).fill(5000), 5000.4] } as never;
    expect(coverageFrom(monthly, windowTotal).monthsCovered).toBe(12);
  });
});

describe("annualFactor", () => {
  it("scales a part year up to a year", () => {
    expect(annualFactor(6)).toBe(2);
    expect(annualFactor(3)).toBe(4);
  });

  it("leaves a full, unknown or over-full window alone", () => {
    expect(annualFactor(12)).toBe(1);
    expect(annualFactor(null)).toBe(1);
    expect(annualFactor(0)).toBe(1);
    // scaling DOWN a longer window is not this function's guess to make
    expect(annualFactor(18)).toBe(1);
  });
});

describe("finalMonthOf", () => {
  /* Xero returns the requested window plus N prior windows of that size, so
     the base has to be one month for the columns to come back as months. */
  it("is the last calendar month of the period", () => {
    expect(finalMonthOf({ from: "2025-07-01", to: "2026-06-30", label: "" })).toEqual({
      from: "2026-06-01",
      to: "2026-06-30",
    });
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
  /* Whole months, not "twelve months ending yesterday". A window that stops
     mid-month halves that month's rent and reads as a dip that never happened
     — and only a whole-month window tiles into the twelve columns that
     coverageFrom reconciles against, which is the partial-year detection a
     young business needs most. */
  it("is the twelve complete calendar months ending last month", () => {
    expect(trailingYear("2026-07-26")).toEqual({
      from: "2025-07-01",
      to: "2026-06-30",
      label: "Last 12 months",
    });
  });

  it("doesn't include the month we're standing in", () => {
    expect(trailingYear("2026-10-01")).toMatchObject({ from: "2025-10-01", to: "2026-09-30" });
    expect(trailingYear("2026-10-31")).toMatchObject({ from: "2025-10-01", to: "2026-09-30" });
  });

  it("handles a January start without falling out of the year", () => {
    expect(trailingYear("2026-01-15")).toMatchObject({ from: "2025-01-01", to: "2025-12-31" });
  });

  it("ends on a real month end, February included", () => {
    expect(trailingYear("2028-03-10").to).toBe("2028-02-29");
  });
});

describe("periodFor", () => {
  it("picks the right window for each choice", () => {
    expect(periodFor("last-fy", "2026-10-15").to).toBe("2026-06-30");
    expect(periodFor("trailing-12", "2026-10-15").to).toBe("2026-09-30");
  });

  /* In the month after year end the two windows genuinely coincide — worth
     pinning so nobody "fixes" it back into a ragged mid-month window. */
  it("agrees with itself just after the year end", () => {
    expect(periodFor("last-fy", "2026-07-26")).toEqual(
      expect.objectContaining({ from: "2025-07-01", to: "2026-06-30" })
    );
    expect(periodFor("trailing-12", "2026-07-26")).toEqual(
      expect.objectContaining({ from: "2025-07-01", to: "2026-06-30" })
    );
  });
});
