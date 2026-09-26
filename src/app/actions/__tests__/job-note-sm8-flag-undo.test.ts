/**
 * @jest-environment node
 */

/* Taking back a Mark done that WENT — once live test 5 proves that an empty
   completer clears the mark, and FLAG_UNDO_AFTER_SENT is flipped by its
   one-line PR (two-way phase 2, PR B, test 13). Until then no such Undo is
   offered (job-note-sm8.test holds that side); here the flag is set, as
   that PR will set it. */

import { makeFakeDb } from "@/lib/integrations/__tests__/fixtures/sm8-fake-db";

type Row = Record<string, unknown>;

const fake = makeFakeDb();
jest.mock("@/lib/supabase-server", () => ({
  supabaseAdmin: { from: (t: string) => fake.from(t), rpc: (n: string, a: Record<string, unknown>) => fake.rpc(n, a) },
}));
jest.unmock("@/app/actions/job-note-sm8");
jest.mock("@/lib/integrations/sm8-note-plan", () => ({
  ...jest.requireActual("@/lib/integrations/sm8-note-plan"),
  FLAG_UNDO_AFTER_SENT: true,
}));
jest.mock("@/lib/integrations/sm8-store", () => ({
  sm8AccessResult: jest.fn(async () => ({ ok: true, access: { accessToken: "t", tenantId: "vendor-1", grant: "g", meter: "vendor-1" } })),
  renewSm8Access: jest.fn(async () => ({ ok: false })),
  markSm8NeedsReauth: jest.fn(async () => true),
}));
const updateSm8NoteCompleter = jest.fn();
const readSm8Note = jest.fn();
jest.mock("@/lib/integrations/sm8-write", () => ({
  postSm8Attachment: jest.fn(),
  readSm8Attachment: jest.fn(),
  postSm8Note: jest.fn(),
  deleteSm8Note: jest.fn(),
  updateSm8NoteCompleter: (...a: unknown[]) => updateSm8NoteCompleter(...a),
  readSm8Note: (...a: unknown[]) => readSm8Note(...a),
}));
jest.mock("@/lib/auth0", () => ({ auth0: { getSession: async () => ({ orgId: "org-1", user: { sub: "auth0|isaac" } }) } }));
jest.mock("@/lib/fleet/query", () => ({ staffProfileIdFor: jest.fn(async () => "staff-isaac") }));
jest.mock("@/lib/permissions-server", () => ({
  requireOrg: jest.fn(async () => ({ orgId: "org-1", userId: "auth0|isaac" })),
  can: jest.fn(async () => true),
  getDbRole: jest.fn(async () => "staff"),
}));
jest.mock("next/server", () => ({ after: () => {} }));
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));
jest.mock("@/lib/compliance/send", () => ({
  jobIsReal: jest.fn(async (orgId: string, job: string) => (fake.db.sm8_jobs ?? []).some((j) => j.uuid === job && j.active === 1)),
}));

import { undoJobNoteDone } from "../job-note-sm8";
import { NOTE_WORDS } from "@/lib/integrations/sm8-note-plan";
import { runSm8Writes } from "@/lib/integrations/sm8-writes";

const ORG = "org-1";
const TENANT = "vendor-1";
const JOB = "0f8c2b9e-1111-4a4a-8b8b-000000000001";
const ISAAC_SM8 = "5a1b2c3d-0000-4000-8000-00000000aaaa";
const LUKE_SM8 = "5a1b2c3d-0000-4000-8000-00000000bbbb";
const FLAG = "7e7e7e7e-0000-4000-8000-00000000f1a9";
const LANDED = "2026-09-21 08:00:00";
const PRESS = "00000000-0000-4000-8000-0000000000a1";

const writes = () => fake.db.sm8_writes as Row[];

