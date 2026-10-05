/**
 * @jest-environment node
 */

/* Accepted quotes to ServiceM8 — the engine, end to end: the quote queue's
   one door and the sender, over the fake database (its shape check
   included), with ServiceM8 replaced by a fake account whose DELETE of a
   removed line PUTS IT BACK, as the live one is taken to (Isaac,
   2026-10-05: "copy the scope and line items to service mate"). */

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
jest.mock("../sm8-store", () => ({
  sm8AccessResult: (...a: unknown[]) => sm8AccessResult(...a),
  renewSm8Access: (...a: unknown[]) => renewSm8Access(...a),
  markSm8NeedsReauth: jest.fn(async () => true),
}));

const calls: { what: string; path: string; body?: Row }[] = [];
const fns = { postSm8JobMaterial: jest.fn(), postSm8RecordUpdate: jest.fn(), deleteSm8JobMaterial: jest.fn(), readSm8Raw: jest.fn() };
jest.mock("../sm8-write", () => ({
  postSm8JobMaterial: (...a: unknown[]) => fns.postSm8JobMaterial(...a),
  postSm8RecordUpdate: (...a: unknown[]) => fns.postSm8RecordUpdate(...a),
  deleteSm8JobMaterial: (...a: unknown[]) => fns.deleteSm8JobMaterial(...a),
  readSm8Raw: (...a: unknown[]) => fns.readSm8Raw(...a),
}));
const getSession = jest.fn();
jest.mock("@/lib/auth0", () => ({ auth0: { getSession: (...a: unknown[]) => getSession(...a) } }));
jest.mock("@/lib/fleet/query", () => ({ staffProfileIdFor: jest.fn(async () => "staff-boss") }));
jest.mock("next/server", () => ({ after: jest.fn() }));
jest.mock("@/lib/workboard/job-notes-query", () => ({ staffDisplayNames: jest.fn(async () => new Map()) }));

import { sm8PressFromSession } from "../sm8-press";
import { runSm8Writes } from "../sm8-writes";
import { QUOTE_WORDS, quoteRows } from "../sm8-quote-plan";
import { queueAcceptedQuote } from "@/app/actions/sm8-quote-queue";

const ORG = "org-1";
const TENANT = "vendor-1";
const ACCESS = { accessToken: "token-1", tenantId: TENANT, grant: "g1", meter: TENANT };
const JOB = "0b1e0b1e-0000-4000-8000-000000000001";
const OLD = "9e9e9e9e-0000-4000-8000-000000000001";
const PRESS = "7e7e7e7e-0000-4000-8000-000000000001";

let records: Map<string, Row>;
let nextDelete: "ok" | "lost" = "ok";
const ok = (uuid: string | null = null) => ({ status: 200, outcome: { kind: "created", remoteUuid: uuid }, remote: null, recordUuid: uuid });
const lost = () => ({ status: null, outcome: { kind: "unavailable", status: null }, remote: null, recordUuid: null });

function wire() {
  fns.readSm8Raw.mockImplementation(async (_c: unknown, object: string, uuid: string) => {
    const r = records.get(`${object}:${uuid.toLowerCase()}`);
    return r ? { ok: true, found: true, row: { ...r }, active: r.active as number } : { ok: true, found: false };
  });
  fns.postSm8JobMaterial.mockImplementation(async (_c: unknown, uuid: string, jobUuid: string, fields: Row) => {
    calls.push({ what: "create", path: "jobmaterial", body: { uuid, job_uuid: jobUuid, ...fields } });
    records.set(`jobmaterial:${uuid.toLowerCase()}`, { uuid, job_uuid: jobUuid, ...fields, active: 1 });
    return ok(uuid);
  });
  fns.postSm8RecordUpdate.mockImplementation(async (_c: unknown, object: string, uuid: string, body: Row) => {
    calls.push({ what: "update", path: object, body });
    Object.assign(records.get(`${object}:${uuid.toLowerCase()}`)!, body);
    return ok(uuid);
  });
  fns.deleteSm8JobMaterial.mockImplementation(async (_c: unknown, uuid: string) => {
    calls.push({ what: "delete", path: "jobmaterial" });
    const r = records.get(`jobmaterial:${uuid.toLowerCase()}`)!;
    /* THE TRAP: a DELETE on a removed record puts it back */
    r.active = r.active === 1 ? 0 : 1;
    const how = nextDelete;
    nextDelete = "ok";
    return how === "lost" ? lost() : ok(uuid);
  });
}

const plan = {
  status: { from: "Quote", to: "Work Order" },
  workDone: "Option 1: 3-head multi\n- Three high walls",
  lines: [{ name: "Option 1: 3-head multi, as per quote", quantity: 1, unitPriceCents: 1_150_000, unitCostCents: 700_000 }],
  remove: [{ uuid: OLD, name: "As Per Quote" }],
  taxRateUuid: "e8260719-4f70-42c7-8811-20fe6c03874b",
};

async function send(p = plan) {
  getSession.mockResolvedValue({ orgId: ORG, user: { sub: "auth0|boss" } });
  const press = (await sm8PressFromSession())!;
  return queueAcceptedQuote(press, PRESS, JOB, quoteRows(JOB, p));
}
const run = () => runSm8Writes(ORG, "send", { clock: Date.now });
const rows = () => (fake.db.sm8_writes as Row[]).filter((w) => w.kind === "quote");
const due = () => {
  for (const w of fake.db.sm8_writes as Row[]) w.next_attempt_at = new Date(Date.now() - 1000).toISOString();
};

