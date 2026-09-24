/**
 * @jest-environment node
 */

/* The write path's plumbing — queued, claimed, sent, recorded — against an
   in-memory table, so the rules that matter are exercised rather than
   described: nothing goes without the deployment's, the owner's and the
   account's yes; one sender per row; a retry reuses its uuid; a trial run
   goes everywhere but ServiceM8; and a refusal stops what it should. */

type Row = Record<string, unknown>;

const db: Record<string, Row[]> = {};
const downloads: string[] = [];
let storageFails = false;

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
    const rows = db[table];
    if (op === "upsert") {
      const made: Row[] = [];
      for (const r of incoming) {
        const clash = rows.some((x) => conflict.every((c) => x[c] === r[c]));
        if (clash) continue;
        const row = { id: `w${rows.length + 1}`, ...r };
        rows.push(row);
        made.push(row);
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
    in: (c: string, vs: unknown[]) => (filters.push((r) => vs.includes(r[c])), q),
    lte: (c: string, v: string) => (filters.push((r) => String(r[c]) <= v), q),
    lt: (c: string, v: string) => (filters.push((r) => r[c] != null && String(r[c]) < v), q),
    gte: (c: string, v: string) => (filters.push((r) => r[c] != null && String(r[c]) >= v), q),
    or: (expr: string) => (filters.push(parseOr(expr)), q),
    order: (col: string, o: { ascending: boolean }) => ((order = { col, asc: o.ascending }), q),
    limit: (n: number) => ((limit = n), q),
    maybeSingle: async () => {
      const res = exec();
      return { data: (res.data as Row[] | null)?.[0] ?? null, error: null };
    },
    then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(exec()).then(res, rej),
  };
  return q;
}

