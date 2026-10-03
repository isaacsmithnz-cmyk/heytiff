/**
 * @jest-environment node
 */

/* THE READERS THAT DRAW BOOKINGS, over our rows (two-way phase 3, PR D).

   HeyTiff never writes its copy of ServiceM8, so the job card's list, the
   Schedule's day and the board's next booking ask the overlay: a booking we
   sent that the mirror doesn't hold yet is drawn, one we took out is not,
   and a leftover is decided on the server by the one rule (isLeftover).
   Where the deployment doesn't name `booking`, each makes exactly today's
   reads and hands back exactly today's shape (D-14, D-10).

   Against the in-memory database the engine's own suites use, with the
   real overlay and the real zone; only the write state is handed in. */

import { makeFakeDb } from "@/lib/integrations/__tests__/fixtures/sm8-fake-db";

const fake = makeFakeDb();
jest.mock("@/lib/supabase-server", () => ({
  supabaseAdmin: {
    from: (t: string) => fake.from(t),
    rpc: (n: string, a: Record<string, unknown>) => fake.rpc(n, a),
  },
}));
const readSm8WriteState = jest.fn(async () => STATE);
jest.mock("@/lib/integrations/sm8-writes", () => ({ readSm8WriteState: () => readSm8WriteState() }));

import { nextBookingOf, readMirrorJobDetail, readMirrorJobRow } from "../all-jobs-query";
import { loadScheduleDay } from "../schedule-query";
import { layoutScheduleDay } from "../schedule";
import type { Sm8WriteState } from "@/lib/integrations/sm8-write-plan";

type Row = Record<string, unknown>;

const ORG = "org-1";
const TENANT = "vendor-1";
const ZONE = "Australia/Sydney";
/* Tuesday 6 October 2026, 9:00 am in Sydney (daylight time) */
const NOW = Date.parse("2026-10-05T22:00:00Z");
const TODAY = "2026-10-06";
const TOMORROW = "2026-10-07";

const JOB = "0b1e0b1e-0000-4000-8000-00000000d001";
const DONE_JOB = "0b1e0b1e-0000-4000-8000-00000000d002";
const SAM = "5a0e5a0e-0000-4000-8000-00000000a001";
const ALEX = "5a0e5a0e-0000-4000-8000-00000000a002";
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

const act = (n: number, over: Row = {}): Row => ({
  org_id: ORG,
  uuid: uuid(n),
  job_uuid: JOB,
  staff_uuid: SAM,
  start_date: `${TOMORROW} 08:00:00`,
  end_date: `${TOMORROW} 10:00:00`,
  activity_was_scheduled: 1,
  active: 1,
  edit_date: "2026-10-01 10:00:00",
  ...over,
});

let seq = 0;
/** A booking of ours that went (a sent create). */
const sent = (remote: string, over: Row = {}): Row => {
  seq += 1;
  return {
    id: `c${seq}`,
    org_id: ORG,
    tenant_id: TENANT,
    kind: "booking",
    op: "create",
    status: "sent",
    subject: `slot:${SAM}:${TOMORROW}T0${seq}:00`,
    sm8_job_uuid: JOB,
    remote_uuid: remote,
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
    depends_on: null,
    target_uuid: null,
    verb_id: `v${seq}`,
    requested_by_user: "auth0|sam",
    created_at: "2026-10-05T21:00:00.000Z",
    ...over,
  };
};

/** A Clear of ours that went: it took `target` out. */
const cleared = (target: string): Row => {
  seq += 1;
  return {
    id: `d${seq}`,
    org_id: ORG,
    tenant_id: TENANT,
    kind: "booking",
    op: "delete",
    status: "sent",
    subject: `clear:${target}`,
    sm8_job_uuid: JOB,
    remote_uuid: target,
    replaced_uuids: [],
    verify_uuids: [target.toLowerCase()],
    maybe_landed: false,
    booking_staff_uuid: SAM,
    booking_start: `${TOMORROW} 10:00:00`,
    booking_end: `${TOMORROW} 11:00:00`,
    booking_zone: ZONE,
    taken_back_at: null,
    last_error: null,
    attempts: 1,
    depends_on: null,
    target_uuid: target,
    verb_id: `v${seq}`,
    requested_by_user: "auth0|sam",
    created_at: "2026-10-05T21:30:00.000Z",
  };
};

