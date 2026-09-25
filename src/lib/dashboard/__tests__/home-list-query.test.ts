/* The list's own reads: which Work Orders were won and never booked, and
   which maintenance visits have no day.

   The fake below APPLIES the filters it is handed — eq, is, in, lte, gte, the
   `.or()` tree, ordering and ranges — to rows in memory, the way the database
   would, so each test asserts what comes back rather than which methods were
   called. A fake that only recorded calls would pass a query that asked the
   wrong question. */

type Row = Record<string, unknown>;
type Call = {
  table: string;
  columns?: string;
  eq: Record<string, unknown>;
  is: Record<string, unknown>;
  in: Record<string, unknown[]>;
  or?: string;
  range?: [number, number];
};

let rows: Record<string, Row[]> = {};
let failing = new Set<string>();
const calls: Call[] = [];

/** `a.gte.x,and(b.is.null,c.gte.y)` → a predicate. Only what the loader uses. */
function orPredicate(expr: string): (r: Row) => boolean {
  const split = (s: string): string[] => {
    const out: string[] = [];
    let depth = 0;
    let cur = "";
    for (const ch of s) {
      if (ch === "(") depth++;
      if (ch === ")") depth--;
      if (ch === "," && depth === 0) {
        out.push(cur);
        cur = "";
      } else cur += ch;
    }
    out.push(cur);
    return out;
  };
  const term = (t: string): ((r: Row) => boolean) => {
    if (t.startsWith("and(")) {
      const parts = split(t.slice(4, -1)).map(term);
      return (r) => parts.every((p) => p(r));
    }
    const [col, op, ...rest] = t.split(".");
    const val = rest.join(".");
    if (op === "is" && val === "null") return (r) => r[col] == null;
    if (op === "gte") return (r) => r[col] != null && String(r[col]) >= val;
    if (op === "lte") return (r) => r[col] != null && String(r[col]) <= val;
    if (op === "eq") return (r) => String(r[col]) === val;
    throw new Error(`the fake can't read ${t}`);
  };
  const terms = split(expr).map(term);
  return (r) => terms.some((p) => p(r));
}

const table = (name: string) => {
  const call: Call = { table: name, eq: {}, is: {}, in: {} };
  calls.push(call);
  const filters: ((r: Row) => boolean)[] = [];
  let order: string | null = null;
  let asc = true;
  let limit: number | null = null;
  const chain: Record<string, unknown> = {};
  chain.select = (cols: string) => {
    call.columns = cols;
    return chain;
  };
  chain.eq = (col: string, val: unknown) => {
    call.eq[col] = val;
    filters.push((r) => r[col] === val);
    return chain;
  };
  chain.is = (col: string, val: unknown) => {
    call.is[col] = val;
    filters.push((r) => (val === null ? r[col] == null : r[col] === val));
    return chain;
  };
  chain.in = (col: string, vals: unknown[]) => {
    call.in[col] = vals;
    filters.push((r) => vals.includes(r[col]));
    return chain;
  };
  chain.lte = (col: string, val: string) => {
    filters.push((r) => r[col] != null && String(r[col]) <= val);
    return chain;
  };
  chain.gte = (col: string, val: string) => {
    filters.push((r) => r[col] != null && String(r[col]) >= val);
    return chain;
  };
  chain.or = (expr: string) => {
    call.or = expr;
    filters.push(orPredicate(expr));
    return chain;
  };
  chain.order = (col: string, opts?: { ascending?: boolean }) => {
    order = col;
    asc = opts?.ascending ?? true;
    return chain;
  };
  chain.limit = (n: number) => {
    limit = n;
    return chain;
  };
  chain.range = (from: number, to: number) => {
    call.range = [from, to];
    return chain;
  };
  chain.then = (res: (v: { data: unknown; error: unknown }) => unknown) => {
    if (failing.has(name)) return Promise.resolve({ data: null, error: { message: "down" } }).then(res);
    let data = (rows[name] ?? []).filter((r) => filters.every((f) => f(r)));
    if (order) {
      const col = order;
      data = [...data].sort((a, b) => String(a[col]).localeCompare(String(b[col])) * (asc ? 1 : -1));
    }
    // Supabase answers a thousand rows at most, whatever was asked for
    const [from, to] = call.range ?? [0, Math.min(limit ?? 1000, 1000) - 1];
    data = data.slice(from, Math.min(to, from + 999) + 1);
    return Promise.resolve({ data, error: null }).then(res);
  };
  return chain;
};

