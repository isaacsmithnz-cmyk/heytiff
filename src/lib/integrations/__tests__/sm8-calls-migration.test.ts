/**
 * @jest-environment node
 */

/* docs/migrations/sm8_calls_echo_freshness.sql, read as text: the parts
   whose mistakes would be silent. The functions themselves are exercised for
   real by the rolled-back script beside it (…test.sql), which carries copies
   of them — so the copies are held equal here, or the script would prove
   something the migration doesn't do. */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SM8_OBJECTS } from "../sm8-sync-plan";

const DIR = join(__dirname, "..", "..", "..", "..", "docs", "migrations");
const migration = readFileSync(join(DIR, "sm8_calls_echo_freshness.sql"), "utf8");
const script = readFileSync(join(DIR, "sm8_calls_echo_freshness.test.sql"), "utf8");

/** The SQL between `-- BEGIN name` and `-- END name`, comments and blank
    lines dropped. */
function block(sql: string, name: string): string {
  const start = sql.indexOf(`-- BEGIN ${name}`);
  const end = sql.indexOf(`-- END ${name}`);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return sql
    .slice(start, end)
    .split("\n")
    .filter((l) => l.trim() !== "" && !l.trim().startsWith("--"))
    .join("\n");
}

describe("keep the newer row", () => {
  it("guards every mirror table the sync writes — a new object can't slip past it", () => {
    const list = /foreach t in array array\[([\s\S]*?)\]/.exec(migration)![1];
    const named = [...list.matchAll(/'([a-z0-9_]+)'/g)].map((m) => m[1]).sort();
    expect(named).toEqual(SM8_OBJECTS.map((o) => o.table).sort());
  });

  it("skips an update whose stamp is older, comparing ServiceM8's text stamps as text", () => {
    const fn = block(migration, "KEEP NEWER");
    expect(fn).toMatch(/new\.edit_date collate "C" < old\.edit_date collate "C"/);
    expect(fn).toMatch(/then\s+return null;/);
    // a missing stamp on either side lets the update through
    expect(fn).toMatch(/old\.edit_date is not null and new\.edit_date is not null/);
    expect(migration).toMatch(/before update on public\.%I/);
  });
});

describe("the rolled-back test script", () => {
  it("carries the migration's counter and guard exactly", () => {
    expect(block(script, "METER")).toBe(block(migration, "METER"));
    expect(block(script, "KEEP NEWER")).toBe(block(migration, "KEEP NEWER"));
  });

  it("is one transaction that ends in rollback, and never commits", () => {
    const statements = script
      .split("\n")
      .filter((l) => !l.trim().startsWith("--"))
      .join("\n")
      .trim();
    expect(statements.startsWith("begin;")).toBe(true);
    expect(statements.endsWith("rollback;")).toBe(true);
    expect(statements).not.toMatch(/^\s*commit\s*;/im);
  });

  it("touches no real account's counter and no mirror", () => {
    const meters = [...script.matchAll(/(?:sm8_take_call|sm8_note_throttle)\('([^']*)'|meter = '([^']*)'/g)].map(
      (m) => m[1] ?? m[2]
    );
    expect(meters.length).toBeGreaterThan(10);
    for (const m of meters) expect(m.startsWith("rollback-test:")).toBe(true);
    const outsideBlocks = script.replace(/-- BEGIN METER[\s\S]*?-- END METER/, "").replace(/-- BEGIN KEEP NEWER[\s\S]*?-- END KEEP NEWER/, "");
    for (const o of SM8_OBJECTS) expect(outsideBlocks).not.toContain(o.table);
  });

  it("exercises both functions and the guard", () => {
    expect(script).toMatch(/public\.sm8_take_call\('rollback-test:/);
    expect(script).toMatch(/public\.sm8_note_throttle\('rollback-test:/);
    expect(script).toMatch(/execute function public\.sm8_mirror_keep_newer\(\)/);
  });
});

describe("safe to apply before the deploy", () => {
  it("only adds, and adds nothing twice", () => {
    const sql = migration
      .split("\n")
      .filter((l) => !l.trim().startsWith("--"))
      .join("\n");
    expect(sql).not.toMatch(/\bdrop\s+(table|column|index|function)\b/i);
    expect(sql).not.toMatch(/\bdelete\s+from\b/i);
    for (const m of sql.matchAll(/create\s+(table|index)\s+(?!if not exists)/gi)) throw new Error(`not idempotent: ${m[0]}`);
    for (const m of sql.matchAll(/add column\s+(?!if not exists)/gi)) throw new Error(`not idempotent: ${m[0]}`);
    // the only drop is the trigger it recreates
    expect(sql).toMatch(/drop trigger if exists sm8_keep_newer/);
  });

  it("keeps the counter away from the public keys", () => {
    expect(migration).toMatch(/alter table public\.sm8_call_meter enable row level security/);
    expect(migration).toMatch(/revoke execute on function public\.sm8_take_call\([^)]*\) from public, anon, authenticated/);
    expect(migration).toMatch(/revoke execute on function public\.sm8_note_throttle\([^)]*\) from public, anon, authenticated/);
  });
});
