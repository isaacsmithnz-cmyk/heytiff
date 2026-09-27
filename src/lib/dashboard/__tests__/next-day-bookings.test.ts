/**
 * @jest-environment node
 */

/* E-12: HOME'S NEXT DAY TAKES THE OVERLAY (two-way phase 3, PR E).

   When today has nothing on, Home draws your next booked day. Its first
   read found that day in the mirror alone, so a booking we took out could
   pick a day that then draws nothing, and one we sent wasn't found until
   the sync. Where the deployment books, that read skips the first and
   finds the second; anywhere else it is byte for byte main's read.

   Against the in-memory database with the real overlay; the day itself is
   drawn through loadScheduleDay (PR D's overlay, its own suite), stubbed
   here to say which day was asked for. Made-up people only. */

import { makeFakeDb } from "@/lib/integrations/__tests__/fixtures/sm8-fake-db";

const fake = makeFakeDb();
jest.mock("@/lib/supabase-server", () => ({
  supabaseAdmin: { from: (t: string) => fake.from(t), rpc: (n: string, a: Record<string, unknown>) => fake.rpc(n, a) },
}));
const readSm8WriteState = jest.fn(async () => STATE);
jest.mock("@/lib/integrations/sm8-writes", () => ({ readSm8WriteState: () => readSm8WriteState() }));
const loadScheduleDay = jest.fn();
jest.mock("@/lib/workboard/schedule-query", () => ({ loadScheduleDay: (...a: unknown[]) => loadScheduleDay(...a) }));
const layoutScheduleDay = jest.fn();
jest.mock("@/lib/workboard/schedule", () => ({ layoutScheduleDay: (...a: unknown[]) => layoutScheduleDay(...a) }));

import { loadNextDay } from "../next-day";
import type { Sm8WriteState } from "@/lib/integrations/sm8-write-plan";

type Row = Record<string, unknown>;
const ORG = "org-1";
const TENANT = "vendor-1";
const ZONE = "Australia/Sydney";
/* Saturday 26 September 2026, 9:00 am in Sydney: nothing on today */
const NOW = Date.parse("2026-09-25T23:00:00Z");
const DAY = "2026-09-26";
const ME = "5a0e5a0e-0000-4000-8000-00000000d001";
const OTHER = "5a0e5a0e-0000-4000-8000-00000000d002";
const JOB = "0b1e0b1e-0000-4000-8000-00000000d101";
const uuid = (n: number) => `7e7e7e7e-0000-4000-8000-${String(n).padStart(12, "0")}`;

