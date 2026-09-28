/**
 * @jest-environment node
 */

/* Leave on the ServiceM8 board — the engine, end to end.

   The leave queue's two doors (app/actions/sm8-leave-queue) and the sender
   (sm8-writes' run, sm8-leave-send) against an in-memory database that
   keeps the leave migration's own rules — its shape check included
   (fixtures/sm8-fake-db) — with ServiceM8 replaced at the request
   functions by a fake board that behaves as the live account is taken to:
   a record under our uuid, read back through the list, soft-deleted by a
   DELETE, and A DELETE ON LEAVE ALREADY OFF THE BOARD PUTTING IT BACK. */

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

const postSm8Availability = jest.fn();
const deleteSm8Availability = jest.fn();
const readSm8Availability = jest.fn();
jest.mock("../sm8-write", () => ({
  postSm8Availability: (...a: unknown[]) => postSm8Availability(...a),
  deleteSm8Availability: (...a: unknown[]) => deleteSm8Availability(...a),
  readSm8Availability: (...a: unknown[]) => readSm8Availability(...a),
}));

const getSession = jest.fn();
jest.mock("@/lib/auth0", () => ({ auth0: { getSession: (...a: unknown[]) => getSession(...a) } }));
jest.mock("@/lib/fleet/query", () => ({ staffProfileIdFor: jest.fn(async () => "staff-boss") }));
const after = jest.fn();
jest.mock("next/server", () => ({ after: (fn: unknown) => after(fn) }));
jest.mock("@/lib/workboard/job-notes-query", () => ({ staffDisplayNames: jest.fn(async () => new Map()) }));

import { sm8PressFromSession, type Sm8Press } from "../sm8-press";
import { runSm8Writes } from "../sm8-writes";
import { LEAVE_WORDS } from "../sm8-leave-plan";
import { queueLeaveOffBoard, queueLeaveOnBoard } from "@/app/actions/sm8-leave-queue";

const ORG = "org-1";
const TENANT = "vendor-1";
const SAM = "staff-sam";
const SAM_SM8 = "5a0e5a0e-0000-4000-8000-00000000a001";
const ACCESS = { accessToken: "token-1", tenantId: TENANT, grant: "g1", meter: TENANT };

/* ── the board ── */

type Avail = { uuid: string; regardingUuid: string; name: string; type: string; start: string; end: string; active: number; editDate: string };

let board: Map<string, Avail>;
/** How the next POST or DELETE answers: as asked, lost after it landed, or
    refused before it landed. */
let nextPost: "ok" | "lost" | "down" = "ok";
let nextDelete: "ok" | "lost" = "ok";
let edits = 0;

const answer = (status: number | null, kind: "created" | "unavailable", uuid: string | null = null) => ({
  status,
  outcome: kind === "created" ? { kind, remoteUuid: uuid } : { kind, status },
  remote: null,
  recordUuid: uuid,
});

function wireBoard(): void {
  postSm8Availability.mockImplementation(async (_call: unknown, a: { uuid: string; staffUuid: string; name: string; start: string; end: string }) => {
    const how = nextPost;
    nextPost = "ok";
    if (how === "down") return answer(null, "unavailable");
    board.set(a.uuid.toLowerCase(), {
      uuid: a.uuid,
      regardingUuid: a.staffUuid,
      name: a.name,
      type: "staff-annual-leave",
      start: a.start,
      end: a.end,
      active: 1,
      editDate: `2026-09-28 10:00:${String(++edits).padStart(2, "0")}`,
    });
    return how === "lost" ? answer(null, "unavailable") : answer(200, "created", a.uuid);
  });
  deleteSm8Availability.mockImplementation(async (_call: unknown, uuid: string) => {
    const how = nextDelete;
    nextDelete = "ok";
    const a = board.get(uuid.toLowerCase());
    if (!a) return { status: 404, outcome: { kind: "rejected", status: 404 }, remote: null, recordUuid: null };
    /* THE TRAP: a DELETE on a record already off the board puts it back */
    a.active = a.active === 1 ? 0 : 1;
    return how === "lost" ? answer(null, "unavailable") : answer(200, "created", uuid);
  });
  readSm8Availability.mockImplementation(async (_call: unknown, uuid: string) => {
    const a = board.get(uuid.toLowerCase());
    return a ? { ok: true, found: true, availability: { ...a } } : { ok: true, found: false };
  });
}

