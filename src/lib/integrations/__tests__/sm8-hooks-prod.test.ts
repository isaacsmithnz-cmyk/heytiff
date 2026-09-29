/**
 * @jest-environment node
 */

/* PRODUCTION IS UNCHANGED until SM8_WEBHOOKS=1 on a Production deployment
   (two-way phase 4). This suite holds that, and each PR of the phase adds
   its paths to it: with the env unset, the route answers 404 with no
   database call, the callback and a disconnect send nothing to
   /webhook_subscriptions, the cron and freshen neither ensure nor drain,
   and the meter's `hook` lane takes no turn.

   PR A: the switch itself, and no caller of the `hook` lane yet.

   PR C: the callback, a disconnect, the page-load freshen and the nightly
   cron, each run for real with the env as production has it today, make
   exactly today's calls: the same collaborators in the same order, the
   same database reads, no request at all, and the subscribing module never
   so much as loaded. And the subscriber itself, on the `hook` lane, reads
   and asks nothing while the switch is anything but on.

   PR D: the backstops. The page-load freshen and the nightly cron, off,
   never load the drain, so no queue is read, no lease is taken as `hook`
   and nothing is asked of ServiceM8; and the drain itself, on the `hook`
   lane, reads and writes nothing while the switch is anything but on.

   PR E: the route. Off, every request is 404 before a byte is read: no
   lookup, no after(), the drain never loaded. `gone` is the one difference
   the switch allows: a well-formed hook path answers 410, and still reads
   nothing.

   PR F: the owner's ServiceM8 screen, its loader run for real, reads what
   it read and hands the screen the props it handed it — no read of live
   updates, and no line — and the nightly cron checks no health. */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { NextRequest } from "next/server";
import { sm8WebhooksState } from "../sm8-hooks-switch";

/* ── everything the four entry points reach, recorded ── */

/** The collaborators each entry point called, in order. */
const calls: string[] = [];
/** Every table and function the database was asked about. */
const touched: string[] = [];
/* a declaration, so the hoisted mocks below can use it */
function rec(name: string, value: unknown = undefined) {
  return async (...args: unknown[]) => {
    calls.push(`${name}${typeof args[1] === "string" ? `:${args[1]}` : ""}`);
    return typeof value === "function" ? (value as () => unknown)() : value;
  };
}

/* the callback's branches: which account ServiceM8 names, and which this
   workspace had (set per case; read when called) */
const ACME = { uuid: "acct-1c4b", name: "Acme Air", email: null, timezoneName: "Australia/Sydney", currency: "AUD" };
const BETA = { uuid: "acct-9e02", name: "Beta Cooling", email: null, timezoneName: "Australia/Sydney", currency: "AUD" };
const HAD_ACME = {
  ok: true,
  connected: { tenantId: "acct-1c4b", tenantName: "Acme Air" },
  mirrored: { uuid: "acct-1c4b", name: "Acme Air" },
};
let vendorAnswer: unknown = { ok: true, vendor: ACME };
let accountsAnswer: unknown = HAD_ACME;

jest.mock("@/lib/supabase-server", () => {
  const chain = (table: string): unknown =>
    new Proxy(
      {},
      {
        get(_t, prop) {
          if (prop === "then") {
            return (res: (v: unknown) => unknown) =>
              Promise.resolve({ data: table === "integration_connections" ? { status: "connected" } : null, error: null }).then(res);
          }
          if (prop === "maybeSingle" || prop === "single") {
            return async () => ({ data: table === "integration_connections" ? { status: "connected" } : null, error: null });
          }
          return () => chain(table);
        },
      }
    );
  return {
    supabaseAdmin: {
      from: (table: string) => {
        touched.push(table);
        return chain(table);
      },
      rpc: async (name: string) => {
        touched.push(`rpc:${name}`);
        return { data: null, error: null };
      },
    },
  };
});

/* the subscribing module: its factory running at all is a failure here */
let hooksLoaded = false;
jest.mock("../sm8-hooks", () => {
  hooksLoaded = true;
  return jest.requireActual("../sm8-hooks");
});

