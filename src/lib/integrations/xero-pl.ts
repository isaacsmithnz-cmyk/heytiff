/* Turning a Xero profit & loss into the Rate Calculator's business costs —
   pure, so every judgement it makes is inspectable and tested.

   THE JOB: a P&L is a tree of sections and rows; the calculator wants a flat
   list of annual overheads. Two decisions have to be made, and both are the
   kind that must never happen silently.

   WHICH SECTIONS COUNT. Operating expenses are overheads. Cost of sales is
   not — that is materials consumed on jobs, which the calculator prices
   separately, and folding it in would inflate every hourly rate. Income
   sections obviously don't count. Xero lets a business rename its sections, so
   this matches on the title rather than a fixed structure, and the section
   names actually used are reported back so the screen can show its working.

   WHAT GETS EXCLUDED. Wages, superannuation and vehicle running costs all
   appear in a P&L, and the calculator ALREADY has them: labour comes from the
   staff roster with super and workers-comp derived from it, and vehicles have
   their own step. Importing them again would count the same dollar twice and
   quietly raise the charge-out rate. So they are pulled out — but returned in
   an `excluded` list with the reason and the amount, never dropped. Every
   exclusion is a name-based guess, and a guess a person can't see is a guess
   that can't be corrected.

   P&L amounts are ACCRUAL and GST-EXCLUSIVE by Xero's default, which is what
   the calculator's "amount per year, ex GST" already assumes. */

import type { BusinessCost } from "@/components/rate-calculator/engine";

/** Why a line was kept out of the cost pool. `user` is a manual re-exclusion,
    so a person's own decision survives a refresh alongside ours. */
export type ExclusionReason = "wages" | "super" | "vehicle" | "tax" | "user";

export type ExcludedLine = { name: string; amount: number; reason: ExclusionReason };

/** Why a line was KEPT but is worth a second look.

    Distinct from an exclusion on purpose. An exclusion says "the calculator
    already has this money somewhere else"; a note says "this is in your
    overheads and it might not belong there, but only you can tell". Dropping
    these automatically would lose real money — a subbie invoice is a real cost
    even when it isn't an overhead — so they stay in the pool and say so. */
export type NoteReason =
  | "depreciation"
  | "subcontract"
  | "entertainment"
  | "staff-cost"
  | "insurance";

export type FlaggedLine = { name: string; amount: number; note: NoteReason };

export type ProfitAndLoss = {
  /** Lines that become business costs. */
  lines: BusinessCost[];
  /** Lines deliberately kept out, with the reason — shown, never silent. */
  excluded: ExcludedLine[];
  /** Kept lines worth a second look, with why. */
  notes: FlaggedLine[];
  /** Which P&L sections were read, so the screen can show its working. */
  sections: string[];
  /** Total expense activity per RETURNED COLUMN, across every expense row —
      kept and excluded alike.

      A single-window report has one entry and nobody looks at it. A report
      asked for as twelve monthly columns has twelve, and the count of NON-ZERO
      entries is how many months the books actually cover. That is the only
      trustworthy way to tell a young business's five months of trading from a
      full year — see `coverageFrom`. */
  columnTotals: number[];
};

/* ── section selection ── */

const norm = (v: unknown): string => (typeof v === "string" ? v.trim().toLowerCase() : "");

/** Is this section a pool of overheads?

    Deliberately generous about naming ("Less Operating Expenses", "Operating
    Expenses", "Expenses", "Administrative Expenses" all qualify) and strict
    about the one that must never be included — cost of sales is job cost, not
    overhead. */
export function isExpenseSection(title: string): boolean {
  const t = norm(title);
  if (!t.includes("expense")) return false;
  // "Less Cost of Sales" sometimes reads "Cost of Sales Expenses"
  if (t.includes("cost of sales") || t.includes("cost of goods")) return false;
  return true;
}

/* ── exclusions ── */

/* Name patterns, each with the reason it disqualifies a line. Ordered: the
   first match wins, and `super` is tested before `wages` so "Superannuation"
   isn't swept up as a wage line by a looser pattern later. */