const job = (uuidOf: string, status: string, over: Row = {}): Row => ({
  org_id: ORG,
  uuid: uuidOf,
  generated_job_id: uuidOf === JOB ? "3342" : "3343",
  status,
  active: 1,
  company_uuid: null,
  category_uuid: null,
  queue_uuid: null,
  job_address: null,
  geo_city: "Rose Bay",
  job_description: "Service the units",
  date: "2026-09-30 09:00:00",
  quote_date: null,
  completion_date: status === "Completed" ? `${TODAY} 07:00:00` : null,
  ...over,
});

beforeEach(() => {
  fake.reset();
  seq = 0;
  fake.db.sm8_jobs = [job(JOB, "Work Order"), job(DONE_JOB, "Completed")];
  fake.db.sm8_job_activities = [];
  fake.db.sm8_job_contacts = [];
  fake.db.sm8_job_checklists = [];
  fake.db.sm8_staff = [
    { org_id: ORG, uuid: SAM, first: "Sam", last: "Tester", job_title: "Tech" },
    { org_id: ORG, uuid: ALEX, first: "Alex", last: "Sample", job_title: null },
  ];
  fake.db.sm8_writes = [];
  fake.db.sm8_vendor = [{ org_id: ORG, timezone_name: ZONE }];
  jest.spyOn(Date, "now").mockReturnValue(NOW);
  jest.spyOn(console, "error").mockImplementation(() => {});
  readSm8WriteState.mockClear();
  process.env.SM8_WRITES = "attachment,note,booking";
});
afterEach(() => jest.restoreAllMocks());
afterAll(() => {
  delete process.env.SM8_WRITES;
});

/** The mirror as the tests below set it: a booking of Sam's at 8, one of
    ours at 1 pm, one we cleared at 10, one from yesterday and recorded time;
    and one we sent at 9 that the mirror doesn't hold yet. */
function seedJob() {
  fake.db.sm8_job_activities.push(
    act(1),
    act(2, { staff_uuid: ALEX, start_date: `${TOMORROW} 13:00:00`, end_date: `${TOMORROW} 15:00:00` }),
    act(3, { start_date: `${TOMORROW} 10:00:00`, end_date: `${TOMORROW} 11:00:00` }),
    act(4, { start_date: "2026-10-05 08:00:00", end_date: "2026-10-05 10:00:00" }),
    act(5, { activity_was_scheduled: 0, start_date: "2026-10-05 08:05:00", end_date: "2026-10-05 09:40:00" })
  );
  const ours = sent(uuid(2), { booking_staff_uuid: ALEX, booking_start: `${TOMORROW} 13:00:00`, booking_end: `${TOMORROW} 15:00:00` });
  const notYet = sent(uuid(9));
  fake.db.sm8_writes.push(ours, notYet, cleared(uuid(3)));
  return { ours, notYet };
}

