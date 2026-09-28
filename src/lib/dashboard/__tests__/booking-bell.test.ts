/**
 * @jest-environment node
 */

/* E-4: THE BELL AND BOOKINGS TO SERVICEM8 (two-way phase 3, PR E).

   The presser gets one item per job whose booking line is bad, in the
   card's own words for what went wrong, opening the card where the line
   is; nobody else gets it. The owner gets one item when a read-back guard
   switched bookings off, for seven days after.

   The reads against the in-memory database with the real lines; the chips
   and their assembly as they are. Made-up people and jobs only. */

import { makeFakeDb } from "@/lib/integrations/__tests__/fixtures/sm8-fake-db";

const fake = makeFakeDb();
jest.mock("@/lib/supabase-server", () => ({
  supabaseAdmin: { from: (t: string) => fake.from(t), rpc: (n: string, a: Record<string, unknown>) => fake.rpc(n, a) },
}));
let state: Sm8WriteState;
const readSm8WriteState = jest.fn(async () => state);
jest.mock("@/lib/integrations/sm8-writes", () => ({ readSm8WriteState: () => readSm8WriteState() }));

import { bookingGuardTripped, myBookingTrouble } from "../booking-bell-query";
import { chipGroup, sm8BookingChip, sm8GuardChip } from "../chips";
import { assembleChips } from "../assemble";
import { BOOKING_WORDS } from "@/lib/integrations/sm8-booking-plan";
import type { Sm8WriteState } from "@/lib/integrations/sm8-write-plan";
import type { Capability } from "@/lib/permissions";

type Row = Record<string, unknown>;
const ORG = "org-1";
const TENANT = "vendor-1";
const ZONE = "Australia/Sydney";
/* Tuesday 6 October 2026, 9:00 am in Sydney */
const NOW = Date.parse("2026-10-05T22:00:00Z");
const SINCE = "2026-09-29";
const TOMORROW = "2026-10-07";
const ME = "auth0|test-presser";
const SOMEONE = "auth0|test-someone-else";
const SAM = "5a0e5a0e-0000-4000-8000-00000000e001";
const job = (n: number) => `0b1e0b1e-0000-4000-8000-00000000e${String(n).padStart(3, "0")}`;
const act = (n: number) => `7e7e7e7e-0000-4000-8000-00000000e${String(n).padStart(3, "0")}`;

const LIVE: Sm8WriteState = {
  readable: true,
  kinds: ["attachment", "note", "booking"],
  deployment: true,
  mode: "live",
  modeStored: "live",
  pausedReason: null,
  pausedAt: null,
  linked: true,
  connected: true,
  tenantId: TENANT,
  granted: ["attachment", "note", "booking"],
  refused: [],
  timezoneName: ZONE,
  ownerKinds: ["attachment", "note", "booking"],
  ownerKindsRead: true,
};

let seq = 0;
const row = (jobUuid: string, over: Row = {}): Row => {
  seq += 1;
  const made: Row = {
    id: `r${seq}`,
    org_id: ORG,
    tenant_id: TENANT,
    kind: "booking",
    op: "create",
    status: "sent",
    subject: `slot:${SAM}:${TOMORROW}T0${seq}:00`,
    sm8_job_uuid: jobUuid,
    remote_uuid: act(100 + seq),
    replaced_uuids: [],
    verify_uuids: [],
    maybe_landed: false,
    booking_staff_uuid: SAM,
    booking_start: `${TOMORROW} 09:00:00`,
    booking_end: `${TOMORROW} 11:00:00`,
    booking_zone: ZONE,
    taken_back_at: null,
    last_error: null,
    attempts: 1,
    http_status: null,
    depends_on: null,
    target_uuid: null,
    verb_id: `v${seq}`,
    requested_by: null,
    requested_by_user: ME,
    lease_until: null,
    landed_edit_date: null,
    seen_edit_date: null,
    created_at: `2026-10-0${1 + (seq % 5)}T01:00:00.000Z`,
    updated_at: "2026-10-05T01:00:00.000Z",
    ...over,
  };
  // pressed when it was made, unless the test re-pressed it
  return { ...made, pressed_at: over.pressed_at ?? made.created_at };
};

beforeEach(() => {
  fake.reset();
  seq = 0;
  state = LIVE;
  fake.db.sm8_writes = [];
  fake.db.sm8_job_activities = [];
  fake.db.sm8_vendor = [{ org_id: ORG, timezone_name: ZONE }];
  fake.db.sm8_jobs = Array.from({ length: 9 }, (_, i) => ({ org_id: ORG, uuid: job(i + 1), generated_job_id: `50${i + 1}0` }));
  jest.spyOn(Date, "now").mockReturnValue(NOW);
  jest.spyOn(console, "error").mockImplementation(() => {});
  readSm8WriteState.mockClear();
  process.env.SM8_WRITES = "attachment,note,booking";
});
afterEach(() => jest.restoreAllMocks());
afterAll(() => {
  delete process.env.SM8_WRITES;
});