/* the drain (PR D): the same — loading it at all, off, is a failure */
let drainLoaded = false;
jest.mock("../sm8-hook-drain", () => {
  drainLoaded = true;
  return jest.requireActual("../sm8-hook-drain");
});

const scheduled: (() => unknown)[] = [];
jest.mock("next/server", () => ({
  ...jest.requireActual("next/server"),
  after: (fn: () => unknown) => {
    calls.push("after");
    scheduled.push(fn);
  },
}));
jest.mock("next/cache", () => ({ revalidatePath: () => {} }));
jest.mock("@/lib/auth0", () => ({
  auth0: { getSession: async () => ({ orgId: "org-5d21", user: { sub: "auth0|owner-1" } }) },
}));
jest.mock("@/lib/permissions-server", () => ({ getDbRole: async () => "owner" }));
jest.mock("../sm8", () => ({
  sm8Config: () => ({ clientId: "id", clientSecret: "cs", redirectUri: "https://app.test/cb" }),
  exchangeSm8Code: rec("exchange", { ok: true, tokens: { accessToken: "at", refreshToken: "rt", scope: "vendor", expiresIn: 3600 } }),
  fetchSm8Vendor: rec("vendor", () => vendorAnswer),
}));
jest.mock("../sm8-store", () => ({
  readSm8Accounts: rec("accounts", () => accountsAnswer),
  saveSm8Connection: rec("save", { ok: true }),
  disconnectSm8: rec("disconnectSm8", { cancelled: [], inFlight: 0 }),
  sm8AccessResult: rec("access", { ok: false, reason: "not_connected" }),
  readSm8AccountChange: rec("accountChange", null),
}));
jest.mock("../store", () => ({
  countConnectionsElsewhere: rec("elsewhere", 0),
  disconnectXero: rec("xero"),
  getConnectionView: rec("connection", {
    provider: "servicem8",
    status: "connected",
    tenantId: "acct-1c4b",
    tenantName: "Acme Air",
    tenants: [],
    scopes: ["vendor"],
    missing: [],
    connectedAt: "2026-09-01T00:00:00.000Z",
    connectedByName: null,
    lastError: null,
    writeMode: "live",
  }),
}));
/* the owner's ServiceM8 screen (PR F): its loader, for real; what it hands
   the screen is read off the element */
jest.mock("@/components/integrations/servicem8-screen", () => ({ Servicem8Screen: () => null }));
jest.mock("../sm8-read", () => ({ readSm8Vendor: rec("readVendor", { ok: true, data: { name: "Acme Air", timezoneName: null } }) }));
jest.mock("@/app/actions/staff-import", () => ({ getSm8PeopleData: rec("people", null) }));
jest.mock("../sm8-sync", () => ({
  runSm8SyncWhenFree: rec("whenFree", { ran: true, note: "", pagesUsed: 1, rowsPulled: 0, complete: true }),
  switchSm8AccountUnderLease: rec("switch", { ok: true, cancelled: 0, cleared: true }),
  runSm8Sync: rec("sync", { ran: true, note: "", pagesUsed: 1, rowsPulled: 0, complete: true }),
  sm8SyncIsStale: rec("stale", true),
  sweepableSm8Orgs: rec("sweepable", ["org-5d21"]),
  recordSm8CronVisit: rec("visit"),
  listSm8SyncStatus: rec("syncStatus", { objects: [], lastRun: null }),
}));
jest.mock("../sm8-writes", () => ({
  runSm8Writes: rec("writes", { done: 0, sent: 0, trial: 0, failed: 0, again: 0, lost: 0, stopped: null }),
  sm8WritesDue: rec("writesDue", true),
  sm8WritesEnabled: () => true,
  orgsWithDueSm8Writes: rec("dueOrgs", ["org-5d21"]),
  clearSm8NoteText: rec("clearNotes", 0),
  clearDisconnectedSm8NoteText: rec("clearGone", 0),
  readSm8WriteState: rec("writeState", { readable: false }),
  countSm8Queue: rec("queue", { waiting: 0, failed: 0, waitingKinds: { attachment: 0, note: 0, booking: 0 } }),
  countSm8WritesSentLately: rec("sentLately", 0),
  listRecentSm8Writes: rec("recent", []),
  retryFailedSm8Writes: rec("retry"),
  setSm8WriteKind: rec("kind"),
  setSm8WriteMode: rec("mode"),
  sm8WriteKindsEnabled: () => ["attachment"],
}));
jest.mock("../sm8-write-cancel", () => ({ clearSm8NoteText: rec("clearNotes", 0), sm8NoteTextDue: rec("notesDue", false) }));
jest.mock("../sm8-press", () => ({ sm8PressFromSession: async () => null }));
jest.mock("../sm8-file-cache", () => ({
  EVICT_BUDGET_MS: 20_000,
  evictStaleSm8Files: rec("evict", { evicted: 0, bytes: 0, starred: 0, failed: 0, capped: false, skipped: false }),
}));
jest.mock("../cron-auth", () => ({ authorised: () => true }));
jest.mock("@/lib/dashboard/mention-settle", () => ({ settleMentionAsks: rec("asks", { reads: 0, tasks: 0 }) }));

