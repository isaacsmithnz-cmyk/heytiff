/**
 * @jest-environment node
 */

/* docs/migrations/sm8_webhooks.sql, read as text: the parts whose mistakes
   would be silent. The functions themselves are exercised for real by the
   rolled-back script beside it (…test.sql), which carries a copy of them —
   so the copy is held byte-equal here, or the script would prove something
   the migration doesn't do. */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { HOOK_GRACE_MS, HOOK_OBJECT_NAMES, PING_UUIDS_MAX } from "../sm8-hook-plan";
import { SM8_OBJECTS } from "../sm8-sync-plan";

const DIR = join(__dirname, "..", "..", "..", "..", "docs", "migrations");
const migration = readFileSync(join(DIR, "sm8_webhooks.sql"), "utf8");
const script = readFileSync(join(DIR, "sm8_webhooks.test.sql"), "utf8");

const TABLES = ["sm8_webhooks", "sm8_webhook_hooks", "sm8_webhook_pings"];
const FUNCTIONS: [string, string][] = [
  ["sm8_take_ping", "text, text, text[], integer"],
  ["sm8_rotate_hook", "uuid, text, text"],
  ["sm8_take_hook_call", "uuid, integer"],
];

/** The SQL between `-- BEGIN name` and `-- END name`, exactly. */
function block(sql: string, name: string): string {
  const start = sql.indexOf(`-- BEGIN ${name}`);
  const end = sql.indexOf(`-- END ${name}`);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return sql.slice(start, end);
}

const code = (sql: string) =>
  sql
    .split("\n")
    .filter((l) => !l.trim().startsWith("--"))
    .join("\n");

describe("kept from the public keys", () => {
  it("turns RLS on for all three tables and adds no policy", () => {
    for (const t of TABLES) expect(migration).toContain(`alter table public.${t} enable row level security;`);
    expect(code(migration)).not.toMatch(/create\s+policy/i);
  });

  it("lets only service_role run the three functions", () => {
    const sql = code(migration);
    for (const [fn, args] of FUNCTIONS) {
      expect(sql).toContain(`revoke execute on function public.${fn}(${args}) from public, anon, authenticated;`);
      expect(sql).toContain(`grant  execute on function public.${fn}(${args}) to service_role;`);
    }
    const grants = [...sql.matchAll(/grant\s+execute[^;]*;/gi)].map((m) => m[0]);
    expect(grants).toHaveLength(FUNCTIONS.length);
    for (const g of grants) expect(g).toMatch(/to service_role;$/);
    expect(sql).not.toMatch(/security\s+definer/i);
  });
});

describe("what the tables hold", () => {
  it("queues only the six objects a ping can name", () => {
    const list = /object\s+text not null check \(object in\s*\(([^)]*)\)\)/.exec(migration)![1];
    const named = [...list.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort();
    expect(named).toEqual([...HOOK_OBJECT_NAMES].sort());
    for (const o of named) expect(SM8_OBJECTS.some((s) => s.object === o)).toBe(true);
  });

  it("queues only lowercase uuids", () => {
    expect(migration).toContain("check (uuid ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')");
  });

  it("takes as many uuids from one ping as the route does, and keeps a retired secret as long as the plan says", () => {
    expect(block(migration, "HOOK FUNCTIONS")).toContain(`not between 1 and ${PING_UUIDS_MAX} then`);
    expect(HOOK_GRACE_MS).toBe(72 * 3_600_000);
    expect(block(migration, "HOOK FUNCTIONS")).toContain("clock_timestamp() + interval '72 hours'");
  });

  it("lets two rotations at once take turns, so the second retires the first's hash", () => {
    const fn = /create or replace function public\.sm8_rotate_hook\([\s\S]*?\$\$([\s\S]*?)\$\$;/.exec(block(migration, "HOOK FUNCTIONS"))![1];
    const statements = code(fn)
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l !== "");
    expect(statements.slice(0, 2)).toEqual(["begin", "perform pg_advisory_xact_lock(hashtextextended(p_org::text, 0));"]);
  });

  it("holds each secret by hash only, with one current per workspace", () => {
    expect(migration).toMatch(/hook_hash\s+text primary key/);
    expect(code(migration)).not.toMatch(/callback_url|hook_secret|hook_enc/i);
    expect(migration).toMatch(/create unique index if not exists sm8_webhook_hooks_one_current\s+on public\.sm8_webhook_hooks \(org_id\) where retired_at is null;/);
  });

  it("gives the sync lease its token, holder and asker", () => {
    for (const c of ["lease_token uuid", "lease_by    text", "wanted_at   timestamptz", "wanted_by   text"]) {
      expect(migration).toContain(`alter table public.sm8_sync_runs add column if not exists ${c};`);
    }
  });
});