/** One of each bad line, on its own job, and one that went. */
function seedEach() {
  const takenBack = row(job(3), { taken_back_at: "2026-10-04T01:00:00.000Z" });
  fake.db.sm8_writes.push(
    row(job(1), { status: "failed", last_error: BOOKING_WORDS.row.refused }),
    // case 13: ServiceM8 kept it at another time; the presser holds its Undo
    row(job(2), { last_error: BOOKING_WORDS.row.timeNotKept }),
    takenBack,
    row(job(3), { op: "delete", status: "failed", depends_on: takenBack.id, last_error: BOOKING_WORDS.row.removeRefused, subject: `undo:${takenBack.id}` }),
    row(job(4), { status: "failed", maybe_landed: true, last_error: BOOKING_WORDS.row.bookingUnsure }),
    row(job(5), { op: "delete", status: "failed", target_uuid: act(5), remote_uuid: act(5), last_error: BOOKING_WORDS.row.removeRefused, subject: `clear:${act(5)}` }),
    row(job(6)),
  );
}

describe("the presser's items", () => {
  it("one per job whose line is bad, each in the card's words for what went wrong", async () => {
    seedEach();
    const got = await myBookingTrouble(ORG, ME, SINCE, NOW);
    const by = Object.fromEntries(got.map((t) => [t.jobUuid, t]));
    expect(Object.keys(by).sort()).toEqual([job(1), job(2), job(3), job(4), job(5)]);
    expect(by[job(1)]).toEqual({ jobUuid: job(1), number: "5010", op: "notSent" });
    expect(by[job(2)].op).toBe("keptOther");
    expect(by[job(3)].op).toBe("stillIn");
    expect(by[job(4)].op).toBe("unsure");
    expect(by[job(5)].op).toBe("leftover");
    expect(got.map((t) => sm8BookingChip(t).label).sort()).toEqual(
      [
        "Booking didn't go to ServiceM8",
        "Booking went into ServiceM8 at another time or on someone else",
        "Booking not taken out of ServiceM8",
        "Booking may not have reached ServiceM8",
        "Leftover booking not cleared",
      ].sort(),
    );
  });

  it("never calls a booking kept at another time or on someone else 'didn't go' or 'may not have reached'", async () => {
    fake.db.sm8_writes.push(
      row(job(1), { last_error: BOOKING_WORDS.row.timeNotKept }),
      row(job(2), { last_error: BOOKING_WORDS.row.personNotKept }),
    );
    const labels = (await myBookingTrouble(ORG, ME, SINCE, NOW)).map((t) => sm8BookingChip(t).label);
    expect(labels).toEqual([BOOKING_WORDS.bell.bookingKeptOther, BOOKING_WORDS.bell.bookingKeptOther]);
  });

  it("is one item a job, newest first, and five at most", async () => {
    for (let i = 1; i <= 7; i++) fake.db.sm8_writes.push(row(job(i), { status: "failed", last_error: BOOKING_WORDS.row.refused, created_at: `2026-10-0${i % 5 + 1}T0${i}:00:00.000Z` }));
    // two more on job 1, the newest of all: still one item for it
    fake.db.sm8_writes.push(
      row(job(1), { status: "failed", last_error: BOOKING_WORDS.row.refused, created_at: "2026-10-05T09:00:00.000Z" }),
      row(job(1), { status: "failed", last_error: BOOKING_WORDS.row.refused, created_at: "2026-10-05T08:00:00.000Z" }),
    );
    const got = await myBookingTrouble(ORG, ME, SINCE, NOW);
    expect(got).toHaveLength(5);
    expect(new Set(got.map((t) => t.jobUuid)).size).toBe(5);
    expect(got[0].jobUuid).toBe(job(1));
  });

  it("is nobody else's: another person's presses give them nothing, and theirs give you nothing", async () => {
    seedEach();
    expect(await myBookingTrouble(ORG, SOMEONE, SINCE, NOW)).toEqual([]);
    fake.db.sm8_writes = [row(job(1), { status: "failed", last_error: BOOKING_WORDS.row.refused, requested_by_user: SOMEONE })];
    expect(await myBookingTrouble(ORG, ME, SINCE, NOW)).toEqual([]);
  });

  it("looks back seven days, and only at the account connected now", async () => {
    fake.db.sm8_writes.push(
      row(job(1), { status: "failed", last_error: BOOKING_WORDS.row.refused, created_at: "2026-09-27T01:00:00.000Z" }),
      row(job(2), { status: "failed", last_error: BOOKING_WORDS.row.refused, tenant_id: "vendor-old" }),
    );
    expect(await myBookingTrouble(ORG, ME, SINCE, NOW)).toEqual([]);
  });

  /* S1: Try again, or a fresh press on a slot given back, reuses the row
     and keeps its created_at — it is the press that counts */
  it("goes by when it was last pressed: first pressed eight days ago, failing again today, is today's", async () => {
    fake.db.sm8_writes.push(
      row(job(1), {
        status: "failed",
        last_error: BOOKING_WORDS.row.refused,
        created_at: "2026-09-27T01:00:00.000Z",
        pressed_at: "2026-10-05T20:00:00.000Z",
      }),
      // pressed within the week, and not since
      row(job(2), { status: "failed", last_error: BOOKING_WORDS.row.refused, created_at: "2026-10-04T01:00:00.000Z" }),
    );
    const got = await myBookingTrouble(ORG, ME, SINCE, NOW);
    // the re-pressed one is found, and it is the newest
    expect(got.map((t) => t.jobUuid)).toEqual([job(1), job(2)]);
  });

  it("opens the job's card where the line is, and files under the Workboard", () => {
    const chip = sm8BookingChip({ jobUuid: job(1), number: "5010", op: "notSent" });
    expect(chip).toMatchObject({ kind: "sm8-booking", state: "bad", subject: "Job 5010", href: `/dashboard/workboard?job=${job(1)}` });
    expect(chipGroup("sm8-booking")).toBe("Workboard");
  });
});

