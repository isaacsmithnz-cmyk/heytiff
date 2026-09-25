/* The engine's hard cases: the lease is a real mutex, budgets actually stop
   the walk, cursors move only on completed walks, and each failure kind ends
   exactly as much of the run as it should — one object for a missing scope,
   everything for a rate limit or a dead grant. */

type Row = Record<string, unknown>;

const upserts: { table: string; payload: unknown }[] = [];
const updates: { table: string; patch: Row }[] = [];
const deletes: string[] = [];

let claimResult: Row[] = [{ calls_today: 0, calls_day: null }];
let stateRows: Row[] = [];
let runsRow: Row | null = null;
/* for sweepableSm8Orgs: the connected workspaces, and what each one's last
   finished run looks like */
let connRows: Row[] = [];
let runRows: Row[] = [];
/* The connection row and the mirror's own account row, as maybeSingle reads
   them. A write that names or switches the connection lands on connRow, so a
   later read sees it the way the database would. */
let connRow: Row | null = { tenant_id: "v-1", tenant_name: "Acme Air" };
let vendorRow: Row | null = { uuid: "v-1", name: "Acme Air" };
/* The unique index on ServiceM8 accounts refusing a write that names one. */
let namingRefused = false;
/* Called on every single-row read of the connection, with its count, AFTER
   the read has taken its answer — lets a test play the owner reconnecting
   just after read n of a run. */
let onConnRead: ((n: number) => void) | null = null;
let connReads = 0;
/* Called on every upsert, before it lands — the reconnect that arrives while
   a page is being written. */
let onUpsert: ((table: string) => void) | null = null;
/* Tables whose single-row read errors, and whose delete the database refuses. */
const readFails = new Set<string>();
const deleteFails = new Set<string>();
/* A list read of sm8_sync_state that errors for these columns — a database
   without walk_started_at yet, or one that can't be read at all. */
let stateSelectFails: ((cols: string) => boolean) | null = null;
/* ...and the code it fails with: 42703 is a missing column. */
let stateSelectCode = "42703";
/* An upsert the database refuses, by table and payload. */
let upsertFails: ((table: string, payload: unknown) => { code: string } | null) | null = null;

jest.mock("@/lib/supabase-server", () => ({
  supabaseAdmin: {
    from: (table: string) => {
      const chain: Record<string, unknown> = {};
      chain.upsert = (payload: unknown) => {
        onUpsert?.(table);
        const refused = upsertFails?.(table, payload) ?? null;
        if (refused) return Promise.resolve({ error: refused });
        upserts.push({ table, payload });
        return Promise.resolve({ error: null });
      };
      chain.update = (patch: Row) => {
        /* The connection's own guards are honoured, the way the database
           would: a write conditional on the row's account matches only while
           the row still holds it. */
        const eqs: Row = {};
        const nulls: string[] = [];
        const holds = () =>
          !!connRow &&
          Object.entries(eqs).every(([col, v]) => !(col in connRow!) || connRow![col] === v) &&
          nulls.every((col) => connRow![col] == null);
        const sub: Record<string, unknown> = {};
        sub.eq = (col: string, v: unknown) => {
          eqs[col] = v;
          return sub;
        };
        sub.or = () => sub;
        sub.is = (col: string) => {
          nulls.push(col);
          return sub;
        };
        sub.neq = () => sub;
        sub.select = () => {
          updates.push({ table, patch });
          if (table === "integration_connections" && namingRefused && "tenant_id" in patch) {
            return Promise.resolve({ data: null, error: { code: "23505" } });
          }
          if (table === "integration_connections") {
            if (!holds()) return Promise.resolve({ data: [], error: null });
            connRow = { ...connRow, ...patch };
            return Promise.resolve({ data: [{ id: "c1" }], error: null });
          }
          return Promise.resolve({ data: table === "sm8_sync_runs" ? claimResult : [], error: null });
        };
        sub.then = (res: (v: { error: null }) => unknown) => {
          updates.push({ table, patch });
          return Promise.resolve({ error: null }).then(res);
        };
        return sub;
      };
      chain.select = (cols = "") => {
        const sub: Record<string, unknown> = {};
        sub.eq = () => sub;
        sub.in = () => sub;
        sub.limit = () => sub;
        sub.order = () => sub;
        sub.range = () => sub;
        sub.maybeSingle = async () => {
          const answer = readFails.has(table)
            ? { data: null, error: { code: "08006" } }
            : {
                data: table === "integration_connections" ? connRow : table === "sm8_vendor" ? vendorRow : runsRow,
                error: null,
              };
          if (table === "integration_connections") onConnRead?.(++connReads);
          return answer;
        };
        sub.then = (res: (v: { data: Row[] | null; error?: { code: string } }) => unknown) => {
          if (table === "sm8_sync_state" && stateSelectFails?.(cols)) {
            return Promise.resolve({ data: null, error: { code: stateSelectCode } }).then(res);
          }
          const data =
            table === "sm8_sync_state"
              ? stateRows
              : table === "integration_connections"
                ? connRows
                : table === "sm8_sync_runs"
                  ? runRows
                  : [];
          return Promise.resolve({ data }).then(res);
        };
        return sub;
      };
      chain.delete = () => {
        const sub: Record<string, unknown> = {};
        sub.eq = () => sub;
        sub.then = (res: (v: { error: { code: string } | null }) => unknown) => {
          if (deleteFails.has(table)) return Promise.resolve({ error: { code: "57014" } }).then(res);
          deletes.push(table);
          return Promise.resolve({ error: null }).then(res);
        };
        return sub;
      };
      return chain;
    },
    storage: { from: () => ({ remove: async () => ({ data: [], error: null }) }) },
  },
}));

const afterFn = jest.fn((cb: () => unknown) => void cb);
jest.mock("next/server", () => ({ after: (cb: () => unknown) => afterFn(cb) }));

const sm8AccessResult = jest.fn();
const renewSm8Access = jest.fn();
const markSm8NeedsReauth = jest.fn();
/* The token paths are stubbed, but the naming repair, the account read and
   the switch are the REAL ones: they touch no tokens, and a spy here would
   only prove the sync calls something — the point of the tests below is what
   actually gets written and wiped. The renewal helper between the store and
   the engine is real too. */
jest.mock("../sm8-store", () => ({
  sm8AccessResult: (...a: unknown[]) => sm8AccessResult(...(a as [])),
  renewSm8Access: (...a: unknown[]) => renewSm8Access(...(a as [])),
  markSm8NeedsReauth: (...a: unknown[]) => markSm8NeedsReauth(...(a as [])),
  nameSm8ConnectionIfNameless: jest.requireActual("../sm8-store").nameSm8ConnectionIfNameless,
  readSm8Accounts: jest.requireActual("../sm8-store").readSm8Accounts,
  switchSm8Account: jest.requireActual("../sm8-store").switchSm8Account,
}));

const fetchSm8Vendor = jest.fn();
jest.mock("../sm8", () => ({
  fetchSm8Vendor: (...a: unknown[]) => fetchSm8Vendor(...(a as [])),
}));

const fetchSm8Page = jest.fn();
jest.mock("../sm8-read", () => ({
  fetchSm8Page: (...a: unknown[]) => fetchSm8Page(...(a as [])),
}));