const EXCLUSIONS: { pattern: RegExp; reason: ExclusionReason }[] = [
  /* Income tax is not an overhead — it is a share of the profit, taken after
     the rate has already done its work. Left in the pool it inflates the cost
     base AND then gets the profit margin applied on top, so the customer is
     charged for the tax and then charged again for marking it up. Xero types
     this account plain `Expense`, so it lands in Operating Expenses and would
     be imported like rent.

     PAYROLL tax is a different animal and a real business cost — it is caught
     as `wages` by the `\bpayroll\b` pattern below, because the calculator
     derives it from the roster under `payroll_tax_enabled`. */
  { pattern: /\bincome tax\b|\bcompany tax\b/i, reason: "tax" },
  { pattern: /\bsuper(annuation)?\b/i, reason: "super" },
  { pattern: /\bwages?\b|\bsalar(y|ies)\b|\bpayroll\b|\bemployee benefit/i, reason: "wages" },
  { pattern: /workers?[\s-]*comp/i, reason: "wages" },
  /* `registration` is NOT here on its own: "Trademark registration" and
     "Company registration" are overheads, and swallowing them as vehicle cost
     would quietly delete them from the pool. The Australian slang `rego` is
     unambiguous; the long form has to say what it registers. */
  { pattern: /\bmotor vehicle|\bvehicle\b|\bfuel\b|\bpetrol\b|\bdiesel\b|\btolls?\b|\brego\b|(car|vehicle)[\s-]*registration/i, reason: "vehicle" },
];

/** Why this line should be left out of the pool, or null to keep it.

    Exported because the screen shows the reason next to the amount: an
    exclusion the user can't see is one they can't overrule. */
export function exclusionFor(name: string): ExclusionReason | null {
  for (const { pattern, reason } of EXCLUSIONS) {
    if (pattern.test(name)) return reason;
  }
  return null;
}

/* Lines that stay in the pool but earn a flag.

   DEPRECIATION is the sharp one. The Vehicles step already charges
   (replacement − resale) ÷ cycle_years, which IS the ute depreciating. A P&L
   `Depreciation` account usually holds that same write-down alongside tools and
   computers, so keeping it whole double-charges the fleet and dropping it loses
   the rest. Only the person who set up the chart of accounts can split it.

   SUBCONTRACTORS are job cost, not overhead. Left in the pool they get spread
   across every billable hour by the labour ratio, when they actually belong to
   the jobs they were hired for — but they're real money, so the answer is a
   flag and the allocation chips, not a deletion.

   INSURANCE is the same trap as depreciation from the other end: the Vehicles
   step charges each vehicle's insurance, and a business with ONE insurance
   account has the ute's cover sitting in it alongside public liability.

   COMMISSION and the like are staff remuneration that the roster does NOT hold
   — it prices hourly wage × hours — so this is the only place the money can be
   counted, and excluding it would delete it. But the moment someone folds
   commission into a person's wage it doubles, so it says so. */
const NOTES: { pattern: RegExp; note: NoteReason }[] = [
  { pattern: /\bdepreciation\b|\bamorti[sz]ation\b/i, note: "depreciation" },
  { pattern: /\bsub[\s-]?contract|\bcontractors?\b/i, note: "subcontract" },
  { pattern: /\bentertainment\b/i, note: "entertainment" },
  { pattern: /\bcommissions?\b|\bbonus(es)?\b|\ballowances?\b/i, note: "staff-cost" },
  { pattern: /\binsurance\b/i, note: "insurance" },
];

/** Why this kept line is worth a second look, or null when it's plainly an
    overhead. Only ever consulted for lines that survived `exclusionFor`. */
export function noteFor(name: string): NoteReason | null {
  for (const { pattern, note } of NOTES) {
    if (pattern.test(name)) return note;
  }
  return null;
}

/* ── reading the report ── */

/** Xero renders money as a string, sometimes with a currency symbol, commas,
    or brackets for a negative. Anything unreadable is 0, which drops the line
    rather than inventing a number. */