import { GET as callbackGET } from "@/app/api/integrations/servicem8/callback/route";
import { GET as cronGET } from "@/app/api/cron/sm8-sync/route";
import { disconnectServiceM8Action } from "@/app/actions/integrations";
import { freshenSm8AfterResponse } from "../sm8-freshness";
import { GET as hookGET, POST as hookPOST } from "@/app/api/integrations/servicem8/webhook/[hook]/route";
import Servicem8IntegrationPage from "@/app/dashboard/admin/integrations/servicem8/page";
import type { ReactElement } from "react";

const env = { ...process.env };
const realFetch = global.fetch;
const fetchSpy = jest.fn(async () => new Response("[]"));
beforeEach(() => {
  vendorAnswer = { ok: true, vendor: ACME };
  accountsAnswer = HAD_ACME;
  calls.length = 0;
  touched.length = 0;
  scheduled.length = 0;
  fetchSpy.mockClear();
  global.fetch = fetchSpy as unknown as typeof fetch;
});
afterEach(() => {
  process.env = { ...env };
});
afterAll(() => {
  global.fetch = realFetch;
});

function set(vercel: string | undefined, hooks: string | undefined) {
  if (vercel === undefined) delete process.env.VERCEL_ENV;
  else process.env.VERCEL_ENV = vercel;
  if (hooks === undefined) delete process.env.SM8_WEBHOOKS;
  else process.env.SM8_WEBHOOKS = hooks;
}

describe("the switch", () => {
  it("is off anywhere but Production, whatever SM8_WEBHOOKS says", () => {
    for (const vercel of [undefined, "preview", "development", "", "Production"]) {
      for (const hooks of [undefined, "", "0", "1", "gone", "true"]) {
        set(vercel, hooks);
        expect([vercel, hooks, sm8WebhooksState()]).toEqual([vercel, hooks, "off"]);
      }
    }
  });

  it("is off on Production unless it says exactly 1 or gone", () => {
    for (const hooks of [undefined, "", "0", "true", "on", " 1", "1 ", "GONE", "yes"]) {
      set("production", hooks);
      expect([hooks, sm8WebhooksState()]).toEqual([hooks, "off"]);
    }
  });

  it("is on with 1, and gone with gone, on Production", () => {
    set("production", "1");
    expect(sm8WebhooksState()).toBe("on");
    set("production", "gone");
    expect(sm8WebhooksState()).toBe("gone");
  });
});

/* ── PR C: the four entry points, as production has them today ── */

/** Production as it is: on Production, SM8_WEBHOOKS unset, sending on for
    files, notes and bookings. And every other way the switch can be off. */
const TODAY: [string | undefined, string | undefined][] = [
  ["production", undefined],
  ["production", "gone"],
  ["production", "0"],
  ["preview", "1"],
  [undefined, "1"],
];