beforeEach(() => {
  fake.reset();
  calls.length = 0;
  nextDelete = "ok";
  records = new Map<string, Row>([
    [`job:${JOB}`, { uuid: JOB, status: "Quote", work_done_description: "", active: 1 }],
    [`jobmaterial:${OLD}`, { uuid: OLD, job_uuid: JOB, name: "As Per Quote", quantity: "1.0000", price: "11500.0000", active: 1 }],
  ]);
  fake.db.integration_connections = [
    {
      org_id: ORG,
      provider: "servicem8",
      status: "connected",
      tenant_id: TENANT,
      tenants: [{ tenantId: TENANT, tenantName: "Acme Air", timezoneName: "Australia/Sydney" }],
      scopes: "vendor read_jobs manage_attachments manage_jobs manage_job_materials",
      write_mode: "live",
      paused_reason: null,
      paused_at: null,
      write_scope_refused: {},
      connected_at: "2026-09-01T00:00:00.000Z",
      write_kinds: ["attachment", "quote"],
    },
  ];
  fake.db.integration_links = [];
  fake.db.staff_profiles = [{ id: "staff-boss", org_id: ORG, first_name: "Isaac", last_name: "Smith", full_name: "Isaac Smith", preferred_name: null }];
  fake.db.sm8_writes = [];
  process.env.SM8_WRITES = "attachment,quote";
  sm8AccessResult.mockReset().mockResolvedValue({ ok: true, access: ACCESS });
  renewSm8Access.mockReset().mockResolvedValue({ ok: true, access: ACCESS });
  for (const m of Object.values(fns)) m.mockReset();
  wire();
  jest.spyOn(console, "error").mockImplementation(() => {});
  jest.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());
afterAll(() => {
  delete process.env.SM8_WRITES;
});

describe("an accepted quote goes to ServiceM8", () => {
  it("makes the job a Work Order with its scope, takes the old line off, and puts the quote's line on under our uuid", async () => {
    const q = await send();
    expect(q.ok).toBe(true);
    await run();
    expect(calls.map((c) => [c.what, c.path])).toEqual(
      expect.arrayContaining([
        ["update", "job"],
        ["delete", "jobmaterial"],
        ["create", "jobmaterial"],
      ])
    );
    expect(calls.find((c) => c.what === "update")!.body).toEqual({ work_done_description: plan.workDone, status: "Work Order" });
    const line = calls.find((c) => c.what === "create")!.body!;
    expect(line).toMatchObject({
      job_uuid: JOB,
      name: "Option 1: 3-head multi, as per quote",
      quantity: "1",
      price: "11500.0000",
      cost: "7000.0000",
      displayed_amount_is_tax_inclusive: "0",
      tax_rate_uuid: plan.taxRateUuid,
    });
    /* the line's uuid is the row's own, chosen before the first send */
    expect(rows().find((r) => r.op === "create")!.remote_uuid).toBe(line.uuid);
    expect(records.get(`jobmaterial:${OLD}`)!.active).toBe(0);
    expect(rows().every((r) => r.status === "sent")).toBe(true);
  });

  it("sends a Work Order's own status back unchanged when it isn't a Quote any more", async () => {
    records.get(`job:${JOB}`)!.status = "Work Order";
    await send({ ...plan, status: null as never, remove: [] });
    await run();
    expect(calls.find((c) => c.what === "update")!.body).toEqual({ work_done_description: plan.workDone, status: "Work Order" });
  });

  it("doesn't touch a job that was completed meanwhile", async () => {
    records.get(`job:${JOB}`)!.status = "Completed";
    await send({ ...plan, remove: [], lines: [] });
    await run();
    expect(calls).toEqual([]);
    expect(rows()[0]).toMatchObject({ status: "cancelled", last_error: QUOTE_WORDS.row.notQuote });
  });

  it("takes an old line off once, and never sends a second DELETE to one still there after a lost answer", async () => {
    await send({ ...plan, lines: [] });
    nextDelete = "lost";
    await run();
    expect(calls.filter((c) => c.what === "delete")).toHaveLength(1);
    due();
    await run();
    expect(calls.filter((c) => c.what === "delete")).toHaveLength(1);
    expect(rows().find((r) => r.op === "delete")).toMatchObject({ status: "sent" });
  });

  it("sends no DELETE to a line somebody already removed in ServiceM8", async () => {
    records.get(`jobmaterial:${OLD}`)!.active = 0;
    await send({ ...plan, lines: [] });
    await run();
    expect(calls.filter((c) => c.what === "delete")).toEqual([]);
    expect(rows().find((r) => r.op === "delete")).toMatchObject({ status: "sent" });
  });

  it("is the same rows when the same send is pressed twice", async () => {
    await send();
    await send();
    expect(rows()).toHaveLength(3);
  });

  it("sends nothing on a trial run", async () => {
    (fake.db.integration_connections as Row[])[0]!.write_mode = "trial";
    await send();
    await run();
    expect(calls).toEqual([]);
    expect(rows().every((r) => r.status === "trial")).toBe(true);
  });

  it("queues nothing while the owner has Accepted quotes off", async () => {
    (fake.db.integration_connections as Row[])[0]!.write_kinds = ["attachment"];
    expect(await send()).toEqual({ ok: false, error: QUOTE_WORDS.press.kindOff });
    expect(rows()).toEqual([]);
  });
});

describe("where the deployment doesn't send quotes", () => {
  it.each(["1", "attachment,note,booking,leave", "attachment,customer"])("queues nothing with SM8_WRITES=%j", async (setting) => {
    process.env.SM8_WRITES = setting;
    fake.log.length = 0;
    expect(await send()).toEqual({ ok: false, error: QUOTE_WORDS.card.quotesUnavailable });
    expect(fake.log.filter((l) => l.table === "sm8_writes" || l.table === "integration_connections")).toEqual([]);
  });
});
