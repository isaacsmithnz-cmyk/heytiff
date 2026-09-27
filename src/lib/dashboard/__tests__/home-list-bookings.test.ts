/* HOME'S LIST AND BOOKINGS TO SERVICEM8 — the placement and the words
   (two-way phase 3, PR E). Where bookings are offered, a won job's Book in
   books on the job's card, a booking of ours that hasn't gone says so in
   place of "No day yet.", and a finished job still booked is an alert with
   Clear. Where the deployment books nothing none of it is handed in, and
   the list is exactly main's (E-10's words half; home-list-query-bookings
   holds its reads).

   Pinned on Friday 25 September 2026, like the list's own suite. Made-up
   people and jobs only. */

import { placeHomeList, placeList, type ListAlertRow, type ListCaps, type ListInput, type LeftoverRow } from "../home-list";
import { BOOKING_WORDS, type BookingState } from "@/lib/integrations/sm8-booking-plan";
import type { AllJobsMirrorJob } from "@/lib/workboard/all-jobs";

const DAY = "2026-09-25";
const MAIN: ListCaps = { assetsAll: true, placeVisits: true, money: true, sm8: true };
const BOOKS: ListCaps = { ...MAIN, bookIn: true };

const JOB = "0b1e0b1e-0000-4000-8000-00000000e001";
const DONE = "0b1e0b1e-0000-4000-8000-00000000e002";
const LOST = "0b1e0b1e-0000-4000-8000-00000000e003";

const job = (remoteId: string, jobNumber: string, over: Partial<AllJobsMirrorJob> = {}): AllJobsMirrorJob => ({
  remoteId,
  jobNumber,
  status: "Work Order",
  clientName: "Test Strata",
  description: null,
  suburb: "Testville",
  categoryName: null,
  categoryColour: null,
  date: "2026-09-20 09:00:00",
  quoteDate: null,
  completionDate: null,
  nextBooking: null,
  money: null,
  paidCents: 0,
  ...over,
});

const input = (over: Partial<ListInput> = {}): ListInput => ({
  day: DAY,
  tz: "Australia/Sydney",
  warnDays: 30,
  viewerStaffId: "me",
  names: {},
  tasks: [],
  journal: [],
  chips: [],
  issues: [],
  wins: [],
  visits: [],
  caps: MAIN,
  ...over,
});

const alerts = (list: ReturnType<typeof placeList>): ListAlertRow[] =>
  list.groups.flatMap((g) => g.rows.flatMap((r) => (r.kind === "rollup" ? r.rows : [r]))).filter((r): r is ListAlertRow => r.kind === "alert");
const alertOf = (list: ReturnType<typeof placeList>, id: string) => alerts(list).find((r) => r.id === id);
const groupOf = (list: ReturnType<typeof placeList>, id: string) =>
  list.groups.find((g) => g.rows.some((r) => r.id === id || (r.kind === "rollup" && r.rows.some((k) => k.id === id))))?.key;

const fresh = { job: job(JOB, "3342"), wonOn: "2026-09-24" };
const older = { job: job(LOST, "3100", { suburb: "Oldtown" }), wonOn: "2026-08-01" };

const line = (text: string, tone: BookingState["tone"]): BookingState => ({ key: "line.notSent", text, tone, acts: [] });

describe("E-1: a won job's Book in", () => {
  it("books on the job's own card where bookings are offered and the viewer may", () => {
    const list = placeList(input({ wins: [fresh, older], caps: BOOKS }));
    expect(alertOf(list, `job:${JOB}`)!.verb).toEqual({ label: "Book in", bookIn: JOB });
    // the roll-up's children too
    expect(alertOf(list, `job:${LOST}`)!.verb).toEqual({ label: "Book in", bookIn: LOST });
  });

  it("is today's Schedule link otherwise — bookings not offered, or not the viewer's to press", () => {
    for (const caps of [MAIN, { ...MAIN, bookIn: false }]) {
      const list = placeList(input({ wins: [fresh], caps }));
      expect(alertOf(list, `job:${JOB}`)!.verb).toEqual({
        label: "Book in",
        door: { to: "href", href: `/dashboard/workboard?job=${JOB}` },
      });
    }
  });

  it("leaves the roll-up's Book on the board, whatever is offered (DECISIONS 10)", () => {
    const list = placeList(input({ wins: [fresh, older], caps: BOOKS }));
    const rollup = list.groups.flatMap((g) => g.rows).find((r) => r.id === "rollup:wins");
    expect(rollup && rollup.kind === "rollup" && rollup.verb).toEqual({ label: "Book", door: { to: "href", href: "/dashboard/workboard" } });
  });
});

