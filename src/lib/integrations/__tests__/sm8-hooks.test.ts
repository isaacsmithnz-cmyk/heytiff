/**
 * @jest-environment node
 */

/* Subscribing to live updates from ServiceM8 (two-way phase 4, PR C).

   The real door (sm8-http) and the real renewal (sm8-renew) run against a
   fake ServiceM8 — a list of subscriptions that POST creates or updates
   ("Create or Update", keyed here on object and address) and DELETE turns
   off — and a fake database holding sm8_webhooks and sm8_webhook_hooks,
   whose sm8_rotate_hook does what the migration's does. Every id is made
   up. */

type Row = Record<string, unknown>;
const db: Record<string, Row[]> = {};
const events: string[] = [];
const writes: { table: string; op: string; patch: unknown }[] = [];
let dbThrows = false;

function matches(row: Row, filters: [string, string, unknown][]): boolean {
  return filters.every(([c, op, v]) => {
    const x = row[c];
    if (op === "eq") return x === v;
    if (x === null || x === undefined) return false;
    if (op === "lte") return String(x) <= String(v);
    if (op === "lt") return String(x) < String(v);
    return false;
  });
}

class Query {
  private op: "select" | "update" | "upsert" | "delete" = "select";
  private patch: Row = {};
  private filters: [string, string, unknown][] = [];
  private single = false;
  constructor(private table: string) {}
  select() {
    return this;
  }
  eq(c: string, v: unknown) {
    this.filters.push([c, "eq", v]);
    return this;
  }
  lte(c: string, v: unknown) {
    this.filters.push([c, "lte", v]);
    return this;
  }
  lt(c: string, v: unknown) {
    this.filters.push([c, "lt", v]);
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
  upsert(p: Row) {
    this.op = "upsert";
    this.patch = p;
    return this;
  }
  delete() {
    this.op = "delete";
    return this;
  }
  then<T>(res: (v: { data: unknown; error: null }) => T, rej?: (e: unknown) => T) {
    return Promise.resolve()
      .then(() => this.run())
      .then(res, rej);
  }
  private run(): { data: unknown; error: null } {
    const rows = (db[this.table] ??= []);
    if (this.op !== "select") {
      writes.push({ table: this.table, op: this.op, patch: this.patch });
      events.push(`db:${this.op}:${this.table}`);
    }
    if (this.op === "select") {
      const hit = rows.filter((r) => matches(r, this.filters)).map((r) => ({ ...r }));
      return { data: this.single ? (hit[0] ?? null) : hit, error: null };
    }
    if (this.op === "update") {
      const hit = rows.filter((r) => matches(r, this.filters));
      for (const r of hit) Object.assign(r, this.patch);
      return { data: hit, error: null };
    }
    if (this.op === "upsert") {
      const found = rows.find((r) => r.org_id === this.patch.org_id);
      if (found) Object.assign(found, this.patch);
      else rows.push({ objects: {}, subscribed_at: null, rotate_wanted_at: null, ensure_tried_at: null, ...this.patch });
      return { data: null, error: null };
    }
    const gone = rows.filter((r) => matches(r, this.filters));
    db[this.table] = rows.filter((r) => !gone.includes(r));
    return { data: gone, error: null };
  }
}

const HOUR = 3_600_000;
jest.mock("@/lib/supabase-server", () => ({
  supabaseAdmin: {
    from: (table: string) => {
      if (dbThrows) throw new Error("database down");
      return new Query(table);
    },
    rpc: async (name: string, args: { p_org: string; p_account: string; p_hash: string }) => {
      events.push(`rpc:${name}`);
      writes.push({ table: "rpc", op: name, patch: args });
      const now = new Date().toISOString();
      const hooks = (db.sm8_webhook_hooks ??= []);
      for (const h of hooks) {
        if (h.org_id === args.p_org && h.retired_at === null) {
          h.retired_at = now;
          h.valid_until = new Date(Date.now() + 72 * HOUR).toISOString();
        }
      }
      hooks.push({ hook_hash: args.p_hash, org_id: args.p_org, account_uuid: args.p_account, retired_at: null, valid_until: null });
      const webhooks = (db.sm8_webhooks ??= []);
      const row = webhooks.find((r) => r.org_id === args.p_org);
      if (row) Object.assign(row, { account_uuid: args.p_account, rotate_wanted_at: null });
      else webhooks.push({ org_id: args.p_org, account_uuid: args.p_account, objects: {}, subscribed_at: null, rotate_wanted_at: null });
      return { data: null, error: null };
    },
  },
}));

jest.mock("../sm8-meter", () => ({
  ...jest.requireActual("../sm8-meter"),
  takeSm8Call: async () => ({ ok: true }),
  noteSm8Throttle: async () => {},
}));

const ACCESS = { accessToken: "tok-1", tenantId: "acct-7f3e", grant: "g-1", meter: "acct-7f3e" };
let accessResult: unknown = { ok: true, access: ACCESS };
const renewSm8Access = jest.fn();
const markSm8NeedsReauth = jest.fn(async () => true);
jest.mock("../sm8-store", () => ({
  sm8AccessResult: jest.fn(async () => accessResult),
  renewSm8Access: (...a: unknown[]) => renewSm8Access(...a),
  markSm8NeedsReauth: (...a: unknown[]) => markSm8NeedsReauth(...(a as [])),
}));
const fetchSm8Vendor = jest.fn();
jest.mock("../sm8", () => ({ fetchSm8Vendor: (...a: unknown[]) => fetchSm8Vendor(...a) }));

import { createHash } from "node:crypto";
import {
  dropExpiredSm8Hooks,
  ensureSm8Webhooks,
  ensureSm8WebhooksIfOwed,
  markSm8RotationOwed,
  removeSm8Webhooks,
  sm8EnsureOwed,
} from "../sm8-hooks";
import { hookFieldsFor, hookSpecOf, HOOK_OBJECT_NAMES, HOOK_PATH } from "../sm8-hook-plan";
import { sm8AccessResult } from "../sm8-store";

/* ── the fake ServiceM8 ── */

type Sub = {
  uuid: string;
  type: string;
  object: string;
  callback_url: string;
  fields: string[];
  active: boolean;
  last_failure_reason?: string | null;
  last_failure_at?: string | null;
};
let subs: Sub[] = [];
let made = 0;
const requests: { method: string; path: string; body?: URLSearchParams }[] = [];
/** A spelling ServiceM8 answers something other than success. */
let refuse: Record<string, { status: number; body: string }> = {};
/** Something ServiceM8 does as a POST lands. */
let onPost: (object: string) => void = () => {};
let listStatus = 200;
let fetchThrows = false;

const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status });