/* ── the workspace ── */

function connection(over: Row = {}): Row {
  return {
    org_id: ORG,
    provider: "servicem8",
    status: "connected",
    tenant_id: TENANT,
    tenants: [{ tenantId: TENANT, tenantName: "Acme Air", timezoneName: "Australia/Sydney" }],
    scopes: "vendor read_jobs read_schedule manage_attachments publish_job_notes manage_schedule manage_jobs",
    write_mode: "live",
    paused_reason: null,
    paused_at: null,
    write_scope_refused: {},
    connected_at: "2026-09-01T00:00:00.000Z",
    write_kinds: ["attachment", "booking", "leave", "note"],
    ...over,
  };
}

async function press(): Promise<Sm8Press> {
  getSession.mockResolvedValue({ orgId: ORG, user: { sub: "auth0|boss" } });
  return (await sm8PressFromSession())!;
}

const writes = () => fake.db.sm8_writes as Row[];
const creates = () => writes().filter((w) => w.kind === "leave" && w.op === "create");
const deletes = () => writes().filter((w) => w.kind === "leave" && w.op === "delete");
const run = () => runSm8Writes(ORG, "send", { clock: Date.now });
const due = () => {
  for (const w of writes()) w.next_attempt_at = new Date(Date.now() - 1000).toISOString();
};

function approvedLeave(id: string, kind: string, from: string, to: string, over: Row = {}) {
  (fake.db.leave_requests as Row[]).push({ id, org_id: ORG, staff_profile_id: SAM, kind, status: "approved", start_date: from, end_date: to, ...over });
  return { source: "leave" as const, id, staffProfileId: SAM, kind, from, to };
}