import {
  listSm8SyncStatus,
  readSm8LastCron,
  recordSm8CronVisit,
  runSm8Sync,
  runSm8SyncWhenFree,
  SM8_SYNC_BUSY,
  sm8SyncIsStale,
  sweepableSm8Orgs,
  switchSm8AccountUnderLease,
} from "../sm8-sync";
import {
  PAGE_BUDGET,
  SM8_ACCOUNT_MOVED,
  SM8_ACCOUNT_RESET_TABLES,
  SM8_ACCOUNT_SWITCHED,
  SM8_ACCOUNT_UNCLEARED,
  SM8_ACCOUNT_UNREAD,
  SM8_ELSEWHERE,
  SM8_OBJECTS,
  SM8_PAUSE_SHARED_LIMIT,
  SM8_REVOKED,
  SM8_STATE_UNREAD,
  SM8_UNREACHABLE,
} from "../sm8-sync-plan";

const NOW = Date.parse("2026-07-28T01:00:00Z");
const TODAY = "2026-07-28";

const emptyPage = { ok: true as const, rows: [], nextCursor: null };

const ACCESS = { accessToken: "tok", tenantId: "v-1", grant: "g1", meter: "v-1" };
const RENEWED = { accessToken: "tok-2", tenantId: "v-1", grant: "g2", meter: "v-1" };

beforeEach(() => {
  upserts.length = 0;
  updates.length = 0;
  deletes.length = 0;
  connRow = { tenant_id: "v-1", tenant_name: "Acme Air" };
  vendorRow = { uuid: "v-1", name: "Acme Air" };
  namingRefused = false;
  onConnRead = null;
  connReads = 0;
  onUpsert = null;
  readFails.clear();
  deleteFails.clear();
  stateSelectFails = null;
  stateSelectCode = "42703";
  upsertFails = null;
  claimResult = [{ calls_today: 0, calls_day: null }];
  stateRows = [];
  runsRow = null;
  connRows = [];
  runRows = [];
  afterFn.mockClear();
  sm8AccessResult.mockReset().mockResolvedValue({ ok: true, access: ACCESS });
  renewSm8Access.mockReset().mockResolvedValue({ ok: true, access: RENEWED });
  markSm8NeedsReauth.mockReset().mockResolvedValue(true);
  fetchSm8Vendor.mockReset().mockResolvedValue({
    ok: true,
    vendor: { uuid: "v-1", name: "Acme Air", email: null, timezoneName: "Australia/Brisbane", currency: "AUD" },
  });
  fetchSm8Page.mockReset().mockResolvedValue(emptyPage);
});

const lastRunsUpdate = () => updates.filter((u) => u.table === "sm8_sync_runs").pop()!;
const stateUpsertFor = (object: string) =>
  upserts
    .filter((u) => u.table === "sm8_sync_state")
    .map((u) => u.payload as Row)
    .find((p) => p.object === object);

describe("the lease is a real mutex", () => {
  it("an unclaimed lease means someone else is running — not a second walker", async () => {
    claimResult = [];
    const out = await runSm8Sync("org-1", "manual", NOW);
    expect(out).toMatchObject({ ran: false, note: "A sync is already running." });
    expect(sm8AccessResult).not.toHaveBeenCalled();
    expect(fetchSm8Page).not.toHaveBeenCalled();
  });

  it("an unusable grant releases the lease with the reason", async () => {
    sm8AccessResult.mockResolvedValue({ ok: false, reason: "reauth" });
    const out = await runSm8Sync("org-1", "manual", NOW);
    expect(out.ran).toBe(false);
    const release = lastRunsUpdate();
    expect(release.patch).toMatchObject({ lease_until: null, last_ok: false });
    expect(String(release.patch.last_note)).toContain("connected");
  });
});

describe("budgets", () => {
  it("a spent daily budget refuses before spending a single call", async () => {
    claimResult = [{ calls_today: 2000, calls_day: TODAY }];
    const out = await runSm8Sync("org-1", "cron", NOW);
    expect(out.ran).toBe(false);
    expect(out.note).toContain("budget");
    expect(fetchSm8Vendor).not.toHaveBeenCalled();
  });

  it("yesterday's spend doesn't count against today", async () => {
    claimResult = [{ calls_today: 2000, calls_day: "2026-07-27" }];
    const out = await runSm8Sync("org-1", "cron", NOW);
    expect(out.ran).toBe(true);
    expect(fetchSm8Vendor).toHaveBeenCalled();
  });

  it("the page budget pauses mid-walk WITHOUT advancing the cursor", async () => {
    // The first object never runs out of pages; the budget is what stops it.
    fetchSm8Page.mockImplementation(async () => ({
      ok: true,
      rows: [{ uuid: "u-x", edit_date: "2026-07-28 09:00:00", active: 1 }],
      nextCursor: "more",
    }));

    const out = await runSm8Sync("org-1", "manual", NOW);
    expect(out).toMatchObject({ ran: true, complete: false, pagesUsed: PAGE_BUDGET });
    expect(out.note).toContain("Page budget");
    expect(fetchSm8Page).toHaveBeenCalledTimes(PAGE_BUDGET);

    const staff = stateUpsertFor("staff")!;
    // rows were stored (idempotent), but the floor didn't move
    expect(staff.cursor).toBeNull();
    expect(staff.backfill_done).toBe(false);
    expect(staff.rows_pulled).toBe(PAGE_BUDGET);
    // ...and the page it stopped on is remembered, with its query
    expect(staff.walk_cursor).toBe("more");
    expect(staff.walk_filter).toBeNull(); // staff has no backfill floor
  });
});

/* ── an object bigger than one run's budget ──

   The bug this closes, from the live account on 2026-08-14: sm8_attachments
   held 24,999 rows while rows_pulled read 49,992 — two runs that each re-read
   the same ~25,000 rows because the pagination cursor was thrown away at the
   end of every run. Above PAGE_BUDGET × 1000 rows the object could NEVER
   finish, and everything past page 25 was permanently missing from the
   mirror. */
describe("a walk resumes where it paused", () => {
  const pagedForever = () =>
    fetchSm8Page.mockImplementation(async (_t: string, _e: string, opts: { cursor: string }) => ({
      ok: true,
      rows: [{ uuid: `u-${opts.cursor}`, edit_date: "2026-07-28 09:00:00", active: 1 }],
      nextCursor: `after-${opts.cursor}`,
    }));

  it("starts the next run at the stored cursor, not back at page one", async () => {
    pagedForever();
    stateRows = [
      {
        object: "staff",
        cursor: null,
        backfill_done: false,
        rows_pulled: 25_000,
        walk_cursor: "page-26",
        walk_filter: null,
      },
    ];

    await runSm8Sync("org-1", "manual", NOW);

    const firstCall = fetchSm8Page.mock.calls[0];
    expect(firstCall[1]).toBe("staff.json");
    expect(firstCall[2]).toMatchObject({ cursor: "page-26" });
    /* And it left a NEW resume point, further on than the one it started
       from — which is the whole difference between progress and the loop
       this closes. */
    const staff = stateUpsertFor("staff")!;
    expect(staff.walk_cursor).toContain("page-26");
    expect(staff.walk_cursor).not.toBe("page-26");
  });

  it("resumes on the STORED filter, so a sliding backfill floor can't move the query under it", async () => {
    /* A backfill floor is `now - 24 months`, so recomputing it on a later run
       asks a different question and the stored cursor would be walking a
       result set that no longer exists. jobs is a 24-month object; the stored
       filter must win over anything filterFor would produce today. */
    pagedForever();
    stateRows = SM8_OBJECTS.filter((s) => s.object !== "jobs").map((s) => ({
      object: s.object,
      cursor: "2026-07-01 00:00:00",
      backfill_done: true,
      rows_pulled: 10,
      walk_cursor: null,
      walk_filter: null,
    }));
    stateRows.push({
      object: "jobs",
      cursor: null,
      backfill_done: false,
      rows_pulled: 25_000,
      walk_cursor: "page-26",
      walk_filter: "edit_date gt '2024-01-01 00:00:00'",
    });

    await runSm8Sync("org-1", "manual", NOW);

    const firstCall = fetchSm8Page.mock.calls[0];
    expect(firstCall[1]).toBe("job.json");
    expect(firstCall[2]).toMatchObject({
      cursor: "page-26",
      filter: "edit_date gt '2024-01-01 00:00:00'",
    });
  });

  it("a walk paused before its start was recorded finishes on the old rule, and clears both columns", async () => {
    stateRows = [
      {
        object: "staff",
        cursor: null,
        backfill_done: false,
        rows_pulled: 25_000,
        walk_cursor: "page-26",
        walk_filter: null,
      },
    ];
    fetchSm8Page.mockResolvedValue({
      ok: true,
      rows: [{ uuid: "u-last", edit_date: "2026-07-28 09:00:00", active: 1 }],
      nextCursor: null,
    });

    await runSm8Sync("org-1", "manual", NOW);

    const staff = stateUpsertFor("staff")!;
    expect(staff.backfill_done).toBe(true);
    expect(staff.walk_cursor).toBeNull();
    expect(staff.walk_filter).toBeNull();
    expect(staff.cursor).toBe("2026-07-28 09:00:00"); // the floor moves now, and only now
  });

  it("remembers the page it failed on, so a retry doesn't restart the walk", async () => {
    stateRows = [
      {
        object: "staff",
        cursor: null,
        backfill_done: false,
        rows_pulled: 1000,
        walk_cursor: "page-2",
        walk_filter: null,
      },
    ];
    fetchSm8Page.mockResolvedValue({ ok: false, failure: "rate_limited" });

    await runSm8Sync("org-1", "manual", NOW);

    expect(stateUpsertFor("staff")!.walk_cursor).toBe("page-2");
  });
});