describe("readMirrorJobDetail, where the deployment books (D-9)", () => {
  it("(F) lists the mirror's bookings from today on less the ones we took out, plus the ones we sent it doesn't hold, in start order", async () => {
    const { ours, notYet } = seedJob();
    const d = await readMirrorJobDetail(ORG, JOB, TODAY);
    expect(d?.booked?.map((b) => [b.uuid, b.start, b.staffName, b.ourRow])).toEqual([
      [uuid(1), `${TOMORROW} 08:00:00`, "Sam Tester", null],
      [uuid(9), `${TOMORROW} 09:00:00`, "Sam Tester", notYet.id],
      [uuid(2), `${TOMORROW} 13:00:00`, "Alex Sample", ours.id],
    ]);
  });

  it("(F) lists a booking of ours pressed under another spelling of the job's uuid, as ours", async () => {
    const shouted = sent(uuid(9), { sm8_job_uuid: JOB.toUpperCase() });
    fake.db.sm8_writes.push(shouted);
    const d = await readMirrorJobDetail(ORG, JOB, TODAY);
    expect(d?.booked?.map((b) => [b.uuid, b.ourRow])).toEqual([[uuid(9), shouted.id]]);
  });

  it("(F) names the person on a booking of ours pressed under another spelling of their uuid", async () => {
    fake.db.sm8_writes.push(sent(uuid(9), { booking_staff_uuid: SAM.toUpperCase() }));
    const d = await readMirrorJobDetail(ORG, JOB, TODAY);
    expect(d?.booked?.map((b) => [b.uuid, b.staffName, b.staffTitle])).toEqual([[uuid(9), "Sam Tester", "Tech"]]);
    expect(d?.nextBooking).toMatchObject({ staffName: "Sam Tester", staffTitle: "Tech" });
  });

  it("(F) says the next on site is the first of them", async () => {
    seedJob();
    fake.db.sm8_job_activities = fake.db.sm8_job_activities.filter((a) => a.uuid !== uuid(1));
    const d = await readMirrorJobDetail(ORG, JOB, TODAY);
    /* the cleared 10 am never leads; the one we sent at 9 does */
    expect(d?.nextBooking).toEqual({ start: `${TOMORROW} 09:00:00`, end: `${TOMORROW} 11:00:00`, staffName: "Sam Tester", staffTitle: "Tech" });
  });

  it("(F) marks a leftover by the one rule, on a Completed and an Unsuccessful job, a booking later today included", async () => {
    for (const status of ["Completed", "Unsuccessful"]) {
      fake.db.sm8_jobs = [job(JOB, status)];
      fake.db.sm8_job_activities = [
        act(1, { start_date: `${TODAY} 14:00:00`, end_date: `${TODAY} 15:00:00` }),
        /* started already: not a leftover */
        act(2, { start_date: `${TODAY} 08:00:00`, end_date: `${TODAY} 10:00:00` }),
        /* nobody on it: not a leftover (a Clear must name a person) */
        act(3, { staff_uuid: null, start_date: `${TOMORROW} 08:00:00` }),
      ];
      const d = await readMirrorJobDetail(ORG, JOB, TODAY);
      expect([status, d?.booked?.map((b) => [b.uuid, b.leftover])]).toEqual([
        status,
        [
          [uuid(2), false],
          [uuid(1), true],
          [uuid(3), false],
        ],
      ]);
    }
  });

  it("(F) a card open asks about the bookings it can list only — today on — and reads our rows' two columns, never their lines", async () => {
    const { ours } = seedJob();
    fake.log.length = 0;
    const d = await readMirrorJobDetail(ORG, JOB, TODAY);
    expect(d?.booked?.find((b) => b.uuid === uuid(2))?.ourRow).toBe(ours.id);
    const writes = fake.on("sm8_writes");
    /* yesterday's booking (4) is never asked about */
    expect(writes.filter((s) => s.filters.some((f) => f.includes(uuid(4))))).toEqual([]);
    expect(writes.some((s) => s.filters.some((f) => f.includes(uuid(1))))).toBe(true);
    /* no line is drawn from this read: the whole row is never selected */
    expect(writes.filter((s) => /verb_id/.test(s.columns ?? ""))).toEqual([]);
    expect(writes.filter((s) => s.columns === "id, remote_uuid")).toHaveLength(1);
  });

  it("marks nothing a leftover on an open job, or where the account's zone isn't known", async () => {
    fake.db.sm8_job_activities = [act(1)];
    expect((await readMirrorJobDetail(ORG, JOB, TODAY))?.booked?.map((b) => b.leftover)).toEqual([false]);
    fake.db.sm8_jobs = [job(JOB, "Completed")];
    fake.db.sm8_vendor = [];
    expect((await readMirrorJobDetail(ORG, JOB, TODAY))?.booked?.map((b) => b.leftover)).toEqual([false]);
  });
});

describe("readMirrorJobDetail, where the deployment doesn't book (D-14)", () => {
  it.each(["1", "attachment,note", ""])("(F) makes exactly today's reads, and hands back today's detail, with SM8_WRITES=%j", async (setting) => {
    process.env.SM8_WRITES = setting;
    seedJob();
    const d = await readMirrorJobDetail(ORG, JOB, TODAY);
    expect(d && "booked" in d).toBe(false);
    /* the mirror's first booking from today on — the one we cleared included */
    expect(d?.nextBooking?.start).toBe(`${TOMORROW} 08:00:00`);
    expect(fake.log.map((s) => `${s.table} ${s.columns}`)).toEqual([
      "sm8_jobs uuid, generated_job_id, status, company_uuid, job_address, geo_city, geo_state, geo_postcode, category_uuid, queue_uuid, queue_expiry_date, queue_assigned_staff_uuid, job_description, work_done_description, purchase_order_number, date, quote_date, work_order_date, completion_date, total_invoice_amount, invoice_sent, invoice_date, quote_sent, quote_sent_stamp, payment_received, payment_received_stamp",
      "sm8_job_activities start_date, end_date, staff_uuid, activity_was_scheduled",
      "sm8_job_contacts first, last, type, mobile, phone, email",
      "sm8_job_checklists name, item_type, section_name, sort_order, completed_timestamp, completed_by_staff_uuid",
      /* the check-ins pressed on the card; none here, so no read of who */
      "job_check_ins id, user_id, checked_in_at, checked_out_at",
      "sm8_staff uuid, first, last, job_title",
    ]);
    expect(readSm8WriteState).not.toHaveBeenCalled();
  });
});