const fakeFetch = jest.fn(async (url: string, init: RequestInit) => {
  if (fetchThrows) throw new Error("network down");
  const u = new URL(url);
  const method = init.method ?? "GET";
  const body = init.body instanceof URLSearchParams ? init.body : undefined;
  requests.push({ method, path: `${u.pathname}${u.search}`, body });
  events.push(`${method} ${u.pathname}`);
  if (method === "GET") {
    if (listStatus !== 200) return new Response("no", { status: listStatus });
    const status = u.searchParams.get("status");
    return json(status === "active" ? subs.filter((s) => s.active) : subs);
  }
  if (method === "POST") {
    const object = body!.get("object")!;
    onPost(object);
    if (refuse[object]) return new Response(refuse[object].body, { status: refuse[object].status });
    const fields = body!.get("fields")!.split(",");
    const url2 = body!.get("callback_url")!;
    const same = subs.find((s) => s.object === object && s.callback_url === url2);
    if (same) Object.assign(same, { fields, active: true, last_failure_reason: null, last_failure_at: null });
    else subs.push({ uuid: madeUuid(), type: "object", object, callback_url: url2, fields, active: true });
    return json({ success: true });
  }
  const id = u.pathname.split("/").pop();
  const s = subs.find((x) => x.uuid === id);
  if (!s) return json({ success: false, message: "No matching webhook found" }, 404);
  s.active = false;
  return json({ success: true });
});

function madeUuid(): string {
  made += 1;
  return `5b0c0000-0000-4000-8000-${String(made).padStart(12, "0")}`;
}

/* ── seeds ── */

const ORG = "org-3a9c";
const ORIGIN = "https://app.test";
const secretOf = (c: string) => `${c.repeat(40)}x_-`;
const OLD = secretOf("q");
const NEWER = secretOf("r");
const STRANGE = secretOf("z");
const hashOf = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");
const addressOf = (secret: string, origin = ORIGIN) => `${origin}${HOOK_PATH}${secret}`;
const NAMES: Record<string, string> = {
  jobs: "job",
  job_activities: "jobactivity",
  job_payments: "jobpayment",
  job_notes: "note",
  companies: "company",
  attachments: "attachment",
};
const wanted = (o: (typeof HOOK_OBJECT_NAMES)[number]) => hookFieldsFor(hookSpecOf(o));

