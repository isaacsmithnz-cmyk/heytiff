/**
 * @jest-environment node
 */

/* A new job in ServiceM8 — the engine, end to end.

   The job queue's one door (app/actions/sm8-job-queue) and the sender
   (sm8-writes' run, sm8-job-send) against an in-memory database that keeps
   the new-job migration's own rules — its shape check included
   (fixtures/sm8-fake-db) — with ServiceM8 replaced at the request functions
   by a fake account: a record under our uuid, read back through the list,
   and answers that can be lost after they landed. */

import { makeFakeDb } from "./fixtures/sm8-fake-db";

type Row = Record<string, unknown>;

const fake = makeFakeDb();
jest.mock("@/lib/supabase-server", () => ({
  supabaseAdmin: {
    from: (t: string) => fake.from(t),
    rpc: (n: string, a: Record<string, unknown>) => fake.rpc(n, a),
    storage: { from: () => ({ download: async () => ({ data: null, error: { message: "none" } }) }) },
  },
}));

const sm8AccessResult = jest.fn();
const renewSm8Access = jest.fn();
const markSm8NeedsReauth = jest.fn();
jest.mock("../sm8-store", () => ({
  sm8AccessResult: (...a: unknown[]) => sm8AccessResult(...a),
  renewSm8Access: (...a: unknown[]) => renewSm8Access(...a),
  markSm8NeedsReauth: (...a: unknown[]) => markSm8NeedsReauth(...a),
}));

const posts: { what: string; body: Row }[] = [];
const fns = {
  postSm8Company: jest.fn(),
  postSm8NewJob: jest.fn(),
  postSm8JobContact: jest.fn(),
  readSm8Company: jest.fn(),
  readSm8NewJob: jest.fn(),
  readSm8JobContact: jest.fn(),
};
jest.mock("../sm8-write", () => ({
  postSm8Company: (...a: unknown[]) => fns.postSm8Company(...a),
  postSm8NewJob: (...a: unknown[]) => fns.postSm8NewJob(...a),
  postSm8JobContact: (...a: unknown[]) => fns.postSm8JobContact(...a),
  readSm8Company: (...a: unknown[]) => fns.readSm8Company(...a),
  readSm8NewJob: (...a: unknown[]) => fns.readSm8NewJob(...a),
  readSm8JobContact: (...a: unknown[]) => fns.readSm8JobContact(...a),
}));

const getSession = jest.fn();
jest.mock("@/lib/auth0", () => ({ auth0: { getSession: (...a: unknown[]) => getSession(...a) } }));
jest.mock("@/lib/fleet/query", () => ({ staffProfileIdFor: jest.fn(async () => "staff-boss") }));
const after = jest.fn();
jest.mock("next/server", () => ({ after: (fn: unknown) => after(fn) }));
jest.mock("@/lib/workboard/job-notes-query", () => ({ staffDisplayNames: jest.fn(async () => new Map()) }));

import { sm8PressFromSession, type Sm8Press } from "../sm8-press";
import { runSm8Writes } from "../sm8-writes";
import { JOB_WORDS, validNewJob, type NewJobInput } from "../sm8-job-plan";
import { queueNewJob } from "@/app/actions/sm8-job-queue";

const ORG = "org-1";
const TENANT = "vendor-1";
const ACCESS = { accessToken: "token-1", tenantId: TENANT, grant: "g1", meter: TENANT };
const BUILDER = "c0c0c0c0-0000-4000-8000-0000000000b1";
const CLIENT = "c0c0c0c0-0000-4000-8000-0000000000c1";
const CATEGORY = "ca7ca7ca-0000-4000-8000-000000000001";
const PRESS_ID = "9e9e9e9e-0000-4000-8000-000000000001";

/* ── the account ── */

type Rec = { uuid: string; active: number; parent: string | null; number: string | null };
let records: Map<string, Rec>;
let numbers = 3400;
/** How the next POST of each step answers. */
const next: Record<string, "ok" | "lost" | "down" | "refused" | "theirs"> = {};

