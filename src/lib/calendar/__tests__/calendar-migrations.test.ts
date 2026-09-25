/**
 * @jest-environment node
 */

/* docs/migrations/school_holidays.sql and calendar_events.sql, read as text:
   the parts whose mistakes would be silent. A seeded date typed wrong is a
   school holiday on the wrong week for every workspace; a column the read
   names that the table does not have is an empty calendar that looks like a
   quiet month; a policy or a missing `if not exists` breaks the house posture
   or the second run. */

import { readFileSync } from "node:fs";
import { join } from "node:path";

const DIR = join(__dirname, "..", "..", "..", "..", "docs", "migrations");
const school = readFileSync(join(DIR, "school_holidays.sql"), "utf8");
const events = readFileSync(join(DIR, "calendar_events.sql"), "utf8");
const query = readFileSync(join(__dirname, "..", "query.ts"), "utf8");

/** The SQL with its comment lines dropped. */
const code = (sql: string) =>
  sql
    .split("\n")
    .filter((l) => !l.trim().startsWith("--"))
    .join("\n");

/** The columns a `create table` names, in order. */
function columnsOf(sql: string, tableName: string): string[] {
  const body = new RegExp(`create table if not exists public\\.${tableName} \\(([\\s\\S]*?)\\n\\);`).exec(code(sql));
  expect(body).not.toBeNull();
  return body![1]
    .split("\n")
    .map((l) => /^\s{2}([a-z_]+)\s+(uuid|text|date|time|jsonb|timestamptz)\b/.exec(l)?.[1])
    .filter((c): c is string => !!c);
}

/** The columns `./query.ts` selects from a table. */
function selectedFrom(tableName: string): string[] {
  const m = new RegExp(`\\.from\\("${tableName}"\\)\\s*\\.select\\(\\s*"([^"]+)"`).exec(query);
  expect(m).not.toBeNull();
  return m![1].split(",").map((c) => c.trim());
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const isDay = (s: string) => DAY.test(s) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;

type Seed = { season: string; start: string; end: string; back: string | null; source: string };
const seed: Seed[] = [
  ...code(school).matchAll(/\('(\w+)',\s*'([\d-]+)',\s*'([\d-]+)',\s*(?:'([\d-]+)'|null),\s*'([^']+)'\)/g),
].map((m) => ({ season: m[1], start: m[2], end: m[3], back: m[4] ?? null, source: m[5] }));

describe("the school-holiday seed", () => {
  it("is NSW Eastern from this spring to the summer that ends in 2029", () => {
    expect(seed).toHaveLength(10);
    expect(code(school)).toMatch(/select 'NSW', 'eastern', v\.season/);
    expect(seed[0]).toMatchObject({ season: "spring", start: "2026-09-28" });
    expect(seed[seed.length - 1]).toMatchObject({ season: "summer", end: "2029-01-25" });
  });

  it("holds real days, in order, each break after the last, each back after its end", () => {
    let prevEnd = "";
    for (const r of seed) {
      expect([r.start, isDay(r.start)]).toEqual([r.start, true]);
      expect([r.end, isDay(r.end)]).toEqual([r.end, true]);
      expect(r.end >= r.start).toBe(true);
      expect(r.start > prevEnd).toBe(true);
      if (r.back) {
        expect(isDay(r.back)).toBe(true);
        expect(r.back > r.end).toBe(true);
      }
      prevEnd = r.end;
    }
  });

  it("names the season a break falls in", () => {
    const monthOf = (s: string) => Number(s.slice(5, 7));
    const SEASON: Record<number, string> = { 12: "summer", 4: "autumn", 7: "winter", 9: "spring", 10: "spring" };
    for (const r of seed) expect([r.start, r.season]).toEqual([r.start, SEASON[monthOf(r.start)]]);
  });

  it("never guesses the day students go back: 2028's is not published", () => {
    expect(seed.filter((r) => r.back === null).map((r) => r.start)).toEqual([
      "2027-12-21",
      "2028-04-10",
      "2028-07-10",
      "2028-10-03",
      "2028-12-22",
    ]);
  });

  it("cites the department's page for every row, and in the header", () => {
    for (const r of seed) expect(r.source).toMatch(/^https:\/\/education\.nsw\.gov\.au\/schooling\/calendars\//);
    for (const url of new Set(seed.map((r) => r.source))) expect(school).toContain(`--   ${url}`);
  });

  it("runs twice without adding anything twice", () => {
    expect(code(school)).toMatch(/on conflict \(state, division, starts_on\) do nothing;/);
    expect(code(school)).toMatch(/constraint school_holidays_key\s+unique \(state, division, starts_on\)/);
  });
});

describe("both tables", () => {
  it.each([
    ["school_holidays", school],
    ["calendar_events", events],
  ])("%s: RLS on, no policy, every create idempotent, and says when to apply it", (name, sql) => {
    const body = code(sql);
    expect(body).toContain(`alter table public.${name} enable row level security;`);
    expect(body).not.toMatch(/create policy/i);
    for (const stmt of body.match(/create (table|index|unique index)[^\n]*/gi) ?? []) {
      expect(stmt).toMatch(/if not exists/i);
    }
    expect(sql).toMatch(/APPLY BEFORE MERGING/);
    expect(sql).toMatch(/READ-ONLY CHECKS, BEFORE/);
    // nothing here rewrites or removes a row that exists
    expect(body).not.toMatch(/\b(update|delete from|drop|truncate)\b/i);
  });

  it("has every column the calendar reads", () => {
    const schoolCols = columnsOf(school, "school_holidays");
    for (const c of selectedFrom("school_holidays")) expect([c, schoolCols.includes(c)]).toEqual([c, true]);
    const eventCols = columnsOf(events, "calendar_events");
    for (const c of selectedFrom("calendar_events")) expect([c, eventCols.includes(c)]).toEqual([c, true]);
  });
});

describe("company events", () => {
  it("keeps a shutdown hourless and a series whole", () => {
    const body = code(events);
    expect(body).toMatch(/check \(kind in \('event', 'shutdown'\)\)/);
    expect(body).toMatch(/constraint calendar_events_shutdown check \(kind <> 'shutdown' or starts_at is null\)/);
    expect(body).toMatch(/constraint calendar_events_series\s+check \(\(series_id is null\) = \(repeat is null\)\)/);
    expect(body).toMatch(/constraint calendar_events_range\s+check \(ends_on >= starts_on\)/);
  });

  it("names its author inside the same workspace, and forgets them without losing the event", () => {
    expect(code(events)).toMatch(
      /foreign key \(created_by, org_id\)\s+references public\.staff_profiles \(id, org_id\) on delete set null \(created_by\)/,
    );
  });
});
