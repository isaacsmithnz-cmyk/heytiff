/**
 * @jest-environment node
 */

/* How live updates from ServiceM8 are (two-way phase 4, PR F).

   readSm8HooksHealth is the owner's screen's one read: nothing while live
   updates work or while a reconcile is still to have its go, and the
   plan's state otherwise. checkSm8HooksQuiet is the night's: it alone
   counts the mirror, marks quiet_since when pings stopped while records
   went on changing (never over a ping that came meanwhile), reconciles,
   and clears an old mark. A fake database holds sm8_webhooks, sm8_vendor
   and the six covered tables' counts. Every id is made up. */

type Row = Record<string, unknown>;
const db: Record<string, Row[]> = {};
/** Covered records edited after a stamp, per mirror table. */
let counts: Record<string, number> = {};
const reads: string[] = [];
/** The edit_date each count was taken after. */
const stamps: unknown[] = [];
const writes: { table: string; patch: Row; filters: [string, string, unknown][] }[] = [];
let readFails = false;
/** Something that happens between the check's read and its mark. */
let betweenReadAndWrite: () => void = () => {};

class Query {
  private op: "select" | "update" = "select";
  private patch: Row = {};
  private filters: [string, string, unknown][] = [];
  private single = false;
  private head = false;
  constructor(private table: string) {}
  select(_cols?: string, opts: { head?: boolean } = {}) {
    this.head = !!opts.head;
    return this;
  }
  eq(c: string, v: unknown) {
    this.filters.push([c, "eq", v]);
    return this;
  }
  is(c: string, v: unknown) {
    this.filters.push([c, "is", v]);
    return this;
  }
  gt(c: string, v: unknown) {
    this.filters.push([c, "gt", v]);
    return this;
  }
  maybeSingle() {
    this.single = true;
    return this;
  }
  update(p: Row) {
    this.op = "update";
    this.patch = p;
    return this;
  }
  then<T>(res: (v: unknown) => T, rej?: (e: unknown) => T) {
    return Promise.resolve()
      .then(() => this.run())
      .then(res, rej);
  }
  private run(): unknown {
    if (this.op === "select") {
      reads.push(this.table);
      if (readFails) return { data: null, error: { message: "down" } };
      if (this.head) {
        stamps.push(this.filters.find(([c, op]) => c === "edit_date" && op === "gt")?.[2]);
        return { count: counts[this.table] ?? 0, data: null, error: null };
      }
      const hit = (db[this.table] ?? []).filter((r) => this.matches(r)).map((r) => ({ ...r }));
      if (this.table === "sm8_webhooks") betweenReadAndWrite();
      return { data: this.single ? (hit[0] ?? null) : hit, error: null };
    }
    writes.push({ table: this.table, patch: this.patch, filters: this.filters });
    const hit = (db[this.table] ?? []).filter((r) => this.matches(r));
    for (const r of hit) Object.assign(r, this.patch);
    return { data: hit, error: null };
  }
  private matches(r: Row): boolean {
    return this.filters.every(([c, op, v]) => (op === "eq" ? r[c] === v : op === "is" ? (r[c] ?? null) === v : true));
  }
}

jest.mock("@/lib/supabase-server", () => ({
  supabaseAdmin: { from: (table: string) => new Query(table), rpc: async () => ({ data: null, error: null }) },
}));
/* the reconcile a quiet workspace gets: its first step is the access */
const sm8AccessResult = jest.fn(async (..._a: unknown[]) => ({ ok: false, reason: "not_connected" }));
jest.mock("../sm8-store", () => ({
  sm8AccessResult: (...a: unknown[]) => sm8AccessResult(...a),
  renewSm8Access: jest.fn(),
  markSm8NeedsReauth: jest.fn(),
}));
jest.mock("../sm8", () => ({ fetchSm8Vendor: jest.fn() }));

import { checkSm8HooksQuiet, readSm8HooksHealth, sm8HooksSettling } from "../sm8-hooks";
import { HOOK_OBJECT_NAMES, hookSpecOf, type HookObjectsState } from "../sm8-hook-plan";