const answer = (status: number | null, kind: "created" | "unavailable" | "rejected", uuid: string | null = null) => ({
  status,
  outcome: kind === "created" ? { kind, remoteUuid: uuid } : { kind, status },
  remote: null,
  recordUuid: uuid,
});

function wireAccount(): void {
  const post = (what: string, parentOf: (b: Row) => string | null, number: boolean) => async (_call: unknown, b: Row) => {
    const how = next[what] ?? "ok";
    next[what] = "ok";
    posts.push({ what, body: b });
    if (how === "down") return answer(null, "unavailable");
    if (how === "refused") return answer(400, "rejected");
    const uuid = how === "theirs" ? `${String(b.uuid).slice(0, 30)}ffffff` : String(b.uuid);
    records.set(uuid.toLowerCase(), { uuid, active: 1, parent: parentOf(b), number: number ? String(++numbers) : null });
    return how === "lost" ? answer(null, "unavailable") : answer(200, "created", uuid);
  };
  fns.postSm8Company.mockImplementation(async (c: unknown, b: Row) => post("company", (x) => (x.parentUuid as string) ?? null, false)(c, { ...b }));
  fns.postSm8NewJob.mockImplementation(async (c: unknown, b: Row) => post("job", (x) => x.companyUuid as string, true)(c, { ...b }));
  fns.postSm8JobContact.mockImplementation(async (c: unknown, b: Row) => post("contact", (x) => x.jobUuid as string, false)(c, { ...b }));
  const read = async (_call: unknown, uuid: string) => {
    const r = records.get(uuid.toLowerCase());
    return r ? { ok: true, found: true, record: { ...r, editDate: null } } : { ok: true, found: false };
  };
  fns.readSm8Company.mockImplementation(read);
  fns.readSm8NewJob.mockImplementation(read);
  fns.readSm8JobContact.mockImplementation(read);
}

/* ── the workspace ── */

function connection(over: Row = {}): Row {
  return {
    org_id: ORG,
    provider: "servicem8",
    status: "connected",
    tenant_id: TENANT,
    tenants: [{ tenantId: TENANT, tenantName: "Acme Air", timezoneName: "Australia/Sydney" }],
    scopes: "vendor read_jobs read_customers manage_attachments create_jobs manage_customers manage_job_contacts",
    write_mode: "live",
    paused_reason: null,
    paused_at: null,
    write_scope_refused: {},
    connected_at: "2026-09-01T00:00:00.000Z",
    write_kinds: ["attachment", "job"],
    ...over,
  };
}

async function press(): Promise<Sm8Press> {
  getSession.mockResolvedValue({ orgId: ORG, user: { sub: "auth0|boss" } });
  return (await sm8PressFromSession())!;
}

const rows = () => (fake.db.sm8_writes as Row[]).filter((w) => w.kind === "job");
const run = () => runSm8Writes(ORG, "send", { clock: Date.now });
const due = () => {
  for (const w of fake.db.sm8_writes as Row[]) w.next_attempt_at = new Date(Date.now() - 1000).toISOString();
};
const contact = { first: "Sarah", last: "Jones", mobile: "0426 719 412", phone: "", email: "sarah@example.com" };

async function queue(input: Partial<NewJobInput> = {}) {
  const v = validNewJob({
    client: { kind: "new", name: "Sarah Jones", address: "" },
    jobAddress: "14 Raglan St, Mosman",
    description: "Quote a 7 kW ducted",
    categoryUuid: null,
    contact,
    ...input,
  });
  if (!v.ok) throw new Error(v.error);
  return queueNewJob(await press(), PRESS_ID, v.job, "Sarah Jones");
}