describe("E-2: a won job with a booking of ours that hasn't gone", () => {
  it("says the booking's line in place of the won line, in the line's tone", () => {
    const failed = line("Not booked. ServiceM8 refused the booking.", "bad");
    const waiting = line("Not booked yet. Sending is paused.", null);
    const list = placeList(
      input({ wins: [fresh, older], caps: BOOKS, bookingLines: { [JOB]: failed, [LOST]: waiting } }),
    );
    const a = alertOf(list, `job:${JOB}`)!;
    expect(a).toMatchObject({ sub: "Not booked. ServiceM8 refused the booking.", tone: "late", dot: "late" });
    // still in its place, under Today
    expect(groupOf(list, `job:${JOB}`)).toBe("today");
    const b = alertOf(list, `job:${LOST}`)!;
    expect(b).toMatchObject({ sub: "Not booked yet. Sending is paused.", tone: "", dot: "quiet" });
    expect(groupOf(list, "rollup:wins")).toBe("tobook");
  });

  it("finds the job's line whatever the case of its uuid", () => {
    const upper = { job: job(JOB.toUpperCase(), "3342"), wonOn: "2026-09-24" };
    const list = placeList(input({ wins: [upper], caps: BOOKS, bookingLines: { [JOB]: line("Trial run, not booked", null) } }));
    expect(alertOf(list, `job:${JOB.toUpperCase()}`)!.sub).toBe("Trial run, not booked");
  });

  it("keeps the won line for a job with no line, or a line with nothing to say", () => {
    const silent: BookingState = { key: null, text: null, tone: null, acts: [] };
    const list = placeList(input({ wins: [fresh], caps: BOOKS, bookingLines: { [JOB]: silent } }));
    expect(alertOf(list, `job:${JOB}`)).toMatchObject({ sub: "Won yesterday. No day yet.", tone: "", dot: "today" });
  });
});

const left = (over: Partial<LeftoverRow> = {}): LeftoverRow => ({
  activityUuid: "7e7e7e7e-0000-4000-8000-000000000001",
  jobUuid: DONE,
  jobNumber: "3370",
  jobStatus: "Completed",
  staffName: "Sam",
  start: "2026-09-25 13:00:00",
  ...over,
});

describe("E-3: the leftover booking alert (DECISIONS 3)", () => {
  it("names the job, the person, the day and the time, in the words by key", () => {
    const list = placeList(input({ caps: BOOKS, leftovers: [left()] }));
    const a = alertOf(list, `leftover:${DONE}`)!;
    expect(a.title).toBe("Job 3370 is finished but still booked");
    expect(a.sub).toBe("Sam, Fri 25 Sept, 1:00 pm.");
    expect(a.door).toEqual({ to: "job", remoteId: DONE });
    expect(a.verb).toEqual({ label: "Clear", clear: { jobUuid: DONE, activityUuid: left().activityUuid } });
  });

  it("is one alert a job: several bookings say how many, and the first of them", () => {
    const list = placeList(
      input({
        caps: BOOKS,
        leftovers: [
          left({ activityUuid: "a3", start: "2026-10-02 08:00:00", staffName: "Alex" }),
          left({ activityUuid: "a1", start: "2026-09-29 07:00:00", staffName: "Sam" }),
          left({ activityUuid: "a2", start: "2026-09-30 09:30:00", staffName: null }),
        ],
      }),
    );
    const rows = alerts(list).filter((r) => r.id.startsWith("leftover:"));
    expect(rows).toHaveLength(1);
    expect(rows[0].sub).toBe("3 bookings left. The first is Sam, Tue 29 Sept, 7:00 am.");
    // Clear opens that first booking's confirm
    expect(rows[0].verb).toEqual({ label: "Clear", clear: { jobUuid: DONE, activityUuid: "a1" } });
  });

  it("is placed by its booking's own day: today under Today, later under Later", () => {
    const list = placeList(
      input({
        caps: BOOKS,
        leftovers: [left(), left({ jobUuid: LOST, jobNumber: "3371", activityUuid: "b1", start: "2026-09-28 08:00:00" })],
      }),
    );
    expect(groupOf(list, `leftover:${DONE}`)).toBe("today");
    expect(alertOf(list, `leftover:${DONE}`)!.dot).toBe("today");
    expect(groupOf(list, `leftover:${LOST}`)).toBe("later");
    expect(alertOf(list, `leftover:${LOST}`)!.dot).toBe("quiet");
  });

  it("covers an Unsuccessful job the same way", () => {
    const list = placeList(input({ caps: BOOKS, leftovers: [left({ jobStatus: "Unsuccessful" })] }));
    expect(alertOf(list, `leftover:${DONE}`)!.title).toBe("Job 3370 is finished but still booked");
  });

  it("says the person booked when ServiceM8 names nobody by name", () => {
    const list = placeList(input({ caps: BOOKS, leftovers: [left({ staffName: null })] }));
    expect(alertOf(list, `leftover:${DONE}`)!.sub).toBe(`${BOOKING_WORDS.fill.person}, Fri 25 Sept, 1:00 pm.`);
  });

  it("carries no Clear for a viewer who may not press it — the alert stays, a door to the card", () => {
    const list = placeList(input({ caps: { ...MAIN, bookIn: false }, leftovers: [left()] }));
    expect(alertOf(list, `leftover:${DONE}`)!.verb).toBeNull();
  });

  it("ranks among the alerts: after a won job, before an issue", () => {
    const list = placeList(
      input({
        caps: BOOKS,
        wins: [fresh],
        leftovers: [left()],
        issues: [
          {
            id: "i1",
            summary: "Unit keeps tripping",
            equipmentRef: null,
            occurrences: 1,
            firstSeen: DAY,
            lastSeen: DAY,
            targetKind: "none",
            targetId: null,
            where: null,
          },
        ],
      }),
    );
    const today = list.groups.find((g) => g.key === "today")!;
    expect(today.rows.map((r) => r.id)).toEqual([`job:${JOB}`, `leftover:${DONE}`, "issue:i1"]);
  });
});