describe("loadScheduleDay (D-10)", () => {
  it("(F) drops the day's bookings we took out, carries the ones we sent the mirror doesn't hold with their jobs, and marks each leftover on the server", async () => {
    fake.db.sm8_job_activities.push(act(1), act(3, { start_date: `${TOMORROW} 10:00:00` }));
    /* pressed under the job's uuid in another case: one job, whatever the spelling */
    const done = sent(uuid(9), { sm8_job_uuid: DONE_JOB.toUpperCase(), booking_start: `${TOMORROW} 12:00:00`, booking_end: `${TOMORROW} 13:00:00` });
    fake.db.sm8_writes.push(cleared(uuid(3)), done);
    const p = await loadScheduleDay(ORG, TOMORROW);
    expect(p.activities.map((a) => [a.uuid, a.jobUuid, a.wasScheduled, a.leftover])).toEqual([
      [uuid(1), JOB, 1, false],
      [uuid(9), DONE_JOB, 1, true],
    ]);
    expect(p.jobs.map((j) => j.remoteId).sort()).toEqual([JOB, DONE_JOB].sort());

    /* the browser lays it out and copies the mark; it reads no clock */
    const day = layoutScheduleDay({ activities: p.activities, staff: p.staff, jobs: p.jobs });
    const blocks = day.lanes.flatMap((l) => l.blocks);
    expect(blocks.map((b) => [b.key, b.leftover])).toEqual([
      [uuid(1), false],
      [uuid(9), true],
    ]);
  });

  it("(F) copies no mark it wasn't given: a block whose activity carries none is not a leftover", () => {
    const day = layoutScheduleDay({
      activities: [{ uuid: uuid(1), jobUuid: JOB, staffUuid: SAM, start: `${TOMORROW} 08:00:00`, end: `${TOMORROW} 09:00:00`, wasScheduled: 1 }],
      staff: [{ uuid: SAM, name: "Sam Tester" }],
      jobs: [],
    });
    expect(day.lanes[0].blocks[0].leftover).toBe(false);
  });

  it.each(["1", "attachment,note"])("(F) is byte for byte today's where SM8_WRITES=%j: nothing dropped, nothing added, no mark, no more reads", async (setting) => {
    process.env.SM8_WRITES = setting;
    fake.db.sm8_job_activities.push(act(1), act(3, { start_date: `${TOMORROW} 10:00:00` }));
    fake.db.sm8_writes.push(cleared(uuid(3)), sent(uuid(9), { sm8_job_uuid: DONE_JOB, booking_start: `${TOMORROW} 12:00:00` }));
    const p = await loadScheduleDay(ORG, TOMORROW);
    expect(JSON.stringify(p.activities)).toBe(
      JSON.stringify([
        { uuid: uuid(1), jobUuid: JOB, staffUuid: SAM, start: `${TOMORROW} 08:00:00`, end: `${TOMORROW} 10:00:00`, wasScheduled: 1 },
        { uuid: uuid(3), jobUuid: JOB, staffUuid: SAM, start: `${TOMORROW} 10:00:00`, end: `${TOMORROW} 10:00:00`, wasScheduled: 1 },
      ])
    );
    expect(Object.keys(p)).toEqual(["dayISO", "activities", "staff", "onSite", "addresses", "jobs"]);
    expect(fake.log.map((s) => s.table)).toEqual(["sm8_job_activities", "sm8_job_activities", "sm8_staff", "sm8_jobs"]);
    expect(readSm8WriteState).not.toHaveBeenCalled();
  });
});

