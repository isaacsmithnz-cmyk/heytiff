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
export type ExclusionReason = "wages" | "super" | "vehicle" | "user";

export type ExcludedLine = { name: string; amount: number; reason: ExclusionReason };

export type ProfitAndLoss = {
  /** Lines that become business costs. */
  lines: BusinessCost[];
  /** Lines deliberately kept out, with the reason — shown, never silent. */
  excluded: ExcludedLine[];
  /** Which P&L sections were read, so the screen can show its working. */
  sections: string[];
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
  { pattern: /\bsuper(annuation)?\b/i, reason: "super" },
  { pattern: /\bwages?\b|\bsalar(y|ies)\b|\bpayroll\b|\bemployee benefit/i, reason: "wages" },
  { pattern: /workers?[\s-]*comp/i, reason: "wages" },
  { pattern: /\bmotor vehicle|\bvehicle\b|\bfuel\b|\bpetrol\b|\bdiesel\b|\btolls?\b|\brego\b|\bregistration\b/i, reason: "vehicle" },
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

/** A row's amount — the LAST cell with a readable number.

    Not the second cell: a P&L asked for multiple periods has one column per
    period, and the last is the one the caller asked about. With a single
    period there is only one, so this is right either way. */
function rowAmount(row: Row): number {
  const cells = row.cells ?? [];
  for (let i = cells.length - 1; i >= 1; i--) {
    const v = parseAmount(cells[i]?.value);
    if (v !== 0) return v;
  }
  return 0;
}

/** Map a `ReportWithRows` body into cost lines and exclusions.

    Only `rowType: "Row"` is read. A SummaryRow is the section's own total, and
    including it alongside its members would double every section. */
export function mapProfitAndLoss(body: unknown): ProfitAndLoss {
  const empty: ProfitAndLoss = { lines: [], excluded: [], sections: [] };
  if (!body || typeof body !== "object") return empty;

  const reports = (body as { reports?: unknown }).reports;
  if (!Array.isArray(reports) || reports.length === 0) return empty;

  const sectionsRaw = (reports[0] as { rows?: unknown }).rows;
  if (!Array.isArray(sectionsRaw)) return empty;

  const lines: BusinessCost[] = [];
  const excluded: ExcludedLine[] = [];
  const sections: string[] = [];

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
      // A zero line is an account with no activity in the period. It carries no
      // information and would only clutter a list someone has to read.
      if (amount === 0) continue;

      const reason = exclusionFor(name);
      if (reason) {
        excluded.push({ name, amount, reason });
      } else {
        // Everything lands as "shared" — how a cost splits between install and
        // service is a HeyTiff judgement about the business, not something a
        // chart of accounts knows. The user re-allocates on the chips.
        lines.push({ name, amount, allocated_to: "shared" });
      }
    }
  }

  return { lines, excluded, sections };
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

/** The twelve months ending yesterday — for books too young to have a complete
    financial year, which is most businesses in their first eighteen months. */
export function trailingYear(today: string): Period {
  const [y, m, d] = today.split("-").map(Number);
  const end = new Date(Date.UTC(y, m - 1, d - 1));
  const start = new Date(Date.UTC(end.getUTCFullYear() - 1, end.getUTCMonth(), end.getUTCDate() + 1));
  return {
    from: iso(start.getUTCFullYear(), start.getUTCMonth() + 1, start.getUTCDate()),
    to: iso(end.getUTCFullYear(), end.getUTCMonth() + 1, end.getUTCDate()),
    label: "Last 12 months",
  };
}

export type PeriodChoice = "last-fy" | "trailing-12";

export function periodFor(
  choice: PeriodChoice,
  today: string,
  endDay: number | null = null,
  endMonth: number | null = null
): Period {
  return choice === "trailing-12" ? trailingYear(today) : lastFinancialYear(today, endDay, endMonth);
}
