/* THE JOB CARD'S AND THE SCHEDULE'S BOOKINGS, AS THE SERVER HANDS THEM
   OVER (two-way phase 3, PR D).

   readJobRecord says whether Book in and Clear are offered here, with every
   press's lines; scheduleDay says whether a leftover's Clear is. Book in
   goes only to Workboard manage, the owner while bookings are the owner's,
   where bookings are offered, on an active Quote or Work Order (D-1). Where
   the deployment doesn't name `booking`, neither makes one read more, and
   what they hand over has no booking key at all (D-14). */

const statements: { table: string; columns: string }[] = [];
let jobRow: Record<string, unknown> | null = null;

jest.mock("@/lib/supabase-server", () => ({
  supabaseAdmin: {
    from: (table: string) => {
      const chain: Record<string, unknown> = {};
      chain.select = (columns: string) => {
        statements.push({ table, columns });
        return chain;
      };
      chain.eq = () => chain;
      chain.maybeSingle = async () => ({ data: table === "sm8_jobs" ? jobRow : null, error: null });
      return chain;
    },
  },
}));
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));
jest.mock("@/lib/auth0", () => ({
  auth0: { getSession: jest.fn(async () => ({ user: { sub: "auth0|sam" }, orgId: "org-1" })) },
}));

let caps = new Set<string>();
let role = "owner";
jest.mock("@/lib/permissions-server", () => ({
  can: async (c: string) => caps.has(c),
  getDbRole: async () => role,
}));
jest.mock("@/lib/workboard/query", () => ({ getSm8Timezone: async () => "Australia/Sydney" }));
jest.mock("@/lib/org/query", () => ({ orgPaymentTermsDays: async () => null }));
const readJobNotes = jest.fn(async (): Promise<unknown[]> => []);
jest.mock("@/lib/workboard/all-jobs-query", () => ({
  familyMediaSources: async () => [],
  readJobNotes: () => readJobNotes(),
  readJobLedger: async () => null,
  readJobFamily: async () => null,
}));
jest.mock("@/lib/workboard/job-summary", () => ({ readStoredJobSummary: async () => null }));
jest.mock("@/lib/workboard/job-notes-query", () => ({
  readOurJobNotes: async () => [],
  readFlagStates: async () => ({ flags: {}, held: new Set() }),
  readJobAttention: async () => ({ attention: { items: [], total: 0 }, assignable: [] }),
}));

const DAY_PAYLOAD = { dayISO: "2026-10-07", activities: [], staff: [], jobs: [], onSite: [], addresses: {} };
const loadScheduleDay = jest.fn(async (..._a: unknown[]) => ({ ...DAY_PAYLOAD }));
jest.mock("@/lib/workboard/schedule-query", () => ({
  loadScheduleDay: (...a: unknown[]) => loadScheduleDay(...a),
  EMPTY_SCHEDULE: { dayISO: "", activities: [], staff: [], jobs: [], onSite: [], addresses: {} },
}));

const readSm8WriteState = jest.fn(async () => state);
jest.mock("@/lib/integrations/sm8-writes", () => ({ readSm8WriteState: () => readSm8WriteState() }));
const readBookingLines = jest.fn(async (_o: string, _s: unknown, _j: string, _viewer: string | null) => ({
  verbs: [],
  lines: {},
  gone: [],
  untried: [],
}));
const bookingZone = jest.fn(async () => ({ zone: "Australia/Sydney" }));
jest.mock("@/lib/integrations/sm8-booking-read", () => ({
  readBookingLines: (...a: unknown[]) => readBookingLines(...(a as [string, unknown, string, string | null])),
  bookingZone: () => bookingZone(),
}));

import { readJobRecord, scheduleDay } from "../workboard";
import type { Sm8WriteState } from "@/lib/integrations/sm8-write-plan";

const JOB = "0b1e0b1e-0000-4000-8000-00000000d001";

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
  tenantId: "vendor-1",
  granted: ["attachment", "note", "booking"],
  refused: [],
  timezoneName: "Australia/Sydney",
  ownerKinds: ["attachment", "note", "booking"],
  ownerKindsRead: true,
};
let state: Sm8WriteState = STATE;

beforeEach(() => {
  statements.length = 0;
  caps = new Set(["workboard", "workboard_manage"]);
  role = "owner";
  state = STATE;
  jobRow = { status: "Quote", active: 1 };
  readSm8WriteState.mockClear();
  readBookingLines.mockClear();
  readJobNotes.mockReset().mockResolvedValue([]);
  loadScheduleDay.mockClear();
  bookingZone.mockClear();
  process.env.SM8_WRITES = "attachment,booking";
});
afterAll(() => {
  delete process.env.SM8_WRITES;
});