jest.mock("@/lib/supabase-server", () => ({ supabaseAdmin: { from: (n: string) => table(n) } }));

import { loadHomeList, loadJobsToBook, wonSinceFilter, type HomeListContext } from "../home-list-query";
import type { Capability } from "@/lib/permissions";

const DAY = "2026-09-25";
const ORG = "org-1";

const ctx = (over: Partial<HomeListContext> = {}, ...caps: Capability[]): HomeListContext => ({
  orgId: ORG,
  caps: new Set<Capability>(caps.length ? caps : ["workboard"]),
  railDay: DAY,
  tz: "Australia/Sydney",
  names: new Map([
    ["s2", "Callum Reid"],
    ["s3", "Leo"],
    ["s4", "  "],
  ]),
  shared: { expiry: { warnDays: 21 } },
  connected: true,
  ...over,
});

const workOrder = (uuid: string, over: Row = {}): Row => ({
  org_id: ORG,
  uuid,
  generated_job_id: uuid.toUpperCase(),
  status: "Work Order",
  active: 1,
  company_uuid: null,
  geo_city: "Oatley",
  category_uuid: null,
  job_description: "Supply and install\n a split system",
  date: "2026-09-01 09:00:00",
  quote_date: null,
  completion_date: null,
  work_order_date: "2026-09-02 10:00:00",
  total_invoice_amount: "8470.0000",
  ...over,
});

const activity = (uuid: string, job: string, over: Row = {}): Row => ({
  org_id: ORG,
  uuid,
  job_uuid: job,
  activity_was_scheduled: 1,
  active: 1,
  start_date: "2026-01-05 08:00:00",
  ...over,
});

beforeEach(() => {
  rows = {};
  failing = new Set();
  calls.length = 0;
});

const of = (t: string) => calls.filter((c) => c.table === t);
const opts = { money: false, sm8: true };