export function parseAmount(raw: unknown): number {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : 0;
  const s = String(raw ?? "").trim();
  if (!s) return 0;
  const negative = /^\(.*\)$/.test(s);
  const n = Number(s.replace(/[()]/g, "").replace(/[^0-9.-]/g, ""));
  if (!Number.isFinite(n)) return 0;
  return negative ? -n : n;
}

type Cell = { value?: unknown };
type Row = { rowType?: unknown; title?: unknown; cells?: Cell[]; rows?: Row[] };

/** A row's account name — the first cell, which is the label column. */
function rowName(row: Row): string {
  const first = row.cells?.[0]?.value;
  return typeof first === "string" ? first.trim() : "";
}

/** A row's amount — the FIRST amount cell, which is the period we asked for.

    This used to scan BACKWARDS for the last non-zero cell, on the reasoning
    that the requested period would be the rightmost column. A Xero P&L run
    year-on-year proves the opposite: the current year is the LEFT column and
    the comparative sits to its right. So a report that ever came back with a
    comparative would have imported last year's figures — silently, and
    plausibly, since they look like perfectly good costs.

    Nothing requests a comparative today (`periods` is undefined for the window
    call), so there is normally exactly one amount cell and both readings agree.
    Taking the first is simply the one that stays right if that ever changes. */
function rowAmount(row: Row): number {
  return parseAmount(row.cells?.[1]?.value);
}

/** EVERY amount cell on a row, in column order — the whole row rather than the
    one figure `rowAmount` picks.

    This is what makes coverage detection possible: asked for twelve monthly
    columns, a row answers with twelve numbers, and the months that are zero
    across every account are months the business wasn't trading. */
function rowAmounts(row: Row): number[] {
  const cells = row.cells ?? [];
  return cells.slice(1).map(c => parseAmount(c?.value));
}

/** Map a `ReportWithRows` body into cost lines and exclusions.

    Only `rowType: "Row"` is read. A SummaryRow is the section's own total, and
    including it alongside its members would double every section. */
export function mapProfitAndLoss(body: unknown): ProfitAndLoss {
  const empty: ProfitAndLoss = { lines: [], excluded: [], notes: [], sections: [], columnTotals: [] };
  if (!body || typeof body !== "object") return empty;

  const reports = (body as { reports?: unknown }).reports;
  if (!Array.isArray(reports) || reports.length === 0) return empty;

  const sectionsRaw = (reports[0] as { rows?: unknown }).rows;
  if (!Array.isArray(sectionsRaw)) return empty;

  const lines: BusinessCost[] = [];
  const excluded: ExcludedLine[] = [];
  const notes: FlaggedLine[] = [];
  const sections: string[] = [];
  const columnTotals: number[] = [];

  for (const raw of sectionsRaw as Row[]) {
    if (norm(raw?.rowType) !== "section") continue;
    const title = typeof raw.title === "string" ? raw.title : "";
    if (!isExpenseSection(title)) continue;
    sections.push(title);

    for (const row of raw.rows ?? []) {
      if (norm(row?.rowType) !== "row") continue;

      const name = rowName(row);
      if (!name) continue;
      const amount = rowAmount(row);

      /* Column totals count EVERY expense row — the wage line is as much
         evidence the business was trading that month as the rent line, so
         coverage is measured before any exclusion is applied. This runs even
         for a zero row, which costs nothing and keeps the column count honest
         when a report's last month is genuinely empty. */
      rowAmounts(row).forEach((v, i) => {
        columnTotals[i] = (columnTotals[i] ?? 0) + v;
      });

      // A zero line is an account with no activity in the period. It carries no
      // information and would only clutter a list someone has to read.
      if (amount === 0) continue;

      const reason = exclusionFor(name);
      if (reason) {
        excluded.push({ name, amount, reason });
        continue;
      }
      // Everything lands as "shared" — how a cost splits between install and
      // service is a HeyTiff judgement about the business, not something a
      // chart of accounts knows. The user re-allocates on the chips.
      lines.push({ name, amount, allocated_to: "shared" });
      const note = noteFor(name);
      if (note) notes.push({ name, amount, note });
    }
  }

  return { lines, excluded, notes, sections, columnTotals };
}