const ORG = "org-3b9c";
const HOUR = 3_600_000;
const NOW = Date.parse("2026-10-05T01:00:00Z");
const iso = (ms: number) => new Date(ms).toISOString();
const ALL: HookObjectsState = Object.fromEntries(HOOK_OBJECT_NAMES.map((o) => [o, { active: true, name: o }]));

function row(over: Row = {}): Row {
  return {
    org_id: ORG,
    objects: ALL,
    subscribed_at: iso(NOW - 72 * HOUR),
    last_ping_at: iso(NOW - HOUR),
    quiet_since: null,
    rotate_wanted_at: null,
    ensure_tried_at: iso(NOW - 2 * HOUR),
    ...over,
  };
}

const env = { ...process.env };
beforeEach(() => {
  process.env.VERCEL_ENV = "production";
  process.env.SM8_WEBHOOKS = "1";
  process.env.APP_BASE_URL = "https://app.test";
  for (const k of Object.keys(db)) delete db[k];
  db.sm8_webhooks = [row()];
  db.sm8_vendor = [{ org_id: ORG, timezone_name: "Australia/Sydney" }];
  counts = {};
  reads.length = 0;
  stamps.length = 0;
  writes.length = 0;
  readFails = false;
  betweenReadAndWrite = () => {};
  sm8AccessResult.mockClear();
});
afterEach(() => {
  process.env = { ...env };
});

const TABLES = HOOK_OBJECT_NAMES.map((o) => hookSpecOf(o).table);

describe("the owner's screen: readSm8HooksHealth", () => {
  it("says nothing while live updates work", async () => {
    expect(await readSm8HooksHealth(ORG, NOW)).toBeNull();
    expect(reads).toEqual(["sm8_webhooks"]);
  });

  it("names each way they don't", async () => {
    db.sm8_webhooks = [row({ objects: {} })];
    expect(await readSm8HooksHealth(ORG, NOW)).toEqual({ state: "none" });

    db.sm8_webhooks = [row({ objects: { ...ALL, job_notes: { active: false, error: "403: forbidden" } } })];
    expect(await readSm8HooksHealth(ORG, NOW)).toEqual({ state: "partial", missing: ["job_notes"], errors: ["job_notes"] });

    db.sm8_webhooks = [
      row({ objects: { ...ALL, jobs: { active: false, failure_reason: "Webhook request failed for over 12 hours", failure_at: "2026-10-03 04:12:00" } } }),
    ];
    expect(await readSm8HooksHealth(ORG, NOW)).toEqual({
      state: "deactivated",
      object: "jobs",
      reason: "Webhook request failed for over 12 hours",
      at: "2026-10-03 04:12:00",
    });
  });

  it("says quiet only from the night's mark, and never counts", async () => {
    db.sm8_webhooks = [row({ last_ping_at: iso(NOW - 30 * HOUR), quiet_since: iso(NOW - 5 * HOUR) })];
    expect(await readSm8HooksHealth(ORG, NOW)).toEqual({ state: "quiet", since: NOW - 30 * HOUR });
    /* no mark: nothing, however long ago the last ping */
    db.sm8_webhooks = [row({ last_ping_at: iso(NOW - 30 * HOUR) })];
    expect(await readSm8HooksHealth(ORG, NOW)).toBeNull();
    expect(reads.every((t) => t === "sm8_webhooks")).toBe(true);
  });

  it("says nothing while a reconcile is still to have its go", async () => {
    for (const over of [
      { ensure_tried_at: null },
      { ensure_tried_at: iso(NOW + 20_000) },
      { rotate_wanted_at: iso(NOW - HOUR), ensure_tried_at: iso(NOW - 2 * HOUR) },
    ]) {
      db.sm8_webhooks = [row({ objects: {}, ...over })];
      expect([over, await readSm8HooksHealth(ORG, NOW)]).toEqual([over, null]);
    }
    db.sm8_webhooks = [];
    expect(await readSm8HooksHealth(ORG, NOW)).toBeNull();
    /* a rotation owed that a reconcile has tried since: said */
    db.sm8_webhooks = [row({ objects: {}, rotate_wanted_at: iso(NOW - 2 * HOUR), ensure_tried_at: iso(NOW - HOUR) })];
    expect(await readSm8HooksHealth(ORG, NOW)).toEqual({ state: "none" });
  });

  it("says nothing when the row can't be read", async () => {
    readFails = true;
    expect(await readSm8HooksHealth(ORG, NOW)).toBeNull();
  });

  it("reads nothing on any switch but on", async () => {
    for (const [vercel, hooks] of [["production", undefined], ["production", "gone"], ["preview", "1"]]) {
      process.env.VERCEL_ENV = vercel;
      if (hooks === undefined) delete process.env.SM8_WEBHOOKS;
      else process.env.SM8_WEBHOOKS = hooks;
      db.sm8_webhooks = [row({ objects: {} })];
      expect(await readSm8HooksHealth(ORG, NOW)).toBeNull();
      expect(await checkSm8HooksQuiet(ORG, { budgetMs: 30_000, clock: () => NOW })).toEqual({ state: "unread", counted: false, ensured: false });
    }
    expect(reads).toEqual([]);
    expect(writes).toEqual([]);
  });
});