/* ── where a finished walk leaves the cursor ──

   The highest stamp read used to be the cursor. A record edited on a page the
   walk had already read carries a lower stamp than a later page's, so the
   next walk never asked for it again; and in April's repeated hour a later
   edit can carry an earlier stamp. The cursor is now floored a quarter of an
   hour before the walk began, in the account's own clock. */
describe("the cursor a finished walk leaves", () => {
  const vendorIn = (timezoneName: string | null) =>
    fetchSm8Vendor.mockResolvedValue({
      ok: true,
      vendor: { uuid: "v-1", name: "Acme Air", email: null, timezoneName, currency: "AUD" },
    });
  const jobsPages = (rows: { page: string; edit: string }[]) =>
    fetchSm8Page.mockImplementation(async (_call: unknown, endpoint: string, opts: { cursor: string }) => {
      if (endpoint !== "job.json") return emptyPage;
      if (opts.cursor === "-1") {
        return { ok: true, rows: [{ uuid: "j-1", edit_date: rows[0].edit, active: 1 }], nextCursor: "p2" };
      }
      return { ok: true, rows: [{ uuid: "j-2", edit_date: rows[1].edit, active: 1 }], nextCursor: null };
    });

  it("sits a quarter of an hour before the walk began, when a later page read a newer stamp", async () => {
    // Brisbane is UTC+10: the walk began at 11:00 on the account's clock
    vendorIn("Australia/Brisbane");
    jobsPages([
      { page: "1", edit: "2026-07-28 09:00:00" },
      { page: "2", edit: "2026-07-28 11:05:00" },
    ]);
    await runSm8Sync("org-1", "manual", NOW);
    // the old rule said 11:05, and an edit at 10:59 on page one was lost
    expect(stateUpsertFor("jobs")).toMatchObject({ cursor: "2026-07-28 10:45:00", walk_started_at: null });
  });

  it("reaches back across April's repeated hour", async () => {
    // 15:40Z on 3 April 2027 is 02:40 AEDT, twenty minutes before Sydney's clocks go back
    vendorIn("Australia/Sydney");
    jobsPages([
      { page: "1", edit: "2027-04-04 01:00:00" },
      { page: "2", edit: "2027-04-04 02:39:00" },
    ]);
    claimResult = [{ calls_today: 0, calls_day: null }];
    await runSm8Sync("org-1", "manual", Date.parse("2027-04-03T15:40:00Z"));
    expect(stateUpsertFor("jobs")!.cursor).toBe("2027-04-04 01:25:00");
  });

  it("keeps the highest stamp read when that is the lower of the two", async () => {
    vendorIn("Australia/Brisbane");
    jobsPages([
      { page: "1", edit: "2026-07-28 08:00:00" },
      { page: "2", edit: "2026-07-28 09:00:00" },
    ]);
    await runSm8Sync("org-1", "manual", NOW);
    expect(stateUpsertFor("jobs")!.cursor).toBe("2026-07-28 09:00:00");
  });

  it("takes the account's zone from its last known row when this read didn't name one", async () => {
    vendorIn(null);
    vendorRow = { uuid: "v-1", name: "Acme Air", timezone_name: "Australia/Brisbane" };
    jobsPages([
      { page: "1", edit: "2026-07-28 09:00:00" },
      { page: "2", edit: "2026-07-28 11:05:00" },
    ]);
    await runSm8Sync("org-1", "manual", NOW);
    expect(stateUpsertFor("jobs")!.cursor).toBe("2026-07-28 10:45:00");
    // and the known zone is kept rather than blanked
    expect((upserts.find((u) => u.table === "sm8_vendor")!.payload as Row).timezone_name).toBe("Australia/Brisbane");
  });

  it("keeps the old rule when no zone is known at all", async () => {
    vendorIn(null);
    jobsPages([
      { page: "1", edit: "2026-07-28 09:00:00" },
      { page: "2", edit: "2026-07-28 11:05:00" },
    ]);
    await runSm8Sync("org-1", "manual", NOW);
    expect(stateUpsertFor("jobs")!.cursor).toBe("2026-07-28 11:05:00");
  });

  it("a fresh walk that pauses keeps when it began, and the run that finishes it floors at that", async () => {
    vendorIn("Australia/Brisbane");
    // first run: the jobs walk never runs out of pages
    fetchSm8Page.mockImplementation(async (_call: unknown, endpoint: string, opts: { cursor: string }) =>
      endpoint === "job.json"
        ? { ok: true, rows: [{ uuid: `j-${opts.cursor}`, edit_date: "2026-07-28 10:59:00", active: 1 }], nextCursor: `after-${opts.cursor}` }
        : emptyPage
    );
    stateRows = SM8_OBJECTS.filter((o) => o.object !== "jobs").map((o) => ({
      object: o.object,
      cursor: null,
      backfill_done: true,
      rows_pulled: 0,
      walk_cursor: null,
      walk_filter: null,
    }));
    await runSm8Sync("org-1", "manual", NOW);
    const paused = stateUpsertFor("jobs")!;
    expect(paused.walk_cursor).not.toBeNull();
    expect(paused.walk_started_at).toBe(new Date(NOW).toISOString());

    // a day later, the walk finishes: its floor is the first run's start
    upserts.length = 0;
    stateRows = [...stateRows, { ...paused }];
    fetchSm8Page.mockImplementation(async (_call: unknown, endpoint: string) =>
      endpoint === "job.json"
        ? { ok: true, rows: [{ uuid: "j-last", edit_date: "2026-07-29 12:00:00", active: 1 }], nextCursor: null }
        : emptyPage
    );
    await runSm8Sync("org-1", "manual", NOW + 86_400_000);
    expect(stateUpsertFor("jobs")).toMatchObject({ cursor: "2026-07-28 10:45:00", walk_started_at: null, walk_cursor: null });
  });

  it("a state read that fails on the new column is asked again without it, rather than starting a new backfill", async () => {
    stateSelectFails = (cols) => cols.includes("walk_started_at");
    stateRows = SM8_OBJECTS.map((o) => ({
      object: o.object,
      cursor: "2026-07-27 00:00:00",
      backfill_done: true,
      rows_pulled: 5,
      walk_cursor: null,
      walk_filter: null,
    }));
    await runSm8Sync("org-1", "manual", NOW);
    // filtered from the stored cursor, not from 24 months back
    const jobsCall = fetchSm8Page.mock.calls.find((c) => c[1] === "job.json")!;
    expect(jobsCall[2]).toMatchObject({ filter: "edit_date gt '2026-07-26 23:59:59'" });
  });

  it("a state read that fails for any other reason stops the run, rather than reading again without the walk's start", async () => {
    /* a brief database error on the first read, then a plain read that
       answers: the walk in progress would lose its start for good */
    stateSelectFails = (cols) => cols.includes("walk_started_at");
    stateSelectCode = "08006";
    const out = await runSm8Sync("org-1", "manual", NOW);
    expect(out.note).toBe(SM8_STATE_UNREAD);
    expect(fetchSm8Page).not.toHaveBeenCalled();
    expect(upserts.filter((u) => u.table === "sm8_sync_state")).toHaveLength(0);
  });

  it("a state that can't be read at all stops the run before a page is asked for", async () => {
    stateSelectFails = () => true;
    const out = await runSm8Sync("org-1", "manual", NOW);
    expect(out.note).toBe(SM8_STATE_UNREAD);
    expect(fetchSm8Page).not.toHaveBeenCalled();
    expect(upserts.filter((u) => u.table === "sm8_sync_state")).toHaveLength(0);
  });

  it("a database without walk_started_at still saves the rest of the state", async () => {
    upsertFails = (table, payload) =>
      table === "sm8_sync_state" && payload !== null && typeof payload === "object" && "walk_started_at" in payload
        ? { code: "PGRST204" }
        : null;
    await runSm8Sync("org-1", "manual", NOW);
    const jobs = stateUpsertFor("jobs")!;
    expect(jobs).toMatchObject({ backfill_done: true });
    expect(jobs).not.toHaveProperty("walk_started_at");
  });
});