function listSix(secret: string, opts: { except?: string[]; origin?: string } = {}): Sub[] {
  return HOOK_OBJECT_NAMES.filter((o) => !opts.except?.includes(o)).map((o) => ({
    uuid: madeUuid(),
    type: "object",
    object: NAMES[o],
    callback_url: addressOf(secret, opts.origin),
    fields: wanted(o),
    active: true,
  }));
}

function holdCurrent(secret: string, account = ACCESS.tenantId) {
  (db.sm8_webhook_hooks ??= []).push({ hook_hash: hashOf(secret), org_id: ORG, account_uuid: account, retired_at: null, valid_until: null });
}
function holdRetired(secret: string, validFor = 24 * HOUR) {
  (db.sm8_webhook_hooks ??= []).push({
    hook_hash: hashOf(secret),
    org_id: ORG,
    account_uuid: ACCESS.tenantId,
    retired_at: new Date(Date.now() - HOUR).toISOString(),
    valid_until: new Date(Date.now() + validFor).toISOString(),
  });
}
function holdRow(patch: Row = {}) {
  (db.sm8_webhooks ??= []).push({
    org_id: ORG,
    account_uuid: ACCESS.tenantId,
    objects: {},
    subscribed_at: null,
    rotate_wanted_at: null,
    ensure_tried_at: null,
    ...patch,
  });
}
const row = () => (db.sm8_webhooks ?? []).find((r) => r.org_id === ORG)!;
const currentHash = () => (db.sm8_webhook_hooks ?? []).find((h) => h.retired_at === null)?.hook_hash;
const posts = () => requests.filter((r) => r.method === "POST");
const deletes = () => requests.filter((r) => r.method === "DELETE").map((r) => r.path.split("/").pop());

const env = { ...process.env };
const realFetch = global.fetch;
let lines: string[] = [];

beforeEach(() => {
  for (const k of Object.keys(db)) delete db[k];
  events.length = 0;
  writes.length = 0;
  requests.length = 0;
  subs = [];
  made = 0;
  refuse = {};
  onPost = () => {};
  listStatus = 200;
  fetchThrows = false;
  dbThrows = false;
  accessResult = { ok: true, access: ACCESS };
  renewSm8Access.mockReset();
  markSm8NeedsReauth.mockClear();
  fetchSm8Vendor.mockReset().mockResolvedValue({ ok: true, vendor: { uuid: ACCESS.tenantId } });
  (sm8AccessResult as jest.Mock).mockClear();
  fakeFetch.mockClear();
  global.fetch = fakeFetch as unknown as typeof fetch;
  process.env = { ...env, VERCEL_ENV: "production", SM8_WEBHOOKS: "1", APP_BASE_URL: ORIGIN };
  lines = [];
  for (const level of ["log", "info", "warn", "error"] as const) {
    jest.spyOn(console, level).mockImplementation((...m: unknown[]) => void lines.push(m.map(String).join(" ")));
  }
});
afterEach(() => {
  jest.restoreAllMocks();
  process.env = { ...env };
});
afterAll(() => {
  global.fetch = realFetch;
});

const ensure = (opts: { rotate?: boolean; budgetMs?: number; clock?: () => number } = {}) =>
  ensureSm8Webhooks(ORG, { budgetMs: 280_000, ...opts });

describe("the switch", () => {
  it("anywhere but on, nothing is read, written or asked", async () => {
    for (const [vercel, hooks] of [
      ["production", undefined],
      ["production", "gone"],
      ["preview", "1"],
    ] as const) {
      process.env.VERCEL_ENV = vercel;
      if (hooks === undefined) delete process.env.SM8_WEBHOOKS;
      else process.env.SM8_WEBHOOKS = hooks;
      expect(await ensure({ rotate: true })).toEqual({ ran: false, why: "off" });
      expect(await removeSm8Webhooks(ORG, { budgetMs: 8_000 })).toMatchObject({ ran: false });
      await markSm8RotationOwed(ORG, ACCESS.tenantId);
      expect(await dropExpiredSm8Hooks()).toBe(0);
    }
    expect(fakeFetch).not.toHaveBeenCalled();
    expect(sm8AccessResult).not.toHaveBeenCalled();
    expect(events).toEqual([]);
  });
});