beforeEach(() => {
  fake.reset();
  board = new Map();
  nextPost = "ok";
  nextDelete = "ok";
  edits = 0;
  fake.db.integration_connections = [connection()];
  fake.db.integration_links = [
    { org_id: ORG, provider: "servicem8", kind: "staff", tenant_id: TENANT, staff_profile_id: SAM, remote_id: SAM_SM8, confirmed_remote_id: null, confirmed_answer: null },
  ];
  fake.db.sm8_staff = [{ org_id: ORG, uuid: SAM_SM8, first: "Sam", last: "Tester", active: 1 }];
  fake.db.staff_profiles = [
    { id: SAM, org_id: ORG, first_name: "Sam", last_name: "Tester", full_name: "Sam Tester", preferred_name: null },
    { id: "staff-alex", org_id: ORG, first_name: "Alex", last_name: "Sample", full_name: "Alex Sample", preferred_name: null },
  ];
  fake.db.leave_requests = [];
  fake.db.staff_unavailability = [];
  fake.db.sm8_writes = [];
  process.env.SM8_WRITES = "attachment,note,booking,leave";
  sm8AccessResult.mockReset().mockResolvedValue({ ok: true, access: ACCESS });
  renewSm8Access.mockReset().mockResolvedValue({ ok: true, access: ACCESS });
  markSm8NeedsReauth.mockReset().mockResolvedValue(true);
  for (const m of [postSm8Availability, deleteSm8Availability, readSm8Availability]) m.mockReset();
  after.mockReset();
  wireBoard();
  jest.spyOn(console, "error").mockImplementation(() => {});
  jest.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => jest.restoreAllMocks());
afterAll(() => {
  delete process.env.SM8_WRITES;
});

describe("approved leave goes onto the person's day", () => {
  it("is queued as one row with the person and the whole-day span, and drains behind the answer", async () => {
    const q = await queueLeaveOnBoard(await press(), approvedLeave("r1", "annual", "2026-10-05", "2026-10-09"));
    expect(q.note).toBeNull();
    expect(q.queued).toHaveLength(1);
    expect(creates()).toHaveLength(1);
    expect(creates()[0]).toMatchObject({
      kind: "leave",
      op: "create",
      sm8_job_uuid: null,
      subject: "leave:r1",
      payload: { name: "Leave" },
      leave_staff_uuid: SAM_SM8,
      leave_start: "2026-10-05 00:00:00",
      leave_end: "2026-10-09 23:59:59",
      status: "queued",
      requested_by: "staff-boss",
    });
    expect(after).toHaveBeenCalledTimes(1);
  });

  it("goes with exactly its fields, is read back, and is sent", async () => {
    await queueLeaveOnBoard(await press(), approvedLeave("r1", "annual", "2026-10-05", "2026-10-09"));
    const r = await run();
    expect(r).toMatchObject({ sent: 1, failed: 0 });
    expect(postSm8Availability).toHaveBeenCalledTimes(1);
    const [, sentAs] = postSm8Availability.mock.calls[0];
    expect(sentAs).toEqual({
      uuid: creates()[0].remote_uuid,
      staffUuid: SAM_SM8,
      name: "Leave",
      start: "2026-10-05 00:00:00",
      end: "2026-10-09 23:59:59",
    });
    expect(creates()[0].status).toBe("sent");
    expect([...board.values()]).toEqual([expect.objectContaining({ regardingUuid: SAM_SM8, active: 1, name: "Leave" })]);
  });

  it("names personal leave Sick leave on the board", async () => {
    await queueLeaveOnBoard(await press(), approvedLeave("r2", "personal", "2026-10-06", "2026-10-06"));
    await run();
    expect([...board.values()][0]).toMatchObject({ name: "Sick leave", start: "2026-10-06 00:00:00", end: "2026-10-06 23:59:59" });
  });

  it("puts one request on once, however often it is asked", async () => {
    const leave = approvedLeave("r1", "annual", "2026-10-05", "2026-10-05");
    await queueLeaveOnBoard(await press(), leave);
    await run();
    const again = await queueLeaveOnBoard(await press(), leave);
    expect(again.queued).toEqual([]);
    expect(creates()).toHaveLength(1);
    await run();
    expect(postSm8Availability).toHaveBeenCalledTimes(1);
  });

  it("puts a casual's day off on the board as Leave", async () => {
    (fake.db.staff_unavailability as Row[]).push({ id: "b1", org_id: ORG, staff_profile_id: SAM });
    await queueLeaveOnBoard(await press(), { source: "dayoff", id: "b1", staffProfileId: SAM, kind: null, from: "2026-10-08", to: "2026-10-08" });
    await run();
    expect(creates()[0]).toMatchObject({ subject: "dayoff:b1", status: "sent" });
    expect([...board.values()][0]).toMatchObject({ name: "Leave", active: 1 });
  });
});

describe("what keeps leave off the board", () => {
  it("queues nothing for someone not linked to ServiceM8, and says so beside the decision", async () => {
    fake.db.integration_links = [];
    const q = await queueLeaveOnBoard(await press(), approvedLeave("r1", "annual", "2026-10-05", "2026-10-05"));
    expect(q).toEqual({ queued: [], note: "Sam Tester isn't linked to anyone in ServiceM8, so the leave stays off its board. An owner can link them in Integrations, ServiceM8." });
    expect(writes()).toHaveLength(0);
  });

  it("queues nothing for someone who said the link isn't them, or whom ServiceM8 has as inactive", async () => {
    (fake.db.integration_links as Row[])[0].confirmed_remote_id = SAM_SM8;
    (fake.db.integration_links as Row[])[0].confirmed_answer = "no";
    const denied = await queueLeaveOnBoard(await press(), approvedLeave("r1", "annual", "2026-10-05", "2026-10-05"));
    expect(denied.note).toMatch(/said the ServiceM8 person they're linked to isn't them/);
    (fake.db.integration_links as Row[])[0].confirmed_answer = "yes";
    (fake.db.sm8_staff as Row[])[0].active = 0;
    const inactive = await queueLeaveOnBoard(await press(), approvedLeave("r2", "annual", "2026-10-06", "2026-10-06"));
    expect(inactive.note).toMatch(/ServiceM8 has Sam Tester as inactive/);
    expect(writes()).toHaveLength(0);
  });

  it("queues nothing, and says nothing, while the owner has Leave off", async () => {
    fake.db.integration_connections = [connection({ write_kinds: ["attachment", "booking", "note"] })];
    const q = await queueLeaveOnBoard(await press(), approvedLeave("r1", "annual", "2026-10-05", "2026-10-05"));
    expect(q).toEqual({ queued: [], note: null });
    expect(writes()).toHaveLength(0);
  });

  it("sends nothing for leave no longer approved when it comes to go", async () => {
    await queueLeaveOnBoard(await press(), approvedLeave("r1", "annual", "2026-10-05", "2026-10-05"));
    (fake.db.leave_requests as Row[])[0].status = "cancelled";
    await run();
    expect(postSm8Availability).not.toHaveBeenCalled();
    expect(creates()[0]).toMatchObject({ status: "cancelled", last_error: LEAVE_WORDS.row.notApproved });
  });

  it("sends nothing for a person ServiceM8 has made inactive since", async () => {
    await queueLeaveOnBoard(await press(), approvedLeave("r1", "annual", "2026-10-05", "2026-10-05"));
    (fake.db.sm8_staff as Row[])[0].active = 0;
    await run();
    expect(postSm8Availability).not.toHaveBeenCalled();
    expect(creates()[0]).toMatchObject({ status: "cancelled", last_error: "ServiceM8 has Sam Tester as inactive, so the leave didn't go." });
  });

  it("makes no request on a trial run", async () => {
    fake.db.integration_connections = [connection({ write_mode: "trial" })];
    await queueLeaveOnBoard(await press(), approvedLeave("r1", "annual", "2026-10-05", "2026-10-05"));
    await run();
    expect(postSm8Availability).not.toHaveBeenCalled();
    expect(readSm8Availability).not.toHaveBeenCalled();
    expect(creates()[0].status).toBe("trial");
  });
});

describe("an answer that was lost", () => {
  it("is read back before anything goes again, and leave found there is sent without a second POST", async () => {
    await queueLeaveOnBoard(await press(), approvedLeave("r1", "annual", "2026-10-05", "2026-10-05"));
    nextPost = "lost";
    await run();
    expect(creates()[0]).toMatchObject({ status: "queued", maybe_landed: true });
    due();
    await run();
    expect(postSm8Availability).toHaveBeenCalledTimes(1);
    expect(creates()[0]).toMatchObject({ status: "sent", maybe_landed: false });
    expect(board.size).toBe(1);
  });

  it("posts again under the same uuid when the read-back finds nothing there", async () => {
    await queueLeaveOnBoard(await press(), approvedLeave("r1", "annual", "2026-10-05", "2026-10-05"));
    nextPost = "down";
    await run();
    due();
    await run();
    expect(postSm8Availability).toHaveBeenCalledTimes(2);
    expect(postSm8Availability.mock.calls[0][1].uuid).toBe(postSm8Availability.mock.calls[1][1].uuid);
    expect(creates()[0].status).toBe("sent");
    expect(board.size).toBe(1);
  });
});

describe("cancelled leave comes off the board", () => {
  it("before it went: the create is stopped, and no request goes at all", async () => {
    const leave = approvedLeave("r1", "annual", "2026-10-05", "2026-10-05");
    await queueLeaveOnBoard(await press(), leave);
    (fake.db.leave_requests as Row[])[0].status = "cancelled";
    const off = await queueLeaveOffBoard(await press(), { source: "leave", id: "r1" });
    expect(off.queued).toEqual([]);
    expect(deletes()).toHaveLength(0);
    expect(creates()[0]).toMatchObject({ status: "cancelled" });
    expect(creates()[0].taken_back_at).toBeTruthy();
    await run();
    expect(postSm8Availability).not.toHaveBeenCalled();
    expect(deleteSm8Availability).not.toHaveBeenCalled();
  });

  it("after it went: read live, DELETEd once, read back off", async () => {
    await queueLeaveOnBoard(await press(), approvedLeave("r1", "annual", "2026-10-05", "2026-10-05"));
    await run();
    const uuid = String(creates()[0].remote_uuid);
    (fake.db.leave_requests as Row[])[0].status = "cancelled";
    const off = await queueLeaveOffBoard(await press(), { source: "leave", id: "r1" });
    expect(off.queued).toHaveLength(1);
    expect(deletes()[0]).toMatchObject({ subject: `remove:${creates()[0].id}`, depends_on: creates()[0].id, payload: { name: LEAVE_WORDS.label.remove } });
    await run();
    expect(deleteSm8Availability).toHaveBeenCalledTimes(1);
    expect(deleteSm8Availability.mock.calls[0][1]).toBe(uuid);
    expect(board.get(uuid.toLowerCase())!.active).toBe(0);
    expect(deletes()[0].status).toBe("sent");
    // and a press of it again puts nothing back on
    await queueLeaveOnBoard(await press(), { source: "leave", id: "r1", staffProfileId: SAM, kind: "annual", from: "2026-10-05", to: "2026-10-05" });
    due();
    await run();
    expect(postSm8Availability).toHaveBeenCalledTimes(1);
    expect(board.get(uuid.toLowerCase())!.active).toBe(0);
  });

  it("sends no DELETE to leave somebody already took off the board — one would put it back", async () => {
    await queueLeaveOnBoard(await press(), approvedLeave("r1", "annual", "2026-10-05", "2026-10-05"));
    await run();
    const uuid = String(creates()[0].remote_uuid);
    board.get(uuid.toLowerCase())!.active = 0;
    await queueLeaveOffBoard(await press(), { source: "leave", id: "r1" });
    await run();
    expect(deleteSm8Availability).not.toHaveBeenCalled();
    expect(board.get(uuid.toLowerCase())!.active).toBe(0);
    expect(deletes()[0].status).toBe("sent");
  });

  it("never sends a second DELETE after one whose answer was lost: still there, a person is asked", async () => {
    await queueLeaveOnBoard(await press(), approvedLeave("r1", "annual", "2026-10-05", "2026-10-05"));
    await run();
    const uuid = String(creates()[0].remote_uuid);
    await queueLeaveOffBoard(await press(), { source: "leave", id: "r1" });
    nextDelete = "lost";
    await run();
    expect(deletes()[0]).toMatchObject({ status: "queued" });
    expect(board.get(uuid.toLowerCase())!.active).toBe(0);
    due();
    await run();
    // it read the leave off the board, and sent nothing more
    expect(deleteSm8Availability).toHaveBeenCalledTimes(1);
    expect(board.get(uuid.toLowerCase())!.active).toBe(0);
    expect(deletes()[0].status).toBe("sent");
  });

  it("fails in words that ask a person, when leave its DELETE reached is still on the board", async () => {
    await queueLeaveOnBoard(await press(), approvedLeave("r1", "annual", "2026-10-05", "2026-10-05"));
    await run();
    const uuid = String(creates()[0].remote_uuid);
    await queueLeaveOffBoard(await press(), { source: "leave", id: "r1" });
    nextDelete = "lost";
    await run();
    // somebody put it back on the board in between
    board.get(uuid.toLowerCase())!.active = 1;
    due();
    await run();
    expect(deleteSm8Availability).toHaveBeenCalledTimes(1);
    expect(deletes()[0]).toMatchObject({ status: "failed", last_error: LEAVE_WORDS.row.stillThere });
  });

  it("takes a day off down off the board too", async () => {
    (fake.db.staff_unavailability as Row[]).push({ id: "b1", org_id: ORG, staff_profile_id: SAM });
    await queueLeaveOnBoard(await press(), { source: "dayoff", id: "b1", staffProfileId: SAM, kind: null, from: "2026-10-08", to: "2026-10-08" });
    await run();
    fake.db.staff_unavailability = [];
    await queueLeaveOffBoard(await press(), { source: "dayoff", id: "b1" });
    await run();
    expect(deleteSm8Availability).toHaveBeenCalledTimes(1);
    expect([...board.values()][0].active).toBe(0);
  });
});

describe("the owner's switch", () => {
  it("Leave off cancels what of leave is waiting, in leave's words, and files go on", async () => {
    await queueLeaveOnBoard(await press(), approvedLeave("r1", "annual", "2026-10-05", "2026-10-05"));
    (fake.db.integration_connections as Row[])[0].write_kinds = ["attachment", "booking", "note"];
    await run();
    expect(postSm8Availability).not.toHaveBeenCalled();
    expect(creates()[0]).toMatchObject({ status: "cancelled", last_error: LEAVE_WORDS.row.switchedOff });
  });
});