async function underEach(run: () => Promise<void>): Promise<{ calls: string[]; touched: string[] }[]> {
  const seen: { calls: string[]; touched: string[] }[] = [];
  for (const [vercel, hooks] of TODAY) {
    set(vercel, hooks);
    process.env.SM8_WRITES = "attachment,note,booking";
    process.env.APP_BASE_URL = "https://app.test";
    calls.length = 0;
    touched.length = 0;
    scheduled.length = 0;
    await run();
    for (const fn of scheduled.splice(0)) await fn();
    seen.push({ calls: [...calls], touched: [...touched] });
  }
  return seen;
}

function expectToday(seen: { calls: string[]; touched: string[] }[], today: { calls: string[]; touched: string[] }) {
  for (const s of seen) expect(s).toEqual(today);
  expect(fetchSpy).not.toHaveBeenCalled();
  expect(hooksLoaded).toBe(false);
  expect(drainLoaded).toBe(false);
}

describe("with the switch off, each entry point makes today's calls exactly", () => {
  it("the connect callback: no rotation owed, and behind the response the sync slice alone", async () => {
    const seen = await underEach(async () => {
      const res = await callbackGET(
        new NextRequest("https://app.test/api/integrations/servicem8/callback?code=c-1&state=s-1", {
          headers: { cookie: "servicem8_oauth_state=s-1:org-5d21" },
        })
      );
      expect(res.headers.get("location")).toBe("https://app.test/dashboard/admin/integrations/servicem8?connected=1");
    });
    expectToday(seen, {
      calls: ["exchange:c-1", "vendor", "accounts", "elsewhere:servicem8", "save", "after", "whenFree:connect"],
      touched: [],
    });
  });

  const connect = (expected: string) => async () => {
    const res = await callbackGET(
      new NextRequest("https://app.test/api/integrations/servicem8/callback?code=c-1&state=s-1", {
        headers: { cookie: "servicem8_oauth_state=s-1:org-5d21" },
      })
    );
    expect(res.headers.get("location")).toBe(`https://app.test/dashboard/admin/integrations/servicem8${expected}`);
  };

  it("the connect callback, a change of account: the old copy cleared under the lease, and the slice alone", async () => {
    vendorAnswer = { ok: true, vendor: BETA };
    const seen = await underEach(connect("?connected=1&switched=1"));
    expectToday(seen, {
      calls: ["exchange:c-1", "vendor", "accounts", "elsewhere:servicem8", "save", "switch", "after", "whenFree:connect"],
      touched: [],
    });
  });

  it("the connect callback, an account ServiceM8 wouldn't name: stored nameless, and the slice alone", async () => {
    vendorAnswer = { ok: false, unauthorized: false };
    accountsAnswer = { ok: true, connected: null, mirrored: null };
    const seen = await underEach(connect("?connected=1"));
    expectToday(seen, {
      calls: ["exchange:c-1", "vendor", "vendor", "accounts", "save", "after", "whenFree:connect"],
      touched: [],
    });
  });

  it("a disconnect: nothing sent to ServiceM8 before the wipe", async () => {
    const seen = await underEach(async () => {
      expect((await disconnectServiceM8Action()).ok).toBe(true);
    });
    expectToday(seen, { calls: ["disconnectSm8"], touched: [] });
  });

  it("the page-load freshen: no reconcile, no read of live updates' tables", async () => {
    const seen = await underEach(async () => {
      freshenSm8AfterResponse("org-5d21");
    });
    expectToday(seen, {
      calls: ["after", "notesDue", "writesDue", "writes:kick", "stale", "sync:kick", "asks"],
      touched: ["integration_connections"],
    });
  });

  it("the nightly cron: no reconcile, no tidying, and the answer as it was", async () => {
    const bodies: unknown[] = [];
    const seen = await underEach(async () => {
      const res = await cronGET(new Request("https://app.test/api/cron/sm8-sync", { headers: { authorization: "Bearer s" } }));
      bodies.push(await res.json());
    });
    expectToday(seen, {
      calls: ["dueOrgs", "writes:cron", "clearNotes", "clearGone", "sweepable", "sync:cron", "evict", "asks"],
      touched: [],
    });
    for (const b of bodies) {
      expect(b).not.toHaveProperty("hooks");
      expect(b).not.toHaveProperty("hookHealth");
    }
  });

  it("the owner's ServiceM8 screen: today's reads, no read of live updates, and today's props", async () => {
    const props: Record<string, unknown>[] = [];
    const seen = await underEach(async () => {
      const el = (await Servicem8IntegrationPage({ searchParams: Promise.resolve({}) })) as ReactElement<Record<string, unknown>>;
      props.push(el.props);
    });
    expectToday(seen, {
      calls: [
        "connection:servicem8",
        "queue:acct-1c4b",
        "accountChange",
        "writeState",
        "recent",
        "sentLately",
        "readVendor",
        "syncStatus",
        "people",
        "elsewhere:servicem8",
        "after",
        "notesDue",
        "writesDue",
        "writes:kick",
        "stale",
        "sync:kick",
        "asks",
      ],
      touched: ["integration_connections"],
    });
    for (const p of props) {
      expect(Object.keys(p).sort()).toEqual([
        "configured",
        "connection",
        "elsewhere",
        "notice",
        "people",
        "previousAccount",
        "reach",
        "sealed",
        "sync",
        "waitingBookings",
        "waitingNotes",
        "waitingWrites",
        "writeScopes",
        "writes",
      ]);
    }
  });
});

