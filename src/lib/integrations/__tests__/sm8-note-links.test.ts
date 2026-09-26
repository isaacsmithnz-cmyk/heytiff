/**
 * @jest-environment node
 */

/* Who a note goes as, and what it answers (two-way phase 2, PR A).

   A note goes as the person who pressed it, so a link is no longer a label:
   each person confirms "Is <ServiceM8 name> you?" once, the answer is kept
   against the very link they saw, and a relink forgets it. And a reply goes
   on the object its source hangs off — this job or one of its claims —
   never on anything a browser names. */

import { makeFakeDb } from "./fixtures/sm8-fake-db";

const fake = makeFakeDb();
jest.mock("@/lib/supabase-server", () => ({ supabaseAdmin: { from: (t: string) => fake.from(t) } }));
const familyMediaSources = jest.fn(async () => [] as { remoteId: string; claimNumber: string | null }[]);
jest.mock("@/lib/workboard/all-jobs-query", () => ({ familyMediaSources: (...a: unknown[]) => familyMediaSources(...(a as [])) }));

import { confirmSm8Link, linkSm8StaffMember, sm8NoteSender } from "../links";
import { noteObjectOf, noteSourceOf } from "../sm8-note-source";
import { NOTE_WORDS } from "../sm8-note-plan";

const ORG = "org-1";
const T = "vendor-1";
const ISAAC = "5a1b2c3d-0000-4000-8000-00000000aaaa";
const OTHER = "5a1b2c3d-0000-4000-8000-00000000cccc";
const JOB = "0f8c2b9e-1111-4a4a-8b8b-000000000001";
const CLAIM = "0f8c2b9e-1111-4a4a-8b8b-000000000002";
const NOTE = "7e7e7e7e-0000-4000-8000-000000000001";

const link = () => fake.db.integration_links[0];