/* ── the account's call limit is shared ──

   Every request the sync makes takes a turn from the account's counter on
   the `sync` lane, which leaves the most room behind. When there is none, the
   sync steps back so a person's send finds it. */
describe("the sync steps back for the account's call limit", () => {
  it("asks for the vendor row and every page on lane `sync`, with the connection's counter", async () => {
    await runSm8Sync("org-1", "manual", NOW);
    expect(fetchSm8Vendor.mock.calls[0][0]).toEqual({ accessToken: "tok", meter: "v-1", lane: "sync" });
    for (const c of fetchSm8Page.mock.calls) {
      expect(c[0]).toEqual({ accessToken: "tok", meter: "v-1", lane: "sync" });
    }
  });

  it("a throttled vendor read ends the run before any page is asked for, and costs nothing", async () => {
    fetchSm8Vendor.mockResolvedValue({ ok: false, unauthorized: false, throttled: true, called: false });
    const out = await runSm8Sync("org-1", "manual", NOW);
    expect(out.note).toBe(SM8_PAUSE_SHARED_LIMIT);
    expect(fetchSm8Page).not.toHaveBeenCalled();
    expect(lastRunsUpdate().patch).toMatchObject({ calls_today: 0, last_note: SM8_PAUSE_SHARED_LIMIT });
  });

  it("a throttled page pauses the walk on the shared-limit note, where it stopped, and isn't counted", async () => {
    fetchSm8Page.mockImplementation(async (_call: unknown, endpoint: string) =>
      endpoint === "category.json" ? { ok: false, failure: "throttled", called: false } : emptyPage
    );
    const out = await runSm8Sync("org-1", "manual", NOW);
    expect(out.note).toBe(SM8_PAUSE_SHARED_LIMIT);
    expect(stateUpsertFor("categories")).toMatchObject({ last_error: SM8_PAUSE_SHARED_LIMIT, walk_cursor: "-1" });
    // the vendor read and the staff page reached ServiceM8; the refused turn didn't
    expect(lastRunsUpdate().patch).toMatchObject({ calls_today: 2 });
  });
});

describe("the walk starts where the hunger is", () => {
  /* The 2026-08-12 prod shape: eight objects with finished backfills,
     job_checklists never reached — no state row at all, because the budget
     died before the walk got there, run after run. The rotation puts the
     unfinished object FIRST. */
  const eightDone = () =>
    SM8_OBJECTS.filter((s) => s.object !== "job_checklists").map((s) => ({
      object: s.object,
      cursor: "2026-08-12 09:00:00",
      backfill_done: true,
      rows_pulled: 10,
    }));

  it("begins at the unreached object, then still walks everyone", async () => {
    stateRows = eightDone();
    const endpoints: string[] = [];
    fetchSm8Page.mockImplementation(async (_tok: string, endpoint: string) => {
      endpoints.push(endpoint);
      return emptyPage;
    });

    const out = await runSm8Sync("org-1", "kick", NOW);
    expect(out.complete).toBe(true);
    expect(endpoints[0]).toBe("jobchecklist.json");
    expect(endpoints).toHaveLength(SM8_OBJECTS.length);
    expect(stateUpsertFor("job_checklists")!.backfill_done).toBe(true);
  });

  it("a backfill bigger than one run now spends the WHOLE budget on itself", async () => {
    stateRows = eightDone();
    fetchSm8Page.mockImplementation(async (_tok: string, endpoint: string) =>
      endpoint === "jobchecklist.json"
        ? {
            ok: true,
            rows: [{ uuid: "c-1", edit_date: "2026-08-12 09:00:00" }],
            nextCursor: "more",
          }
        : emptyPage
    );

    const out = await runSm8Sync("org-1", "kick", NOW);
    expect(out.note).toContain("Page budget");
    expect(fetchSm8Page).toHaveBeenCalledTimes(PAGE_BUDGET); // every page on checklists
    const st = stateUpsertFor("job_checklists")!;
    expect(st.backfill_done).toBe(false); // paused, floor unmoved — and it goes first again next run
    expect(st.cursor).toBeNull();
    // the healthy eight weren't touched this run; their rows and cursors stand
    expect(stateUpsertFor("staff")).toBeUndefined();
  });
});

describe("a clean walk", () => {
  it("mirrors the rows, advances cursors, and counts the calls", async () => {
    fetchSm8Page.mockImplementation(async (_tok: string, endpoint: string) =>
      endpoint === "job.json"
        ? {
            ok: true,
            rows: [
              {
                uuid: "j-1",
                generated_job_id: "1042",
                status: "Work Order",
                edit_date: "2026-07-28 09:00:00",
                active: 1,
                total_invoice_amount: "999.00",
              },
            ],
            nextCursor: null,
          }
        : emptyPage
    );

    const out = await runSm8Sync("org-1", "connect", NOW);
    expect(out).toMatchObject({ ran: true, complete: true, rowsPulled: 1 });

    const vendor = upserts.find((u) => u.table === "sm8_vendor")!.payload as Row;
    expect(vendor).toMatchObject({ org_id: "org-1", timezone_name: "Australia/Brisbane" });

    const jobRows = upserts.find((u) => u.table === "sm8_jobs")!.payload as Row[];
    expect(jobRows[0]).toMatchObject({ org_id: "org-1", uuid: "j-1", generated_job_id: "1042" });
    // Money rides through to the mirror now, verbatim; the gate that decides
    // who may READ it is in the loaders, not in the absence of a column.
    expect(jobRows[0]).toMatchObject({ total_invoice_amount: "999.00" });
    // What still never arrives: write-scope territory and coordinates.
    expect(jobRows[0]).not.toHaveProperty("badges");
    expect(jobRows[0]).not.toHaveProperty("lat");

    const jobs = stateUpsertFor("jobs")!;
    expect(jobs).toMatchObject({
      cursor: "2026-07-28 09:00:00",
      backfill_done: true,
      last_error: null,
      rows_pulled: 1,
    });

    const release = lastRunsUpdate();
    // one vendor call + one page per object
    expect(release.patch).toMatchObject({
      lease_until: null,
      last_ok: true,
      calls_today: 1 + SM8_OBJECTS.length,
      calls_day: TODAY,
    });
  });
});