describe("where the deployment doesn't book (D-14)", () => {
  it.each([
    /* files only: the job's status, and nothing of ServiceM8's sending */
    ["1", [{ table: "sm8_jobs", columns: "status, generated_job_id" }], 0],
    /* notes: the notes' viewer too — their staff card and the settings, once */
    [
      "attachment,note",
      [
        { table: "staff_profiles", columns: "id" },
        { table: "sm8_jobs", columns: "status, generated_job_id" },
      ],
      1,
    ],
  ] as const)("(F) a card open reads what it always read, and the record has no bookings, with SM8_WRITES=%j", async (setting, reads, settings) => {
    process.env.SM8_WRITES = setting;
    const r = await readJobRecord(JOB);
    expect(r && "bookings" in r).toBe(false);
    expect(statements).toEqual(reads);
    expect(readSm8WriteState).toHaveBeenCalledTimes(settings);
    expect(readBookingLines).not.toHaveBeenCalled();
    expect(bookingZone).not.toHaveBeenCalled();
  });

  it("(F) the Schedule's day is the loader's, with no Clear and no read more", async () => {
    process.env.SM8_WRITES = "attachment,note";
    const p = await scheduleDay("2026-10-07");
    expect(Object.keys(p)).toEqual(Object.keys(DAY_PAYLOAD));
    expect(readSm8WriteState).not.toHaveBeenCalled();
    /* the loader as it always was called */
    expect(loadScheduleDay.mock.calls).toEqual([["org-1", "2026-10-07", { away: true }]]);
  });
});

describe("Book in and Clear on the card (D-1)", () => {
  const bookings = async () => (await readJobRecord(JOB))?.bookings;

  it("(F) are offered to the owner with Workboard manage, on an active Quote or Work Order, where bookings are offered", async () => {
    expect(await bookings()).toMatchObject({ offered: true, canBook: true, canClear: true, trial: false, hold: null, zone: "Australia/Sydney" });
    jobRow = { status: "Work Order", active: 1 };
    expect(await bookings()).toMatchObject({ canBook: true });
    /* the doors are the viewer's */
    expect(readBookingLines.mock.calls.at(-1)?.[3]).toBe("auth0|sam");
  });

  it("(F) Book in isn't offered on a job that's finished, or gone, though a leftover's Clear still is", async () => {
    for (const row of [{ status: "Completed", active: 1 }, { status: "Unsuccessful", active: 1 }, { status: "Quote", active: 0 }, null]) {
      jobRow = row;
      expect([row, await bookings()]).toEqual([row, expect.objectContaining({ canBook: false, canClear: true })]);
    }
  });

  it("(F) neither is offered without Workboard manage, or to a manager while bookings are the owner's — and the lines come with no doors", async () => {
    caps = new Set(["workboard"]);
    expect(await bookings()).toMatchObject({ canBook: false, canClear: false });
    expect(readBookingLines.mock.calls.at(-1)?.[3]).toBeNull();
    caps = new Set(["workboard", "workboard_manage"]);
    role = "manager";
    expect(await bookings()).toMatchObject({ canBook: false, canClear: false });
    expect(readBookingLines.mock.calls.at(-1)?.[3]).toBeNull();
  });

  it("(F) neither is offered where bookings aren't: the owner's switch off, or no ServiceM8 account", async () => {
    state = { ...STATE, ownerKinds: ["attachment"] };
    expect(await bookings()).toMatchObject({ offered: false, canBook: false, canClear: false, hold: "off" });
    state = { ...STATE, tenantId: null, linked: false };
    expect(await bookings()).toMatchObject({ offered: false, canBook: false, canClear: false });
  });

  it("says a trial run, and what holds what is booked", async () => {
    state = { ...STATE, mode: "trial" };
    expect(await bookings()).toMatchObject({ offered: true, trial: true });
    state = { ...STATE, mode: "paused" };
    expect(await bookings()).toMatchObject({ hold: "paused" });
  });

  it("(F) reads the bookings in the same round as the notes, not after them", async () => {
    /* the notes answer only once the bookings have been asked for: read one
       after the other, the card would never open */
    let asked: () => void = () => {};
    const bookingsAsked = new Promise<void>((r) => (asked = r));
    readBookingLines.mockImplementationOnce(async () => {
      asked();
      return { verbs: [], lines: {}, gone: [], untried: [] };
    });
    readJobNotes.mockImplementationOnce(async () => {
      await bookingsAsked;
      return [];
    });
    const r = await Promise.race([readJobRecord(JOB), new Promise((r) => setTimeout(() => r("stuck"), 500))]);
    expect(r).not.toBe("stuck");
  });

  it("(F) the Schedule reads the write state once, for the day's overlay and the Clear alike", async () => {
    await scheduleDay("2026-10-07");
    expect(readSm8WriteState).toHaveBeenCalledTimes(1);
    expect(loadScheduleDay).toHaveBeenCalledWith("org-1", "2026-10-07", { state: STATE, away: true });
  });

  it("(F) the Schedule offers a leftover's Clear only to a viewer who may press, where bookings are offered", async () => {
    expect((await scheduleDay("2026-10-07")).canClear).toBe(true);
    role = "manager";
    expect("canClear" in (await scheduleDay("2026-10-07"))).toBe(false);
    role = "owner";
    state = { ...STATE, ownerKinds: ["attachment"] };
    expect("canClear" in (await scheduleDay("2026-10-07"))).toBe(false);
  });
});