describe("the subscriber itself, with the switch anything but on", () => {
  it("reads nothing, writes nothing and asks nothing", async () => {
    /* the module as it is, past this file's recorder (loading it here
       through the mock would count as a load above) */
    const hooks = jest.requireActual("../sm8-hooks") as typeof import("../sm8-hooks");
    const seen = await underEach(async () => {
      expect(await hooks.ensureSm8Webhooks("org-5d21", { rotate: true, budgetMs: 280_000 })).toEqual({ ran: false, why: "off" });
      expect(await hooks.ensureSm8WebhooksIfOwed("org-5d21", { budgetMs: 30_000 })).toBeNull();
      expect(await hooks.removeSm8Webhooks("org-5d21", { budgetMs: 8_000 })).toMatchObject({ ran: false });
      await hooks.markSm8RotationOwed("org-5d21", "acct-1c4b");
      expect(await hooks.dropExpiredSm8Hooks()).toBe(0);
      /* PR F: the screen's read and the night's check */
      expect(await hooks.readSm8HooksHealth("org-5d21")).toBeNull();
      expect(await hooks.checkSm8HooksQuiet("org-5d21", { budgetMs: 30_000 })).toEqual({ state: "unread", counted: false, ensured: false });
    });
    expectToday(seen, { calls: [], touched: [] });
  });
});

describe("the drain itself, with the switch anything but on (PR D)", () => {
  it("reads nothing, writes nothing, takes no lease and asks nothing", async () => {
    const drain = jest.requireActual("../sm8-hook-drain") as typeof import("../sm8-hook-drain");
    const seen = await underEach(async () => {
      for (const wait of [true, false]) {
        expect(await drain.drainSm8Hooks("org-5d21", { deadline: Date.now() + 280_000, maxMs: 120_000, wait })).toEqual({
          ran: false,
          read: 0,
          written: 0,
          handed: 0,
          dropped: 0,
          stopped: "off",
        });
      }
    });
    expectToday(seen, { calls: [], touched: [] });
  });
});

