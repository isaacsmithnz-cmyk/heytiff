/**
 * @jest-environment node
 */

/* The write path's plumbing — queued, claimed, sent, recorded — against an
   in-memory table, so the rules that matter are exercised rather than
   described: nothing goes without the deployment's, the owner's and the
   account's yes; only a person's press queues; one sender per row, and a
   sender that lost its row records nothing; a file asked for again goes
   under a new uuid; a trial run goes everywhere but ServiceM8; doubt holds
   and never cancels; and a refusal stops what it should. */

type Row = Record<string, unknown>;

const db: Record<string, Row[]> = {};
const downloads: string[] = [];
const downloadParams: unknown[] = [];
let storageFails = false;
/** Called inside every download — a test moves its clock from here. */
let onDownload: () => void = () => {};
/** Tables whose every query answers with an error. */
const failing = new Set<string>();
/** Tables whose UPDATES answer with an error, reads still fine. */
const failingUpdates = new Set<string>();
/** Columns this database doesn't have yet: an update naming one is refused
    the way PostgREST refuses it. */
const missingColumns = new Set<string>();
/** Runs before an upsert; an error it returns is the upsert's answer. */
let beforeUpsert: () => { code: string; message: string } | null = () => null;

/** The migration's generated column, as the database computes it. */
const keyOf = (r: Row) => `${r.kind}:${r.sm8_job_uuid ?? ""}:${r.subject}`;

/* A small query engine over `db` — just the PostgREST verbs the module
   uses, applied for real, so a conditional update that matches nothing
   matches nothing. */
function parseOr(expr: string): (r: Row) => boolean {
  const terms: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of expr) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      terms.push(cur);
      cur = "";
    } else cur += ch;
  }
  terms.push(cur);
  const one = (t: string): ((r: Row) => boolean) => {
    const and = /^and\((.*)\)$/.exec(t);
    if (and) {
      const parts = and[1].split(",").map(one);
      return (r) => parts.every((p) => p(r));
    }
    const [col, op, ...rest] = t.split(".");
    const v = rest.join(".");
    if (op === "eq") return (r) => String(r[col]) === v;
    if (op === "lt") return (r) => r[col] != null && String(r[col]) < v;
    if (op === "is") return (r) => r[col] == null;
    throw new Error(`fake: unknown op ${op}`);
  };
  const preds = terms.map(one);
  return (r) => preds.some((p) => p(r));
}

function from(table: string) {
  db[table] ??= [];
  const filters: ((r: Row) => boolean)[] = [];
  let op: "select" | "update" | "upsert" = "select";
  let patch: Row = {};
  let incoming: Row[] = [];
  let conflict: string[] = [];
  let order: { col: string; asc: boolean } | null = null;
  let limit = Infinity;
  let head = false;
  const exec = () => {
    if (failing.has(table)) return { data: null, count: null, error: { code: "XX000", message: "fake: down" } };
    if (op === "update" && failingUpdates.has(table)) return { data: null, error: { code: "XX000", message: "fake: down" } };
    if (op === "update" && Object.keys(patch).some((c) => missingColumns.has(c))) {
      return { data: null, error: { code: "PGRST204", message: "fake: no such column" } };
    }
    const rows = db[table];
    if (op === "upsert") {
      const raced = beforeUpsert();
      if (raced) return { data: null, error: raced };
      const made: Row[] = [];
      for (const r of incoming) {
        const row: Row = {
          replaced_uuids: [],
          free_retries: 0,
          maybe_landed: false,
          verify_uuids: [],
          claim_id: null,
          lease_until: null,
          ...r,
        };
        if (table === "sm8_writes") row.dedupe_key = keyOf(row);
        /* a unique index: NULLs never clash */
        const clash = rows.some((x) => conflict.every((c) => x[c] != null && x[c] === row[c]));
        if (clash) continue;
        const stored = { id: `w${rows.length + 1}`, ...row };
        rows.push(stored);
        made.push(stored);
      }
      return { data: made, error: null };
    }
    let hit = rows.filter((r) => filters.every((f) => f(r)));
    if (op === "update") {
      for (const r of hit) Object.assign(r, patch);
      return { data: hit.map((r) => ({ ...r })), error: null };
    }
    if (order) {
      const { col, asc } = order;
      hit = [...hit].sort((a, b) => (String(a[col]) < String(b[col]) ? -1 : 1) * (asc ? 1 : -1));
    }
    hit = hit.slice(0, limit);
    return head ? { data: null, count: hit.length, error: null } : { data: hit.map((r) => ({ ...r })), error: null };
  };
  const q: Record<string, unknown> = {
    select: (_cols?: string, opts?: { head?: boolean }) => {
      if (opts?.head) head = true;
      return q;
    },
    update: (p: Row) => {
      op = "update";
      patch = p;
      return q;
    },
    upsert: (v: Row | Row[], opts: { onConflict: string }) => {
      op = "upsert";
      incoming = Array.isArray(v) ? v : [v];
      conflict = opts.onConflict.split(",");
      return q;
    },
    eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), q),
    neq: (c: string, v: unknown) => (filters.push((r) => r[c] != null && r[c] !== v), q),
    in: (c: string, vs: unknown[]) => (filters.push((r) => vs.includes(r[c])), q),
    lte: (c: string, v: string) => (filters.push((r) => String(r[c]) <= v), q),
    lt: (c: string, v: string) => (filters.push((r) => r[c] != null && String(r[c]) < v), q),
    gte: (c: string, v: string) => (filters.push((r) => r[c] != null && String(r[c]) >= v), q),
    or: (expr: string) => (filters.push(parseOr(expr)), q),
    order: (col: string, o: { ascending: boolean }) => ((order = { col, asc: o.ascending }), q),
    limit: (n: number) => ((limit = n), q),
    maybeSingle: async () => {
      const res = exec();
      if (res.error) return { data: null, error: res.error };
      return { data: (res.data as Row[] | null)?.[0] ?? null, error: null };
    },
    then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(exec()).then(res, rej),
  };
  return q;
}

/** The two functions the notes migration adds, applied to `db` as the
    database would: one atomic update each. `rpcMissing` is a database
    without them (PGRST202). */
let rpcMissing = false;
const rpcCalls: string[] = [];
function rpc(name: string, args: Record<string, unknown>) {
  rpcCalls.push(name);
  if (rpcMissing) return Promise.resolve({ data: null, error: { code: "PGRST202", message: "fake: no such function" } });
  const conn = (db.integration_connections ?? []).find((c) => c.org_id === args.p_org && c.provider === "servicem8");
  if (name === "sm8_mark_kind_refused") {
    if (conn) {
      const was = (conn.write_scope_refused ?? {}) as Record<string, unknown>;
      conn.write_scope_refused = { ...was, [String(args.p_kind)]: args.p_at };
    }
    return Promise.resolve({ data: !!conn, error: null });
  }
  if (name === "sm8_set_write_kind") {
    if (!conn || (args.p_kind !== "attachment" && args.p_kind !== "note")) return Promise.resolve({ data: null, error: null });
    const was = Array.isArray(conn.write_kinds) ? (conn.write_kinds as string[]) : ["attachment"];
    const kind = String(args.p_kind);
    conn.write_kinds = args.p_on ? [...new Set([...was, kind])].sort() : was.filter((k) => k !== kind);
    return Promise.resolve({ data: conn.write_kinds, error: null });
  }
  return Promise.resolve({ data: null, error: { code: "PGRST202", message: `fake: no ${name}` } });
}

jest.mock("@/lib/supabase-server", () => ({
  supabaseAdmin: {
    rpc: (name: string, args: Record<string, unknown>) => rpc(name, args),
    from: (t: string) => from(t),
    storage: {
      from: () => ({
        download: async (ref: string, _opts: unknown, params: unknown) => {
          downloads.push(ref);
          downloadParams.push(params);
          onDownload();
          if (storageFails) return { data: null, error: { message: "nope" } };
          return { data: new Blob([new Uint8Array([0x25, 0x50, 0x44, 0x46])]), error: null };
        },
      }),
    },
  },
}));

/* The store is a fake — tokens are its suite's business — but the renewal
   helper between it and the sender is the REAL one, so a 401 here goes
   through exactly the renew-once-then-judge path production does. */
const sm8AccessResult = jest.fn();
const renewSm8Access = jest.fn();
const markSm8NeedsReauth = jest.fn();
jest.mock("../sm8-store", () => ({
  sm8AccessResult: (...a: unknown[]) => sm8AccessResult(...a),
  renewSm8Access: (...a: unknown[]) => renewSm8Access(...a),
  markSm8NeedsReauth: (...a: unknown[]) => markSm8NeedsReauth(...a),
}));

const postSm8Attachment = jest.fn();
const readSm8Attachment = jest.fn();
jest.mock("../sm8-write", () => ({
  postSm8Attachment: (...a: unknown[]) => postSm8Attachment(...a),
  readSm8Attachment: (...a: unknown[]) => readSm8Attachment(...a),
}));

/* The press is the REAL one, minted from a fake session: the queue's check
   is what is under test. */
const getSession = jest.fn();
jest.mock("@/lib/auth0", () => ({ auth0: { getSession: (...a: unknown[]) => getSession(...a) } }));
jest.mock("@/lib/fleet/query", () => ({ staffProfileIdFor: jest.fn(async () => "staff-isaac") }));

const scheduled: (() => unknown)[] = [];
jest.mock("next/server", () => ({ after: (fn: () => unknown) => scheduled.push(fn) }));
jest.mock("@/lib/workboard/job-notes-query", () => ({
  staffDisplayNames: jest.fn(async () => new Map([["staff-isaac", "Isaac Smith"]])),
}));

import { countSm8WritesInFlight, countWaitingSm8Writes } from "../sm8-write-cancel";
import { sm8PressFromSession, type Sm8Press } from "../sm8-press";
import {
  cancelWaitingSm8Writes,
  countSm8Queue,
  enqueueAttachments,
  enqueueSm8Writes,
  listRecentSm8Writes,
  orgsWithDueSm8Writes,
  readJobSends,
  readSm8WriteState,
  retryFailedSm8Writes,
  runSm8Writes,
  setSm8WriteMode,
  sm8QueueStuck,
  sm8WritesDue,
} from "../sm8-writes";
import { WRITE_BATCH, WRITE_WORDS } from "../sm8-write-plan";
import { SM8_REVOKED } from "../sm8-sync-plan";