describe("ensureSm8Webhooks: the address", () => {
  it("a first run mints BEFORE the first POST, and subscribes all six at APP_BASE_URL", async () => {
    const out = await ensure();
    expect(out).toMatchObject({ ran: true, rotated: true, posted: 6, deleted: 0, subscribed: true, stopped: null });
    expect(events.indexOf("rpc:sm8_rotate_hook")).toBeGreaterThan(-1);
    expect(events.indexOf("rpc:sm8_rotate_hook")).toBeLessThan(events.indexOf("POST /webhook_subscriptions/object"));
    for (const p of posts()) {
      const address = p.body!.get("callback_url")!;
      expect(address.startsWith(`${ORIGIN}${HOOK_PATH}`)).toBe(true);
      expect(hashOf(address.slice(`${ORIGIN}${HOOK_PATH}`.length))).toBe(currentHash());
    }
    expect(posts().map((p) => p.body!.get("object"))).toEqual(HOOK_OBJECT_NAMES.map((o) => NAMES[o]));
    for (const o of HOOK_OBJECT_NAMES) {
      expect(posts().find((p) => p.body!.get("object") === NAMES[o])!.body!.get("fields")).toBe(wanted(o).join(","));
      expect(row().objects).toMatchObject({ [o]: { name: NAMES[o], active: true, sub: expect.any(String), error: null } });
    }
    expect(row().subscribed_at).toEqual(expect.any(String));
    expect(row().ensure_tried_at).toEqual(expect.any(String));
  });

  it("never takes the address from anything but APP_BASE_URL or ServiceM8's own list", async () => {
    delete process.env.APP_BASE_URL;
    expect(await ensure()).toEqual({ ran: false, why: "no_origin" });
    expect(fakeFetch).not.toHaveBeenCalled();
  });

  it("steady state is one list and one record, with no rotation", async () => {
    holdCurrent(OLD);
    holdRow({ subscribed_at: "2026-09-20T00:00:00.000Z" });
    subs = listSix(OLD);
    const out = await ensure();
    expect(out).toMatchObject({ ran: true, rotated: false, posted: 0, deleted: 0, subscribed: true });
    expect(requests.map((r) => `${r.method} ${r.path}`)).toEqual(["GET /webhook_subscriptions?status=all"]);
    expect(writes.map((w) => `${w.op}:${w.table}`)).toEqual(["upsert:sm8_webhooks"]);
    expect(row().subscribed_at).toBe("2026-09-20T00:00:00.000Z");
  });

  it("a reuse POSTs the listed address exactly as ServiceM8 lists it", async () => {
    holdCurrent(OLD);
    holdRow();
    // the same origin, spelt as ServiceM8 keeps it
    subs = listSix(OLD, { except: ["job_notes"], origin: "https://APP.test" });
    const out = await ensure();
    expect(out).toMatchObject({ rotated: false, posted: 1 });
    expect(events).not.toContain("rpc:sm8_rotate_hook");
    expect(posts()).toHaveLength(1);
    expect(posts()[0].body!.get("callback_url")).toBe(`https://APP.test${HOOK_PATH}${OLD}`);
  });

  it("no entry listed at the current address: a rotation", async () => {
    holdCurrent(OLD);
    holdRow();
    const out = await ensure();
    expect(out).toMatchObject({ rotated: true, posted: 6 });
    expect(currentHash()).not.toBe(hashOf(OLD));
  });

  it("a connect rotates whatever is listed: the old hash is retired for 72 h, and its entries go after the list is read again", async () => {
    holdCurrent(OLD);
    holdRow({ subscribed_at: "2026-09-20T00:00:00.000Z" });
    subs = listSix(OLD);
    const old = subs.map((s) => s.uuid);
    const out = await ensure({ rotate: true });
    expect(out).toMatchObject({ rotated: true, posted: 6, deleted: 6, subscribed: true });
    const retired = db.sm8_webhook_hooks.find((h) => h.hook_hash === hashOf(OLD))!;
    expect(Date.parse(retired.valid_until as string) - Date.now()).toBeGreaterThan(71 * HOUR);
    const methods = requests.map((r) => r.method);
    expect(methods).toEqual(["GET", ...Array(6).fill("POST"), "GET", ...Array(6).fill("DELETE")]);
    expect(deletes().sort()).toEqual([...old].sort());
    expect(row().subscribed_at).not.toBe("2026-09-20T00:00:00.000Z");
  });

  it("an entry of ours for another account's hash is not current: a rotation", async () => {
    holdCurrent(OLD, "acct-other");
    holdRow();
    subs = listSix(OLD);
    expect(await ensure()).toMatchObject({ rotated: true });
  });
});