/* ── how much of the window the books actually cover ──────────────────────

   THE FAILURE THIS EXISTS TO STOP. A business that started trading in February
   has five months of costs inside a July–June window. Xero answers with those
   five months and is right to; the calculator then treats the total as a YEAR
   and under-states overheads by more than half, with every screen still saying
   "FY 2025–26". No amount is wrong — the WINDOW is, and nothing downstream can
   tell. Silently under-pricing a rate is the worst thing this import can do.

   WHY IT IS MEASURED, NOT ASSUMED. The obvious shortcut is the organisation's
   `createdDateUTC`, and it lies in the common case: a business that migrated
   off MYOB last month has three years of history in a one-month-old Xero file.
   Counting months that actually have activity can't be fooled that way.

   WHY IT RECONCILES FIRST. The monthly breakdown is a SECOND call whose column
   semantics we do not control. If its columns don't add up to the single-window
   figure we already trust, they aren't twelve tiles of this window — they're
   something else, and the honest answer is "couldn't tell" rather than a
   confident wrong number. */

/** Cents of slack when reconciling two Xero reports of the same window.
    Rounding differences are real; anything larger is a different window. */
const RECONCILE_TOLERANCE = 1;

export type Coverage = {
  /** Months in the window with expense activity, or null when unknowable. */
  monthsCovered: number | null;
  /** How many columns the monthly report came back with — diagnostic. */
  columns: number;
};

/** Read coverage from a monthly-column report, but only if it reconciles
    against the single-window total that the amounts themselves came from. */
export function coverageFrom(monthly: ProfitAndLoss, windowTotal: number): Coverage {
  const cols = monthly.columnTotals;
  const summed = cols.reduce((a, v) => a + v, 0);
  if (cols.length < 2 || Math.abs(summed - windowTotal) > RECONCILE_TOLERANCE) {
    return { monthsCovered: null, columns: cols.length };
  }
  return { monthsCovered: cols.filter(v => v !== 0).length, columns: cols.length };
}

/** What to multiply a partial window's costs by to get a year.

    1 when the window is full, unknown, or somehow over-full — scaling DOWN a
    report that covers more than twelve months is not this function's job, and
    guessing there would be worse than leaving it alone. */
export function annualFactor(monthsCovered: number | null): number {
  if (monthsCovered === null || monthsCovered <= 0 || monthsCovered >= 12) return 1;
  return 12 / monthsCovered;
}

/* ── accounts the report never mentioned ─────────────────────────────────

   A P&L reports accounts that had a transaction. An account that exists and sat
   idle is simply absent, so reviewing the import tells you nothing about it —
   which is how an account that would be imported WRONGLY stays invisible until
   the quarter it finally has a balance. `Income Tax Expense` is the worked
   example: typed EXPENSE, so it renders under Operating Expenses and would be
   priced as an overhead, and nil in every period we had to look at.

   Naming them costs one extra read and turns "nothing looked wrong" into
   "here is what didn't appear, and what would happen if it did". */

export type DormantAccount = {
  name: string;
  code: string | null;
  /** What the import would do with it the day it has a balance. */
  verdict: ExclusionReason | NoteReason | "overhead";
};

/** Active operating-expense accounts that the report didn't mention.

    Matched on NAME, because that is all a report row carries — the same string
    the exclusion and note patterns already judge. Case- and space-insensitive,
    so "Light, Power, Heating" matching itself doesn't depend on Xero rendering
    the account name and the report row identically. */
export function dormantAccounts(
  accounts: { name: string; code: string | null; active: boolean; operatingExpense: boolean }[],
  pl: Pick<ProfitAndLoss, "lines" | "excluded">
): DormantAccount[] {
  const key = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
  const seen = new Set([...pl.lines, ...pl.excluded].map(l => key(l.name)));

  return accounts
    .filter(a => a.active && a.operatingExpense && !seen.has(key(a.name)))
    .map(a => ({
      name: a.name,
      code: a.code,
      verdict: exclusionFor(a.name) ?? noteFor(a.name) ?? ("overhead" as const),
    }));
}