describe("won work orders, never booked", () => {
  it("asks for work won since 90 days before the day, by the day it was won", () => {
    expect(wonSinceFilter("2026-06-27")).toBe(
      "work_order_date.gte.2026-06-27,and(work_order_date.is.null,date.gte.2026-06-27)",
    );
  });

  it("keeps only active Work Orders won inside 90 days, dating by `date` where ServiceM8 set no won day", async () => {
    rows.sm8_jobs = [
      workOrder("won"),
      workOrder("raised", { work_order_date: null, date: "2026-08-15 09:00:00" }),
      workOrder("edge", { work_order_date: "2026-06-27 07:00:00" }),
      // won long ago, though raised lately: the won day rules
      workOrder("long-won", { work_order_date: "2026-06-26 16:00:00", date: "2026-09-01 09:00:00" }),
      workOrder("long-raised", { work_order_date: null, date: "2026-06-01 09:00:00" }),
      workOrder("quote", { status: "Quote" }),
      workOrder("done", { status: "Completed" }),
      workOrder("deleted", { active: 0 }),
      workOrder("elsewhere", { org_id: "org-2" }),
    ];
    const { wins } = await loadJobsToBook(ORG, DAY, opts);
    expect(wins.map((w) => [w.job.remoteId, w.wonOn]).sort()).toEqual([
      ["edge", "2026-06-27"],
      ["raised", "2026-08-15"],
      ["won", "2026-09-02"],
    ]);
    expect(of("sm8_jobs")[0].eq).toEqual({ org_id: ORG, status: "Work Order", active: 1 });
  });

  it("drops a job with any scheduled block, past or future; time on site and a deleted block are not bookings", async () => {
    rows.sm8_jobs = [workOrder("booked-past"), workOrder("booked-future"), workOrder("on-site"), workOrder("unbooked"), workOrder("deleted-block")];
    rows.sm8_job_activities = [
      activity("a1", "booked-past", { start_date: "2026-01-05 08:00:00" }),
      activity("a2", "booked-future", { start_date: "2026-12-01 08:00:00" }),
      activity("a3", "on-site", { activity_was_scheduled: 0 }),
      activity("a4", "deleted-block", { active: 0 }),
      activity("a5", "unbooked", { org_id: "org-2" }),
    ];
    const { wins } = await loadJobsToBook(ORG, DAY, opts);
    expect(wins.map((w) => w.job.remoteId).sort()).toEqual(["deleted-block", "on-site", "unbooked"]);
  });

  /* A job booked week after week holds more blocks than one answer carries;
     read only the first thousand and a booked job reads as never booked. */
  it("reads every page of bookings, so a job on the second page still counts as booked", async () => {
    rows.sm8_jobs = [workOrder("busy"), workOrder("late-page")];
    rows.sm8_job_activities = [
      ...Array.from({ length: 1000 }, (_, i) => activity(`a${String(i).padStart(4, "0")}`, "busy")),
      activity("z-last", "late-page"),
    ];
    const { wins } = await loadJobsToBook(ORG, DAY, opts);
    expect(wins).toEqual([]);
    expect(of("sm8_job_activities").map((c) => c.range)).toEqual([
      [0, 999],
      [1000, 1999],
    ]);
  });

  it("says nothing rather than something wrong when the bookings can't be read", async () => {
    rows.sm8_jobs = [workOrder("won")];
    failing.add("sm8_job_activities");
    const spy = jest.spyOn(console, "error").mockImplementation(() => {});
    const { wins } = await loadJobsToBook(ORG, DAY, opts);
    spy.mockRestore();
    expect(wins).toEqual([]);
  });

  it("builds the same mirror row the board opens the card on: client, category, one line", async () => {
    rows.sm8_jobs = [workOrder("won", { company_uuid: "c1", category_uuid: "k1" })];
    rows.sm8_companies = [{ org_id: ORG, uuid: "c1", name: "Coogee Strata" }];
    rows.sm8_categories = [{ org_id: ORG, uuid: "k1", name: "Install ", colour: "e7b5ff" }];
    const [{ job }] = (await loadJobsToBook(ORG, DAY, opts)).wins;
    expect(job).toEqual({
      remoteId: "won",
      jobNumber: "WON",
      status: "Work Order",
      clientName: "Coogee Strata",
      description: "Supply and install a split system",
      suburb: "Oatley",
      categoryName: "Install",
      categoryColour: "#e7b5ff",
      date: "2026-09-01 09:00:00",
      quoteDate: null,
      completionDate: null,
      nextBooking: null,
      money: null,
      paidCents: 0,
    });
  });

  it("reads the money only with the grant", async () => {
    rows.sm8_jobs = [workOrder("won")];
    rows.sm8_job_payments = [
      { org_id: ORG, job_uuid: "won", amount: "1000.0000", active: 1 },
      { org_id: ORG, job_uuid: "won", amount: "500.0000", active: 0 },
    ];

    const without = await loadJobsToBook(ORG, DAY, { money: false, sm8: true });
    expect(of("sm8_jobs")[0].columns).not.toContain("total_invoice_amount");
    expect(of("sm8_job_payments")).toHaveLength(0);
    expect(without.wins[0].job.money).toBeNull();

    calls.length = 0;
    const withMoney = await loadJobsToBook(ORG, DAY, { money: true, sm8: true });
    expect(of("sm8_jobs")[0].columns).toContain("total_invoice_amount");
    expect(withMoney.wins[0].job.money?.valueCents).toBe(847_000);
    expect(withMoney.wins[0].job.paidCents).toBe(100_000);
  });

  it("asks nothing about work orders in a workspace without ServiceM8", async () => {
    rows.sm8_jobs = [workOrder("won")];
    const { wins } = await loadJobsToBook(ORG, DAY, { money: true, sm8: false });
    expect(wins).toEqual([]);
    expect(of("sm8_jobs")).toHaveLength(0);
    expect(of("maintenance_visits")).toHaveLength(1);
  });
});