describe("ensureSm8Webhooks: a rotation owed is cleared at the END", () => {
  it("the mark survives the mint, and goes only once the reconcile has finished", async () => {
    holdCurrent(OLD);
    holdRow({ rotate_wanted_at: "2026-09-28T01:00:00.000Z", subscribed_at: "2026-09-20T00:00:00.000Z" });
    subs = listSix(OLD);
    const seen: unknown[] = [];
    onPost = () => void seen.push(row().rotate_wanted_at);
    const out = await ensure();
    expect(out).toMatchObject({ rotated: true });
    expect(seen).toEqual(Array(6).fill("2026-09-28T01:00:00.000Z"));
    expect(row().rotate_wanted_at).toBeNull();
  });

  it("a mark a later connect made meanwhile stays", async () => {
    holdCurrent(OLD);
    holdRow({ rotate_wanted_at: "2026-09-28T01:00:00.000Z" });
    onPost = () => void (row().rotate_wanted_at = "2026-09-28T02:00:00.000Z");
    await ensure();
    expect(row().rotate_wanted_at).toBe("2026-09-28T02:00:00.000Z");
  });

  it("nothing is subscribed at a new address until the POSTs land", async () => {
    holdCurrent(OLD);
    holdRow({ subscribed_at: "2026-09-20T00:00:00.000Z" });
    subs = listSix(OLD);
    const seen: unknown[] = [];
    onPost = () => void seen.push(row().subscribed_at);
    await ensure({ rotate: true });
    expect(seen.every((s) => s === null)).toBe(true);
  });
});

describe("ensureSm8Webhooks: the POSTs", () => {
  it("a name ServiceM8 doesn't subscribe is tried in its next spelling, and the one that worked is kept", async () => {
    refuse = { jobactivity: { status: 400, body: '{"success":false,"message":"Object jobactivity does not support subscription"}' } };
    await ensure();
    expect(posts().filter((p) => /activity/i.test(p.body!.get("object")!)).map((p) => p.body!.get("object"))).toEqual([
      "jobactivity",
      "JobActivity",
    ]);
    expect(row().objects).toMatchObject({ job_activities: { name: "JobActivity", active: true } });
  });

  it("the spelling that worked last time goes first", async () => {
    holdCurrent(OLD);
    holdRow({ objects: { job_activities: { name: "JobActivity" } } });
    subs = listSix(OLD, { except: ["job_activities"] });
    await ensure();
    expect(posts().map((p) => p.body!.get("object"))).toEqual(["JobActivity"]);
  });

  it("a refusal is kept redacted, and no address is ever written — not to objects, not anywhere", async () => {
    refuse = {
      note: {
        status: 403,
        body: "", // filled in below, once the address is known
      },
    };
    onPost = (object) => {
      if (object !== "note") return;
      const address = posts()[posts().length - 1].body!.get("callback_url")!;
      const path = address.slice(ORIGIN.length);
      refuse.note.body = JSON.stringify({ success: false, message: `read_job_notes scope required for ${address} (${path})` });
    };
    const out = await ensure();
    expect(out).toMatchObject({ posted: 5, subscribed: false });
    const secret = posts()[0].body!.get("callback_url")!.slice(`${ORIGIN}${HOOK_PATH}`.length);
    const notes = (row().objects as Record<string, { error?: string; active?: boolean }>).job_notes;
    expect(notes.active).toBe(false);
    expect(notes.error).toContain("scope required");
    expect(notes.error).toContain("[address]");
    expect(notes.error).toContain("/webhook/[hook]");
    const everything = JSON.stringify(writes);
    expect(everything).not.toContain(secret);
    expect(everything).not.toMatch(/webhook(\\\\?\/|%2F)[A-Za-z0-9_-]{43}/);
    for (const w of writes) {
      const p = w.patch as { objects?: unknown };
      if (p && p.objects !== undefined) expect(JSON.stringify(p.objects)).not.toMatch(/https?:/);
    }
    expect(lines.join("\n")).not.toContain(secret);
    expect(row().subscribed_at).toBeNull();
  });

  it("an address echoed JSON-escaped or form-encoded is kept out too", async () => {
    onPost = (object) => {
      if (object !== "job") return;
      const address = posts()[posts().length - 1].body!.get("callback_url")!;
      refuse.job = {
        status: 400,
        body: `{"message":"bad ${address.replace(/\//g, "\\/")}","detail":"${encodeURIComponent(address)}"}`,
      };
    };
    await ensure();
    const secret = posts()[0].body!.get("callback_url")!.slice(`${ORIGIN}${HOOK_PATH}`.length);
    const error = (row().objects as Record<string, { error?: string }>).jobs.error!;
    expect(error).toContain("[address]");
    expect(JSON.stringify(writes)).not.toContain(secret);
    expect(error).not.toMatch(/app\.test/);
  });

  it("a subscription ServiceM8 turned off has its reason recorded BEFORE the POST that clears it", async () => {
    holdCurrent(OLD);
    holdRow();
    subs = listSix(OLD);
    const off = subs.find((s) => s.object === "company")!;
    Object.assign(off, { active: false, last_failure_reason: "Webhook request failed for over 12 hours", last_failure_at: "2026-09-27 03:25:00" });
    await ensure();
    const recorded = writes.findIndex(
      (w) => w.op === "update" && JSON.stringify((w.patch as { objects?: unknown }).objects ?? {}).includes("12 hours")
    );
    const postAt = events.indexOf("POST /webhook_subscriptions/object");
    const recordedAt = events.findIndex((e, i) => e === "db:update:sm8_webhooks" && i < postAt);
    expect(recorded).toBeGreaterThan(-1);
    expect(recordedAt).toBeGreaterThan(-1);
    expect(posts().map((p) => p.body!.get("callback_url"))).toEqual([addressOf(OLD)]);
    expect(row().objects).toMatchObject({
      companies: { active: true, failure_reason: "Webhook request failed for over 12 hours", failure_at: "2026-09-27 03:25:00" },
    });
  });

  it("a subscription watching too little is POSTed again", async () => {
    holdCurrent(OLD);
    holdRow();
    subs = listSix(OLD);
    subs.find((s) => s.object === "job")!.fields = ["status"];
    await ensure();
    expect(posts().map((p) => p.body!.get("object"))).toEqual(["job"]);
  });

  it("one watching too little that ServiceM8 won't widen isn't counted as subscribed", async () => {
    holdCurrent(OLD);
    holdRow({ subscribed_at: "2026-09-20T00:00:00.000Z" });
    subs = listSix(OLD);
    const narrow = subs.find((s) => s.object === "job")!;
    narrow.fields = ["status"];
    refuse = { job: { status: 403, body: "no" }, Job: { status: 403, body: "no" } };
    const out = await ensure();
    expect(out).toMatchObject({ subscribed: false });
    expect(row().objects).toMatchObject({ jobs: { active: false, sub: narrow.uuid } });
    expect(row().subscribed_at).toBeNull();
  });
});