describe("the vendor read repairs a nameless connect", () => {
  /* A connect whose vendor read failed (a 402-blocked account, say) is stored
     deliberately nameless. saveSm8Connection's comment promises the next sync
     names it — before this, only the sm8_vendor mirror was written and the
     connection row stayed NULL forever. */
  const connectionWrite = () => updates.find((u) => u.table === "integration_connections");

  it("a successful vendor read names the connection row, not just the mirror", async () => {
    connRow = { tenant_id: null, tenant_name: null };
    await runSm8Sync("org-1", "manual", NOW);

    expect(upserts.find((u) => u.table === "sm8_vendor")).toBeDefined();
    expect(connectionWrite()!.patch).toMatchObject({
      tenant_id: "v-1",
      tenant_name: "Acme Air",
    });
  });

  it("a vendor read that failed leaves the connection row alone", async () => {
    // nothing was learned, so there is nothing to write — and a bad read must
    // never blank a name the row already has
    connRow = { tenant_id: null, tenant_name: null };
    fetchSm8Vendor.mockResolvedValue({ ok: false, unauthorized: false });
    await runSm8Sync("org-1", "manual", NOW);
    expect(connectionWrite()).toBeUndefined();
  });

  it("an account another workspace already holds is flagged, and no page is fetched", async () => {
    connRow = { tenant_id: null, tenant_name: null };
    // the unique index refuses the naming write
    namingRefused = true;
    const out = await runSm8Sync("org-1", "manual", NOW);
    expect(out.note).toBe(SM8_ELSEWHERE);
    expect(markSm8NeedsReauth).toHaveBeenCalledWith("org-1", SM8_ELSEWHERE, ACCESS);
    expect(fetchSm8Page).not.toHaveBeenCalled();
  });
});

describe("failure kinds end exactly as much as they should", () => {
  it("a 403 names the grant on that object and keeps walking the rest", async () => {
    fetchSm8Page.mockImplementation(async (_tok: string, endpoint: string) =>
      endpoint === "staff.json" ? { ok: false, failure: "forbidden" } : emptyPage
    );

    const out = await runSm8Sync("org-1", "manual", NOW);
    expect(out.complete).toBe(false);
    expect(stateUpsertFor("staff")!.last_error).toBe("Reconnect ServiceM8 to grant read_staff.");
    // the walk went on: every other object was still fetched
    expect(fetchSm8Page).toHaveBeenCalledTimes(SM8_OBJECTS.length);
    expect(stateUpsertFor("jobs")!.backfill_done).toBe(true);
  });

  it("a 429 ends the whole run — serverless can't sleep it off", async () => {
    fetchSm8Page.mockImplementation(async (_tok: string, endpoint: string) =>
      endpoint === "staff.json" ? { ok: false, failure: "rate_limited" } : emptyPage
    );

    const out = await runSm8Sync("org-1", "manual", NOW);
    expect(out.note).toContain("rate limit");
    expect(fetchSm8Page).toHaveBeenCalledTimes(1);
    expect(lastRunsUpdate().patch).toMatchObject({ last_ok: false });
  });

  it("a dead grant is renewed once, then marked needs_reauth, and the run stops", async () => {
    fetchSm8Page.mockResolvedValue({ ok: false, failure: "unauthorized" });

    const out = await runSm8Sync("org-1", "manual", NOW);
    expect(fetchSm8Page).toHaveBeenCalledTimes(2);
    expect(renewSm8Access).toHaveBeenCalledTimes(1);
    expect(markSm8NeedsReauth).toHaveBeenCalledTimes(1);
    // the grant flagged is the one that was refused twice, not an older one
    expect(markSm8NeedsReauth).toHaveBeenCalledWith("org-1", SM8_REVOKED, RENEWED);
    expect(out.note).toContain("reconnecting");
  });

  it("a 401 cured by one renewal keeps walking every object and flags nothing", async () => {
    /* The hourly token ran out mid-walk. Before, this flagged the connection
       and the owner was asked to reconnect a connection that worked. */
    let refused = false;
    fetchSm8Page.mockImplementation(async (call: { accessToken: string }) => {
      if (call.accessToken === "tok" && !refused) {
        refused = true;
        return { ok: false, failure: "unauthorized" };
      }
      return emptyPage;
    });

    const out = await runSm8Sync("org-1", "manual", NOW);
    expect(out.complete).toBe(true);
    expect(markSm8NeedsReauth).not.toHaveBeenCalled();
    // every object, plus the one page asked twice
    expect(fetchSm8Page).toHaveBeenCalledTimes(SM8_OBJECTS.length + 1);
    // and the renewed token was carried on, not renewed per object
    expect(renewSm8Access).toHaveBeenCalledTimes(1);
    expect(lastRunsUpdate().patch).toMatchObject({ calls_today: 1 + SM8_OBJECTS.length + 1 });
  });

  it("a vendor 401 is renewed once before the grant is judged", async () => {
    fetchSm8Vendor.mockImplementation(async (call: { accessToken: string }) =>
      call.accessToken === "tok"
        ? { ok: false, unauthorized: true }
        : { ok: true, vendor: { uuid: "v-1", name: "Acme Air", email: null, timezoneName: "Australia/Brisbane", currency: "AUD" } }
    );
    const out = await runSm8Sync("org-1", "manual", NOW);
    expect(out.complete).toBe(true);
    expect(fetchSm8Vendor).toHaveBeenCalledTimes(2);
    expect(markSm8NeedsReauth).not.toHaveBeenCalled();
    // the pages went with the renewed token
    expect(fetchSm8Page.mock.calls[0][0]).toMatchObject({ accessToken: "tok-2", lane: "sync" });
  });

  it("a refresh that couldn't reach ServiceM8 says so, not 'reconnect'", async () => {
    sm8AccessResult.mockResolvedValue({ ok: false, reason: "unreachable" });
    const out = await runSm8Sync("org-1", "manual", NOW);
    expect(out.note).toBe(SM8_UNREACHABLE);
    expect(out.note).not.toMatch(/reconnect/i);
    expect(fetchSm8Vendor).not.toHaveBeenCalled();
  });

  it("a renewal that couldn't reach ServiceM8 mid-walk stops the run on 'couldn't be reached'", async () => {
    fetchSm8Page.mockResolvedValue({ ok: false, failure: "unauthorized" });
    renewSm8Access.mockResolvedValue({ ok: false, reason: "unreachable" });
    const out = await runSm8Sync("org-1", "manual", NOW);
    expect(out.note).toBe(SM8_UNREACHABLE);
    expect(markSm8NeedsReauth).not.toHaveBeenCalled();
    expect(fetchSm8Page).toHaveBeenCalledTimes(1);
  });

  it("a vendor read that fails ends the run before any page is fetched", async () => {
    // without the account's uuid, a changed account can't be told from the same one
    fetchSm8Vendor.mockResolvedValue({ ok: false, unauthorized: false });
    const out = await runSm8Sync("org-1", "manual", NOW);
    expect(out.note).toBe(SM8_UNREACHABLE);
    expect(fetchSm8Page).not.toHaveBeenCalled();
    expect(upserts.find((u) => u.table === "sm8_vendor")).toBeUndefined();
  });

  /* 2026-07-30, the first live connection: an expired ServiceM8 trial answers
     402 to every endpoint, and with no branch for it the board said "couldn't
     be reached" — a network fault — while the sync retried a state only the
     account holder can clear. */
  it("a 402 ends the run on the account read, before spending a page call", async () => {
    fetchSm8Vendor.mockResolvedValue({ ok: false, unauthorized: false, paymentRequired: true });

    const out = await runSm8Sync("org-1", "manual", NOW);
    expect(out.note).toMatch(/trial has ended or an invoice is outstanding/);
    // the nine objects would each be told the same thing
    expect(fetchSm8Page).not.toHaveBeenCalled();
    expect(lastRunsUpdate().patch).toMatchObject({ last_ok: false, calls_today: 1 });
  });

  it("a 402 never marks the grant needs_reauth — reconnecting can't pay a bill", async () => {
    fetchSm8Vendor.mockResolvedValue({ ok: false, unauthorized: false, paymentRequired: true });
    await runSm8Sync("org-1", "manual", NOW);
    expect(markSm8NeedsReauth).not.toHaveBeenCalled();
  });

  it("a 402 mid-walk stops the run too, on that object's own error", async () => {
    fetchSm8Page.mockImplementation(async (_tok: string, endpoint: string) =>
      endpoint === "staff.json" ? { ok: false, failure: "payment_required" } : emptyPage
    );

    const out = await runSm8Sync("org-1", "manual", NOW);
    expect(out.complete).toBe(false);
    expect(stateUpsertFor("staff")!.last_error).toMatch(/Choose a plan in ServiceM8/);
    expect(fetchSm8Page).toHaveBeenCalledTimes(1);
    expect(markSm8NeedsReauth).not.toHaveBeenCalled();
  });
});