beforeEach(() => {
  fake.reset();
  fake.db.integration_connections = [{ org_id: ORG, provider: "servicem8", tenant_id: T }];
  fake.db.integration_links = [
    { id: "l1", org_id: ORG, provider: "servicem8", kind: "staff", tenant_id: T, staff_profile_id: "staff-isaac", remote_id: ISAAC, confirmed_remote_id: null, confirmed_answer: null },
  ];
  fake.db.sm8_staff = [
    { org_id: ORG, uuid: ISAAC, first: "Isaac", last: "Smith", active: 1 },
    { org_id: ORG, uuid: OTHER, first: "Izak", last: "Smyth", active: 1 },
  ];
  fake.db.staff_profiles = [{ org_id: ORG, id: "staff-isaac", first_name: "Isaac", last_name: "Smith", full_name: "Isaac Smith", preferred_name: null }];
  familyMediaSources.mockReset().mockResolvedValue([]);
  jest.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe("who a note goes as", () => {
  it("asks first, then is ready only for the link the person confirmed", async () => {
    expect(await sm8NoteSender(ORG, "staff-isaac")).toEqual({ state: "confirm", remoteId: ISAAC, sm8Name: "Isaac Smith", handle: "isaacsmith" });
    expect(await confirmSm8Link({ orgId: ORG, tenantId: T, staffId: "staff-isaac", userId: "auth0|i", remoteId: ISAAC, answer: "yes" })).toEqual({ ok: true });
    expect(await sm8NoteSender(ORG, "staff-isaac")).toEqual({
      state: "ready",
      staffUuid: ISAAC,
      remoteId: ISAAC,
      sm8Name: "Isaac Smith",
      handle: "isaacsmith",
    });
  });

  it("(F) re-linking clears the confirmation: the new link is asked about again", async () => {
    await confirmSm8Link({ orgId: ORG, tenantId: T, staffId: "staff-isaac", userId: "auth0|i", remoteId: ISAAC, answer: "yes" });
    fake.db.integration_links = [];
    fake.db.integration_links.push({ ...{ id: "l1", org_id: ORG, provider: "servicem8", kind: "staff", tenant_id: T, staff_profile_id: "staff-isaac", remote_id: ISAAC, confirmed_remote_id: ISAAC, confirmed_answer: "yes", confirmed_at: "x" } });
    await linkSm8StaffMember({ orgId: ORG, tenantId: T, staffProfileId: "staff-isaac", remoteId: OTHER, remoteLabel: null, matchedBy: "manual", userId: "auth0|owner" });
    const upserted = fake.on("integration_links").find((s) => s.op === "upsert");
    expect(upserted).toBeDefined();
    const row = fake.db.integration_links.find((r) => r.remote_id === OTHER)!;
    expect(row).toMatchObject({ confirmed_remote_id: null, confirmed_answer: null, confirmed_at: null, confirmed_by_user_id: null });
  });

  it("(F) links still save on a database without the confirm columns", async () => {
    fake.missing.add("confirmed_remote_id");
    fake.db.integration_links = [];
    expect(
      await linkSm8StaffMember({ orgId: ORG, tenantId: T, staffProfileId: "staff-isaac", remoteId: ISAAC, remoteLabel: null, matchedBy: "manual", userId: "u" })
    ).toEqual({ ok: true });
    expect(fake.db.integration_links).toHaveLength(1);
  });

  it("(F) a confirmation acts only on your own row, and only for the link you saw: Yes after a relink confirms nothing", async () => {
    link().remote_id = OTHER; // an owner relinked while the question was open
    expect(await confirmSm8Link({ orgId: ORG, tenantId: T, staffId: "staff-isaac", userId: "u", remoteId: ISAAC, answer: "yes" })).toEqual({
      ok: false,
      error: NOTE_WORDS.press.linkChanged,
    });
    expect(link().confirmed_answer).toBeNull();
    // someone else's staff card matches nothing
    expect((await confirmSm8Link({ orgId: ORG, tenantId: T, staffId: "staff-luke", userId: "u", remoteId: OTHER, answer: "yes" })).ok).toBe(false);
  });

  it("(F) Not me is a denial, and denied and inactive senders carry the handle", async () => {
    await confirmSm8Link({ orgId: ORG, tenantId: T, staffId: "staff-isaac", userId: "u", remoteId: ISAAC, answer: "no" });
    expect(await sm8NoteSender(ORG, "staff-isaac")).toEqual({ state: "denied", remoteId: ISAAC, sm8Name: "Isaac Smith", handle: "isaacsmith" });
    Object.assign(link(), { confirmed_answer: "yes" });
    fake.db.sm8_staff[0].active = 0;
    expect(await sm8NoteSender(ORG, "staff-isaac")).toEqual({ state: "inactive", remoteId: ISAAC, sm8Name: "Isaac Smith", handle: "isaacsmith" });
  });

  it("a confirmation of an OLD link never counts for the link there now", async () => {
    Object.assign(link(), { confirmed_remote_id: OTHER, confirmed_answer: "yes" });
    expect((await sm8NoteSender(ORG, "staff-isaac")).state).toBe("confirm");
  });

  it("names the rest: no card, unlinked, a broken link, a staff member ServiceM8 no longer has, and a read that fails", async () => {
    expect(await sm8NoteSender(ORG, null)).toEqual({ state: "unlinked", noCard: true });
    expect(await sm8NoteSender(ORG, "staff-luke")).toEqual({ state: "unlinked", noCard: false });
    link().remote_id = "not-a-uuid";
    expect(await sm8NoteSender(ORG, "staff-isaac")).toEqual({ state: "bad_link", remoteId: "not-a-uuid" });
    link().remote_id = "5a1b2c3d-0000-4000-8000-000000000fff";
    expect(await sm8NoteSender(ORG, "staff-isaac")).toMatchObject({ state: "inactive", sm8Name: "Isaac Smith", handle: null });
    fake.missing.add("confirmed_answer");
    expect(await sm8NoteSender(ORG, "staff-isaac")).toEqual({ state: "unknown" });
  });

  it("reads the link at the account it is told, not the one connected now", async () => {
    expect((await sm8NoteSender(ORG, "staff-isaac", "vendor-old")).state).toBe("unlinked");
  });
});

describe("what a note answers, and where it goes", () => {
  it("finds a mirror note on any object, or one of our sent notes by the uuid it went under", async () => {
    fake.db.sm8_job_notes = [
      { org_id: ORG, uuid: NOTE, related_object_uuid: CLAIM, note: "@isaacsmith grilles", edit_by_staff_uuid: OTHER, edit_date: "2026-09-20 10:00:00", action_required: "1", action_completed_by_staff_uuid: null },
    ];
    expect(await noteSourceOf(ORG, NOTE)).toEqual({
      relatedUuid: CLAIM,
      text: "@isaacsmith grilles",
      authorSm8Uuid: OTHER,
      editDate: "2026-09-20 10:00:00",
      editBy: OTHER,
      flagged: true,
      completedBy: null,
      origin: "sm8",
    });
    const OURS = "7e7e7e7e-0000-4000-8000-000000000002";
    fake.db.workboard_notes = [{ org_id: ORG, id: "n1", applied: { jobNotes: ["english"], sm8Text: "@lukeingold tiếng việt" } }];
    fake.db.sm8_writes = [{ org_id: ORG, kind: "note", op: "create", status: "sent", remote_uuid: OURS, sm8_job_uuid: JOB, note_id: "n1", as_staff_uuid: ISAAC }];
    expect(await noteSourceOf(ORG, OURS)).toMatchObject({ relatedUuid: JOB, text: "@lukeingold tiếng việt", origin: "heytiff", authorSm8Uuid: ISAAC });
    expect(await noteSourceOf(ORG, "not-a-uuid")).toBeNull();
  });

  it("a diary entry goes on its job; a reply on its source's object, only when that is the job or one of its claims", async () => {
    fake.db.sm8_job_notes = [{ org_id: ORG, uuid: NOTE, related_object_uuid: CLAIM, note: "x" }];
    expect(await noteObjectOf(ORG, { target_id: JOB, reply_to_sm8_note_uuid: null })).toBe(JOB);
    expect(await noteObjectOf(ORG, { target_id: JOB, reply_to_sm8_note_uuid: NOTE })).toBeNull();
    familyMediaSources.mockResolvedValue([{ remoteId: CLAIM, claimNumber: "2380-1" }]);
    expect(await noteObjectOf(ORG, { target_id: JOB, reply_to_sm8_note_uuid: NOTE })).toBe(CLAIM);
    expect(await noteObjectOf(ORG, { target_id: JOB, reply_to_sm8_note_uuid: "7e7e7e7e-0000-4000-8000-00000000dead" })).toBeNull();
  });
});