describe("ensureSm8Webhooks: the DELETEs", () => {
  it("come from the list read AFTER the POSTs: only active entries at a retired or dead address, once each", async () => {
    holdCurrent(OLD);
    holdRetired(NEWER);
    holdRow();
    subs = listSix(OLD, { except: ["jobs"] });
    const moved = { uuid: madeUuid(), type: "object", object: "job", callback_url: addressOf(NEWER), fields: wanted("jobs"), active: true };
    const retiredOff = { ...moved, uuid: madeUuid(), object: "note", active: false };
    const dead = { ...moved, uuid: madeUuid(), object: "company", callback_url: addressOf(STRANGE) };
    const deadTwice = { ...dead, uuid: madeUuid(), object: "attachment" };
    const elsewhere = { ...moved, uuid: madeUuid(), callback_url: `https://other.test${HOOK_PATH}${OLD}` };
    const otherPath = { ...moved, uuid: madeUuid(), callback_url: `${ORIGIN}/api/other/${OLD}` };
    const event = { ...moved, uuid: madeUuid(), type: "event" };
    subs.push(moved, retiredOff, dead, deadTwice, elsewhere, otherPath, event);
    // "Create or Update" moved the retired job entry in place as the POST landed
    onPost = () => void (moved.active = false);
    const out = await ensure();
    expect(out).toMatchObject({ posted: 1 });
    expect(requests.map((r) => r.method)).toEqual(["GET", "POST", "GET", "DELETE", "DELETE"]);
    expect(deletes().sort()).toEqual([dead.uuid, deadTwice.uuid].sort());
  });

  it("with nothing to POST, the one list decides", async () => {
    holdCurrent(OLD);
    holdRetired(NEWER);
    holdRow();
    subs = listSix(OLD);
    const retired = { ...subs[0], uuid: madeUuid(), callback_url: addressOf(NEWER) };
    subs.push(retired);
    await ensure();
    expect(requests.map((r) => r.method)).toEqual(["GET", "DELETE"]);
    expect(deletes()).toEqual([retired.uuid]);
  });

  it("an entry at our address for an object it doesn't know is left alone, and logged", async () => {
    holdCurrent(OLD);
    holdRow();
    subs = listSix(OLD);
    const potato = { ...subs[0], uuid: madeUuid(), object: "potato" };
    subs.push(potato);
    await ensure();
    expect(deletes()).toEqual([]);
    expect(lines.some((l) => l.includes("left alone") && l.includes(potato.uuid) && l.includes("potato"))).toBe(true);
    expect(lines.join("\n")).not.toContain(OLD);
  });
});