jest.mock("@/lib/supabase-server", () => ({
  supabaseAdmin: {
    from: (t: string) => from(t),
    storage: {
      from: () => ({
        download: async (ref: string) => {
          downloads.push(ref);
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

const scheduled: (() => unknown)[] = [];
jest.mock("next/server", () => ({ after: (fn: () => unknown) => scheduled.push(fn) }));
jest.mock("@/lib/workboard/job-notes-query", () => ({
  staffDisplayNames: jest.fn(async () => new Map([["staff-isaac", "Isaac Smith"]])),
}));

import { countSm8WritesInFlight, countWaitingSm8Writes } from "../sm8-write-cancel";
import {
  cancelWaitingSm8Writes,
  enqueueAttachments,
  kickSm8WritesIfDue,
  listRecentSm8Writes,
  orgsWithDueSm8Writes,
  readJobSends,
  readSm8WriteState,
  runSm8Writes,
  setSm8WriteMode,
} from "../sm8-writes";
import { WRITE_BATCH, WRITE_WORDS } from "../sm8-write-plan";
import { SM8_REVOKED } from "../sm8-sync-plan";

const ACCESS = { accessToken: "token-1", tenantId: "vendor-1", grant: "g1" };
const RENEWED = { accessToken: "token-2", tenantId: "vendor-1", grant: "g2" };

const NOW = Date.parse("2026-09-24T01:00:00.000Z");
const ORG = "org-1";

const connection = (over: Row = {}): Row => ({
  org_id: ORG,
  provider: "servicem8",
  status: "connected",
  tenant_id: "vendor-1",
  scopes: "vendor read_jobs manage_attachments",
  write_mode: "live",
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

const file = (documentId: string, over: Partial<Parameters<typeof enqueueAttachments>[3][number]> = {}) => ({
  jobUuid: "job-1",
  documentId,
  name: `${documentId}.pdf`,
  mimeType: "application/pdf",
  sizeBytes: 4,
  key: `d:${documentId}`,
  ...over,
});

const writes = () => db.sm8_writes;

beforeEach(() => {
  for (const k of Object.keys(db)) delete db[k];
  db.integration_connections = [connection()];
  db.documents = [doc("d1"), doc("d2"), doc("d3")];
  db.sm8_writes = [];
  db.sm8_jobs = [{ org_id: ORG, uuid: "job-1", generated_job_id: "2380" }];
  downloads.length = 0;
  storageFails = false;
  scheduled.length = 0;
  process.env.SM8_WRITES = "1";
  sm8AccessResult.mockReset().mockResolvedValue({ ok: true, access: ACCESS });
  renewSm8Access.mockReset().mockResolvedValue({ ok: true, access: RENEWED });
  markSm8NeedsReauth.mockReset().mockResolvedValue(true);
  postSm8Attachment.mockReset().mockResolvedValue({ status: 200, outcome: { kind: "created", remoteUuid: null } });
  readSm8Attachment.mockReset();
});

afterAll(() => {
  delete process.env.SM8_WRITES;
});

const queue = async (...ids: string[]) =>
  (await enqueueAttachments(ORG, "vendor-1", "staff-isaac", ids.map((id) => file(id)), NOW))!;

describe("where writing stands", () => {
  it("needs the deployment's switch, the owner's and a grant that can write", async () => {
    expect(await readSm8WriteState(ORG)).toEqual({
      deployment: true,
      mode: "live",
      connected: true,
      tenantId: "vendor-1",
      granted: true,
    });
    delete process.env.SM8_WRITES;
    expect((await readSm8WriteState(ORG)).deployment).toBe(false);
  });

  it("reads a workspace with no connection as switched off", async () => {
    db.integration_connections = [];
    expect(await readSm8WriteState(ORG)).toMatchObject({ mode: "off", tenantId: null, granted: false });
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
    expect(q).toEqual({ ids: [], already: ["d1", "d2"] });
    expect(writes()).toHaveLength(2);
  });

  it("asks again for a file that failed, under the SAME uuid, from scratch", async () => {
    await queue("d1");
    Object.assign(writes()[0], { status: "failed", attempts: 6, last_error: "x", http_status: 500 });
    const uuid = writes()[0].remote_uuid;
    const q = await queue("d1");
    expect(q.ids).toEqual([writes()[0].id]);
    expect(writes()[0]).toMatchObject({ status: "queued", attempts: 0, last_error: null, http_status: null, remote_uuid: uuid });
  });

  it("brings a waiting retry forward, keeping its count", async () => {
    await queue("d1");
    Object.assign(writes()[0], { attempts: 2, next_attempt_at: "2026-09-24T09:00:00.000Z" });
    await queue("d1");
    expect(writes()[0]).toMatchObject({ status: "queued", attempts: 2, next_attempt_at: new Date(NOW).toISOString() });
  });
});

describe("sending", () => {
  it("sends each due file once, with our uuid and the file's own bytes, and records it sent", async () => {
    const { ids } = await queue("d1");
    const run = await runSm8Writes(ORG, "send", { ids, clock: () => NOW });
    expect(run).toMatchObject({ done: 1, sent: 1, failed: 0, stopped: null });
    expect(postSm8Attachment).toHaveBeenCalledWith("token-1", {
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
    expect(run.stopped).toBe(WRITE_WORDS.forbidden);
    expect(postSm8Attachment).not.toHaveBeenCalled();
    expect(writes()[0].status).toBe("queued");
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
    expect(postSm8Attachment.mock.calls.map((c) => c[0])).toEqual(["token-1", "token-2"]);
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
    postSm8Attachment.mockImplementation(async (token: string) =>
      token === "token-1"
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
    expect(readSm8Attachment).toHaveBeenCalledWith("token-1", writes()[0].remote_uuid);
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
  it("off cancels what is waiting and leaves what went", async () => {
    await queue("d1", "d2");
    writes()[1].status = "sent";
    expect(await setSm8WriteMode(ORG, "off", NOW)).toBe(true);
    expect(db.integration_connections[0].write_mode).toBe("off");
    expect(writes()[0]).toMatchObject({ status: "cancelled", last_error: WRITE_WORDS.switchedOff });
    expect(writes()[1].status).toBe("sent");
  });

  it("says so when there's no connection to switch", async () => {
    db.integration_connections = [];
    expect(await setSm8WriteMode(ORG, "live", NOW)).toBe(false);
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
    expect(await cancelWaitingSm8Writes(ORG, "because", NOW)).toEqual([{ id: writes()[0].id, name: "d1.pdf" }]);
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

describe("kicks", () => {
  it("schedules a sender after the response only when something is due", async () => {
    await kickSm8WritesIfDue(ORG, NOW);
    expect(scheduled).toHaveLength(0);
    await queue("d1");
    await kickSm8WritesIfDue(ORG, NOW);
    expect(scheduled).toHaveLength(1);
  });

  it("gives the nightly sweep each workspace with something due, once", async () => {
    await queue("d1", "d2");
    db.sm8_writes.push({ ...writes()[0], id: "other", org_id: "org-2" });
    expect((await orgsWithDueSm8Writes(10, NOW)).sort()).toEqual([ORG, "org-2"]);
    delete process.env.SM8_WRITES;
    expect(await orgsWithDueSm8Writes(10, NOW)).toEqual([]);
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
    expect(await listRecentSm8Writes(ORG)).toEqual([
      expect.objectContaining({ name: "d1.pdf", jobNumber: "2380", by: "Isaac Smith", status: "queued" }),
    ]);
  });
});