/* ── the period ── */

export type Period = { from: string; to: string; label: string };

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const iso = (y: number, m: number, d: number) =>
  `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

/** The last COMPLETE financial year, from the organisation's own year end.

    Read from Xero rather than hardcoded to July–June: a business can run a
    different year end, and assuming the Australian default would silently
    fetch the wrong twelve months for them. Falls back to 30 June when Xero
    doesn't say, which is right for almost every Australian business.

    `today` is passed in rather than read, so this is testable and so the
    workspace's own day (not the server's UTC instant) decides. */
export function lastFinancialYear(
  today: string,
  endDay: number | null = null,
  endMonth: number | null = null
): Period {
  const day = endDay && endDay >= 1 && endDay <= 31 ? endDay : 30;
  const month = endMonth && endMonth >= 1 && endMonth <= 12 ? endMonth : 6;

  const [ty, tm, td] = today.split("-").map(Number);

  /* Which year's end have we already passed? If today is on or before this
     year's end date, the last COMPLETE year ended the year before. */
  const passedThisYear = tm > month || (tm === month && td > day);
  const endYear = passedThisYear ? ty : ty - 1;

  const to = iso(endYear, month, day);
  // The day after the previous year end — for a 30 June end, 1 July.
  const startY = endYear - 1;
  const nextDay = new Date(Date.UTC(startY, month - 1, day + 1));
  const from = iso(nextDay.getUTCFullYear(), nextDay.getUTCMonth() + 1, nextDay.getUTCDate());

  /* "FY 2024–25" only makes sense for a year that spans two — a business with
     a December year end gets the plain year instead of a misleading label. */
  const label =
    from.slice(0, 4) === to.slice(0, 4)
      ? `Year to ${MONTHS[month - 1]} ${endYear}`
      : `FY ${startY}–${String(endYear).slice(2)}`;

  return { from, to, label };
}

/** The twelve COMPLETE calendar months ending with the last complete month —
    for books too young to have a full financial year, which is most businesses
    in their first eighteen months.

    Whole months, not "twelve months ending yesterday", for two reasons. A
    window that stops mid-month chops that month's rent and insurance in half
    and reads as a dip that never happened. And only a whole-month window tiles
    into the twelve monthly columns that `coverageFrom` reconciles against — a
    ragged window can't be checked, so it would forfeit the very partial-year
    detection a young business needs most. */
export function trailingYear(today: string): Period {
  const [y, m] = today.split("-").map(Number);
  // The last complete month is the one before the month we're standing in.
  const end = new Date(Date.UTC(y, m - 1, 0)); // day 0 = last day of prior month
  const start = new Date(Date.UTC(end.getUTCFullYear() - 1, end.getUTCMonth() + 1, 1));
  return {
    from: iso(start.getUTCFullYear(), start.getUTCMonth() + 1, 1),
    to: iso(end.getUTCFullYear(), end.getUTCMonth() + 1, end.getUTCDate()),
    label: "Last 12 months",
  };
}

/** The window to ask for when we want it back as twelve monthly columns.

    Xero's `periods`/`timeframe` pair returns the requested window PLUS that
    many prior windows of that size, so the base window has to be one month for
    the columns to come back as months. Everything downstream reconciles the
    result before believing it, so being wrong here costs a fallback rather
    than a wrong number. */
export function finalMonthOf(period: Period): { from: string; to: string } {
  const [y, m] = period.to.split("-").map(Number);
  return { from: iso(y, m, 1), to: period.to };
}

/** Prior periods to ask for alongside the base month — eleven, making twelve. */
export const MONTHLY_PERIODS = 11;

export type PeriodChoice = "last-fy" | "trailing-12";

export function periodFor(
  choice: PeriodChoice,
  today: string,
  endDay: number | null = null,
  endMonth: number | null = null
): Period {
  return choice === "trailing-12" ? trailingYear(today) : lastFinancialYear(today, endDay, endMonth);
}