describe("ensureSm8Webhooks: bounds", () => {
  it("a request starts only while its worst case still ends inside the budget", async () => {
    const clock = () => 1_000_000;
    // a list (10 s + the meter's 3 s) fits in 20 s; a POST (25 s + 3 s) doesn't
    const out = await ensure({ budgetMs: 20_000, clock });
    expect(requests.map((r) => r.method)).toEqual(["GET"]);
    expect(out).toMatchObject({ ran: true, posted: 0, stopped: "late" });
    requests.length = 0;
    await ensure({ budgetMs: 12_000, clock });
    expect(requests).toEqual([]);
  });

  it("does nothing without a working connection that names its account", async () => {
    accessResult = { ok: false, reason: "reauth" };
    expect(await ensure()).toEqual({ ran: false, why: "not_connected" });
    accessResult = { ok: true, access: { ...ACCESS, tenantId: null } };
    expect(await ensure()).toEqual({ ran: false, why: "not_connected" });
    expect(fakeFetch).not.toHaveBeenCalled();
  });

  it("never throws: a database or a network that fails is an answer", async () => {
    dbThrows = true;
    await expect(ensure()).resolves.toEqual({ ran: false, why: "failed" });
    dbThrows = false;
    fetchThrows = true;
    await expect(ensure()).resolves.toMatchObject({ ran: true, posted: 0 });
    expect(row().ensure_tried_at).toEqual(expect.any(String));
    fetchThrows = false;
    listStatus = 500;
    await expect(ensure()).resolves.toMatchObject({ ran: true, stopped: expect.stringContaining("list 500") });
    await expect(removeSm8Webhooks(ORG, { budgetMs: 8_000 })).resolves.toMatchObject({ deleted: 0 });
  });

  it("a 401 from the subscriptions doesn't mark the grant for reconnecting while a plain read still works", async () => {
    listStatus = 401;
    const out = await ensure();
    expect(fetchSm8Vendor).toHaveBeenCalledWith(expect.objectContaining({ lane: "hook" }));
    expect(renewSm8Access).not.toHaveBeenCalled();
    expect(markSm8NeedsReauth).not.toHaveBeenCalled();
    expect(out).toMatchObject({ ran: true, stopped: expect.stringContaining("401") });
  });

  it("a 401 the plain read shares is renewed once, and only a second marks the grant", async () => {
    listStatus = 401;
    fetchSm8Vendor.mockResolvedValue({ ok: false, unauthorized: true });
    renewSm8Access.mockResolvedValue({ ok: true, access: { ...ACCESS, accessToken: "tok-2", grant: "g-2" } });
    const out = await ensure();
    expect(renewSm8Access).toHaveBeenCalledTimes(1);
    expect(requests.filter((r) => r.method === "GET")).toHaveLength(2);
    expect(markSm8NeedsReauth).toHaveBeenCalledTimes(1);
    expect(out).toMatchObject({ ran: true, stopped: "dead" });
  });
});

describe("when a page load owes a reconcile", () => {
  const NOW = Date.parse("2026-09-28T10:00:00.000Z");
  const at = (msAgo: number) => new Date(NOW - msAgo).toISOString();

  it("a rotation owed, or the six not all subscribed — at most hourly", () => {
    expect(sm8EnsureOwed(null, NOW)).toBe(true);
    const settled = { rotate_wanted_at: null, subscribed_at: at(HOUR * 5), ensure_tried_at: at(HOUR * 5) };
    expect(sm8EnsureOwed(settled, NOW)).toBe(false);
    expect(sm8EnsureOwed({ ...settled, rotate_wanted_at: at(60_000) }, NOW)).toBe(true);
    expect(sm8EnsureOwed({ ...settled, subscribed_at: null }, NOW)).toBe(true);
    expect(sm8EnsureOwed({ ...settled, subscribed_at: null, ensure_tried_at: at(HOUR - 1) }, NOW)).toBe(false);
    expect(sm8EnsureOwed({ ...settled, rotate_wanted_at: at(1), ensure_tried_at: at(HOUR + 1) }, NOW)).toBe(true);
    expect(sm8EnsureOwed({ ...settled, subscribed_at: null, ensure_tried_at: null }, NOW)).toBe(true);
  });
});