describe("the board's next booking", () => {
  it("(F) skips a booking we took out, and counts one we sent that the mirror doesn't hold", async () => {
    fake.db.sm8_writes.push(cleared(uuid(3)), sent(uuid(9), { sm8_job_uuid: DONE_JOB.toUpperCase(), booking_start: `${TOMORROW} 12:00:00` }));
    const next = await nextBookingOf(
      ORG,
      [JOB, DONE_JOB],
      [
        { uuid: uuid(3), job_uuid: JOB, start_date: `${TOMORROW} 10:00:00` },
        { uuid: uuid(1), job_uuid: JOB, start_date: `${TOMORROW} 14:00:00` },
      ],
      TODAY
    );
    expect(Object.fromEntries(next)).toEqual({ [JOB]: `${TOMORROW} 14:00:00`, [DONE_JOB]: `${TOMORROW} 12:00:00` });
  });

  it("(F) one job's row asks only about that job's bookings of ours, never the whole workspace's", async () => {
    fake.db.sm8_job_payments = [];
    fake.db.sm8_writes.push(sent(uuid(9), { sm8_job_uuid: DONE_JOB }));
    fake.db.sm8_job_activities.push(act(1));
    fake.log.length = 0;
    const r = await readMirrorJobRow(ORG, JOB, TODAY);
    expect(r?.nextBooking).toBe(`${TOMORROW} 08:00:00`);
    const sentReads = fake.on("sm8_writes").filter((s) => /booking_start/.test(s.columns ?? ""));
    expect(sentReads.length).toBeGreaterThan(0);
    for (const s of sentReads) expect(s.filters).toContain("sm8_job_uuid in");
  });

  it("(F) is the mirror's first row per job, reading nothing more, where the deployment doesn't book", async () => {
    process.env.SM8_WRITES = "attachment,note";
    fake.db.sm8_writes.push(cleared(uuid(3)));
    const next = await nextBookingOf(
      ORG,
      [JOB],
      [
        { job_uuid: JOB, start_date: `${TOMORROW} 10:00:00` },
        { job_uuid: JOB, start_date: `${TOMORROW} 14:00:00` },
      ],
      TODAY
    );
    expect(Object.fromEntries(next)).toEqual({ [JOB]: `${TOMORROW} 10:00:00` });
    expect(fake.log).toEqual([]);
  });
});

describe("readMirrorJobDetail, with check-ins pressed on the card", () => {
  it("counts a person's HeyTiff check-in over their ServiceM8 sessions that day, and names someone ServiceM8 doesn't know", async () => {
    process.env.SM8_WRITES = "";
    fake.db.sm8_job_activities.push(
      /* Sam's ServiceM8 check-in on 5 Oct: 1h 35m, missed most of the day */
      act(5, { activity_was_scheduled: 0, start_date: "2026-10-05 08:05:00", end_date: "2026-10-05 09:40:00" }),
      /* Alex's on the same day, with nothing of ours to replace it */
      act(6, { staff_uuid: ALEX, activity_was_scheduled: 0, start_date: "2026-10-05 10:00:00", end_date: "2026-10-05 11:00:00" })
    );
    fake.db.staff_profiles = [
      { id: "p-sam", org_id: ORG, user_id: "u-sam", first_name: "Sam", last_name: "Tester" },
      { id: "p-new", org_id: ORG, user_id: "u-new", first_name: "Nova", last_name: "Apprentice" },
    ];
    fake.db.integration_links = [];
    fake.db.job_check_ins = [
      /* Sam, by name: 7:30am to 4pm Sydney on 5 Oct (daylight time) */
      { id: "c1", org_id: ORG, sm8_job_uuid: JOB, user_id: "u-sam", checked_in_at: "2026-10-04T20:30:00Z", checked_out_at: "2026-10-05T05:00:00Z" },
      /* Nova, not in ServiceM8: 8am to noon */
      { id: "c2", org_id: ORG, sm8_job_uuid: JOB, user_id: "u-new", checked_in_at: "2026-10-04T21:00:00Z", checked_out_at: "2026-10-05T01:00:00Z" },
    ];
    const d = await readMirrorJobDetail(ORG, JOB, TODAY, { timezone: ZONE });
    const day = d?.visits.find((v) => v.day === "2026-10-05");
    /* 8h 30m (Sam, ours) + 1h (Alex, ServiceM8) + 4h (Nova, ours); Sam's 1h 35m gave way */
    expect(day?.minutes).toBe(510 + 60 + 240);
    expect(day?.crew.map((c) => c.name).sort()).toEqual(["Alex Sample", "Nova Apprentice", "Sam Tester"]);
  });
});