beforeEach(() => {
  fake.reset();
  process.env.SM8_WRITES = "attachment,note";
  fake.db.integration_connections = [
    {
      org_id: ORG,
      provider: "servicem8",
      status: "connected",
      tenant_id: TENANT,
      scopes: "vendor read_jobs manage_attachments publish_job_notes",
      write_mode: "live",
      write_scope_refused: {},
      write_kinds: ["attachment", "note"],
    },
  ];
  fake.db.integration_links = [
    { org_id: ORG, provider: "servicem8", kind: "staff", tenant_id: TENANT, staff_profile_id: "staff-isaac", remote_id: ISAAC_SM8, confirmed_remote_id: ISAAC_SM8, confirmed_answer: "yes" },
  ];
  fake.db.sm8_staff = [{ org_id: ORG, uuid: ISAAC_SM8, first: "Isaac", last: "Smith", active: 1 }];
  fake.db.staff_profiles = [{ org_id: ORG, id: "staff-isaac", first_name: "Isaac", last_name: "Smith" }];
  fake.db.sm8_jobs = [{ org_id: ORG, uuid: JOB, active: 1 }];
  fake.db.sm8_job_notes = [
    {
      org_id: ORG, uuid: FLAG, related_object_uuid: JOB, note: "call the builder", action_required: "1",
      action_completed_by_staff_uuid: ISAAC_SM8, edit_by_staff_uuid: ISAAC_SM8, edit_date: LANDED, active: 1,
    },
  ];
  fake.db.workboard_notes = [];
  fake.db.sm8_writes = [
    {
      id: "u1", org_id: ORG, tenant_id: TENANT, kind: "note", op: "update", flag_done: true, status: "sent",
      target_uuid: FLAG, subject: `flag:${FLAG}:p0`, sm8_job_uuid: JOB, seen_edit_date: "2026-09-20 10:00:00",
      seen_edit_by: LUKE_SM8, landed_edit_date: LANDED, requested_by: "staff-isaac", remote_uuid: "00000000-0000-4000-8000-0000000000f0",
      created_at: "2026-09-21T00:00:00Z", attempts: 1, last_error: null, maybe_landed: false, verify_uuids: [],
    },
  ];
  updateSm8NoteCompleter.mockReset().mockResolvedValue({ status: 200, outcome: { kind: "created", remoteUuid: null }, remote: null, recordUuid: null });
  readSm8Note
    .mockReset()
    .mockResolvedValueOnce({ ok: true, found: true, relatedUuid: JOB, active: true, flagged: true, completedBy: ISAAC_SM8, editDate: LANDED, editBy: ISAAC_SM8 })
    .mockResolvedValue({ ok: true, found: true, relatedUuid: JOB, active: true, flagged: true, completedBy: null, editDate: "2026-09-25 10:00:00", editBy: ISAAC_SM8 });
  jest.spyOn(console, "error").mockImplementation(() => {});
  jest.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());
afterAll(() => {
  delete process.env.SM8_WRITES;
});

describe("with FLAG_UNDO_AFTER_SENT set", () => {
  it("(F) Undo of a mark that went queues a clear, checked against the edit time our mark left, and the sender sends an empty completer", async () => {
    const r = await undoJobNoteDone({ jobUuid: JOB, noteUuid: FLAG, pressId: PRESS });
    expect(r).toMatchObject({ ok: true });
    const clear = writes().find((w) => w.op === "update" && w.flag_done === false);
    expect(clear).toMatchObject({ target_uuid: FLAG, seen_edit_date: LANDED, requested_by: "staff-isaac" });
    await runSm8Writes(ORG, "send");
    expect(updateSm8NoteCompleter).toHaveBeenCalledTimes(1);
    expect(updateSm8NoteCompleter.mock.calls[0][2]).toBe("");
  });

  it("(F) (verifier r2 11) a mark going out right now: try again in a moment", async () => {
    writes()[0].status = "sending";
    expect(await undoJobNoteDone({ jobUuid: JOB, noteUuid: FLAG, pressId: PRESS })).toMatchObject({
      ok: false,
      error: NOTE_WORDS.press.inFlight,
    });
  });
});