const ACCESS = { accessToken: "token-1", tenantId: "vendor-1", grant: "g1", meter: "vendor-1" };
/** A request on lane `write` with the first token, counted against the account. */
const W1 = { accessToken: "token-1", meter: "vendor-1", lane: "write" };
const RENEWED = { accessToken: "token-2", tenantId: "vendor-1", grant: "g2", meter: "vendor-1" };

const NOW = Date.parse("2026-09-24T01:00:00.000Z");
const ORG = "org-1";

const connection = (over: Row = {}): Row => ({
  org_id: ORG,
  provider: "servicem8",
  status: "connected",
  tenant_id: "vendor-1",
  tenants: [{ tenantId: "vendor-1", tenantName: "Acme Air", timezoneName: "Australia/Sydney" }],
  scopes: "vendor read_jobs manage_attachments",
  write_mode: "live",
  paused_reason: null,
  paused_at: null,
  write_scope_refused: {},
  connected_at: "2026-09-01T00:00:00.000Z",
  ...over,
});

const doc = (id: string, over: Row = {}): Row => ({
  id,
  org_id: ORG,
  storage_ref: `org/${ORG}/jobs/${id}.pdf`,
  mime_type: "application/pdf",
  uploaded_at: "2026-09-01T00:00:00.000Z",
  ...over,
});

const file = (documentId: string, over: Partial<Parameters<typeof enqueueAttachments>[2][number]> = {}) => ({
  jobUuid: "job-1",
  documentId,
  name: `${documentId}.pdf`,
  mimeType: "application/pdf",
  sizeBytes: 4,
  key: `d:${documentId}`,
  ...over,
});

const writes = () => db.sm8_writes;

let press: Sm8Press;