describe("the owner's guard item", () => {
  // a guard switched the owner's Bookings off
  const OFF: Sm8WriteState = { ...LIVE, ownerKinds: ["attachment", "note"] };
  beforeEach(() => {
    state = OFF;
  });

  /* N2: once the owner has switched Bookings back on, the item is stale */
  it("goes once the owner has switched bookings back on", async () => {
    fake.db.sm8_writes.push(row(job(2), { last_error: BOOKING_WORDS.row.timeNotKept, updated_at: "2026-10-03T01:00:00.000Z" }));
    expect(await bookingGuardTripped(ORG, SINCE)).toEqual({ number: "5020" });
    state = LIVE;
    expect(await bookingGuardTripped(ORG, SINCE)).toBeNull();
  });

  it("names the job a guard switched bookings off on, and opens the ServiceM8 screen", async () => {
    fake.db.sm8_writes.push(row(job(2), { last_error: BOOKING_WORDS.row.timeNotKept, updated_at: "2026-10-03T01:00:00.000Z" }));
    const guard = await bookingGuardTripped(ORG, SINCE);
    expect(guard).toEqual({ number: "5020" });
    expect(sm8GuardChip(guard)).toMatchObject({
      label: "HeyTiff switched bookings off",
      subject: "Job 5020",
      href: "/dashboard/admin/integrations/servicem8",
      state: "bad",
    });
  });

  it("lasts seven days after the guard", async () => {
    fake.db.sm8_writes.push(row(job(2), { last_error: BOOKING_WORDS.row.fieldsNotKept, op: "update", updated_at: "2026-09-27T01:00:00.000Z" }));
    expect(await bookingGuardTripped(ORG, SINCE)).toBeNull();
  });

  it("counts an unsure booking ServiceM8 answered OK (call 15), not one read back after a lost answer", async () => {
    fake.db.sm8_writes.push(row(job(4), { status: "failed", maybe_landed: true, last_error: BOOKING_WORDS.row.bookingUnsure, http_status: null }));
    expect(await bookingGuardTripped(ORG, SINCE)).toBeNull();
    fake.db.sm8_writes.push(row(job(5), { status: "failed", maybe_landed: true, last_error: BOOKING_WORDS.row.bookingUnsure, http_status: 200 }));
    expect(await bookingGuardTripped(ORG, SINCE)).toEqual({ number: "5050" });
  });

  it("is the owner's alone", () => {
    const base = {
      today: "2026-10-06",
      warnDays: 30,
      viewerStaffId: null,
      self: null,
      selfVehicle: null,
      teamPeople: [],
      fleet: [],
      orgCredentials: [],
      pendingClaims: 0,
      pendingLeave: 0,
      ownSheet: null,
      ownDeclinedClaims: [],
      ownDeclinedLeave: [],
      selfCompleteness: null,
      selfName: null,
      ownBookingTrouble: [{ jobUuid: job(1), number: "5010", op: "notSent" as const }],
      sm8BookingGuard: { number: "5020" },
    };
    const caps = new Set<Capability>(["workboard"]);
    const owner = assembleChips({ ...base, isOwner: true }, caps).self.map((c) => c.key);
    const manager = assembleChips({ ...base, isOwner: false }, caps).self.map((c) => c.key);
    expect(owner).toEqual(expect.arrayContaining([`sm8-booking:${job(1)}`, "sm8-guard"]));
    // a presser with no staff card still gets their own item
    expect(manager).toEqual([`sm8-booking:${job(1)}`]);
  });
});

describe("without `booking`", () => {
  it.each(["1", "attachment,note"])("SM8_WRITES=%s: neither reads anything", async (writes) => {
    process.env.SM8_WRITES = writes;
    seedEach();
    fake.db.sm8_writes.push(row(job(2), { last_error: BOOKING_WORDS.row.timeNotKept }));
    expect(await myBookingTrouble(ORG, ME, SINCE, NOW)).toEqual([]);
    expect(await bookingGuardTripped(ORG, SINCE)).toBeNull();
    expect(fake.log).toEqual([]);
    expect(readSm8WriteState).not.toHaveBeenCalled();
  });
});