describe("sweepableSm8Orgs — the nightly cap must rotate, not cut off", () => {
  it("puts the longest-waiting workspace first", async () => {
    connRows = [{ org_id: "a" }, { org_id: "b" }, { org_id: "c" }];
    runRows = [
      { org_id: "a", last_finished_at: "2026-07-28T03:00:00.000Z" },
      { org_id: "b", last_finished_at: "2026-07-26T03:00:00.000Z" },
      { org_id: "c", last_finished_at: "2026-07-27T03:00:00.000Z" },
    ];
    expect(await sweepableSm8Orgs(10)).toEqual(["b", "c", "a"]);
  });

  it("a workspace that has NEVER synced goes first — it has waited longest", async () => {
    // the exact org an unordered .limit() is most likely to strand: it has no
    // sm8_sync_runs row at all, so selecting FROM that table would hide it
    connRows = [{ org_id: "synced" }, { org_id: "never" }];
    runRows = [{ org_id: "synced", last_finished_at: "2026-07-28T03:00:00.000Z" }];
    expect(await sweepableSm8Orgs(10)).toEqual(["never", "synced"]);
  });

  it("treats a null last_finished_at as never swept", async () => {
    connRows = [{ org_id: "a" }, { org_id: "b" }];
    runRows = [
      { org_id: "a", last_finished_at: "2026-07-28T03:00:00.000Z" },
      { org_id: "b", last_finished_at: null }, // claimed a lease, never finished
    ];
    expect(await sweepableSm8Orgs(10)).toEqual(["b", "a"]);
  });

  it("the cap takes the neediest, and tomorrow's run reaches the rest", async () => {
    connRows = ["a", "b", "c", "d"].map((org_id) => ({ org_id }));
    runRows = [
      { org_id: "a", last_finished_at: "2026-07-28T03:00:00.000Z" },
      { org_id: "b", last_finished_at: "2026-07-25T03:00:00.000Z" },
      { org_id: "c", last_finished_at: "2026-07-26T03:00:00.000Z" },
      { org_id: "d", last_finished_at: "2026-07-27T03:00:00.000Z" },
    ];
    const tonight = await sweepableSm8Orgs(2);
    expect(tonight).toEqual(["b", "c"]);

    // once tonight's two have run, the other two are the longest-waiting
    runRows = [
      { org_id: "a", last_finished_at: "2026-07-28T03:00:00.000Z" },
      { org_id: "b", last_finished_at: "2026-07-29T03:00:00.000Z" },
      { org_id: "c", last_finished_at: "2026-07-29T03:00:00.000Z" },
      { org_id: "d", last_finished_at: "2026-07-27T03:00:00.000Z" },
    ];
    expect(await sweepableSm8Orgs(2)).toEqual(["d", "a"]);
  });

  it("is deterministic when timestamps tie", async () => {
    connRows = [{ org_id: "b" }, { org_id: "a" }];
    runRows = [
      { org_id: "a", last_finished_at: "2026-07-28T03:00:00.000Z" },
      { org_id: "b", last_finished_at: "2026-07-28T03:00:00.000Z" },
    ];
    expect(await sweepableSm8Orgs(10)).toEqual(["a", "b"]);
  });

  it("no connected workspaces spends no second query", async () => {
    connRows = [];
    expect(await sweepableSm8Orgs(10)).toEqual([]);
  });
});

describe("is the mirror due a top-up?", () => {
  it("yes, when it is stale and nothing is running", async () => {
    runsRow = { lease_until: null, last_finished_at: new Date(NOW - 60 * 60_000).toISOString() };
    expect(await sm8SyncIsStale("org-1", NOW)).toBe(true);
    runsRow = null; // never synced
    expect(await sm8SyncIsStale("org-1", NOW)).toBe(true);
  });

  it("no, when fresh or already running — and it schedules nothing itself", async () => {
    runsRow = { lease_until: null, last_finished_at: new Date(NOW - 2 * 60_000).toISOString() };
    expect(await sm8SyncIsStale("org-1", NOW)).toBe(false);

    runsRow = {
      lease_until: new Date(NOW + 60_000).toISOString(),
      last_finished_at: new Date(NOW - 60 * 60_000).toISOString(),
    };
    expect(await sm8SyncIsStale("org-1", NOW)).toBe(false);
    expect(afterFn).not.toHaveBeenCalled();
  });
});

describe("the overnight trace", () => {
  it("records the scheduler's visit against the workspace, and nothing else", async () => {
    await recordSm8CronVisit("org-1", NOW);
    const visit = upserts.find((u) => u.table === "sm8_sync_runs")!.payload as Row;
    expect(visit).toEqual({ org_id: "org-1", last_cron_at: new Date(NOW).toISOString() });
  });

  it("never throws for a database without the column", async () => {
    upsertFails = (table) => (table === "sm8_sync_runs" ? { code: "PGRST204" } : null);
    await expect(recordSm8CronVisit("org-1", NOW)).resolves.toBeUndefined();
  });

  it("reads back as the time, null when it never came, and undefined when it can't be read", async () => {
    runsRow = { last_cron_at: "2026-09-24T20:04:00Z" };
    expect(await readSm8LastCron("org-1")).toBe("2026-09-24T20:04:00Z");
    runsRow = { last_cron_at: null };
    expect(await readSm8LastCron("org-1")).toBeNull();
    runsRow = null;
    expect(await readSm8LastCron("org-1")).toBeNull();
    readFails.add("sm8_sync_runs");
    expect(await readSm8LastCron("org-1")).toBeUndefined();
  });

  it("rides the screen's status view — and is absent, not null, when unread", async () => {
    runsRow = { last_cron_at: "2026-09-24T20:04:00Z", last_finished_at: null, lease_until: null };
    expect((await listSm8SyncStatus("org-1")).lastCron).toBe("2026-09-24T20:04:00Z");
    runsRow = { last_cron_at: null };
    expect((await listSm8SyncStatus("org-1")).lastCron).toBeNull();
    readFails.add("sm8_sync_runs");
    expect("lastCron" in (await listSm8SyncStatus("org-1"))).toBe(false);
  });
});