describe("settling", () => {
  it("is a reconcile never tried, one running, or a rotation owed since the last try", () => {
    expect(sm8HooksSettling(null, NOW)).toBe(true);
    expect(sm8HooksSettling({ rotate_wanted_at: null, ensure_tried_at: null }, NOW)).toBe(true);
    expect(sm8HooksSettling({ rotate_wanted_at: null, ensure_tried_at: iso(NOW + 1) }, NOW)).toBe(true);
    expect(sm8HooksSettling({ rotate_wanted_at: iso(NOW - 1), ensure_tried_at: iso(NOW - 2) }, NOW)).toBe(true);
    expect(sm8HooksSettling({ rotate_wanted_at: iso(NOW - 2), ensure_tried_at: iso(NOW - 1) }, NOW)).toBe(false);
    expect(sm8HooksSettling({ rotate_wanted_at: null, ensure_tried_at: iso(NOW) }, NOW)).toBe(false);
  });
});

describe("the night: checkSm8HooksQuiet", () => {
  const check = (budgetMs = 28_000) => checkSm8HooksQuiet(ORG, { budgetMs, clock: () => NOW });
  const quietRow = (over: Row = {}) => row({ last_ping_at: iso(NOW - 25 * HOUR), ...over });
  const marks = () => writes.filter((w) => "quiet_since" in w.patch);

  it("marks quiet_since when pings stopped a day ago and 10 records changed since, and reconciles", async () => {
    db.sm8_webhooks = [quietRow()];
    counts = { [TABLES[0]]: 4, [TABLES[1]]: 6 };
    expect(await check()).toEqual({ state: "quiet", counted: true, ensured: false });
    expect(db.sm8_webhooks[0].quiet_since).toBe(iso(NOW));
    /* counted table by table from the last ping plus 10 minutes, in the
       account's clock: 00:10 UTC on 4 Oct is 11:10 in Sydney, daylight
       saving having begun that morning */
    expect(reads.filter((t) => TABLES.includes(t))).toEqual([TABLES[0], TABLES[1]]);
    expect(stamps).toEqual(["2026-10-04 11:10:00", "2026-10-04 11:10:00"]);
    /* the reconcile ran: its first step asks for the access */
    expect(sm8AccessResult).toHaveBeenCalledWith(ORG, NOW);
  });

  it("stops counting at ten", async () => {
    db.sm8_webhooks = [quietRow()];
    counts = Object.fromEntries(TABLES.map((t) => [t, 3]));
    await check();
    expect(reads.filter((t) => TABLES.includes(t))).toEqual(TABLES.slice(0, 4));
  });

  it("isn't quiet at 9 records, or at 23 hours, and a day and a bit with none counted at all", async () => {
    db.sm8_webhooks = [quietRow()];
    counts = { [TABLES[0]]: 9 };
    expect(await check()).toEqual({ state: "ok", counted: true, ensured: false });
    expect(marks()).toEqual([]);

    reads.length = 0;
    db.sm8_webhooks = [row({ last_ping_at: iso(NOW - 23 * HOUR) })];
    counts = { [TABLES[0]]: 500 };
    expect(await check()).toEqual({ state: "ok", counted: false, ensured: false });
    expect(reads.filter((t) => TABLES.includes(t))).toEqual([]);
    expect(marks()).toEqual([]);
    expect(sm8AccessResult).not.toHaveBeenCalled();
  });

  it("counts from the subscribing when nothing has ever pinged", async () => {
    db.sm8_webhooks = [row({ last_ping_at: null, subscribed_at: iso(NOW - 25 * HOUR) })];
    counts = { [TABLES[0]]: 10 };
    expect((await check()).state).toBe("quiet");
    expect(db.sm8_webhooks[0].quiet_since).toBe(iso(NOW));
  });

  it("gives a Reconnect its own 24 hours: no count, and last night's mark cleared", async () => {
    db.sm8_webhooks = [row({ last_ping_at: iso(NOW - 30 * HOUR), subscribed_at: iso(NOW - HOUR), quiet_since: iso(NOW - 6 * HOUR) })];
    counts = { [TABLES[0]]: 50 };
    /* the screen: the old mark no longer says quiet */
    expect(await readSm8HooksHealth(ORG, NOW)).toBeNull();
    /* the night: nothing counted, and the mark goes */
    expect(await check()).toEqual({ state: "ok", counted: false, ensured: false });
    expect(reads.filter((t) => TABLES.includes(t))).toEqual([]);
    expect(db.sm8_webhooks[0].quiet_since).toBeNull();
  });

  it("never marks over a ping that came after it read the row", async () => {
    db.sm8_webhooks = [quietRow()];
    counts = { [TABLES[0]]: 10 };
    betweenReadAndWrite = () => {
      /* sm8_take_ping: last_ping_at moves on, quiet_since cleared */
      Object.assign(db.sm8_webhooks[0], { last_ping_at: iso(NOW - 1_000), quiet_since: null });
    };
    await check();
    expect(db.sm8_webhooks[0].quiet_since).toBeNull();
    expect(marks()).toHaveLength(1);
  });

  it("leaves a mark it already made, and clears an old one once it isn't quiet", async () => {
    db.sm8_webhooks = [quietRow({ quiet_since: iso(NOW - 24 * HOUR) })];
    counts = { [TABLES[0]]: 10 };
    expect((await check()).state).toBe("quiet");
    expect(marks()).toEqual([]);
    expect(db.sm8_webhooks[0].quiet_since).toBe(iso(NOW - 24 * HOUR));

    db.sm8_webhooks = [row({ quiet_since: iso(NOW - 24 * HOUR), subscribed_at: iso(NOW - HOUR), last_ping_at: null })];
    expect((await check()).state).toBe("ok");
    expect(db.sm8_webhooks[0].quiet_since).toBeNull();
  });

  it("leaves none, partial and deactivated to the reconcile and the screen: no count, no mark", async () => {
    for (const objects of [{}, { ...ALL, attachments: { active: false } }, { ...ALL, jobs: { active: false, failure_reason: "Failed" } }]) {
      db.sm8_webhooks = [quietRow({ objects })];
      counts = { [TABLES[0]]: 50 };
      const out = await check();
      expect(["none", "partial", "deactivated"]).toContain(out.state);
      expect(out.counted).toBe(false);
    }
    expect(reads.filter((t) => TABLES.includes(t))).toEqual([]);
    expect(writes).toEqual([]);
  });

  it("touches nothing while a reconcile is still to have its go, or when it can't read", async () => {
    db.sm8_webhooks = [quietRow({ ensure_tried_at: iso(NOW + 10_000) })];
    counts = { [TABLES[0]]: 50 };
    expect((await check()).state).toBe("settling");
    db.sm8_webhooks = [quietRow()];
    db.sm8_vendor = [];
    expect((await check()).state).toBe("unread");
    readFails = true;
    expect((await check()).state).toBe("unread");
    expect(writes).toEqual([]);
  });

  it("reconciles a quiet workspace only in what is left of its budget", async () => {
    db.sm8_webhooks = [quietRow()];
    counts = { [TABLES[0]]: 10 };
    expect(await check(0)).toEqual({ state: "quiet", counted: true, ensured: false });
    expect(sm8AccessResult).not.toHaveBeenCalled();
    expect(db.sm8_webhooks[0].quiet_since).toBe(iso(NOW));
  });
});