describe("the webhook route, with the switch anything but on (PR E)", () => {
  /* made up: the shape of a minted hook, and of a record */
  const HOOK = "Vt3kPq8Lx0Zr5Wm2Yb7Nc4Hd9Jf1Gs6Aa-Ee_Uu0Oo3";
  const at = (hook: string, query = "") =>
    `https://app.test/api/integrations/servicem8/webhook/${hook}${query}`;
  const params = (hook: string) => ({ params: Promise.resolve({ hook }) });
  const ping = JSON.stringify({
    object: "job",
    entry: [{ uuid: "1f2e3d4c-5b6a-4978-8a6b-5c4d3e2f1a0b", changed_fields: ["status"], time: "2026-09-28 01:00:00" }],
    resource_url: "https://api.servicem8.com/api_1.0/job/1f2e3d4c-5b6a-4978-8a6b-5c4d3e2f1a0b.json",
  });

  it("answers 404 (410 to a well-formed hook when gone) with no lookup, no after() and no drain", async () => {
    const statuses: (string | number | undefined)[][] = [];
    const seen = await underEach(async () => {
      const state = [process.env.VERCEL_ENV, process.env.SM8_WEBHOOKS];
      const post = await hookPOST(
        new NextRequest(at(HOOK), { method: "POST", headers: { "content-type": "application/json" }, body: ping }),
        params(HOOK)
      );
      const get = await hookGET(new NextRequest(at(HOOK, "?mode=subscribe&challenge=c-9")), params(HOOK));
      const bad = await hookPOST(new NextRequest(at("nope"), { method: "POST", body: ping }), params("nope"));
      statuses.push([...state, post.status, get.status, bad.status]);
    });
    expectToday(seen, { calls: [], touched: [] });
    expect(statuses).toEqual([
      ["production", undefined, 404, 404, 404],
      ["production", "gone", 410, 410, 404],
      ["production", "0", 404, 404, 404],
      ["preview", "1", 404, 404, 404],
      [undefined, "1", 404, 404, 404],
    ]);
  });
});

/* Every file under src/ that takes a turn on the `hook` lane, each held
   behind the switch by its own case above: PR C's subscriber (its lists,
   POSTs and DELETEs, and the plain read that confirms a refused grant),
   and PR D's drain (its one GET a record). */
const HOOK_LANE_CALLERS: string[] = ["lib/integrations/sm8-hook-drain.ts", "lib/integrations/sm8-hooks.ts"];

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name === "__tests__" || name === "node_modules") continue;
      out.push(...sources(p));
    } else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) {
      out.push(p);
    }
  }
  return out;
}

/** Whether a source takes a turn on the `hook` lane: the lane passed to
    sm8CallOf or takeSm8Call (its arguments may hold a call of their own),
    or "hook" given to anything named `lane` or typed Sm8Lane. */
function takesHookLane(text: string): boolean {
  const HOOK = `["'\`]hook["'\`]`;
  return [
    new RegExp(`(?:sm8CallOf|takeSm8Call)\\s*\\((?:[^()]|\\((?:[^()]|\\([^()]*\\))*\\))*?${HOOK}`),
    new RegExp(`\\blane\\??\\s*(?::[^=;,)]*)?[:=]\\s*${HOOK}`),
    new RegExp(`:\\s*Sm8Lane\\s*=\\s*${HOOK}`),
    new RegExp(`${HOOK}\\s+(?:as|satisfies)\\s+Sm8Lane\\b`),
  ].some((re) => re.test(text));
}

describe("the meter's hook lane", () => {
  it("is spotted however a caller spells it", () => {
    for (const text of [
      `sm8CallOf(access, "hook")`,
      `sm8CallOf(f(), "hook")`,
      `sm8CallOf(await accessOf(g(org)), 'hook')`,
      `takeSm8Call(meter, "hook", 2)`,
      `const lane: Sm8Lane = "hook";`,
      `let lane = "hook";`,
      `{ accessToken, meter, lane: "hook" }`,
      `const l: Sm8Lane = "hook";`,
      `const l = "hook" as Sm8Lane;`,
    ]) {
      expect([text, takesHookLane(text)]).toEqual([text, true]);
    }
    for (const text of [
      `sm8CallOf(access, "read")`,
      `sm8CallOf(f(), "sync")`,
      `takeSm8Call(meter, "write")`,
      `const lane: Sm8Lane = "read";`,
      `const hook = "hook";`,
      `hook: HOOK_METER_WAIT_MS`,
    ]) {
      expect([text, takesHookLane(text)]).toEqual([text, false]);
    }
  });

  it("is taken by no file but those listed, each held behind the switch", () => {
    const SRC = join(__dirname, "..", "..", "..");
    const callers = sources(SRC)
      .filter((f) => takesHookLane(readFileSync(f, "utf8")))
      .map((f) => f.slice(SRC.length + 1))
      .sort();
    expect(callers).toEqual(HOOK_LANE_CALLERS);
  });
});