describe("services with no day", () => {
  const visit = (id: string, over: Row = {}): Row => ({
    org_id: ORG,
    id,
    agreement_id: "ag1",
    due_date: "2026-10-05",
    status: "upcoming",
    remote_id: null,
    booked_date: null,
    ...over,
  });

  it("keeps only open visits with no day and no ServiceM8 job, due by the day plus 56, on an active agreement", async () => {
    rows.maintenance_visits = [
      visit("open"),
      visit("late", { due_date: "2026-08-01" }),
      visit("edge", { due_date: "2026-11-20" }),
      visit("marked-booked", { status: "booked" }),
      visit("too-far", { due_date: "2026-11-21" }),
      visit("linked", { remote_id: "sm8-job" }),
      visit("placed", { booked_date: "2026-10-01" }),
      visit("done", { status: "done" }),
      visit("skipped", { status: "skipped" }),
      visit("paused", { agreement_id: "ag2" }),
      visit("elsewhere", { org_id: "org-2" }),
    ];
    rows.maintenance_agreements = [
      { org_id: ORG, id: "ag1", client_name: "Bayview Apartments", label: "annual service", status: "active" },
      { org_id: ORG, id: "ag2", client_name: "Northgate", label: "quarterly clean", status: "paused" },
    ];
    const { visits } = await loadJobsToBook(ORG, DAY, opts);
    expect(visits.map((v) => v.id)).toEqual(["late", "open", "marked-booked", "edge"]);
    expect(visits[0]).toEqual({ id: "late", clientName: "Bayview Apartments", label: "annual service", dueDate: "2026-08-01" });
    // unlinked and unplaced asked as IS NULL — a neq would drop exactly these
    expect(of("maintenance_visits")[0].is).toEqual({ remote_id: null, booked_date: null });
    expect(of("maintenance_agreements")[0].eq).toEqual({ org_id: ORG });
  });

  it("says nothing when the visits can't be read", async () => {
    rows.maintenance_visits = [visit("open")];
    failing.add("maintenance_visits");
    const spy = jest.spyOn(console, "error").mockImplementation(() => {});
    const { visits } = await loadJobsToBook(ORG, DAY, opts);
    spy.mockRestore();
    expect(visits).toEqual([]);
  });
});

describe("loadHomeList", () => {
  it("reads nothing without the board, and offers nothing the board gates", async () => {
    rows.sm8_jobs = [workOrder("won")];
    rows.maintenance_visits = [{ org_id: ORG, id: "v", agreement_id: "ag1", due_date: DAY, status: "upcoming" }];
    const reads = await loadHomeList(ctx({}, "assets_all", "workboard_money", "workboard_manage"));
    expect(calls).toHaveLength(0);
    expect(reads).toMatchObject({
      wins: [],
      visits: [],
      caps: { assetsAll: true, placeVisits: false, money: false, sm8: true },
    });
  });

  it("carries the day, the zone, the org's window and first names", async () => {
    const reads = await loadHomeList(ctx());
    expect(reads).toMatchObject({ day: DAY, tz: "Australia/Sydney", warnDays: 21 });
    expect(reads.names).toEqual({ s2: "Callum", s3: "Leo" });
  });

  it("maps the grants: the board's manage and money grants ride on the board", async () => {
    const reads = await loadHomeList(ctx({}, "workboard", "workboard_manage", "workboard_money"));
    expect(reads.caps).toEqual({ assetsAll: false, placeVisits: true, money: true, sm8: true });
  });

  it("takes the workspace's word for ServiceM8, and reads no work orders without one", async () => {
    rows.sm8_jobs = [workOrder("won")];
    const off = await loadHomeList(ctx({ connected: false }));
    expect(off.caps.sm8).toBe(false);
    expect(of("sm8_jobs")).toHaveLength(0);
    expect(off.wins).toEqual([]);
  });

  /* The zone is not the word. `sm8VendorOf` answers a failed read as
     connected with no zone, and an account row can hold no zone at all: a
     connected workspace keeps its won jobs either way. */
  it("keeps a connected workspace's won jobs when its zone is unknown", async () => {
    rows.sm8_jobs = [workOrder("won")];
    const reads = await loadHomeList(ctx({ tz: null, connected: true }));
    expect(reads.caps.sm8).toBe(true);
    expect(reads.wins.map((w) => w.job.remoteId)).toEqual(["won"]);
  });
});