describe("E-5: placeList stays pure", () => {
  it("reads no clock: the same input places the same list at any time", () => {
    const spy = jest.spyOn(Date, "now").mockImplementation(() => {
      throw new Error("placeList read the clock");
    });
    try {
      const a = placeList(input({ wins: [fresh, older], caps: BOOKS, bookingLines: { [JOB]: line("x", "bad") }, leftovers: [left()] }));
      const b = placeList(input({ wins: [fresh, older], caps: BOOKS, bookingLines: { [JOB]: line("x", "bad") }, leftovers: [left()] }));
      expect(a).toEqual(b);
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });
});

describe("E-6: the counts count things", () => {
  it("a job that left for a sent booking no longer counts, and a leftover alert counts its job once", () => {
    const before = placeList(input({ wins: [fresh, older], caps: BOOKS }));
    expect(before.groups.find((g) => g.key === "today")!.count).toBe(1);
    // the reads took the booked job off (home-list-query): the list counts what is left
    const after = placeList(input({ wins: [older], caps: BOOKS, leftovers: [left(), left({ activityUuid: "a9", start: "2026-09-25 15:00:00" })] }));
    expect(after.groups.find((g) => g.key === "today")!.count).toBe(1);
    expect(after.groups.find((g) => g.key === "tobook")!.count).toBe(1);
  });
});

describe("E-10: where the deployment books nothing, the list is main's", () => {
  it("places byte for byte the list it placed with no booking input at all", () => {
    const base = input({ wins: [fresh, older] });
    // what the reads hand in without `booking`: no bookIn, no lines, no leftovers
    const list = placeList(base);
    expect(JSON.stringify(list)).toBe(
      JSON.stringify(placeList({ ...base, caps: { assetsAll: true, placeVisits: true, money: true, sm8: true } })),
    );
    const won = alertOf(list, `job:${JOB}`)!;
    expect(won).toEqual({
      kind: "alert",
      id: `job:${JOB}`,
      title: "Job 3342, Testville",
      sub: "Won yesterday. No day yet.",
      tone: "",
      dot: "today",
      figure: null,
      door: { to: "job", remoteId: JOB },
      verb: { label: "Book in", door: { to: "href", href: `/dashboard/workboard?job=${JOB}` } },
    });
    expect(alerts(list).some((r) => r.id.startsWith("leftover:"))).toBe(false);
  });

  it("hands placeList nothing new from reads that carry nothing new", () => {
    const reads = { day: DAY, tz: null, warnDays: 30, caps: MAIN, names: {}, wins: [fresh], visits: [] };
    const base = { viewerStaffId: null, tasks: { mine: [], team: null }, chips: { self: [], team: [] }, issues: [], journal: [] };
    expect(placeHomeList(reads, base)).toEqual(placeList(input({ viewerStaffId: null, tz: null, wins: [fresh] })));
  });
});