beforeEach(() => {
  fake.reset();
  records = new Map();
  numbers = 3400;
  posts.length = 0;
  for (const k of Object.keys(next)) delete next[k];
  fake.db.integration_connections = [connection()];
  fake.db.integration_links = [];
  fake.db.staff_profiles = [{ id: "staff-boss", org_id: ORG, first_name: "Isaac", last_name: "Smith", full_name: "Isaac Smith", preferred_name: null }];
  fake.db.sm8_companies = [
    { org_id: ORG, uuid: BUILDER, name: "Built By MK", active: 1, parent_company_uuid: null },
    { org_id: ORG, uuid: CLIENT, name: "Tim Scott", active: 1, parent_company_uuid: null },
  ];
  fake.db.sm8_categories = [{ org_id: ORG, uuid: CATEGORY, name: "Install", active: 1 }];
  fake.db.sm8_writes = [];
  process.env.SM8_WRITES = "attachment,job";
  sm8AccessResult.mockReset().mockResolvedValue({ ok: true, access: ACCESS });
  renewSm8Access.mockReset().mockResolvedValue({ ok: true, access: ACCESS });
  markSm8NeedsReauth.mockReset().mockResolvedValue(true);
  for (const m of Object.values(fns)) m.mockReset();
  after.mockReset();
  wireAccount();
  jest.spyOn(console, "error").mockImplementation(() => {});
  jest.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => jest.restoreAllMocks());
afterAll(() => {
  delete process.env.SM8_WRITES;
});

describe("a new job goes to ServiceM8", () => {
  it("is queued as one row, its uuids chosen once, and a second press of the form is the same row", async () => {
    const q = await queue();
    expect(q).toMatchObject({ ok: true, again: false });
    expect(rows()).toHaveLength(1);
    const r = rows()[0]!;
    expect(r).toMatchObject({ kind: "job", op: "create", sm8_job_uuid: null, subject: `job:${PRESS_ID}`, job_company_new: "client", payload: { name: "New job for Sarah Jones" } });
    expect(r.job_company_uuid).toEqual(expect.stringMatching(/^[0-9a-f-]{36}$/));
    expect(r.job_contact_uuid).toEqual(expect.stringMatching(/^[0-9a-f-]{36}$/));
    await queue();
    expect(rows()).toHaveLength(1);
  });

  it("makes the client, then the job under it, then its contact under the job — each under our uuid — and keeps the job's number", async () => {
    await queue({ categoryUuid: CATEGORY });
    const r = rows()[0]!;
    await run();
    expect(posts.map((p) => p.what)).toEqual(["company", "job", "contact"]);
    expect(posts[0]!.body).toMatchObject({ uuid: r.job_company_uuid, name: "Sarah Jones", address: "14 Raglan St, Mosman" });
    expect(posts[1]!.body).toMatchObject({ uuid: r.remote_uuid, companyUuid: r.job_company_uuid, categoryUuid: CATEGORY });
    expect(posts[2]!.body).toMatchObject({ uuid: r.job_contact_uuid, jobUuid: r.remote_uuid, first: "Sarah", mobile: "0426 719 412" });
    expect(rows()[0]).toMatchObject({ status: "sent", job_done: ["company", "job", "contact"], job_number: "3401", maybe_landed: false });
  });

  it("puts a job under an existing client with no client step, and a site under its builder", async () => {
    await queue({ client: { kind: "existing", uuid: CLIENT }, contact: null });
    await run();
    expect(posts.map((p) => p.what)).toEqual(["job"]);
    expect(posts[0]!.body).toMatchObject({ companyUuid: CLIENT });

    fake.db.sm8_writes = [];
    posts.length = 0;
    const v = validNewJob({ client: { kind: "site", parentUuid: BUILDER, address: "41 Waverley St, Bondi Junction" }, jobAddress: "41 Waverley St, Bondi Junction", description: "Split", categoryUuid: null, contact: null });
    await queueNewJob(await press(), "9e9e9e9e-0000-4000-8000-000000000002", (v as { ok: true; job: never }).job, "Built By MK");
    await run();
    expect(posts.map((p) => p.what)).toEqual(["company", "job"]);
    expect(posts[0]!.body).toMatchObject({ name: "41 Waverley St, Bondi Junction", parentUuid: BUILDER });
  });

  it("never makes a step twice: a job whose answer was lost after it landed is read back next time, and the contact goes", async () => {
    await queue();
    next.job = "lost";
    await run();
    expect(rows()[0]).toMatchObject({ status: "queued", job_done: ["company"], maybe_landed: true });
    due();
    await run();
    expect(posts.map((p) => p.what)).toEqual(["company", "job", "contact"]);
    expect(rows()[0]).toMatchObject({ status: "sent", job_done: ["company", "job", "contact"] });
  });

  it("makes a job again under the SAME uuid when its answer was lost before it landed", async () => {
    await queue({ contact: null, client: { kind: "existing", uuid: CLIENT } });
    next.job = "down";
    await run();
    const first = posts[0]!.body.uuid;
    due();
    await run();
    expect(posts.map((p) => p.what)).toEqual(["job", "job"]);
    expect(posts[1]!.body.uuid).toBe(first);
    expect(rows()[0]).toMatchObject({ status: "sent" });
  });

  it("follows ServiceM8's own uuid when it keeps the job under another: the contact names that one", async () => {
    await queue({ client: { kind: "existing", uuid: CLIENT } });
    next.job = "theirs";
    await run();
    const kept = String(posts[0]!.body.uuid).slice(0, 30) + "ffffff";
    expect(posts[1]!.body).toMatchObject({ jobUuid: kept });
    expect(rows()[0]).toMatchObject({ status: "sent", remote_uuid: kept });
  });

  it("sends nothing at all on a trial run — a job may be charged", async () => {
    fake.db.integration_connections = [connection({ write_mode: "trial" })];
    await queue();
    await run();
    expect(posts).toEqual([]);
    expect(rows()[0]).toMatchObject({ status: "trial" });
  });

  it("says so when the client was made and the job refused", async () => {
    await queue({ contact: null });
    next.job = "refused";
    await run();
    expect(rows()[0]).toMatchObject({ status: "failed", job_done: ["company"] });
    expect(rows()[0]!.last_error).toMatch(/Sarah Jones was added to ServiceM8 as a client, but the job wasn't/);
  });

  it("doesn't make a job under a client ServiceM8 no longer has", async () => {
    (fake.db.sm8_companies as Row[])[1]!.active = 0;
    await queue({ client: { kind: "existing", uuid: CLIENT } });
    await run();
    expect(posts).toEqual([]);
    expect(rows()[0]).toMatchObject({ status: "cancelled", last_error: JOB_WORDS.row.clientGone });
  });

  it("never sends a job again that somebody removed in ServiceM8 after a lost answer", async () => {
    await queue({ client: { kind: "existing", uuid: CLIENT }, contact: null });
    next.job = "lost";
    await run();
    const uuid = String(posts[0]!.body.uuid).toLowerCase();
    records.get(uuid)!.active = 0;
    due();
    await run();
    expect(posts.map((p) => p.what)).toEqual(["job"]);
    expect(rows()[0]).toMatchObject({ status: "failed", last_error: JOB_WORDS.row.jobRemovedThere });
  });
});

describe("where the deployment doesn't send new jobs", () => {
  it.each(["1", "attachment,note", "attachment,note,booking", "attachment,note,booking,leave"])("queues nothing and reads nothing, with SM8_WRITES=%j", async (setting) => {
    process.env.SM8_WRITES = setting;
    const v = validNewJob({ client: { kind: "existing", uuid: CLIENT }, jobAddress: "a", description: "b", categoryUuid: null, contact: null });
    fake.log.length = 0;
    const q = await queueNewJob(await press(), PRESS_ID, (v as { ok: true; job: never }).job, "x");
    expect(q).toEqual({ ok: false, error: JOB_WORDS.card.jobsUnavailable });
    expect(fake.log.filter((l) => l.table === "sm8_writes" || l.table === "integration_connections")).toEqual([]);
  });
});