describe("safe to apply before the deploy", () => {
  it("is one transaction", () => {
    const sql = code(migration).trim();
    expect(sql.startsWith("begin;")).toBe(true);
    expect(sql.endsWith("commit;")).toBe(true);
  });

  it("waits at most 5 s for a lock, so the syncs never queue behind it", () => {
    const statements = code(migration)
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l !== "");
    expect(statements.slice(0, 2)).toEqual(["begin;", "set local lock_timeout = '5s';"]);
  });

  it("only adds, and adds nothing twice", () => {
    const sql = code(migration);
    expect(sql).not.toMatch(/\bdrop\s+(table|column|index|function|trigger|constraint)\b/i);
    expect(sql).not.toMatch(/\b(delete\s+from|truncate)\b/i);
    expect(sql).not.toMatch(/\balter\s+column\b/i);
    for (const m of sql.matchAll(/create\s+(unique\s+)?(table|index)\s+(?!if not exists)/gi)) throw new Error(`not idempotent: ${m[0]}`);
    for (const m of sql.matchAll(/add column\s+(?!if not exists)/gi)) throw new Error(`not idempotent: ${m[0]}`);
    for (const m of sql.matchAll(/create\s+function/gi)) throw new Error(`not idempotent: ${m[0]}`);
  });

  it("writes no row itself: every insert and update is inside a function", () => {
    const outside = code(migration).replace(/\$\$[\s\S]*?\$\$/g, "");
    expect(outside).not.toMatch(/\binsert\s+into\b/i);
    expect(outside).not.toMatch(/^\s*update\s/im);
  });

  it("carries its read-only checks, before and after, in the header", () => {
    expect(migration).toMatch(/-- READ-ONLY, BEFORE \(expect t, t, t, t, 0\):/);
    expect(migration).toMatch(/-- READ-ONLY, AFTER:/);
    const header = migration.slice(0, migration.indexOf("\nbegin;"));
    for (const line of header.split("\n")) expect(line.startsWith("--") || line.trim() === "").toBe(true);
  });
});

describe("the rolled-back test script", () => {
  it("carries the migration's functions byte for byte", () => {
    expect(block(script, "HOOK FUNCTIONS")).toBe(block(migration, "HOOK FUNCTIONS"));
  });

  it("is one transaction that ends in rollback, and never commits", () => {
    const statements = code(script).trim();
    expect(statements.startsWith("begin;")).toBe(true);
    expect(statements.endsWith("rollback;")).toBe(true);
    expect(statements).not.toMatch(/^\s*commit\s*;/im);
  });

  it("uses only hashes no real secret can have, and touches no mirror", () => {
    const outside = script.replace(/-- BEGIN HOOK FUNCTIONS[\s\S]*?-- END HOOK FUNCTIONS/, "");
    const named = [
      ...outside.matchAll(/public\.sm8_take_ping\('([^']*)'|sm8_rotate_hook\(c\.org, c\.account, '([^']*)'|hook_hash = '([^']*)'/g),
    ].map((m) => m[1] ?? m[2] ?? m[3]);
    expect(named.length).toBeGreaterThan(20);
    for (const h of named) expect(h.startsWith("rollback-test:")).toBe(true);
    for (const o of SM8_OBJECTS) expect(outside).not.toContain(o.table);
  });

  it("refuses to run on a workspace that already has a hook", () => {
    expect(script).toMatch(/if exists \(select 1 from public\.sm8_webhook_hooks where org_id = v_org\) then\s+raise exception/);
  });

  it("exercises every verdict and all three functions", () => {
    for (const v of ["known", "unknown", "stale", "queued", "merged", "full"]) {
      expect(script).toContain(`r.verdict is distinct from '${v}'`);
    }
    expect(script).toMatch(/public\.sm8_rotate_hook\(c\.org, c\.account, 'rollback-test:/);
    expect(script).toMatch(/public\.sm8_take_hook_call\(c\.org, 2\)/);
  });

  it("checks a ping clears the nightly check's quiet mark (PR F)", () => {
    const step = script.match(/-- 10\. [\s\S]*?end \$\$;/)?.[0] ?? "";
    expect(step).toMatch(/set quiet_since = clock_timestamp\(\)/);
    expect(step).toMatch(/public\.sm8_take_ping\('rollback-test:hook-a', 'jobs'/);
    expect(step).toMatch(/select quiet_since from public\.sm8_webhooks where org_id = c\.org\) is not null then\s+raise exception/);
    /* and the function it runs clears it: the migration's own ping */
    expect(block(migration, "HOOK FUNCTIONS")).toMatch(/set last_ping_at = clock_timestamp\(\), quiet_since = null/);
  });

  it("checks a rotation holds the workspace's lock until the transaction ends", () => {
    expect(script).toMatch(/l\.locktype = 'advisory' and l\.pid = pg_backend_pid\(\) and l\.granted/);
    expect(script).toContain("= hashtextextended(c.org::text, 0)");
  });
});
