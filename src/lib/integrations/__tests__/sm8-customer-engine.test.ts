/**
 * @jest-environment node
 */

/* Customer details to ServiceM8 — the engine, end to end: the customer
   queue's one door and the sender, over the fake database (its shape check
   included), with ServiceM8 replaced by a fake account whose DELETE of a
   removed record PUTS IT BACK, as the live one is taken to. */

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
const fns = { postSm8NewJobContact: jest.fn(), postSm8RecordUpdate: jest.fn(), deleteSm8JobContact: jest.fn(), readSm8Raw: jest.fn() };
jest.mock("../sm8-write", () => ({
  postSm8NewJobContact: (...a: unknown[]) => fns.postSm8NewJobContact(...a),
  postSm8RecordUpdate: (...a: unknown[]) => fns.postSm8RecordUpdate(...a),
  deleteSm8JobContact: (...a: unknown[]) => fns.deleteSm8JobContact(...a),
  readSm8Raw: (...a: unknown[]) => fns.readSm8Raw(...a),
}));
const getSession = jest.fn();
jest.mock("@/lib/auth0", () => ({ auth0: { getSession: (...a: unknown[]) => getSession(...a) } }));
jest.mock("@/lib/fleet/query", () => ({ staffProfileIdFor: jest.fn(async () => "staff-boss") }));
jest.mock("next/server", () => ({ after: jest.fn() }));
jest.mock("@/lib/workboard/job-notes-query", () => ({ staffDisplayNames: jest.fn(async () => new Map()) }));

import { sm8PressFromSession } from "../sm8-press";
import { runSm8Writes } from "../sm8-writes";
import { CUSTOMER_WORDS, customerChanges, type CustomerForm } from "../sm8-customer-plan";
import { queueCustomerChanges } from "@/app/actions/sm8-customer-queue";

const ORG = "org-1";
const TENANT = "vendor-1";
const ACCESS = { accessToken: "token-1", tenantId: TENANT, grant: "g1", meter: TENANT };
const JOB = "0b1e0b1e-0000-4000-8000-000000000001";
const CO = "c0c0c0c0-0000-4000-8000-000000000001";
const P1 = "9e9e9e9e-0000-4000-8000-000000000001";
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
  fns.postSm8NewJobContact.mockImplementation(async (_c: unknown, uuid: string, jobUuid: string, fields: Row) => {
    calls.push({ what: "create", path: "jobcontact", body: { uuid, job_uuid: jobUuid, ...fields } });
    records.set(`jobcontact:${uuid.toLowerCase()}`, { uuid, job_uuid: jobUuid, ...fields, active: 1 });
    return ok(uuid);
  });
  fns.postSm8RecordUpdate.mockImplementation(async (_c: unknown, object: string, uuid: string, body: Row) => {
    calls.push({ what: "update", path: object, body });
    const r = records.get(`${object}:${uuid.toLowerCase()}`)!;
    Object.assign(r, body);
    return ok(uuid);
  });
  fns.deleteSm8JobContact.mockImplementation(async (_c: unknown, uuid: string) => {
    calls.push({ what: "delete", path: "jobcontact" });
    const r = records.get(`jobcontact:${uuid.toLowerCase()}`)!;
    /* THE TRAP: a DELETE on a removed record puts it back */
    r.active = r.active === 1 ? 0 : 1;
    const how = nextDelete;
    nextDelete = "ok";
    return how === "lost" ? lost() : ok(uuid);
  });
}

const base: CustomerForm = {
  jobUuid: JOB,
  company: { uuid: CO, name: "Pagewood Hotel", address: "1 Pagewood Rd" },
  billingAddress: "Cliff Rd, Watsons Bay",
  contacts: [{ uuid: P1, first: "Jeff", last: "Fletcher", mobile: "0411", phone: "", email: "", type: "JOB" }],
};

async function save(after: CustomerForm) {
  getSession.mockResolvedValue({ orgId: ORG, user: { sub: "auth0|boss" } });
  const press = (await sm8PressFromSession())!;
  const d = customerChanges(base, after);
  if (!d.ok) throw new Error(d.error);
  return queueCustomerChanges(press, PRESS, JOB, d.changes);
}
const run = () => runSm8Writes(ORG, "send", { clock: Date.now });
const rows = () => (fake.db.sm8_writes as Row[]).filter((w) => w.kind === "customer");
const due = () => {
  for (const w of fake.db.sm8_writes as Row[]) w.next_attempt_at = new Date(Date.now() - 1000).toISOString();
};