beforeEach(async () => {
  for (const k of Object.keys(db)) delete db[k];
  db.integration_connections = [connection()];
  db.documents = [doc("d1"), doc("d2"), doc("d3")];
  db.sm8_writes = [];
  db.sm8_jobs = [{ org_id: ORG, uuid: "job-1", generated_job_id: "2380" }];
  downloads.length = 0;
  downloadParams.length = 0;
  storageFails = false;
  onDownload = () => {};
  failing.clear();
  failingUpdates.clear();
  missingColumns.clear();
  beforeUpsert = () => null;
  rpcMissing = false;
  rpcCalls.length = 0;
  scheduled.length = 0;
  process.env.SM8_WRITES = "1";
  sm8AccessResult.mockReset().mockResolvedValue({ ok: true, access: ACCESS });
  renewSm8Access.mockReset().mockResolvedValue({ ok: true, access: RENEWED });
  markSm8NeedsReauth.mockReset().mockResolvedValue(true);
  postSm8Attachment.mockReset().mockResolvedValue({ status: 200, outcome: { kind: "created", remoteUuid: null } });
  readSm8Attachment.mockReset();
  getSession.mockReset().mockResolvedValue({ orgId: ORG, user: { sub: "auth0|isaac" } });
  press = (await sm8PressFromSession())!;
  jest.spyOn(console, "error").mockImplementation(() => {});
  jest.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => jest.restoreAllMocks());

afterAll(() => {
  delete process.env.SM8_WRITES;
});

const queue = async (...ids: string[]) =>
  (await enqueueAttachments(press, await readSm8WriteState(ORG), ids.map((id) => file(id)), NOW))!;

describe("where writing stands", () => {
  it("needs the deployment's switch, the owner's and a grant that can write", async () => {
    expect(await readSm8WriteState(ORG)).toEqual({
      readable: true,
      kinds: ["attachment"],
      deployment: true,
      mode: "live",
      modeStored: "live",
      pausedReason: null,
      pausedAt: null,
      linked: true,
      connected: true,
      tenantId: "vendor-1",
      granted: ["attachment"],
      refused: [],
      timezoneName: "Australia/Sydney",
      /* the owner's per-kind switch: a row without write_kinds reads as
         files, which is what it meant before the column */
      ownerKinds: ["attachment"],
      ownerKindsRead: true,
    });
    delete process.env.SM8_WRITES;
    expect((await readSm8WriteState(ORG)).deployment).toBe(false);
  });

  it("reads a workspace with no connection as switched off, and unlinked", async () => {
    db.integration_connections = [];
    expect(await readSm8WriteState(ORG)).toMatchObject({
      readable: true,
      linked: false,
      mode: "off",
      modeStored: null,
      tenantId: null,
      granted: [],
    });
  });

  it("reads a settings row that couldn't be read as unreadable — never as switched off", async () => {
    failing.add("integration_connections");
    expect(await readSm8WriteState(ORG)).toMatchObject({ readable: false, linked: false });
  });
});

describe("queueing", () => {
  it("makes a row per file, each under a uuid of its own chosen now", async () => {
    const q = await queue("d1", "d2");
    expect(q.ids).toHaveLength(2);
    expect(q.already).toEqual([]);
    const [a, b] = writes();
    expect(a).toMatchObject({
      org_id: ORG,
      tenant_id: "vendor-1",
      kind: "attachment",
      sm8_job_uuid: "job-1",
      subject: "document:d1",
      status: "queued",
      attempts: 0,
      requested_by: "staff-isaac",
    });
    expect(a.payload).toMatchObject({ documentId: "d1", name: "d1.pdf", key: "d:d1" });
    expect(a.remote_uuid).toMatch(/^[0-9a-f-]{36}$/);
    expect(b.remote_uuid).not.toBe(a.remote_uuid);
  });

  it("never queues a file twice: sent and in-flight are answered 'already'", async () => {
    await queue("d1", "d2");
    writes()[0].status = "sent";
    writes()[1].status = "sending";
    const q = await queue("d1", "d2");
    expect(q).toEqual({ ids: [], already: ["d1", "d2"], capped: false });
    expect(writes()).toHaveLength(2);
  });

  it("asks again for a file that failed under a NEW uuid, remembering the old, from scratch", async () => {
    /* the old uuid may be a dead record in ServiceM8, which can never be
       finished; and this one's last try met a 503, so it may have landed
       after all — it is checked before the new one goes */
    await queue("d1");
    Object.assign(writes()[0], {
      status: "failed",
      attempts: 6,
      last_error: "x",
      http_status: 503,
      maybe_landed: true,
      remote_code: "500",
      remote_message: "down",
    });
    const old = writes()[0].remote_uuid;
    const q = await queue("d1");
    expect(q.ids).toEqual([writes()[0].id]);
    expect(writes()[0]).toMatchObject({
      status: "queued",
      attempts: 0,
      last_error: null,
      http_status: null,
      remote_code: null,
      remote_message: null,
      replaced_uuids: [old],
      verify_uuids: [old],
      maybe_landed: false,
    });
    expect(writes()[0].remote_uuid).not.toBe(old);
    expect(writes()[0].remote_uuid).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("checks nothing first when nothing under the old uuid went out unanswered", async () => {
    await queue("d1");
    Object.assign(writes()[0], { status: "failed", attempts: 1, http_status: 413 });
    await queue("d1");
    expect(writes()[0].verify_uuids).toEqual([]);
  });

  it("gives a trial row and a cancelled row a new uuid too", async () => {
    await queue("d1", "d2");
    Object.assign(writes()[0], { status: "trial", attempts: 1 });
    Object.assign(writes()[1], { status: "cancelled" });
    const [a, b] = [writes()[0].remote_uuid, writes()[1].remote_uuid];
    const q = await queue("d1", "d2");
    expect(q.ids).toHaveLength(2);
    expect(writes()[0]).toMatchObject({ status: "queued", replaced_uuids: [a] });
    expect(writes()[1]).toMatchObject({ status: "queued", replaced_uuids: [b] });
    expect(writes()[0].remote_uuid).not.toBe(a);
    expect(writes()[1].remote_uuid).not.toBe(b);
  });

  it("records who pressed, and when", async () => {
    await queue("d1");
    expect(writes()[0]).toMatchObject({
      source: "press",
      pressed_at: new Date(NOW).toISOString(),
      requested_by: "staff-isaac",
      requested_by_user: "auth0|isaac",
    });
  });

  it("queues nothing that no person pressed for", async () => {
    const state = await readSm8WriteState(ORG);
    // the same fields, but not minted from a session
    const forged = { ...press } as Sm8Press;
    expect(await enqueueAttachments(forged, state, [file("d1")], NOW)).toBeNull();
    expect(writes()).toHaveLength(0);
  });

  it("queues nothing on a press kept for later", async () => {
    const state = await readSm8WriteState(ORG);
    const minted = Date.now();
    jest.spyOn(Date, "now").mockReturnValue(minted + 121_000);
    expect(await enqueueAttachments(press, state, [file("d1")], NOW)).toBeNull();
    expect(writes()).toHaveLength(0);
  });

  it("makes ONE row for a thing with no job, however often it is pressed", async () => {
    const state = await readSm8WriteState(ORG);
    const one = { kind: "attachment" as const, jobUuid: null, subject: "document:d1", payload: { name: "d1.pdf" }, ref: "d1" };
    const first = await enqueueSm8Writes(press, state, [one], NOW);
    const second = await enqueueSm8Writes(press, state, [one], NOW);
    expect(first?.ids).toHaveLength(1);
    expect(second?.ids).toEqual(first?.ids);
    expect(writes()).toHaveLength(1);
    expect(writes()[0].dedupe_key).toBe("attachment::document:d1");
  });

  it("says a re-queue that couldn't be written couldn't be queued — never that the file is already there", async () => {
    await queue("d1");
    Object.assign(writes()[0], { status: "failed", attempts: 6 });
    failingUpdates.add("sm8_writes");
    const state = await readSm8WriteState(ORG);
    expect(await enqueueAttachments(press, state, [file("d1")], NOW)).toBeNull();
    expect(writes()[0].status).toBe("failed");
  });

  it("reads a press that lost the race to the same file as 'already', not as a failure", async () => {
    /* while the old unique index stands beside the new one, the loser of two
       presses at the same instant raises 23505 instead of doing nothing */
    beforeUpsert = () => {
      beforeUpsert = () => null;
      db.sm8_writes.push({
        id: "theirs",
        org_id: ORG,
        tenant_id: "vendor-1",
        kind: "attachment",
        sm8_job_uuid: "job-1",
        subject: "document:d1",
        dedupe_key: "attachment:job-1:document:d1",
        status: "queued",
      });
      return { code: "23505", message: "duplicate key value violates unique constraint \"sm8_writes_subject_uniq\"" };
    };
    const q = await queue("d1", "d2");
    // d1 is the other press's; d2, which the failed statement never reached, goes in
    expect(q.already).toEqual(["d1"]);
    expect(q.ids).toHaveLength(1);
    expect(writes().map((w) => w.subject).sort()).toEqual(["document:d1", "document:d2"]);
    expect(writes().find((w) => w.subject === "document:d2")!.status).toBe("queued");
  });

  it("still fails a press whose insert fails for any other reason", async () => {
    beforeUpsert = () => ({ code: "XX000", message: "fake: down" });
    const state = await readSm8WriteState(ORG);
    expect(await enqueueAttachments(press, state, [file("d1")], NOW)).toBeNull();
  });

  it("brings a waiting retry forward, keeping its count", async () => {
    await queue("d1");
    Object.assign(writes()[0], { attempts: 2, next_attempt_at: "2026-09-24T09:00:00.000Z" });
    await queue("d1");
    expect(writes()[0]).toMatchObject({ status: "queued", attempts: 2, next_attempt_at: new Date(NOW).toISOString() });
  });
});

describe("the hourly cap", () => {
  /** `n` writes pressed `minsAgo` minutes ago for vendor-1, in `org`. */
  const pressed = (n: number, minsAgo: number, org = ORG, status = "sent") => {
    for (let i = 0; i < n; i++) {
      db.sm8_writes.push({
        id: `p-${org}-${minsAgo}-${i}`,
        org_id: org,
        tenant_id: "vendor-1",
        kind: "attachment",
        sm8_job_uuid: "job-9",
        subject: `document:p${org}${minsAgo}${i}`,
        dedupe_key: `attachment:job-9:document:p${org}${minsAgo}${i}`,
        status,
        pressed_at: new Date(NOW - minsAgo * 60_000).toISOString(),
      });
    }
  };

  it("pauses sending at the 61st press in an hour on one ServiceM8 account, across workspaces, and queues nothing", async () => {
    pressed(40, 10);
    pressed(20, 30, "org-2");
    const before = writes().length;
    const q = await queue("d1");
    expect(q).toEqual({ ids: [], already: [], capped: true });
    expect(writes()).toHaveLength(before);
    expect(db.integration_connections[0]).toMatchObject({
      write_mode: "paused",
      paused_reason: "cap",
      paused_at: new Date(NOW).toISOString(),
    });
  });

  it("leaves an owner's own Paused or Off alone, set between the press's read and the trip", async () => {
    pressed(60, 10);
    const stale = await readSm8WriteState(ORG);
    for (const [mode, reason] of [
      ["paused", "owner"],
      ["off", null],
    ] as const) {
      Object.assign(db.integration_connections[0], { write_mode: mode, paused_reason: reason, paused_at: "2026-09-23T00:00:00.000Z" });
      const q = await enqueueAttachments(press, stale, [file("d1")], NOW);
      expect(q?.capped).toBe(true);
      expect(db.integration_connections[0]).toMatchObject({
        write_mode: mode,
        paused_reason: reason,
        paused_at: "2026-09-23T00:00:00.000Z",
      });
    }
  });

  it("takes the 60th", async () => {
    pressed(59, 10);
    expect((await queue("d1")).capped).toBe(false);
    expect(db.integration_connections[0].write_mode).toBe("live");
  });

  it("doesn't count what was pressed more than an hour ago, or before the last pause", async () => {
    pressed(30, 90);
    pressed(40, 40);
    db.integration_connections[0].paused_at = new Date(NOW - 30 * 60_000).toISOString();
    expect((await queue("d1")).capped).toBe(false);
  });

  it("doesn't cap a trial run, or count one", async () => {
    pressed(60, 10);
    db.integration_connections[0].write_mode = "trial";
    expect((await queue("d1")).capped).toBe(false);
    db.integration_connections[0].write_mode = "live";
    db.sm8_writes = db.sm8_writes.filter((r) => r.status !== "sent");
    pressed(60, 10, ORG, "trial");
    expect((await queue("d2")).capped).toBe(false);
  });
});

describe("sending", () => {
  it("sends each due file once, with our uuid and the file's own bytes, and records it sent", async () => {
    const { ids } = await queue("d1");
    const run = await runSm8Writes(ORG, "send", { ids, clock: () => NOW });
    expect(run).toMatchObject({ done: 1, sent: 1, failed: 0, stopped: null });
    expect(postSm8Attachment).toHaveBeenCalledWith(W1, {
      jobUuid: "job-1",
      uuid: writes()[0].remote_uuid,
      fileName: "d1.pdf",
      mimeType: "application/pdf",
      bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46]),
    });
    expect(writes()[0]).toMatchObject({ status: "sent", attempts: 1, lease_until: null, http_status: 200 });
    expect(writes()[0].sent_at).toBe(new Date(NOW).toISOString());
  });

  it("claims a row before sending it — a second sender reaching for it gets nothing", async () => {
    const { ids } = await queue("d1");
    // another worker holds it, mid-request
    Object.assign(writes()[0], { status: "sending", attempts: 1, lease_until: new Date(NOW + 60_000).toISOString() });
    const run = await runSm8Writes(ORG, "kick", { ids, clock: () => NOW });
    expect(run.done).toBe(0);
    expect(postSm8Attachment).not.toHaveBeenCalled();
  });

  it("takes a send back whose worker died, under the same uuid", async () => {
    const { ids } = await queue("d1");
    Object.assign(writes()[0], { status: "sending", attempts: 1, lease_until: new Date(NOW - 1).toISOString() });
    await runSm8Writes(ORG, "kick", { ids, clock: () => NOW });
    expect(postSm8Attachment).toHaveBeenCalledTimes(1);
    expect(writes()[0]).toMatchObject({ status: "sent", attempts: 2 });
  });

  it("sends nothing on a deployment without the switch", async () => {
    const { ids } = await queue("d1");
    delete process.env.SM8_WRITES;
    expect((await runSm8Writes(ORG, "cron", { ids, clock: () => NOW })).done).toBe(0);
    expect(postSm8Attachment).not.toHaveBeenCalled();
  });

  it("cancels what was waiting once the owner has switched it off", async () => {
    const { ids } = await queue("d1");
    db.integration_connections[0].write_mode = "off";
    await runSm8Writes(ORG, "kick", { ids, clock: () => NOW });
    expect(postSm8Attachment).not.toHaveBeenCalled();
    expect(writes()[0]).toMatchObject({ status: "cancelled", last_error: WRITE_WORDS.switchedOff });
  });

  it("never sends a write to a ServiceM8 account other than the one it was queued for", async () => {
    const { ids } = await queue("d1");
    db.integration_connections[0].tenant_id = "vendor-2";
    await runSm8Writes(ORG, "kick", { ids, clock: () => NOW });
    expect(postSm8Attachment).not.toHaveBeenCalled();
    expect(writes()[0]).toMatchObject({ status: "cancelled", last_error: WRITE_WORDS.otherAccount });
  });

  it("doesn't send a file taken off the job since it was queued", async () => {
    const { ids } = await queue("d1");
    db.documents = db.documents.filter((d) => d.id !== "d1");
    await runSm8Writes(ORG, "kick", { ids, clock: () => NOW });
    expect(postSm8Attachment).not.toHaveBeenCalled();
    expect(writes()[0]).toMatchObject({ status: "cancelled", last_error: WRITE_WORDS.fileGone });
  });

  it("refuses to read a file filed under another workspace", async () => {
    const { ids } = await queue("d1");
    db.documents[0].storage_ref = "org/someone-else/jobs/d1.pdf";
    await runSm8Writes(ORG, "kick", { ids, clock: () => NOW });
    expect(downloads).toEqual([]);
    expect(writes()[0].status).toBe("cancelled");
  });

  it("waits, and asks nothing of ServiceM8, while On lacks the permission", async () => {
    const { ids } = await queue("d1");
    db.integration_connections[0].scopes = "vendor read_jobs";
    const run = await runSm8Writes(ORG, "kick", { ids, clock: () => NOW });
    expect(run.stopped).toBe(WRITE_WORDS.scopeHeld);
    expect(postSm8Attachment).not.toHaveBeenCalled();
    expect(writes()[0].status).toBe("queued");
  });

  it("gives the file's read its own clock", async () => {
    const { ids } = await queue("d1");
    await runSm8Writes(ORG, "send", { ids, clock: () => NOW });
    expect(downloadParams).toEqual([{ signal: expect.any(AbortSignal) }]);
  });

  it("keeps what ServiceM8 said when it refused, and clears it once the file goes", async () => {
    const { ids } = await queue("d1");
    postSm8Attachment.mockResolvedValueOnce({
      status: 503,
      outcome: { kind: "unavailable", status: 503 },
      remote: { code: "500", message: "Down for maintenance" },
    });
    await runSm8Writes(ORG, "send", { ids, clock: () => NOW });
    expect(writes()[0]).toMatchObject({ status: "queued", remote_code: "500", remote_message: "Down for maintenance" });
    writes()[0].next_attempt_at = new Date(NOW).toISOString();
    await runSm8Writes(ORG, "send", { ids, clock: () => NOW });
    expect(writes()[0]).toMatchObject({ status: "sent", remote_code: null, remote_message: null });
  });
});

describe("doubt holds, and never cancels", () => {
  it("holds everything, and cancels nothing, when the settings can't be read", async () => {
    const { ids } = await queue("d1");
    failing.add("integration_connections");
    const run = await runSm8Writes(ORG, "kick", { ids, clock: () => NOW });
    expect(run.stopped).toBe(WRITE_WORDS.settingsUnread);
    expect(postSm8Attachment).not.toHaveBeenCalled();
    expect(writes()[0].status).toBe("queued");
  });

  it("holds, and cancels nothing, on a stored setting that isn't one", async () => {
    const { ids } = await queue("d1");
    db.integration_connections[0].write_mode = "banana";
    await runSm8Writes(ORG, "kick", { ids, clock: () => NOW });
    expect(postSm8Attachment).not.toHaveBeenCalled();
    expect(writes()[0].status).toBe("queued");
  });

  it("holds while paused, and cancels nothing", async () => {
    const { ids } = await queue("d1");
    db.integration_connections[0].write_mode = "paused";
    const run = await runSm8Writes(ORG, "kick", { ids, clock: () => NOW });
    expect(run.stopped).toBe(WRITE_WORDS.paused);
    expect(postSm8Attachment).not.toHaveBeenCalled();
    expect(writes()[0].status).toBe("queued");
    expect(writes()[0].last_error ?? null).toBeNull();
  });

  it.each([
    ["the owner pauses it", { write_mode: "paused", paused_reason: "owner" }, WRITE_WORDS.paused],
    ["it turns to a trial run", { write_mode: "trial" }, "Sending to ServiceM8 changed to a trial run."],
    ["the account changes", { tenant_id: "vendor-2" }, WRITE_WORDS.otherAccount],
  ])("claims nothing more once %s mid-run", async (_what, change, stopped) => {
    /* Pause changes no row: a run already going must read the switch again
       before its next claim, or "Paused: nothing goes" is a suggestion */
    const { ids } = await queue("d1", "d2", "d3");
    postSm8Attachment.mockImplementationOnce(async () => {
      Object.assign(db.integration_connections[0], change);
      return { status: 200, outcome: { kind: "created", remoteUuid: null } };
    });
    const run = await runSm8Writes(ORG, "send", { ids, clock: () => NOW });
    expect(run).toMatchObject({ done: 1, sent: 1, stopped });
    expect(postSm8Attachment).toHaveBeenCalledTimes(1);
    expect(writes()[1]).toMatchObject({ status: "queued", attempts: 0 });
    expect(writes()[2]).toMatchObject({ status: "queued", attempts: 0 });
  });

  it("holds, mid-run, when the switch can't be read again", async () => {
    const { ids } = await queue("d1", "d2");
    postSm8Attachment.mockImplementationOnce(async () => {
      failing.add("integration_connections");
      return { status: 200, outcome: { kind: "created", remoteUuid: null } };
    });
    const run = await runSm8Writes(ORG, "send", { ids, clock: () => NOW });
    expect(run).toMatchObject({ done: 1, stopped: WRITE_WORDS.settingsUnread });
    expect(writes()[1]).toMatchObject({ status: "queued", attempts: 0 });
  });

  it("cancels, in the disconnect's words, what waits for a connection that is gone", async () => {
    /* a send in flight at the disconnect finishes back in the queue; it
       must never go after a reconnect and On */
    const { ids } = await queue("d1");
    db.integration_connections = [];
    await runSm8Writes(ORG, "kick", { ids, clock: () => NOW });
    expect(postSm8Attachment).not.toHaveBeenCalled();
    expect(writes()[0]).toMatchObject({ status: "cancelled", last_error: WRITE_WORDS.disconnected });
  });
});

describe("a permission per kind", () => {
  it("a grant holding the files permission sends files, whatever else the write list asks for", async () => {
    /* the day a second kind ships, its scope joins the list: a grant that
       predates it must not stop sending the files it can send */
    await jest.isolateModulesAsync(async () => {
      jest.doMock("../providers", () => ({
        ...jest.requireActual("../providers"),
        SM8_WRITE_SCOPE_LIST: ["manage_attachments", "publish_job_notes"],
        SM8_WRITE_KIND_SCOPES: { attachment: ["manage_attachments"], note: ["publish_job_notes"] },
      }));
      const w = await import("../sm8-writes");
      const p = await import("../sm8-press");
      const mine = (await p.sm8PressFromSession())!;
      const queued = await w.enqueueAttachments(mine, await w.readSm8WriteState(ORG), [file("d1")], NOW);
      const run = await w.runSm8Writes(ORG, "send", { ids: queued!.ids, clock: () => NOW });
      expect(run.sent).toBe(1);
      expect(postSm8Attachment).toHaveBeenCalledTimes(1);
    });
  });
});

describe("which kinds this deployment writes", () => {
  it("holds files where the deployment allows only another kind", async () => {
    const { ids } = await queue("d1");
    process.env.SM8_WRITES = "note";
    const run = await runSm8Writes(ORG, "kick", { ids, clock: () => NOW });
    expect(run.done).toBe(0);
    expect(postSm8Attachment).not.toHaveBeenCalled();
    expect(writes()[0].status).toBe("queued");
  });

  it.each(["1", "attachment", " attachment , note"])("sends files where SM8_WRITES is %p", async (v) => {
    const { ids } = await queue("d1");
    process.env.SM8_WRITES = v;
    expect((await runSm8Writes(ORG, "kick", { ids, clock: () => NOW })).sent).toBe(1);
  });
});

describe("a trial run", () => {
  it("goes everywhere but ServiceM8: the account checked, the file read, the send left out", async () => {
    db.integration_connections[0] = connection({ write_mode: "trial", scopes: "vendor read_jobs" });
    const { ids } = await queue("d1");
    const run = await runSm8Writes(ORG, "send", { ids, clock: () => NOW });
    expect(run).toMatchObject({ done: 1, trial: 1, sent: 0 });
    expect(downloads).toEqual([`org/${ORG}/jobs/d1.pdf`]);
    expect(sm8AccessResult).not.toHaveBeenCalled();
    expect(postSm8Attachment).not.toHaveBeenCalled();
    expect(writes()[0]).toMatchObject({ status: "trial", lease_until: null });
  });
});

describe("what an answer does to the run", () => {
  it("a 401 that survives one renewal holds everything for a reconnect, flags THAT grant, and doesn't count it against the file", async () => {
    const { ids } = await queue("d1", "d2");
    postSm8Attachment.mockResolvedValue({ status: 401, outcome: { kind: "unauthorized" } });
    const run = await runSm8Writes(ORG, "send", { ids, clock: () => NOW });
    expect(run.done).toBe(1);
    // the same file, the same uuid, once with each token
    expect(postSm8Attachment).toHaveBeenCalledTimes(2);
    expect(postSm8Attachment.mock.calls.map((c) => c[0].accessToken)).toEqual(["token-1", "token-2"]);
    expect(postSm8Attachment.mock.calls[1][1].uuid).toBe(postSm8Attachment.mock.calls[0][1].uuid);
    expect(markSm8NeedsReauth).toHaveBeenCalledTimes(1);
    expect(markSm8NeedsReauth).toHaveBeenCalledWith(ORG, SM8_REVOKED, RENEWED);
    expect(writes()[0]).toMatchObject({ status: "queued", attempts: 0, last_error: WRITE_WORDS.reauth });
    expect(writes()[1]).toMatchObject({ status: "queued", attempts: 0 });
  });

  it("a 401 cured by one renewal sends the file and flags nothing", async () => {
    /* The hourly token ran out mid-run: that is not a dead grant, and the
       owner must not be asked to reconnect a connection that works. */
    const { ids } = await queue("d1", "d2");
    postSm8Attachment.mockImplementation(async (call: { accessToken: string }) =>
      call.accessToken === "token-1"
        ? { status: 401, outcome: { kind: "unauthorized" } }
        : { status: 200, outcome: { kind: "created", remoteUuid: null } }
    );
    const run = await runSm8Writes(ORG, "send", { ids, clock: () => NOW });
    expect(run).toMatchObject({ done: 2, sent: 2, stopped: null });
    expect(markSm8NeedsReauth).not.toHaveBeenCalled();
    // the renewed token is carried on: the second file needed no renewal of its own
    expect(renewSm8Access).toHaveBeenCalledTimes(1);
    expect(writes()[0]).toMatchObject({ status: "sent", attempts: 1 });
  });

  it("a token refresh that couldn't reach ServiceM8 stops with that, and touches no row", async () => {
    const { ids } = await queue("d1");
    const before = { ...writes()[0] };
    sm8AccessResult.mockResolvedValue({ ok: false, reason: "unreachable" });
    const run = await runSm8Writes(ORG, "send", { ids, clock: () => NOW });
    expect(run.stopped).toBe(WRITE_WORDS.unreachable);
    expect(postSm8Attachment).not.toHaveBeenCalled();
    expect(writes()[0]).toEqual(before);
  });

  it("a dead grant stops the run without touching a row", async () => {
    const { ids } = await queue("d1");
    sm8AccessResult.mockResolvedValue({ ok: false, reason: "reauth" });
    const run = await runSm8Writes(ORG, "send", { ids, clock: () => NOW });
    expect(run.stopped).toBe(WRITE_WORDS.reauth);
    expect(writes()[0]).toMatchObject({ status: "queued", attempts: 0 });
  });

  it("a renewal that couldn't reach ServiceM8 hands the attempt back and waits a minute", async () => {
    const { ids } = await queue("d1", "d2");
    postSm8Attachment.mockResolvedValue({ status: 401, outcome: { kind: "unauthorized" } });
    renewSm8Access.mockResolvedValue({ ok: false, reason: "unreachable" });
    const run = await runSm8Writes(ORG, "send", { ids, clock: () => NOW });
    expect(run).toMatchObject({ done: 1, stopped: WRITE_WORDS.unreachable });
    expect(writes()[0]).toMatchObject({ status: "queued", attempts: 0, last_error: WRITE_WORDS.unreachable });
    expect(writes()[0].next_attempt_at).toBe(new Date(NOW + 60_000).toISOString());
    expect(markSm8NeedsReauth).not.toHaveBeenCalled();
  });

  it("renewed too late in its claim, a send goes back to the queue instead of risking its lease", async () => {
    const { ids } = await queue("d1");
    let t = NOW;
    postSm8Attachment.mockImplementation(async () => {
      t += 45_000; // a slow upload, then the refusal
      return { status: 401, outcome: { kind: "unauthorized" } };
    });
    await runSm8Writes(ORG, "send", { ids, clock: () => t });
    expect(postSm8Attachment).toHaveBeenCalledTimes(1);
    expect(writes()[0]).toMatchObject({ status: "queued", attempts: 0, last_error: null, lease_until: null });
    expect(writes()[0].next_attempt_at).toBe(new Date(t).toISOString());
    expect(markSm8NeedsReauth).not.toHaveBeenCalled();
  });

  it("a token renewed onto a different account never carries the file", async () => {
    // the owner reconnected to another account while the run was out
    const { ids } = await queue("d1");
    postSm8Attachment.mockResolvedValue({ status: 401, outcome: { kind: "unauthorized" } });
    renewSm8Access.mockResolvedValue({ ok: true, access: { ...RENEWED, tenantId: "vendor-2" } });
    await runSm8Writes(ORG, "send", { ids, clock: () => NOW });
    expect(postSm8Attachment).toHaveBeenCalledTimes(1);
    expect(writes()[0]).toMatchObject({ status: "cancelled", last_error: WRITE_WORDS.otherAccount });
  });

  it("a token renewed onto a connection that names no account never carries the file, and doesn't cancel it", async () => {
    /* A nameless reconnect landed while the run was out: the token is for
       SOME account, and nothing says it is the one this file was queued for. */
    const { ids } = await queue("d1", "d2");
    postSm8Attachment.mockResolvedValue({ status: 401, outcome: { kind: "unauthorized" } });
    renewSm8Access.mockResolvedValue({ ok: true, access: { ...RENEWED, tenantId: null } });
    const run = await runSm8Writes(ORG, "send", { ids, clock: () => NOW });
    expect(postSm8Attachment).toHaveBeenCalledTimes(1);
    expect(run).toMatchObject({ done: 1, stopped: WRITE_WORDS.accountUnknown });
    expect(writes()[0]).toMatchObject({ status: "queued", attempts: 0, last_error: WRITE_WORDS.accountUnknown });
    expect(writes()[0].next_attempt_at).toBe(new Date(NOW + 60_000).toISOString());
    expect(writes()[1]).toMatchObject({ status: "queued", attempts: 0 });
  });

  it("a first token from a connection that names no account sends nothing", async () => {
    const { ids } = await queue("d1");
    sm8AccessResult.mockResolvedValue({ ok: true, access: { ...ACCESS, tenantId: null } });
    await runSm8Writes(ORG, "send", { ids, clock: () => NOW });
    expect(postSm8Attachment).not.toHaveBeenCalled();
    expect(writes()[0]).toMatchObject({ status: "queued", attempts: 0, last_error: WRITE_WORDS.accountUnknown });
  });

  it("backs off an unreachable ServiceM8 and ends the run, the next file untried", async () => {
    const { ids } = await queue("d1", "d2");
    postSm8Attachment.mockResolvedValue({ status: 503, outcome: { kind: "unavailable", status: 503 } });
    await runSm8Writes(ORG, "send", { ids, clock: () => NOW });
    expect(writes()[0]).toMatchObject({ status: "queued", attempts: 1, http_status: 503, last_error: WRITE_WORDS.unreachable });
    expect(writes()[0].next_attempt_at).toBe(new Date(NOW + 60_000).toISOString());
    expect(postSm8Attachment).toHaveBeenCalledTimes(1);
  });

  it("stops only the file ServiceM8 refused", async () => {
    const { ids } = await queue("d1", "d2");
    postSm8Attachment
      .mockResolvedValueOnce({ status: 413, outcome: { kind: "rejected", status: 413 } })
      .mockResolvedValueOnce({ status: 200, outcome: { kind: "created", remoteUuid: null } });
    const run = await runSm8Writes(ORG, "send", { ids, clock: () => NOW });
    expect(run).toMatchObject({ done: 2, sent: 1, failed: 1 });
    expect(writes()[0]).toMatchObject({ status: "failed", last_error: WRITE_WORDS.tooBig });
    expect(writes()[1].status).toBe("sent");
  });

  it("counts a 409 as sent only once ServiceM8 shows our record on this job", async () => {
    const { ids } = await queue("d1", "d2");
    postSm8Attachment.mockResolvedValue({ status: 409, outcome: { kind: "exists" } });
    readSm8Attachment
      .mockResolvedValueOnce({ ok: true, found: true, jobUuid: "job-1", active: true })
      .mockResolvedValueOnce({ ok: true, found: true, jobUuid: "another-job", active: true });
    await runSm8Writes(ORG, "send", { ids, clock: () => NOW });
    expect(readSm8Attachment).toHaveBeenCalledWith(W1, writes()[0].remote_uuid);
    expect(writes()[0].status).toBe("sent");
    expect(writes()[1]).toMatchObject({ status: "failed", last_error: WRITE_WORDS.notThere });
  });

  it("keeps ServiceM8's uuid when it names the record something else", async () => {
    const { ids } = await queue("d1");
    postSm8Attachment.mockResolvedValue({ status: 200, outcome: { kind: "created", remoteUuid: "theirs-1" } });
    await runSm8Writes(ORG, "send", { ids, clock: () => NOW });
    expect(writes()[0]).toMatchObject({ status: "sent", remote_uuid: "theirs-1" });
  });

  it("retries a file the bucket wouldn't give up, without ending the run", async () => {
    const { ids } = await queue("d1");
    storageFails = true;
    await runSm8Writes(ORG, "send", { ids, clock: () => NOW });
    expect(writes()[0]).toMatchObject({ status: "queued", attempts: 1, last_error: WRITE_WORDS.unreadable });
    expect(postSm8Attachment).not.toHaveBeenCalled();
  });
});

describe("a file ServiceM8 left unfinished", () => {
  const dead = () => {
    postSm8Attachment.mockResolvedValueOnce({ status: 409, outcome: { kind: "exists" } });
    readSm8Attachment.mockResolvedValueOnce({ ok: true, found: true, jobUuid: "job-1", active: false });
  };

  it("goes again at once under a new uuid, the dead one kept and the attempt handed back", async () => {
    const { ids } = await queue("d1");
    const deadUuid = writes()[0].remote_uuid;
    dead();
    const run = await runSm8Writes(ORG, "send", { ids, clock: () => NOW });
    expect(run).toMatchObject({ done: 1, again: 1, stopped: null });
    expect(writes()[0]).toMatchObject({
      status: "queued",
      attempts: 0,
      last_error: null,
      replaced_uuids: [deadUuid],
      free_retries: 1,
      next_attempt_at: new Date(NOW).toISOString(),
    });
    const fresh = writes()[0].remote_uuid;
    expect(fresh).not.toBe(deadUuid);

    // the next run sends it under the new one
    await runSm8Writes(ORG, "send", { ids, clock: () => NOW });
    expect(postSm8Attachment).toHaveBeenLastCalledWith(W1, expect.objectContaining({ uuid: fresh }));
    expect(writes()[0]).toMatchObject({ status: "sent", remote_uuid: fresh });
  });

  it("stops for a person after two new uuids, rather than leaving a dead record on every run", async () => {
    const { ids } = await queue("d1");
    for (let i = 0; i < 3; i++) {
      dead();
      await runSm8Writes(ORG, "send", { ids, clock: () => NOW });
    }
    expect(postSm8Attachment).toHaveBeenCalledTimes(3);
    expect(writes()[0]).toMatchObject({ status: "failed", last_error: WRITE_WORDS.deadRecordGaveUp });
    expect(writes()[0].replaced_uuids).toHaveLength(2);
  });

  it("a 409 on another job is still somebody else's record, never sent", async () => {
    const { ids } = await queue("d1");
    postSm8Attachment.mockResolvedValueOnce({ status: 409, outcome: { kind: "exists" } });
    readSm8Attachment.mockResolvedValueOnce({ ok: true, found: true, jobUuid: "job-2", active: false });
    await runSm8Writes(ORG, "send", { ids, clock: () => NOW });
    expect(writes()[0]).toMatchObject({ status: "failed", last_error: WRITE_WORDS.notThere });
  });
});

describe("a file asked for again after an unanswered try", () => {
  const again = async () => {
    const { ids } = await queue("d1");
    Object.assign(writes()[0], { status: "failed", attempts: 6, http_status: null, maybe_landed: true });
    const old = String(writes()[0].remote_uuid);
    await queue("d1");
    return { ids, old, fresh: String(writes()[0].remote_uuid) };
  };

  it("is sent without an upload when ServiceM8 already has the last try, live on this job", async () => {
    const { ids, old } = await again();
    readSm8Attachment.mockResolvedValueOnce({ ok: true, found: true, jobUuid: "job-1", active: true });
    const run = await runSm8Writes(ORG, "send", { ids, clock: () => NOW });
    expect(readSm8Attachment).toHaveBeenCalledWith(W1, old);
    expect(postSm8Attachment).not.toHaveBeenCalled();
    expect(downloads).toEqual([]);
    expect(run.sent).toBe(1);
    expect(writes()[0]).toMatchObject({ status: "sent", remote_uuid: old, verify_uuids: [], replaced_uuids: [] });
  });

  it("goes under the new uuid when the last try isn't there", async () => {
    const { ids, fresh } = await again();
    readSm8Attachment.mockResolvedValueOnce({ ok: true, found: false });
    await runSm8Writes(ORG, "send", { ids, clock: () => NOW });
    expect(postSm8Attachment).toHaveBeenCalledWith(W1, expect.objectContaining({ uuid: fresh }));
    expect(writes()[0]).toMatchObject({ status: "sent", remote_uuid: fresh, verify_uuids: [] });
  });

  it("waits, counted, when ServiceM8 can't be asked", async () => {
    const { ids, old } = await again();
    readSm8Attachment.mockResolvedValueOnce({ ok: false });
    const run = await runSm8Writes(ORG, "send", { ids, clock: () => NOW });
    expect(postSm8Attachment).not.toHaveBeenCalled();
    expect(run.stopped).toBe(WRITE_WORDS.unreachable);
    expect(writes()[0]).toMatchObject({ status: "queued", attempts: 1, verify_uuids: [old] });
  });
});

describe("an upload that may have landed is checked, whatever came between", () => {
  const lost = { status: null, outcome: { kind: "unavailable", status: null }, remote: null };
  const due = () => (writes()[0].next_attempt_at = new Date(NOW).toISOString());

  it("through Off, a trial run and back: the lost upload is still checked, and never uploaded twice", async () => {
    /* U1's upload times out and lands unseen. Off cancels it; a press makes
       U2 and keeps U1 to check; a trial run uploads nothing under U2. The
       next live press must still check U1 — not U2, which never went */
    const { ids } = await queue("d1");
    const u1 = String(writes()[0].remote_uuid);
    postSm8Attachment.mockResolvedValueOnce(lost);
    await runSm8Writes(ORG, "send", { ids, clock: () => NOW });
    expect(writes()[0]).toMatchObject({ status: "queued", maybe_landed: true });

    await setSm8WriteMode(ORG, "off", NOW);
    db.integration_connections[0].write_mode = "trial";
    await queue("d1");
    const u2 = String(writes()[0].remote_uuid);
    expect(writes()[0]).toMatchObject({ verify_uuids: [u1], maybe_landed: false });
    await runSm8Writes(ORG, "send", { ids, clock: () => NOW });
    expect(writes()[0]).toMatchObject({ status: "trial", attempts: 1, verify_uuids: [u1], maybe_landed: false });

    db.integration_connections[0].write_mode = "live";
    await queue("d1");
    expect(writes()[0].verify_uuids).toEqual([u1]);
    expect(writes()[0].replaced_uuids).toEqual([u1, u2]);

    readSm8Attachment.mockResolvedValueOnce({ ok: true, found: true, jobUuid: "job-1", active: true });
    await runSm8Writes(ORG, "send", { ids, clock: () => NOW });
    expect(readSm8Attachment).toHaveBeenCalledWith(W1, u1);
    expect(postSm8Attachment).toHaveBeenCalledTimes(1);
    expect(writes()[0]).toMatchObject({ status: "sent", remote_uuid: u1, verify_uuids: [] });
  });

  it("through a check that couldn't be read until the row gave up", async () => {
    const { ids } = await queue("d1");
    const u1 = String(writes()[0].remote_uuid);
    postSm8Attachment.mockResolvedValueOnce(lost);
    await runSm8Writes(ORG, "send", { ids, clock: () => NOW });
    Object.assign(writes()[0], { status: "failed" });
    await queue("d1");
    expect(writes()[0].verify_uuids).toEqual([u1]);

    readSm8Attachment.mockResolvedValue({ ok: false });
    for (let i = 0; i < 6; i++) {
      due();
      await runSm8Writes(ORG, "send", { ids, clock: () => NOW });
    }
    expect(writes()[0]).toMatchObject({ status: "failed", last_error: WRITE_WORDS.gaveUp, verify_uuids: [u1], maybe_landed: false });

    await queue("d1");
    expect(writes()[0].verify_uuids).toEqual([u1]);
    expect(postSm8Attachment).toHaveBeenCalledTimes(1);
  });

  it("after a 409 whose record couldn't be read back — a record exists under that uuid, and may be ours", async () => {
    const { ids } = await queue("d1");
    const u1 = String(writes()[0].remote_uuid);
    postSm8Attachment.mockResolvedValueOnce({ status: 409, outcome: { kind: "exists" }, remote: null });
    readSm8Attachment.mockResolvedValueOnce({ ok: false });
    await runSm8Writes(ORG, "send", { ids, clock: () => NOW });
    expect(writes()[0]).toMatchObject({ status: "queued", http_status: 409, maybe_landed: true });
    Object.assign(writes()[0], { status: "failed" });
    await queue("d1");
    expect(writes()[0].verify_uuids).toEqual([u1]);
  });

  it("after a sender that never finished its upload", async () => {
    /* the claim marks the uuid before the upload goes; a sender that loses
       its row mid-upload records nothing, and the mark is what is left */
    const { ids } = await queue("d1");
    const u1 = String(writes()[0].remote_uuid);
    postSm8Attachment.mockImplementationOnce(async () => {
      Object.assign(writes()[0], { status: "cancelled", last_error: WRITE_WORDS.switchedOff });
      return { status: 200, outcome: { kind: "created", remoteUuid: null }, remote: null };
    });
    const run = await runSm8Writes(ORG, "send", { ids, clock: () => NOW });
    expect(run.lost).toBe(1);
    expect(writes()[0]).toMatchObject({ status: "cancelled", maybe_landed: true });

    await queue("d1");
    expect(writes()[0].verify_uuids).toEqual([u1]);
    readSm8Attachment.mockResolvedValueOnce({ ok: true, found: true, jobUuid: "job-1", active: true });
    await runSm8Writes(ORG, "send", { ids, clock: () => NOW });
    expect(postSm8Attachment).toHaveBeenCalledTimes(1);
    expect(writes()[0]).toMatchObject({ status: "sent", remote_uuid: u1 });
  });

  it("but not after an answer ServiceM8 meant, or a trial run", async () => {
    const { ids } = await queue("d1", "d2");
    postSm8Attachment.mockResolvedValueOnce({ status: 413, outcome: { kind: "rejected", status: 413 }, remote: null });
    await runSm8Writes(ORG, "send", { ids, clock: () => NOW });
    expect(writes()[0]).toMatchObject({ status: "failed", maybe_landed: false });
    expect(writes()[1]).toMatchObject({ status: "sent", maybe_landed: false });

    db.integration_connections[0].write_mode = "trial";
    await queue("d3");
    await runSm8Writes(ORG, "send", { clock: () => NOW });
    expect(writes()[2]).toMatchObject({ status: "trial", maybe_landed: false });
  });
});

describe("one sender per row, to the end", () => {
  it("a sender whose claim was taken over records nothing", async () => {
    const { ids } = await queue("d1");
    postSm8Attachment.mockImplementation(async () => {
      // the lease lapsed mid-request and a second sender took the row
      Object.assign(writes()[0], { claim_id: "other", attempts: 2 });
      return { status: 200, outcome: { kind: "created", remoteUuid: null } };
    });
    const run = await runSm8Writes(ORG, "send", { ids, clock: () => NOW });
    expect(run).toMatchObject({ done: 1, lost: 1, sent: 0 });
    expect(writes()[0]).toMatchObject({ status: "sending", claim_id: "other", attempts: 2 });
    expect(writes()[0].sent_at).toBeUndefined();
  });

  it("with too little of its claim left, lets go of the row without uploading", async () => {
    const { ids } = await queue("d1");
    let t = NOW;
    onDownload = () => {
      t += 40_000; // a slow read of the file
    };
    const run = await runSm8Writes(ORG, "send", { ids, clock: () => t });
    expect(postSm8Attachment).not.toHaveBeenCalled();
    expect(run.again).toBe(1);
    expect(writes()[0]).toMatchObject({ status: "queued", attempts: 0, free_retries: 1, lease_until: null, claim_id: null });
    expect(writes()[0].next_attempt_at).toBe(new Date(t).toISOString());
  });

  it("lets go twice at most, then stops for a person", async () => {
    const { ids } = await queue("d1");
    let t = NOW;
    onDownload = () => {
      t += 40_000;
    };
    for (let i = 0; i < 3; i++) await runSm8Writes(ORG, "send", { ids, clock: () => t });
    expect(postSm8Attachment).not.toHaveBeenCalled();
    expect(writes()[0]).toMatchObject({ status: "failed", last_error: WRITE_WORDS.tooSlowGaveUp });
  });
});

describe("a refusal stops what it should", () => {
  const scope403 = {
    status: 403,
    outcome: { kind: "forbidden", scope: true },
    remote: { code: null, message: 'insufficient_scope: "manage_attachments" scope required' },
  };
  const generic403 = { status: 403, outcome: { kind: "forbidden", scope: false }, remote: null };

  it("a 403 for scope holds the file and its kind until a reconnect, and asks nothing more of ServiceM8", async () => {
    const { ids } = await queue("d1", "d2");
    postSm8Attachment.mockResolvedValueOnce(scope403);
    const run = await runSm8Writes(ORG, "send", { ids, clock: () => NOW });
    expect(run).toMatchObject({ done: 1, stopped: WRITE_WORDS.scopeHeld });
    expect(writes()[0]).toMatchObject({ status: "queued", attempts: 0, last_error: WRITE_WORDS.scopeHeld });
    expect(db.integration_connections[0].write_scope_refused).toEqual({ attachment: new Date(NOW).toISOString() });
    // the next file was never tried
    expect(writes()[1]).toMatchObject({ status: "queued", attempts: 0 });

    // the next run posts nothing
    const next = await runSm8Writes(ORG, "kick", { clock: () => NOW });
    expect(next.stopped).toBe(WRITE_WORDS.scopeHeld);
    expect(postSm8Attachment).toHaveBeenCalledTimes(1);

    // a reconnect since clears it
    db.integration_connections[0].connected_at = new Date(NOW + 60_000).toISOString();
    const after = await runSm8Writes(ORG, "kick", { clock: () => NOW });
    expect(after.sent).toBe(2);
  });

  it("any other 403 fails only its own file, and the next one goes", async () => {
    const { ids } = await queue("d1", "d2");
    postSm8Attachment.mockResolvedValueOnce(generic403);
    const run = await runSm8Writes(ORG, "send", { ids, clock: () => NOW });
    expect(run).toMatchObject({ done: 2, failed: 1, sent: 1, stopped: null });
    expect(writes()[0]).toMatchObject({ status: "failed", last_error: WRITE_WORDS.forbidden });
    expect(writes()[1].status).toBe("sent");
    expect(db.integration_connections[0].write_scope_refused).toEqual({});
  });

  it("two 403s in a row end the run", async () => {
    const { ids } = await queue("d1", "d2", "d3");
    postSm8Attachment.mockResolvedValueOnce(generic403).mockResolvedValueOnce(generic403);
    const run = await runSm8Writes(ORG, "send", { ids, clock: () => NOW });
    expect(run).toMatchObject({ done: 2, failed: 2, stopped: WRITE_WORDS.forbidden });
    expect(writes()[2]).toMatchObject({ status: "queued", attempts: 0 });
  });

  it("a daily limit holds every file waiting until it resets", async () => {
    const { ids } = await queue("d1", "d2");
    postSm8Attachment.mockResolvedValueOnce({ status: 429, outcome: { kind: "rate_limited", limit: "day" } });
    await runSm8Writes(ORG, "send", { ids, clock: () => NOW });
    // 11:00 in Sydney: its midnight is 14:00 UTC, and the reset is tried five minutes after
    const reset = "2026-09-24T14:05:00.000Z";
    expect(writes()[0]).toMatchObject({ status: "queued", attempts: 0, last_error: WRITE_WORDS.dailyLimit, next_attempt_at: reset });
    expect(writes()[1].next_attempt_at).toBe(reset);
  });

  it("an account not in good standing holds every file waiting for 12 hours", async () => {
    const { ids } = await queue("d1", "d2");
    postSm8Attachment.mockResolvedValueOnce({ status: 402, outcome: { kind: "payment_required" } });
    await runSm8Writes(ORG, "send", { ids, clock: () => NOW });
    const later = new Date(NOW + 12 * 3_600_000).toISOString();
    expect(writes()[0]).toMatchObject({ status: "queued", last_error: WRITE_WORDS.billing, next_attempt_at: later });
    expect(writes()[1].next_attempt_at).toBe(later);
  });
});

describe("bounds", () => {
  it("sends at most a batch a run", async () => {
    db.documents = Array.from({ length: WRITE_BATCH + 3 }, (_, i) => doc(`x${i}`));
    await queue(...db.documents.map((d) => String(d.id)));
    const run = await runSm8Writes(ORG, "cron", { clock: () => NOW });
    expect(run.done).toBe(WRITE_BATCH);
  });

  it("stops claiming once a waiting person has waited long enough", async () => {
    const { ids } = await queue("d1", "d2");
    let t = NOW;
    const clock = () => t;
    postSm8Attachment.mockImplementation(async () => {
      t += 25_000;
      return { status: 200, outcome: { kind: "created", remoteUuid: null } };
    });
    const run = await runSm8Writes(ORG, "send", { ids, budgetMs: 20_000, clock });
    expect(run.done).toBe(1);
    expect(writes()[1].status).toBe("queued");
  });

  it("isn't due before its wait is over", async () => {
    await queue("d1");
    writes()[0].next_attempt_at = new Date(NOW + 60_000).toISOString();
    expect((await runSm8Writes(ORG, "kick", { clock: () => NOW })).done).toBe(0);
  });
});

describe("the switch, and cancelling", () => {
  it("off cancels what is waiting, leaves what went, and says what it cancelled", async () => {
    await queue("d1", "d2");
    writes()[1].status = "sent";
    expect(await setSm8WriteMode(ORG, "off", NOW)).toEqual({
      ok: true,
      cancelled: [{ id: writes()[0].id, name: "d1.pdf", kind: "attachment" }],
    });
    expect(db.integration_connections[0].write_mode).toBe("off");
    expect(writes()[0]).toMatchObject({ status: "cancelled", last_error: WRITE_WORDS.switchedOff });
    expect(writes()[1].status).toBe("sent");
  });

  it("says so when there's no connection to switch", async () => {
    db.integration_connections = [];
    expect(await setSm8WriteMode(ORG, "live", NOW)).toEqual({ ok: false });
  });

  it("paused records that the owner paused it, and when, and keeps what is waiting", async () => {
    await queue("d1");
    expect(await setSm8WriteMode(ORG, "paused", NOW)).toEqual({ ok: true, cancelled: [] });
    expect(db.integration_connections[0]).toMatchObject({
      write_mode: "paused",
      paused_reason: "owner",
      paused_at: new Date(NOW).toISOString(),
    });
    expect(writes()[0].status).toBe("queued");
  });

  it("switching back on clears who paused it and keeps when — the cap counts from it", async () => {
    Object.assign(db.integration_connections[0], {
      write_mode: "paused",
      paused_reason: "cap",
      paused_at: "2026-09-24T00:30:00.000Z",
    });
    expect((await setSm8WriteMode(ORG, "live", NOW)).ok).toBe(true);
    expect(db.integration_connections[0]).toMatchObject({
      write_mode: "live",
      paused_reason: null,
      paused_at: "2026-09-24T00:30:00.000Z",
    });
  });

  it("switches every setting but Paused on a database without the pause columns yet", async () => {
    missingColumns.add("paused_reason");
    expect(await setSm8WriteMode(ORG, "trial", NOW)).toEqual({ ok: true, cancelled: [] });
    expect(db.integration_connections[0].write_mode).toBe("trial");
    expect(await setSm8WriteMode(ORG, "live", NOW)).toEqual({ ok: true, cancelled: [] });
    expect(db.integration_connections[0].write_mode).toBe("live");
    // Paused needs them: it says so rather than half-switching
    expect(await setSm8WriteMode(ORG, "paused", NOW)).toEqual({ ok: false });
    expect(db.integration_connections[0].write_mode).toBe("live");
  });

  it("leaves a send in flight alone, and takes one whose claim has lapsed", async () => {
    await queue("d1", "d2");
    Object.assign(writes()[0], { status: "sending", lease_until: new Date(NOW + 60_000).toISOString() });
    Object.assign(writes()[1], { status: "sending", lease_until: new Date(NOW - 60_000).toISOString() });
    await cancelWaitingSm8Writes(ORG, "because", NOW);
    expect(writes()[0].status).toBe("sending");
    expect(writes()[1].status).toBe("cancelled");
  });

  it("says what it cancelled, by the name each file would have gone under", async () => {
    await queue("d1", "d2");
    writes()[1].status = "sent";
    expect(await cancelWaitingSm8Writes(ORG, "because", NOW)).toEqual([
      { id: writes()[0].id, name: "d1.pdf", kind: "attachment" },
    ]);
  });

  it("counts what is waiting and what is in flight by the same rule the cancel uses", async () => {
    await queue("d1", "d2", "d3");
    Object.assign(writes()[1], { status: "sending", lease_until: new Date(NOW + 60_000).toISOString() });
    Object.assign(writes()[2], { status: "sending", lease_until: new Date(NOW - 60_000).toISOString() });
    expect(await countWaitingSm8Writes(ORG, NOW)).toBe(2);
    expect(await countSm8WritesInFlight(ORG, NOW)).toBe(1);
    await cancelWaitingSm8Writes(ORG, "because", NOW);
    expect(await countWaitingSm8Writes(ORG, NOW)).toBe(0);
  });
});

describe("what is due", () => {
  it("says so only when something of a kind this deployment writes is due", async () => {
    expect(await sm8WritesDue(ORG, NOW)).toBe(false);
    await queue("d1");
    expect(await sm8WritesDue(ORG, NOW)).toBe(true);
    // not yet: a retry waiting for its minute
    writes()[0].next_attempt_at = new Date(NOW + 60_000).toISOString();
    expect(await sm8WritesDue(ORG, NOW)).toBe(false);
  });

  it("ignores a kind the operator's allow-list doesn't name", async () => {
    await queue("d1");
    writes()[0].kind = "note";
    expect(await sm8WritesDue(ORG, NOW)).toBe(false);
    delete process.env.SM8_WRITES;
    writes()[0].kind = "attachment";
    expect(await sm8WritesDue(ORG, NOW)).toBe(false);
  });

  it("a queue that can't be read is nothing due", async () => {
    await queue("d1");
    failing.add("sm8_writes");
    expect(await sm8WritesDue(ORG, NOW)).toBe(false);
  });

  it("gives the nightly sweep each workspace with something due, once", async () => {
    await queue("d1", "d2");
    db.sm8_writes.push({ ...writes()[0], id: "other", org_id: "org-2" });
    expect((await orgsWithDueSm8Writes(10, NOW)).sort()).toEqual([ORG, "org-2"]);
    delete process.env.SM8_WRITES;
    expect(await orgsWithDueSm8Writes(10, NOW)).toEqual([]);
  });
});

/* ── the account's call limit ──

   Every request the sender makes takes a turn from the account's counter on
   lane `write`. A turn refused is nobody's fault: the attempt is handed
   back, and the run ends, because the next row would be refused the same. */
describe("the account's call limit", () => {
  it("a send the counter had no room for waits its minute, the attempt handed back, and ends the run", async () => {
    const { ids } = await queue("d1", "d2");
    postSm8Attachment.mockResolvedValue({
      status: null,
      outcome: { kind: "rate_limited", limit: "ours", waitMs: 20_000 },
      remote: null,
    });
    const run = await runSm8Writes(ORG, "send", { ids, clock: () => NOW });
    expect(run).toMatchObject({ done: 1, sent: 0, stopped: WRITE_WORDS.paced });
    expect(writes()[0]).toMatchObject({ status: "queued", attempts: 0, last_error: WRITE_WORDS.paced });
    expect(writes()[0].next_attempt_at).toBe(new Date(NOW + 60_000).toISOString());
    // nothing went, so nothing may have landed
    expect(writes()[0].maybe_landed).toBe(false);
    // the next file waits with it, untried
    expect(postSm8Attachment).toHaveBeenCalledTimes(1);
    expect(writes()[1].next_attempt_at).toBe(new Date(NOW + 60_000).toISOString());
  });

  const counterRefused = (waitMs: number, day = false) => ({
    ok: false,
    limited: { kind: "rate_limited", limit: "ours", waitMs, day },
  });

  it("a send refused for the day says so, and waits what the counter said, though that is under an hour", async () => {
    // ServiceM8's daily 429 was recorded 10 s ago: its hour's cooldown has 59 min 50 s to run
    const { ids } = await queue("d1");
    postSm8Attachment.mockResolvedValue({
      status: null,
      outcome: { kind: "rate_limited", limit: "ours", waitMs: 3_590_000, day: true },
      remote: null,
    });
    const run = await runSm8Writes(ORG, "send", { ids, clock: () => NOW });
    expect(run.stopped).toBe(WRITE_WORDS.dailyLimit);
    expect(writes()[0]).toMatchObject({ status: "queued", attempts: 0, last_error: WRITE_WORDS.dailyLimit });
    expect(writes()[0].next_attempt_at).toBe(new Date(NOW + 3_590_000).toISOString());
  });

  it("a read-back after a 409 the counter had no room for is handed back, not spent", async () => {
    const { ids } = await queue("d1");
    postSm8Attachment.mockResolvedValue({ status: 409, outcome: { kind: "exists" }, remote: null });
    readSm8Attachment.mockResolvedValue(counterRefused(20_000));
    const run = await runSm8Writes(ORG, "send", { ids, clock: () => NOW });
    expect(readSm8Attachment).toHaveBeenCalledWith(W1, writes()[0].remote_uuid);
    expect(run.stopped).toBe(WRITE_WORDS.paced);
    expect(writes()[0]).toMatchObject({ status: "queued", attempts: 0, last_error: WRITE_WORDS.paced });
    // a record is there under our uuid: it may have landed
    expect(writes()[0].maybe_landed).toBe(true);
  });

  it("a read-back refused under the day's cooldown keeps the counter's wait, not a minute", async () => {
    const { ids } = await queue("d1");
    postSm8Attachment.mockResolvedValue({ status: 409, outcome: { kind: "exists" }, remote: null });
    readSm8Attachment.mockResolvedValue(counterRefused(3_590_000, true));
    const run = await runSm8Writes(ORG, "send", { ids, clock: () => NOW });
    expect(run.stopped).toBe(WRITE_WORDS.dailyLimit);
    expect(writes()[0]).toMatchObject({ status: "queued", attempts: 0, last_error: WRITE_WORDS.dailyLimit });
    expect(writes()[0].next_attempt_at).toBe(new Date(NOW + 3_590_000).toISOString());
  });

  it("a check before a re-press the counter had no room for is handed back, and the check kept", async () => {
    const old = "0b1c2d3e-4f50-4617-8829-3a4b5c6d7e8f";
    const { ids } = await queue("d1");
    Object.assign(writes()[0], { verify_uuids: [old] });
    readSm8Attachment.mockResolvedValue(counterRefused(20_000));
    const run = await runSm8Writes(ORG, "send", { ids, clock: () => NOW });
    expect(readSm8Attachment).toHaveBeenCalledWith(W1, old);
    expect(postSm8Attachment).not.toHaveBeenCalled();
    expect(run.stopped).toBe(WRITE_WORDS.paced);
    expect(writes()[0]).toMatchObject({ status: "queued", attempts: 0, verify_uuids: [old] });
  });

  it("a check before a re-press refused under the day's cooldown waits it out, the check kept", async () => {
    const old = "0b1c2d3e-4f50-4617-8829-3a4b5c6d7e8f";
    const { ids } = await queue("d1");
    Object.assign(writes()[0], { verify_uuids: [old] });
    readSm8Attachment.mockResolvedValue(counterRefused(3_590_000, true));
    await runSm8Writes(ORG, "send", { ids, clock: () => NOW });
    expect(writes()[0]).toMatchObject({ status: "queued", attempts: 0, verify_uuids: [old], last_error: WRITE_WORDS.dailyLimit });
    expect(writes()[0].next_attempt_at).toBe(new Date(NOW + 3_590_000).toISOString());
  });

  it("a check that failed any other way still spends the attempt, as before", async () => {
    const old = "0b1c2d3e-4f50-4617-8829-3a4b5c6d7e8f";
    const { ids } = await queue("d1");
    Object.assign(writes()[0], { verify_uuids: [old] });
    readSm8Attachment.mockResolvedValue({ ok: false });
    await runSm8Writes(ORG, "send", { ids, clock: () => NOW });
    expect(writes()[0]).toMatchObject({ status: "queued", attempts: 1, last_error: WRITE_WORDS.unreachable });
  });
});

describe("the owner's Retry failed files", () => {
  const failed = (id: string, over: Row = {}) => {
    db.sm8_writes.push({
      id,
      org_id: ORG,
      tenant_id: "vendor-1",
      kind: "attachment",
      sm8_job_uuid: "job-1",
      subject: `document:${id}`,
      dedupe_key: `attachment:job-1:document:${id}`,
      payload: { documentId: id, name: `${id}.pdf` },
      remote_uuid: `uuid-${id}`,
      replaced_uuids: [],
      status: "failed",
      attempts: 6,
      http_status: 413,
      verify_uuids: [],
      pressed_at: "2026-09-20T00:00:00.000Z",
      updated_at: `2026-09-2${id.length}T00:00:00.000Z`,
      ...over,
    });
  };

  it("queues what the hour has room for, oldest first, and says how many are left", async () => {
    for (let i = 0; i < 58; i++) {
      db.sm8_writes.push({ id: `h${i}`, org_id: ORG, tenant_id: "vendor-1", status: "sent", pressed_at: new Date(NOW - 60_000).toISOString() });
    }
    failed("a", { updated_at: "2026-09-20T00:00:00.000Z" });
    failed("b", { updated_at: "2026-09-21T00:00:00.000Z" });
    failed("c", { updated_at: "2026-09-22T00:00:00.000Z" });
    const r = await retryFailedSm8Writes(press, await readSm8WriteState(ORG), NOW);
    expect(r).toEqual({ queued: 2, left: 1, capped: false, byHour: true });
    const byId = (id: string) => writes().find((w) => w.id === id)!;
    expect(byId("a")).toMatchObject({ status: "queued", attempts: 0, replaced_uuids: ["uuid-a"], requested_by_user: "auth0|isaac" });
    expect(byId("b").status).toBe("queued");
    expect(byId("c").status).toBe("failed");
    // it never trips Pause
    expect(db.integration_connections[0].write_mode).toBe("live");
  });

  it("leaves another ServiceM8 account's failures alone", async () => {
    failed("a");
    failed("b", { tenant_id: "vendor-old" });
    const r = await retryFailedSm8Writes(press, await readSm8WriteState(ORG), NOW);
    expect(r).toMatchObject({ queued: 1, left: 0 });
    expect(writes().find((w) => w.id === "b")!.status).toBe("failed");
  });

  it("says when the hour has no room at all", async () => {
    for (let i = 0; i < 60; i++) {
      db.sm8_writes.push({ id: `h${i}`, org_id: ORG, tenant_id: "vendor-1", status: "sent", pressed_at: new Date(NOW - 60_000).toISOString() });
    }
    failed("a");
    expect(await retryFailedSm8Writes(press, await readSm8WriteState(ORG), NOW)).toEqual({
      queued: 0,
      left: 1,
      capped: true,
      byHour: true,
    });
  });

  it("takes nothing but a press", async () => {
    failed("a");
    expect(await retryFailedSm8Writes({ ...press } as Sm8Press, await readSm8WriteState(ORG), NOW)).toBeNull();
    expect(writes()[0].status).toBe("failed");
  });
});

describe("what the owner's bell reads", () => {
  it("says nothing while the queue is moving, or empty", async () => {
    expect(await sm8QueueStuck(ORG, NOW)).toBeNull();
    await queue("d1");
    expect(await sm8QueueStuck(ORG, NOW)).toBeNull();
  });

  it("says HeyTiff paused sending at the cap, with how many are waiting", async () => {
    await queue("d1", "d2");
    Object.assign(db.integration_connections[0], { write_mode: "paused", paused_reason: "cap" });
    expect(await sm8QueueStuck(ORG, NOW)).toEqual({ reason: "cap", waiting: 2, kinds: { attachment: 2, note: 0 } });
  });

  it("forgets the cap once sending isn't paused — a change of account switched it off", async () => {
    await queue("d1");
    Object.assign(db.integration_connections[0], { write_mode: "off", paused_reason: "cap" });
    expect(await sm8QueueStuck(ORG, NOW)).toBeNull();
  });

  it("says nothing of the owner's own pause", async () => {
    await queue("d1");
    Object.assign(db.integration_connections[0], { write_mode: "paused", paused_reason: "owner" });
    expect(await sm8QueueStuck(ORG, NOW)).toBeNull();
  });

  it("asks for a reconnect when files wait on a grant that doesn't work, or a permission refused", async () => {
    await queue("d1");
    db.integration_connections[0].status = "needs_reauth";
    const one = { attachment: 1, note: 0 };
    expect(await sm8QueueStuck(ORG, NOW)).toEqual({ reason: "reconnect", waiting: 1, kinds: one });
    db.integration_connections[0].status = "connected";
    db.integration_connections[0].write_scope_refused = { attachment: new Date(NOW).toISOString() };
    expect(await sm8QueueStuck(ORG, NOW)).toEqual({ reason: "reconnect", waiting: 1, kinds: one });
  });

  it("says when ServiceM8 holds files for an account not in good standing", async () => {
    await queue("d1");
    writes()[0].last_error = WRITE_WORDS.billing;
    expect(await sm8QueueStuck(ORG, NOW)).toEqual({ reason: "billing", waiting: 1, kinds: { attachment: 1, note: 0 } });
  });

  it("reads nothing on a deployment that doesn't write", async () => {
    await queue("d1");
    db.integration_connections[0].status = "needs_reauth";
    delete process.env.SM8_WRITES;
    expect(await sm8QueueStuck(ORG, NOW)).toBeNull();
  });
});

describe("what the card and the screen read", () => {
  it("gives the card each file's write", async () => {
    await queue("d1");
    writes()[0].status = "sent";
    expect(await readJobSends(ORG, "job-1")).toEqual([
      { documentId: "d1", status: "sent", error: null, attempts: 0, remoteUuid: writes()[0].remote_uuid },
    ]);
  });

  it("gives the owner the latest writes, by name, job and who asked", async () => {
    await queue("d1");
    expect(await listRecentSm8Writes(ORG, NOW)).toEqual([
      expect.objectContaining({ name: "d1.pdf", jobNumber: "2380", by: "Isaac Smith", status: "queued" }),
    ]);
  });

  it("gives every write of the last 30 days, not the latest few", async () => {
    db.documents = Array.from({ length: 12 }, (_, i) => doc(`x${i}`));
    await queue(...db.documents.map((d) => String(d.id)));
    writes().forEach((w, i) => Object.assign(w, { status: "sent", updated_at: new Date(NOW - i * 60_000).toISOString() }));
    const listed = await listRecentSm8Writes(ORG, NOW);
    expect(listed).toHaveLength(12);
    // latest first
    expect(listed[0].id).toBe(writes()[0].id);
  });

  it("keeps a failed write however old, and lets an old sent one go", async () => {
    await queue("d1", "d2");
    Object.assign(writes()[0], { status: "failed", updated_at: "2026-06-01T00:00:00.000Z" });
    Object.assign(writes()[1], { status: "sent", updated_at: "2026-06-01T00:00:00.000Z" });
    expect((await listRecentSm8Writes(ORG, NOW)).map((w) => w.id)).toEqual([writes()[0].id]);
  });

  it("counts what is waiting, and what failed", async () => {
    await queue("d1", "d2", "d3");
    writes()[2].status = "failed";
    expect(await countSm8Queue(ORG, "vendor-1", NOW)).toEqual({
      waiting: 2,
      failed: 1,
      waitingKinds: { attachment: 2, note: 0 },
    });
  });

  it("counts only the connected account's failures — the ones Retry failed files can reach", async () => {
    await queue("d1", "d2");
    Object.assign(writes()[0], { status: "failed", tenant_id: "vendor-old" });
    writes()[1].status = "sent";
    expect(await countSm8Queue(ORG, "vendor-1", NOW)).toEqual({
      waiting: 0,
      failed: 0,
      waitingKinds: { attachment: 0, note: 0 },
    });
    // and Retry agrees there is nothing of this account's to go again
    expect(await retryFailedSm8Writes(press, await readSm8WriteState(ORG), NOW)).toMatchObject({ queued: 0, left: 0 });
    // no account named: nothing counted as failed
    expect((await countSm8Queue(ORG, null, NOW)).failed).toBe(0);
  });
});