describe("ensureSm8WebhooksIfOwed: the page load's", () => {
  it("runs an owed reconcile, and then not again within the hour, whatever is still owed", async () => {
    refuse = { note: { status: 403, body: "no" } };
    expect(await ensureSm8WebhooksIfOwed(ORG, { budgetMs: 30_000 })).toMatchObject({ ran: true, subscribed: false });
    const first = requests.length;
    expect(first).toBeGreaterThan(0);
    expect(row().subscribed_at).toBeNull();
    // the next page load, a minute later: one read of one row, nothing asked
    expect(await ensureSm8WebhooksIfOwed(ORG, { budgetMs: 30_000, now: Date.now() + 60_000 })).toBeNull();
    expect(requests).toHaveLength(first);
    // past the hour, it tries again
    expect(await ensureSm8WebhooksIfOwed(ORG, { budgetMs: 30_000, now: Date.now() + HOUR + 1 })).toMatchObject({ ran: true });
    expect(requests.length).toBeGreaterThan(first);
  });

  it("owes nothing while all six are subscribed and no rotation waits", async () => {
    holdCurrent(OLD);
    holdRow({ subscribed_at: "2026-09-20T00:00:00.000Z", ensure_tried_at: "2026-09-20T00:00:00.000Z" });
    subs = listSix(OLD);
    expect(await ensureSm8WebhooksIfOwed(ORG, { budgetMs: 30_000 })).toBeNull();
    expect(requests).toEqual([]);
  });
});

describe("markSm8RotationOwed", () => {
  it("marks it for the account, making the row if there is none", async () => {
    await markSm8RotationOwed(ORG, ACCESS.tenantId, Date.parse("2026-09-28T01:00:00.000Z"));
    expect(row()).toMatchObject({ account_uuid: ACCESS.tenantId, rotate_wanted_at: "2026-09-28T01:00:00.000Z" });
  });

  it("without an account, only marks a row that exists", async () => {
    await markSm8RotationOwed(ORG, null);
    expect(db.sm8_webhooks ?? []).toEqual([]);
    holdRow();
    await markSm8RotationOwed(ORG, null, Date.parse("2026-09-28T01:00:00.000Z"));
    expect(row().rotate_wanted_at).toBe("2026-09-28T01:00:00.000Z");
  });
});

describe("removeSm8Webhooks", () => {
  it("lists the active ones and takes down every one at our address, and nothing else", async () => {
    holdCurrent(OLD);
    subs = listSix(OLD);
    const dead = { ...subs[0], uuid: madeUuid(), callback_url: addressOf(STRANGE) };
    const off = { ...subs[1], uuid: madeUuid(), callback_url: addressOf(NEWER), active: false };
    const theirs = { ...subs[2], uuid: madeUuid(), callback_url: "https://someone.else/hooks/job" };
    subs.push(dead, off, theirs);
    const out = await removeSm8Webhooks(ORG, { budgetMs: 8_000 });
    expect(requests[0].path).toBe("/webhook_subscriptions?status=active");
    expect(out).toEqual({ ran: true, deleted: 7, stopped: null });
    expect(deletes()).not.toContain(off.uuid);
    expect(deletes()).not.toContain(theirs.uuid);
    expect(writes).toEqual([]);
  });

  it("cuts each request's wait to what is left of its budget, and asks nothing with too little left", async () => {
    subs = listSix(OLD);
    const timeout = jest.spyOn(AbortSignal, "timeout");
    await removeSm8Webhooks(ORG, { budgetMs: 8_000, clock: () => 0 });
    // the meter's 3 s kept aside
    expect(timeout).toHaveBeenCalledWith(5_000);
    requests.length = 0;
    await removeSm8Webhooks(ORG, { budgetMs: 4_000, clock: () => 0 });
    expect(requests).toEqual([]);
  });
});

describe("dropExpiredSm8Hooks", () => {
  it("tidies away the hashes past their 72 hours, and only those", async () => {
    holdCurrent(OLD);
    holdRetired(NEWER);
    holdRetired(STRANGE, -HOUR);
    expect(await dropExpiredSm8Hooks()).toBe(1);
    expect(db.sm8_webhook_hooks.map((h) => h.hook_hash).sort()).toEqual([hashOf(OLD), hashOf(NEWER)].sort());
  });
});