beforeEach(() => {
  fake.reset();
  calls.length = 0;
  nextDelete = "ok";
  records = new Map<string, Row>([
    [`company:${CO}`, { uuid: CO, name: "Pagewood Hotel", address: "1 Pagewood Rd", active: 1 }],
    [`job:${JOB}`, { uuid: JOB, status: "Work Order", billing_address: "Cliff Rd, Watsons Bay", active: 1 }],
    [`jobcontact:${P1}`, { uuid: P1, job_uuid: JOB, first: "Jeff", last: "Fletcher", type: "JOB", active: 1 }],
  ]);
  fake.db.integration_connections = [
    {
      org_id: ORG,
      provider: "servicem8",
      status: "connected",
      tenant_id: TENANT,
      tenants: [{ tenantId: TENANT, tenantName: "Acme Air", timezoneName: "Australia/Sydney" }],
      scopes: "vendor read_jobs manage_attachments manage_job_contacts manage_customers manage_jobs manage_schedule",
      write_mode: "live",
      paused_reason: null,
      paused_at: null,
      write_scope_refused: {},
      connected_at: "2026-09-01T00:00:00.000Z",
      write_kinds: ["attachment", "customer"],
    },
  ];
  fake.db.integration_links = [];
  fake.db.staff_profiles = [{ id: "staff-boss", org_id: ORG, first_name: "Isaac", last_name: "Smith", full_name: "Isaac Smith", preferred_name: null }];
  fake.db.sm8_writes = [];
  process.env.SM8_WRITES = "attachment,customer";
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

describe("a customer save goes to ServiceM8", () => {
  it("sends each record only what changed — and the one field each update needs, as it stands live", async () => {
    await save({ ...base, company: { uuid: CO, name: "Pagewood Hotel", address: "2 Pagewood Rd" }, billingAddress: "1 Pagewood Rd" });
    await run();
    expect(calls).toEqual([
      { what: "update", path: "company", body: { address: "2 Pagewood Rd", name: "Pagewood Hotel" } },
      { what: "update", path: "job", body: { billing_address: "1 Pagewood Rd", status: "Work Order" } },
    ]);
    expect(rows().map((r) => r.status)).toEqual(["sent", "sent"]);
  });

  it("adds a contact under our uuid on the job, and changes a role", async () => {
    await save({ ...base, contacts: [{ ...base.contacts[0]!, type: "Site Contact" }, { uuid: null, first: "Kim", last: "Lee", mobile: "0400", phone: "", email: "", type: "BILLING" }] });
    await run();
    expect(calls.map((c) => [c.what, c.body?.type])).toEqual([
      ["update", "Site Contact"],
      ["create", "BILLING"],
    ]);
    expect(calls[1]!.body).toMatchObject({ job_uuid: JOB, first: "Kim" });
    expect(rows().every((r) => r.status === "sent")).toBe(true);
  });

  it("removes a contact once, and never sends a second DELETE to one still there after a lost answer", async () => {
    await save({ ...base, contacts: [] });
    nextDelete = "lost";
    await run();
    expect(calls.map((c) => c.what)).toEqual(["delete"]);
    /* the lost DELETE landed: next time it reads removed, and nothing goes */
    due();
    await run();
    expect(calls.map((c) => c.what)).toEqual(["delete"]);
    expect(rows()[0]).toMatchObject({ status: "sent" });
  });

  it("sends no DELETE to a contact somebody already removed in ServiceM8", async () => {
    records.get(`jobcontact:${P1}`)!.active = 0;
    await save({ ...base, contacts: [] });
    await run();
    expect(calls).toEqual([]);
    expect(rows()[0]).toMatchObject({ status: "sent" });
  });

  it("doesn't change a record ServiceM8 no longer has", async () => {
    records.get(`company:${CO}`)!.active = 0;
    await save({ ...base, company: { uuid: CO, name: "New name", address: "1 Pagewood Rd" } });
    await run();
    expect(calls).toEqual([]);
    expect(rows()[0]).toMatchObject({ status: "cancelled", last_error: CUSTOMER_WORDS.row.gone });
  });

  it("sends nothing on a trial run", async () => {
    (fake.db.integration_connections as Row[])[0]!.write_mode = "trial";
    await save({ ...base, billingAddress: "x" });
    await run();
    expect(calls).toEqual([]);
    expect(rows()[0]).toMatchObject({ status: "trial" });
  });
});

describe("where the deployment doesn't save customer changes", () => {
  it.each(["1", "attachment,note,booking,leave", "attachment,job"])("queues nothing with SM8_WRITES=%j", async (setting) => {
    process.env.SM8_WRITES = setting;
    fake.log.length = 0;
    expect(await save({ ...base, billingAddress: "x" })).toEqual({ ok: false, error: CUSTOMER_WORDS.card.customersUnavailable });
    expect(fake.log.filter((l) => l.table === "sm8_writes" || l.table === "integration_connections")).toEqual([]);
  });
});