/* ── one account per mirror ──

   2026-08-10: a live business account was connected by accident, and the
   owner reconnected the right one while the first backfill was still running.
   Nothing stopped the first run writing the wrong account into the fresh
   mirror, and a reconnect to a different account kept the old account's copy
   beside the new one. */
describe("the account behind the connection", () => {
  const vendorB = { uuid: "v-2", name: "Beta Cooling", email: null, timezoneName: "Australia/Sydney", currency: "AUD" };

  beforeEach(() => {
    jest.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("a different account from the one the mirror holds clears the old copy, switches sending off, and reads from the start", async () => {
    // the connection holds B (the callback saved it); the mirror still names A
    connRow = { tenant_id: "v-2", tenant_name: "Beta Cooling" };
    vendorRow = { uuid: "v-1", name: "Acme Air" };
    fetchSm8Vendor.mockResolvedValue({ ok: true, vendor: vendorB });
    stateRows = SM8_OBJECTS.map((s) => ({ object: s.object, cursor: "2026-07-01 00:00:00", backfill_done: true, rows_pulled: 5 }));

    const out = await runSm8Sync("org-1", "manual", NOW);

    for (const t of SM8_ACCOUNT_RESET_TABLES) expect(deletes).toContain(t);
    expect(deletes).toContain("sm8_vendor");
    expect(deletes).not.toContain("sm8_sync_runs");
    expect(updates.find((u) => u.table === "integration_connections")!.patch).toMatchObject({
      write_mode: "off",
      account_changed_from: "Acme Air",
    });
    expect(updates.find((u) => u.table === "sm8_writes")!.patch).toMatchObject({ status: "cancelled" });
    // the mirror's row now names the new account
    expect(upserts.find((u) => u.table === "sm8_vendor")!.payload).toMatchObject({ uuid: "v-2" });
    expect(out.note).toBe(SM8_ACCOUNT_SWITCHED);
  });

  it("the same account deletes nothing and leaves the owner's switch alone", async () => {
    await runSm8Sync("org-1", "manual", NOW);
    expect(deletes).toEqual([]);
    expect(updates.some((u) => "write_mode" in u.patch)).toBe(false);
  });

  it("never on a missing value: no mirror row yet is a first sync, not a switch", async () => {
    vendorRow = null;
    connRow = { tenant_id: null, tenant_name: null };
    fetchSm8Vendor.mockResolvedValue({ ok: true, vendor: vendorB });
    await runSm8Sync("org-1", "manual", NOW);
    expect(deletes).toEqual([]);
    expect(updates.some((u) => "write_mode" in u.patch)).toBe(false);
  });

  it("a connection already naming another account than this token reads is a reconnect mid-run: nothing written", async () => {
    // this run's token reads A; the owner has since reconnected to B
    connRow = { tenant_id: "v-2", tenant_name: "Beta Cooling" };
    const out = await runSm8Sync("org-1", "manual", NOW);
    expect(out.note).toBe(SM8_ACCOUNT_MOVED);
    expect(deletes).toEqual([]);
    expect(upserts.find((u) => u.table === "sm8_vendor")).toBeUndefined();
    expect(fetchSm8Page).not.toHaveBeenCalled();
  });

  it("a connection moved to another account mid-walk stops the run, and writes no more of the old one", async () => {
    let n = 0;
    fetchSm8Page.mockImplementation(async () => {
      n += 1;
      if (n === 2) connRow = { tenant_id: "v-2", tenant_name: "Beta Cooling" };
      return { ok: true, rows: [{ uuid: `u-${n}`, edit_date: "2026-07-28 09:00:00", active: 1 }], nextCursor: `c-${n}` };
    });

    const out = await runSm8Sync("org-1", "manual", NOW);
    expect(out.note).toBe(SM8_ACCOUNT_MOVED);
    expect(fetchSm8Page).toHaveBeenCalledTimes(2);
    // page one landed before the move; page two, and the object's state row, didn't
    expect(upserts.filter((u) => u.table === "sm8_staff")).toHaveLength(1);
    expect(stateUpsertFor("staff")).toBeUndefined();
  });

  /* Reads of the connection in a run of one account whose mirror is its own:
     1 which account (readSm8Accounts), 2 before sm8_vendor is written, then
     one before each page's rows and one before each object's state row. */
  it("a reconnect that lands before the mirror's own row is written stops the run before it", async () => {
    // the stale run must not write the old account over the sentinel
    onConnRead = (n) => {
      if (n === 1) connRow = { tenant_id: "v-2", tenant_name: "Beta Cooling" };
    };
    const out = await runSm8Sync("org-1", "manual", NOW);
    expect(out.note).toBe(SM8_ACCOUNT_MOVED);
    expect(upserts.find((u) => u.table === "sm8_vendor")).toBeUndefined();
    expect(fetchSm8Page).not.toHaveBeenCalled();
  });

  it("a disconnect mid-walk stops the run, and none of the page it read lands", async () => {
    fetchSm8Page.mockResolvedValue({ ok: true, rows: [{ uuid: "u-1", edit_date: "2026-07-28 09:00:00", active: 1 }], nextCursor: null });
    onConnRead = (n) => {
      if (n === 2) connRow = null;
    };
    const out = await runSm8Sync("org-1", "manual", NOW);
    expect(out.note).toMatch(/isn't connected/);
    expect(fetchSm8Page).toHaveBeenCalledTimes(1);
    const mirrorTables = new Set(SM8_OBJECTS.map((o) => o.table));
    expect(upserts.filter((u) => mirrorTables.has(u.table))).toEqual([]);
    expect(upserts.filter((u) => u.table === "sm8_sync_state")).toEqual([]);
  });

  it("a nameless connection taken by another account before this run could name it: nothing named, nothing cleared", async () => {
    /* The mirror names a third account — a switch that hadn't finished — so a
       run that went on would start clearing on behalf of an account the
       connection no longer holds. */
    connRow = { tenant_id: null, tenant_name: null };
    vendorRow = { uuid: "v-3", name: "Gamma Heating" };
    onConnRead = (n) => {
      if (n === 1) connRow = { tenant_id: "v-2", tenant_name: "Beta Cooling" };
    };
    const out = await runSm8Sync("org-1", "manual", NOW);
    expect(out.note).toBe(SM8_ACCOUNT_MOVED);
    expect(connRow).toMatchObject({ tenant_id: "v-2" });
    expect(updates.some((u) => "write_mode" in u.patch)).toBe(false);
    expect(deletes).toEqual([]);
    expect(upserts.find((u) => u.table === "sm8_vendor")).toBeUndefined();
  });

  it("a reconnect that lands after an object's last page, before its state row, keeps the old cursor out", async () => {
    /* A cursor of the old account's, with backfill_done, inherited by the new
       one would mean its history is never read. */
    fetchSm8Page.mockResolvedValue({ ok: true, rows: [{ uuid: "u-1", edit_date: "2026-07-28 09:00:00", active: 1 }], nextCursor: null });
    onConnRead = (n) => {
      if (n === 3) connRow = { tenant_id: "v-2", tenant_name: "Beta Cooling" };
    };
    const out = await runSm8Sync("org-1", "manual", NOW);
    expect(out.note).toBe(SM8_ACCOUNT_MOVED);
    expect(upserts.filter((u) => u.table === "sm8_staff")).toHaveLength(1);
    expect(upserts.filter((u) => u.table === "sm8_sync_state")).toEqual([]);
  });

  it("a reconnect while a page is being written: the old rows stay behind the sentinel, and the next run clears them", async () => {
    fetchSm8Page.mockResolvedValue({ ok: true, rows: [{ uuid: "u-a", edit_date: "2026-07-28 09:00:00", active: 1 }], nextCursor: null });
    onUpsert = (table) => {
      if (table === "sm8_staff") connRow = { tenant_id: "v-2", tenant_name: "Beta Cooling" };
    };
    const stale = await runSm8Sync("org-1", "manual", NOW);
    expect(stale.note).toBe(SM8_ACCOUNT_MOVED);
    expect(upserts.filter((u) => u.table === "sm8_staff")).toHaveLength(1);
    // no cursor for the object that was being written, and the sentinel still names the old account
    expect(upserts.filter((u) => u.table === "sm8_sync_state")).toEqual([]);
    expect(deletes).not.toContain("sm8_vendor");
    expect(upserts.filter((u) => u.table === "sm8_vendor").map((u) => (u.payload as Row).uuid)).toEqual(["v-1"]);

    // the next run, under the new grant, finds the old copy and clears it before reading
    onUpsert = null;
    upserts.length = 0;
    fetchSm8Vendor.mockResolvedValue({ ok: true, vendor: vendorB });
    fetchSm8Page.mockResolvedValue(emptyPage);
    const next = await runSm8Sync("org-1", "manual", NOW);
    expect(deletes).toContain("sm8_staff");
    expect(deletes).toContain("sm8_vendor");
    expect(upserts.find((u) => u.table === "sm8_vendor")!.payload).toMatchObject({ uuid: "v-2" });
    expect(next.note).toBe(SM8_ACCOUNT_SWITCHED);
  });

  it.each([...SM8_ACCOUNT_RESET_TABLES, "documents"])(
    "a clear of %s that fails stops the run before any page, and keeps the sentinel",
    async (table) => {
      jest.spyOn(console, "error").mockImplementation(() => {});
      connRow = { tenant_id: "v-2", tenant_name: "Beta Cooling" };
      vendorRow = { uuid: "v-1", name: "Acme Air" };
      fetchSm8Vendor.mockResolvedValue({ ok: true, vendor: vendorB });
      deleteFails.add(table);
      const out = await runSm8Sync("org-1", "manual", NOW);
      expect(out.note).toBe(SM8_ACCOUNT_UNCLEARED);
      expect(fetchSm8Page).not.toHaveBeenCalled();
      expect(deletes).not.toContain("sm8_vendor");
      expect(upserts.find((u) => u.table === "sm8_vendor")).toBeUndefined();
    }
  );

  it.each(["integration_connections", "sm8_vendor"])(
    "a failed read of %s names, clears and writes nothing",
    async (table) => {
      jest.spyOn(console, "error").mockImplementation(() => {});
      connRow = { tenant_id: null, tenant_name: null };
      readFails.add(table);
      const out = await runSm8Sync("org-1", "manual", NOW);
      expect(out.note).toBe(SM8_ACCOUNT_UNREAD);
      expect(updates.filter((u) => u.table === "integration_connections")).toEqual([]);
      expect(deletes).toEqual([]);
      expect(upserts.find((u) => u.table === "sm8_vendor")).toBeUndefined();
      expect(fetchSm8Page).not.toHaveBeenCalled();
    }
  );

  it("a disconnect kept the record of the old account, so connecting another one clears the old copy", async () => {
    // Disconnect deleted the connection row but kept sm8_vendor; the new grant is nameless
    connRow = { tenant_id: null, tenant_name: null };
    vendorRow = { uuid: "v-1", name: "Acme Air" };
    fetchSm8Vendor.mockResolvedValue({ ok: true, vendor: vendorB });
    const out = await runSm8Sync("org-1", "manual", NOW);
    expect(connRow).toMatchObject({ tenant_id: "v-2", write_mode: "off", account_changed_from: "Acme Air" });
    expect(deletes).toEqual(expect.arrayContaining(["documents", "job_photo_readings", "job_photo_favourites", "sm8_vendor"]));
    expect(out.note).toBe(SM8_ACCOUNT_SWITCHED);
  });
});

/* ── the callback's clear, and the sync that follows it ──

   The callback clears the old account's copy before its first sync, and it
   does so under the same lease the walker holds: a run still reading the old
   account under the old grant must not land a page after its table went. */
describe("the callback's clear is serialised with the walker", () => {
  const vendorB = { uuid: "v-2", name: "Beta Cooling", email: null, timezoneName: "Australia/Sydney", currency: "AUD" };
  const from = { uuid: "v-1", name: "Acme Air" };

  beforeEach(() => {
    connRow = { tenant_id: "v-2", tenant_name: "Beta Cooling" };
    jest.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("a run holding the lease means the clear is skipped: nothing deleted, nothing recorded", async () => {
    claimResult = [];
    expect(await switchSm8AccountUnderLease("org-1", { to: vendorB, from, now: NOW })).toEqual({ ok: false, reason: "busy" });
    expect(deletes).toEqual([]);
    expect(updates.filter((u) => u.table === "integration_connections")).toEqual([]);
  });

  it("a free lease is taken for the clear and given back, without passing for a sync", async () => {
    const r = await switchSm8AccountUnderLease("org-1", { to: vendorB, from, now: NOW });
    expect(r).toEqual({ ok: true, cancelled: 0, cleared: true });
    const runs = updates.filter((u) => u.table === "sm8_sync_runs");
    expect(runs[0].patch).toEqual({ lease_until: new Date(NOW + 120_000).toISOString() });
    expect(runs[runs.length - 1].patch).toEqual({ lease_until: null });
    expect(deletes).toContain("sm8_vendor");
    // the clear happened while the lease was held
    const order = [...updates.map((u) => u.table)];
    expect(order.indexOf("sm8_sync_runs")).toBeLessThan(order.indexOf("integration_connections"));
  });

  it("the first sync waits for a run under the old grant to stop, then runs", async () => {
    let claims = 0;
    claimResult = [];
    onUpsert = (table) => {
      if (table === "sm8_sync_runs" && ++claims === 3) claimResult = [{ calls_today: 0, calls_day: null }];
    };
    const out = await runSm8SyncWhenFree("org-1", "connect", { waitMs: 0 });
    expect(claims).toBe(3);
    expect(out.ran).toBe(true);
  });

  it("gives up after its last try, with the busy answer", async () => {
    claimResult = [];
    const out = await runSm8SyncWhenFree("org-1", "connect", { tries: 2, waitMs: 0 });
    expect(out).toMatchObject({ ran: false, note: SM8_SYNC_BUSY });
    expect(sm8AccessResult).not.toHaveBeenCalled();
  });

  it("doesn't wait on an answer that isn't busy", async () => {
    sm8AccessResult.mockResolvedValue({ ok: false, reason: "reauth" });
    await runSm8SyncWhenFree("org-1", "connect", { waitMs: 0 });
    expect(sm8AccessResult).toHaveBeenCalledTimes(1);
  });
});