const STATE: Sm8WriteState = {
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

const act = (n: number, start: string, over: Row = {}): Row => ({
  org_id: ORG,
  uuid: uuid(n),
  job_uuid: JOB,
  staff_uuid: ME,
  start_date: start,
  end_date: start.replace(/ \d{2}:/, " 23:"),
  activity_was_scheduled: 1,
  active: 1,
  ...over,
});

let seq = 0;
const row = (over: Row): Row => {
  seq += 1;
  return {
    id: `r${seq}`,
    org_id: ORG,
    tenant_id: TENANT,
    kind: "booking",
    op: "create",
    status: "sent",
    subject: `slot:${ME}:x${seq}`,
    sm8_job_uuid: JOB,
    remote_uuid: uuid(900 + seq),
    replaced_uuids: [],
    verify_uuids: [],
    maybe_landed: false,
    booking_staff_uuid: ME,
    booking_start: "2026-09-30 09:00:00",
    booking_end: "2026-09-30 11:00:00",
    booking_zone: ZONE,
    taken_back_at: null,
    last_error: null,
    attempts: 1,
    depends_on: null,
    target_uuid: null,
    created_at: "2026-09-25T22:00:00.000Z",
    ...over,
  };
};

beforeEach(() => {
  fake.reset();
  seq = 0;
  fake.db.sm8_jobs = [{ org_id: ORG, uuid: JOB, status: "Work Order", active: 1 }];
  fake.db.sm8_job_activities = [];
  fake.db.sm8_writes = [];
  fake.db.sm8_vendor = [{ org_id: ORG, timezone_name: ZONE }];
  jest.spyOn(Date, "now").mockReturnValue(NOW);
  jest.spyOn(console, "error").mockImplementation(() => {});
  readSm8WriteState.mockClear();
  process.env.SM8_WRITES = "attachment,note,booking";
  loadScheduleDay.mockReset().mockImplementation(async (_org: string, day: string) => ({
    activities: [],
    staff: [],
    jobs: [],
    onSite: [],
    addresses: {},
    day,
  }));
  // a lane of yours on whatever day is drawn
  layoutScheduleDay.mockReset().mockReturnValue({
    lanes: [{ staffUuid: ME, name: "Test Person", blocks: [{ key: "b1", remoteId: JOB, startMin: 540 }] }],
    tracksTime: false,
  });
});
afterEach(() => jest.restoreAllMocks());
afterAll(() => {
  delete process.env.SM8_WRITES;
});

describe("with bookings allowed", () => {
  it("skips a day whose only booking of yours we took out", async () => {
    fake.db.sm8_job_activities.push(act(1, "2026-09-28 08:00:00"), act(2, "2026-10-01 08:00:00"));
    const create = row({ remote_uuid: uuid(1), taken_back_at: "2026-09-25T22:30:00.000Z" });
    fake.db.sm8_writes.push(create, row({ op: "delete", depends_on: create.id, verify_uuids: [uuid(1)], subject: `undo:${create.id}` }));
    const next = await loadNextDay(ORG, ME, DAY);
    expect(loadScheduleDay).toHaveBeenCalledWith(ORG, "2026-10-01");
    expect(next?.dayISO).toBe("2026-10-01");
  });

  it("finds a day that holds only a booking of yours we sent, before the mirror has it", async () => {
    fake.db.sm8_job_activities.push(act(2, "2026-10-01 08:00:00"));
    fake.db.sm8_writes.push(row({ booking_staff_uuid: ME.toUpperCase(), booking_start: "2026-09-29 07:00:00", booking_end: "2026-09-29 09:00:00" }));
    const next = await loadNextDay(ORG, ME, DAY);
    expect(next?.dayISO).toBe("2026-09-29");
  });

  it("never takes somebody else's booking we sent for yours", async () => {
    fake.db.sm8_job_activities.push(act(2, "2026-10-01 08:00:00"));
    fake.db.sm8_writes.push(row({ booking_staff_uuid: OTHER, booking_start: "2026-09-29 07:00:00", booking_end: "2026-09-29 09:00:00" }));
    expect((await loadNextDay(ORG, ME, DAY))?.dayISO).toBe("2026-10-01");
  });

  it("is no next day when the only booking in the fortnight is one we took out", async () => {
    fake.db.sm8_job_activities.push(act(1, "2026-09-28 08:00:00"));
    const create = row({ remote_uuid: uuid(1), taken_back_at: "2026-09-25T22:30:00.000Z" });
    fake.db.sm8_writes.push(create, row({ op: "delete", depends_on: create.id, verify_uuids: [uuid(1)], subject: `undo:${create.id}` }));
    expect(await loadNextDay(ORG, ME, DAY)).toBeNull();
    expect(loadScheduleDay).not.toHaveBeenCalled();
  });
});

describe("without bookings allowed", () => {
  it.each(["1", "attachment,note"])("SM8_WRITES=%s: the first read is main's, byte for byte", async (writes) => {
    process.env.SM8_WRITES = writes;
    fake.db.sm8_job_activities.push(act(1, "2026-09-28 08:00:00"));
    const create = row({ remote_uuid: uuid(1), taken_back_at: "2026-09-25T22:30:00.000Z" });
    fake.db.sm8_writes.push(create, row({ op: "delete", depends_on: create.id, verify_uuids: [uuid(1)], subject: `undo:${create.id}` }));
    const next = await loadNextDay(ORG, ME, DAY);
    // the mirror alone, as on main: the booking we took out still picks its day
    expect(next?.dayISO).toBe("2026-09-28");
    expect(fake.log.map((s) => [s.table, s.columns, [...s.filters].sort()])).toEqual([
      [
        "sm8_job_activities",
        "start_date",
        [`org_id=${ORG}`, `staff_uuid=${ME}`, "active=1", "activity_was_scheduled=1", "start_date>=", "start_date<"].sort(),
      ],
    ]);
    expect(readSm8WriteState).not.toHaveBeenCalled();
  });
});
