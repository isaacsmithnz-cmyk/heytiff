/**
 * @jest-environment node
 */

/* The Home calendar's writes (H21 Save; H22 Sort it out, Edit and Delete).
   Every rule is decided on the server, so every rule is pinned here: who may
   write (`team`, as posting a notice), what the words become, whose
   workspace a row lands in or is found in (the session's, whatever the
   request says, and every read and write naming both keys), which day (the
   workspace's, the one the calendar draws Today on, never Sydney's), how a
   repeat goes on (one row per date, one series), and that Home is told to
   draw it. Nothing here reaches a database or a model: the table is a list
   in memory that answers the calls the actions make, and the reader of a
   line is a stub. */

type Row = Record<string, unknown>;
type Insert = { table: string; row: Row };
/** One call on the table, as the action made it: what it did and what it named. */
type Call = {
  table: string;
  action: "select" | "insert" | "update" | "delete";
  eq: [string, unknown][];
  in: [string, unknown[]][];
  /** `gte`/`lte` bounds on ISO days, which compare as strings. */
  range: [string, "gte" | "lte", string][];
};
const inserts: Insert[] = [];
const calls: Call[] = [];
/** calendar_events, as the fake database holds it. */
let rows: Row[] = [];
/** public_holidays, as the fake database holds it: read, never written. */
let holidays: Row[] = [];
let holidayError: { message: string } | null = null;
/** The workspace's state (`stateFor(orgId, "")`), whose holidays these are. */
let orgState: string | null = "NSW";
let seq = 0;
let insertError: { message: string } | null = null;
let updateError: { message: string } | null = null;
let deleteError: { message: string } | null = null;
let allowed = new Set<string>(["team"]);
let staffId: string | null = "s-me";
let zone: string | null = "Australia/Sydney";
let session: { orgId?: string; user?: { sub: string } } | null = { orgId: "org-1", user: { sub: "auth0|me" } };

jest.mock("@/lib/supabase-server", () => ({
  supabaseAdmin: {
    from: (table: string) => {
      const call: Call = { table, action: "select", eq: [], in: [], range: [] };
      let payload: unknown = null;
      let returning = false;
      const matches = (r: Row) =>
        call.eq.every(([c, v]) => r[c] === v) &&
        call.in.every(([c, vs]) => vs.includes(r[c])) &&
        call.range.every(([c, op, v]) => (op === "gte" ? String(r[c]) >= v : String(r[c]) <= v));
      const run = async (one: "single" | "maybe" | null) => {
        calls.push(call);
        if (call.action === "insert") {
          if (insertError) return { data: null, error: insertError };
          const list = (Array.isArray(payload) ? payload : [payload]) as Row[];
          const made = list.map((r) => ({ ...r, id: ++seq === 1 ? "ev-new" : `ev-new-${seq}` }));
          for (const r of list) inserts.push({ table, row: r });
          rows.push(...made);
          const data = made.map((r) => ({ id: r.id }));
          return { data: one ? data[0] : data, error: null };
        }
        if (call.action === "update") {
          if (updateError) return { data: null, error: updateError };
          for (const r of rows) if (matches(r)) Object.assign(r, payload as Row);
          return { data: null, error: null };
        }
        if (call.action === "delete") {
          if (deleteError) return { data: null, error: deleteError };
          const gone = rows.filter(matches);
          rows = rows.filter((r) => !matches(r));
          return { data: returning ? gone.map((r) => ({ id: r.id })) : null, error: null };
        }
        if (table === "public_holidays" && holidayError) return { data: null, error: holidayError };
        const found = (table === "public_holidays" ? holidays : rows).filter(matches).map((r) => ({ ...r }));
        return { data: one ? (found[0] ?? null) : found, error: null };
      };
      const q: Record<string, unknown> = {
        select: () => {
          if (call.action !== "select") returning = true;
          return q;
        },
        insert: (v: unknown) => ((call.action = "insert"), (payload = v), q),
        update: (v: unknown) => ((call.action = "update"), (payload = v), q),
        delete: () => ((call.action = "delete"), q),
        eq: (c: string, v: unknown) => (call.eq.push([c, v]), q),
        in: (c: string, vs: unknown[]) => (call.in.push([c, vs]), q),
        gte: (c: string, v: string) => (call.range.push([c, "gte", v]), q),
        lte: (c: string, v: string) => (call.range.push([c, "lte", v]), q),
        single: () => run("single"),
        maybeSingle: () => run("maybe"),
        then: (ok: (v: unknown) => unknown, bad: (e: unknown) => unknown) => run(null).then(ok, bad),
      };
      return q;
    },
  },
}));
jest.mock("@/lib/auth0", () => ({ auth0: { getSession: jest.fn(async () => session) } }));
jest.mock("@/lib/permissions-server", () => ({ can: jest.fn(async (cap: string) => allowed.has(cap)) }));
jest.mock("@/lib/fleet/query", () => ({ staffProfileIdFor: jest.fn(async () => staffId) }));
jest.mock("@/lib/workboard/query", () => ({ getSm8Timezone: jest.fn(async () => zone) }));
const stateFor = jest.fn(async (_org: string, _staff: string) => orgState);
jest.mock("@/lib/timepay/leave-query", () => ({
  stateFor: (org: string, staff: string) => stateFor(org, staff),
}));
const revalidatePath = jest.fn();
jest.mock("next/cache", () => ({ revalidatePath: (p: string) => revalidatePath(p) }));
const readCalendarLine = jest.fn();
jest.mock("@/lib/calendar/line-brain", () => ({
  readCalendarLine: (...a: unknown[]) => readCalendarLine(...a),
}));

import {
  addCalendarEvent,
  deleteCalendarEvent,
  editCalendarEvent,
  fileCalendarLine,
  noteOnCalendarEvents,
  undoCalendarLine,
  type CalendarEventPatch,
} from "../calendar";
import type { CalendarLine } from "@/lib/calendar/line";

beforeEach(() => {
  inserts.length = 0;
  calls.length = 0;
  rows = [];
  holidays = [];
  holidayError = null;
  orgState = "NSW";
  stateFor.mockClear();
  seq = 0;
  insertError = null;
  updateError = null;
  deleteError = null;
  allowed = new Set(["team"]);
  staffId = "s-me";
  zone = "Australia/Sydney";
  session = { orgId: "org-1", user: { sub: "auth0|me" } };
  revalidatePath.mockClear();
  readCalendarLine.mockReset();
  /* Thu 24 Sept 2026, 11:30 pm in Perth: Sydney is already on Friday. */
  jest.useFakeTimers({ now: new Date("2026-09-24T15:30:00Z") });
});
afterEach(() => jest.useRealTimers());

describe("addCalendarEvent", () => {
  it("puts the words on today, all day, as typed, in the caller's workspace, and tells Home", async () => {
    const res = await addCalendarEvent("  Team   barbecue at the yard ");
    expect(res).toEqual({ ok: true, id: "ev-new", day: "2026-09-25" });
    expect(inserts).toEqual([
      {
        table: "calendar_events",
        row: {
          org_id: "org-1",
          kind: "event",
          title: "Team barbecue at the yard",
          starts_on: "2026-09-25",
          ends_on: "2026-09-25",
          created_by: "s-me",
          source: "typed",
        },
      },
    ]);
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard");
  });

  it("lands on the workspace's day, the one its calendar draws Today on, not Sydney's", async () => {
    zone = "Australia/Perth";
    const res = await addCalendarEvent("Toolbox talk");
    expect(res).toMatchObject({ ok: true, day: "2026-09-24" });
    expect(inserts[0]!.row).toMatchObject({ starts_on: "2026-09-24", ends_on: "2026-09-24" });
  });

  /* A workspace without ServiceM8 has no zone: its calendar draws Today on
     Sydney's day, so Save lands there too — never UTC's, still Thursday. */
  it("lands on Sydney's day for a workspace with no ServiceM8 zone", async () => {
    zone = null;
    const res = await addCalendarEvent("Toolbox talk");
    expect(res).toMatchObject({ ok: true, day: "2026-09-25" });
    expect(inserts[0]!.row).toMatchObject({ starts_on: "2026-09-25", ends_on: "2026-09-25" });
  });

  it("is refused without `team`, and writes nothing", async () => {
    allowed = new Set(["assets_all"]);
    expect(await addCalendarEvent("Toolbox talk")).toEqual({ ok: false, error: "You can't add to the calendar." });
    expect(inserts).toEqual([]);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("is refused without a session, and writes nothing", async () => {
    session = null;
    expect(await addCalendarEvent("Toolbox talk")).toEqual({ ok: false, error: "Not signed in." });
    expect(inserts).toEqual([]);
  });

  it("needs words", async () => {
    expect(await addCalendarEvent("   \n  ")).toEqual({ ok: false, error: "Give it a name first." });
    expect(await addCalendarEvent(undefined as unknown as string)).toEqual({ ok: false, error: "Give it a name first." });
    expect(inserts).toEqual([]);
  });

  /* The box empties only for a Save that went in: a line cut to fit would
     lose its end with nothing to say so. Past the table's 120 it is
     refused whole, and the box keeps it with the reason. */
  it("refuses words past the table's 120 characters rather than cutting them, and writes nothing", async () => {
    const long = `Quarterly toolbox talk at the yard: ladders, harness checks, the new van racking, and who is on call over Christmas this year`;
    expect(long.length).toBeGreaterThan(120);
    expect(await addCalendarEvent(long)).toEqual({ ok: false, error: "Keep it to 120 characters." });
    expect(inserts).toEqual([]);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  /* Postgres counts characters, not UTF-16 units: 118 letters and a
     barbecue emoji (two units, one character) is 120 characters, and goes
     in whole, the emoji intact. */
  it("counts the 120 as the table does, by character, and saves a line that fits as typed", async () => {
    const fits = `${"a".repeat(118)} \u{1F356}`;
    expect(fits.length).toBe(121);
    expect(await addCalendarEvent(fits)).toMatchObject({ ok: true });
    expect(inserts[0]!.row.title).toBe(fits);
  });

  it("writes nobody as its author for a caller with no staff card, rather than refusing them", async () => {
    staffId = null;
    expect(await addCalendarEvent("Toolbox talk")).toMatchObject({ ok: true });
    expect(inserts[0]!.row.created_by).toBeNull();
  });

  it("says so when the row does not go in, and tells Home nothing", async () => {
    insertError = { message: 'relation "calendar_events" does not exist' };
    expect(await addCalendarEvent("Toolbox talk")).toEqual({ ok: false, error: "Couldn't add that to the calendar." });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

/* ── Sort it out (H22) ── */

const line = (over: Partial<CalendarLine> = {}): CalendarLine => ({
  title: "Toolbox talk",
  titleInSentence: "toolbox talk",
  kind: "event",
  day: null,
  lastDay: null,
  time: "06:45",
  endTime: null,
  repeat: { every: "month", day: "thu", nth: 1 },
  repeatWord: null,
  where: "The yard",
  who: null,
  ...over,
});
const reads = (l: CalendarLine) => readCalendarLine.mockResolvedValue({ ok: true, line: l });

const FIRST_THURSDAYS = [
  "2026-10-01",
  "2026-11-05",
  "2026-12-03",
  "2027-01-07",
  "2027-02-04",
  "2027-03-04",
  "2027-04-01",
  "2027-05-06",
  "2027-06-03",
  "2027-07-01",
  "2027-08-05",
];

describe("fileCalendarLine", () => {
  it("puts his toolbox talk on eleven first Thursdays, in one insert under one series, and says so", async () => {
    reads(line());
    const res = await fileCalendarLine("Toolbox talk every first Thursday, 6:45");
    expect(res).toEqual({
      ok: true,
      say: "Done. Toolbox talk is on the calendar for Thu 1 Oct at 6:45 am, then the first Thursday of every month until Aug 2027.",
      plan: [
        { lead: "Thu 1 Oct", text: "toolbox talk, 6:45 am" },
        { lead: "Every month", text: "the first Thursday, until Aug 2027" },
      ],
      door: "11 events on the calendar",
      ids: expect.arrayContaining(["ev-new"]),
      about: "the toolbox talk on Thu 1 Oct",
    });
    if (!res.ok) throw new Error("not filed");
    expect(res.ids).toHaveLength(11);
    expect(calls.filter((c) => c.action === "insert")).toHaveLength(1);
    expect(inserts.map((i) => i.row.starts_on)).toEqual(FIRST_THURSDAYS);
    const series = inserts[0]!.row.series_id;
    expect(typeof series).toBe("string");
    for (const { table, row } of inserts) {
      expect(table).toBe("calendar_events");
      expect(row).toEqual({
        org_id: "org-1",
        kind: "event",
        title: "Toolbox talk",
        starts_on: row.starts_on,
        ends_on: row.starts_on,
        starts_at: "06:45",
        ends_at: null,
        location: "The yard",
        audience: null,
        series_id: series,
        repeat: { every: "month", day: "thu", nth: 1 },
        created_by: "s-me",
        source: "sorted",
      });
    }
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard");
  });

  it("reads the line on the workspace's day, to the calendar's end, and marks a spoken one as voice", async () => {
    zone = "Australia/Perth";
    reads(line({ repeat: null, day: "2026-10-08" }));
    await fileCalendarLine("  Daikin training on the 8th  ", "voice");
    expect(readCalendarLine).toHaveBeenCalledWith(
      "Daikin training on the 8th",
      { today: "2026-09-24", windowEnd: "2027-08-31" },
      [],
    );
    expect(inserts).toHaveLength(1);
    expect(inserts[0]!.row).toMatchObject({ starts_on: "2026-10-08", series_id: null, repeat: null, source: "voice" });
  });

  it("puts a range on as one row, first day to last", async () => {
    reads(line({ kind: "shutdown", title: "Christmas shutdown", repeat: null, time: null, day: "2026-12-23", lastDay: "2027-01-08" }));
    const res = await fileCalendarLine("Christmas shutdown 23 Dec to 8 Jan");
    expect(res).toMatchObject({ ok: true, say: "Done. Christmas shutdown is on the calendar from Wed 23 Dec to Fri 8 Jan." });
    expect(inserts.map((i) => [i.row.kind, i.row.starts_on, i.row.ends_on])).toEqual([
      ["shutdown", "2026-12-23", "2027-01-08"],
    ]);
  });

  it("asks Which day? when there is none, sends the answers back with the line, and stops asking after three", async () => {
    reads(line({ repeat: null }));
    expect(await fileCalendarLine("Toolbox talk")).toEqual({ ok: false, ask: "Which day?" });
    expect(await fileCalendarLine("Toolbox talk", "text", [" Thursday ", ""])).toEqual({ ok: false, ask: "Which day?" });
    expect(readCalendarLine).toHaveBeenLastCalledWith("Toolbox talk", expect.anything(), ["Thursday"]);
    expect(await fileCalendarLine("Toolbox talk", "text", ["a", "b", "c", "d"])).toEqual({
      ok: false,
      error: "I couldn't work out a day for that, so nothing went on the calendar.",
    });
    expect(readCalendarLine).toHaveBeenLastCalledWith("Toolbox talk", expect.anything(), ["b", "c", "d"]);
    expect(inserts).toEqual([]);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("says a line it could not read was never read, so its words are kept, and writes nothing", async () => {
    readCalendarLine.mockResolvedValue({ ok: false, error: "That line couldn't be read just now." });
    expect(await fileCalendarLine("toolbox talk")).toEqual({
      ok: false,
      error: "That line couldn't be read just now.",
      unread: true,
    });
    expect(inserts).toEqual([]);
  });

  it("puts nothing on outside the twelve months, and says why", async () => {
    reads(line({ repeat: null, day: "2027-09-10" }));
    expect(await fileCalendarLine("toolbox talk 10 Sept next year")).toEqual({
      ok: false,
      error: "The calendar runs to Aug 2027, so I haven't put that on it.",
    });
    reads(line({ repeat: null, day: "2026-08-20" }));
    expect(await fileCalendarLine("toolbox talk 20 Aug")).toEqual({
      ok: false,
      error: "That day has already gone, so I haven't put it on the calendar.",
    });
    expect(inserts).toEqual([]);
  });

  it("is refused without `team` or a session, before anything is read", async () => {
    allowed = new Set(["workboard"]);
    expect(await fileCalendarLine("toolbox talk")).toEqual({ ok: false, error: "You can't add to the calendar." });
    session = null;
    expect(await fileCalendarLine("toolbox talk")).toEqual({ ok: false, error: "Not signed in." });
    expect(readCalendarLine).not.toHaveBeenCalled();
    expect(inserts).toEqual([]);
  });

  it("needs words", async () => {
    expect(await fileCalendarLine("   ")).toEqual({ ok: false, error: "There was nothing in that line." });
    expect(readCalendarLine).not.toHaveBeenCalled();
  });

  it("says so when the rows do not go in, and tells Home nothing", async () => {
    reads(line());
    insertError = { message: "boom" };
    expect(await fileCalendarLine("toolbox talk")).toEqual({ ok: false, error: "Couldn't add that to the calendar." });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

/* ── what the real model said, fixed (H22's first real-model check) ──

   Each of these is a reading the model gave for a line the check sent,
   brought back on the wire exactly as the model answered and read by the
   real reader (lib/calendar/line-brain), so the guard that holds it is the
   action's own and would hold whatever the model says next time. On Sat 26
   Sept 2026 in Sydney, as the check ran, over NSW's public holidays as
   `ensureHolidays` fills them. */

/** Every field the reader asks for, empty: the model's answer is this with its own. */
const ANSWER = {
  title: "",
  title_in_sentence: "",
  kind: "event",
  day: "",
  last_day: "",
  time: "",
  end_time: "",
  repeat: "none",
  repeat_day: "",
  repeat_nth: "",
  repeat_word: "",
  where: "",
  who: "",
};

const realFetch = globalThis.fetch;
const realKey = process.env.ANTHROPIC_API_KEY;

/** The model's answer on the wire, read by the real reader. */
function modelSays(answer: Partial<typeof ANSWER>) {
  const real = jest.requireActual<typeof import("@/lib/calendar/line-brain")>("@/lib/calendar/line-brain");
  readCalendarLine.mockImplementation(real.readCalendarLine);
  process.env.ANTHROPIC_API_KEY = "test-key";
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        id: "msg_1",
        type: "message",
        role: "assistant",
        model: "claude-opus-5",
        content: [{ type: "text", text: JSON.stringify({ ...ANSWER, ...answer }) }],
        stop_reason: "end_turn",
        stop_sequence: null,
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    )) as typeof fetch;
}

/** NSW's public holidays over the calendar's twelve months (lib/timepay/holiday-rules). */
const NSW: [string, string][] = [
  ["2026-10-05", "Labour Day"],
  ["2026-12-25", "Christmas Day"],
  ["2026-12-26", "Boxing Day"],
  ["2026-12-28", "Boxing Day (additional day)"],
  ["2027-01-01", "New Year's Day"],
  ["2027-01-26", "Australia Day"],
  ["2027-03-26", "Good Friday"],
  ["2027-03-27", "Easter Saturday"],
  ["2027-03-28", "Easter Sunday"],
  ["2027-03-29", "Easter Monday"],
  ["2027-04-25", "Anzac Day"],
  ["2027-04-26", "Anzac Day (additional day)"],
  ["2027-06-14", "King's Birthday"],
];

const holidayRows = (): Row[] => [
  ...NSW.map(([holiday_date, name]) => ({ org_id: "org-1", state: "NSW", holiday_date, name, suppressed: false })),
  /* None of these is one of the caller's: a day an admin took off the list,
     another workspace's, another state's. */
  { org_id: "org-1", state: "NSW", holiday_date: "2026-09-28", name: "Taken off", suppressed: true },
  { org_id: "org-2", state: "NSW", holiday_date: "2026-09-28", name: "Theirs", suppressed: false },
  { org_id: "org-1", state: "VIC", holiday_date: "2026-09-28", name: "Grand Final Friday", suppressed: false },
];

/** The reads of the state's list the action made. */
const holidayReads = () => calls.filter((c) => c.table === "public_holidays");

describe("fileCalendarLine, held to what the model said in its first real check", () => {
  beforeEach(() => {
    holidays = holidayRows();
    /* Only the clock is fake: the reader's request runs on real ticks. */
    jest.useFakeTimers({
      now: new Date("2026-09-26T00:00:00Z"),
      doNotFake: [
        "nextTick",
        "queueMicrotask",
        "setImmediate",
        "clearImmediate",
        "setTimeout",
        "clearTimeout",
        "setInterval",
        "clearInterval",
      ],
    });
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
    if (realKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = realKey;
  });

  const PUBLIC_HOLIDAY = { title: "Public holiday", title_in_sentence: "public holiday" };

  /* "public holiday Monday", read as a shutdown on the next Monday, went
     straight on: on Labour Day, a second entry beside the state's own. */
  it("refuses a public holiday read as a shutdown on Labour Day: it is already on the calendar", async () => {
    modelSays({ ...PUBLIC_HOLIDAY, kind: "shutdown", day: "2026-10-05" });
    expect(await fileCalendarLine("public holiday Monday")).toEqual({
      ok: false,
      error: "Labour Day is already on the calendar.",
    });
    expect(inserts).toEqual([]);
    expect(revalidatePath).not.toHaveBeenCalled();
    /* The workspace's own list, for its state, as the calendar shows it. */
    expect(stateFor).toHaveBeenCalledWith("org-1", "");
    expect(holidayReads()).toHaveLength(1);
    expect(holidayReads()[0]).toMatchObject({
      eq: expect.arrayContaining([
        ["org_id", "org-1"],
        ["state", "NSW"],
        ["suppressed", false],
      ]),
      range: expect.arrayContaining([
        ["holiday_date", "gte", "2026-10-05"],
        ["holiday_date", "lte", "2026-10-05"],
      ]),
    });
  });

  /* And on 26 Sept it landed on Mon 28 Sept, an ordinary working day: the
     calendar would have shown the business shut on a day it is open. */
  it("refuses a public holiday on a day that is not one, however it was read, and says to call it a shutdown", async () => {
    const NOT_ONE = "Mon 28 Sept isn't a public holiday in NSW. If the yard's closed, say it's a shutdown.";
    modelSays({ ...PUBLIC_HOLIDAY, kind: "shutdown", day: "2026-09-28" });
    expect(await fileCalendarLine("public holiday Monday")).toEqual({ ok: false, error: NOT_ONE });
    modelSays({ ...PUBLIC_HOLIDAY, kind: "public_holiday", day: "2026-09-28" });
    expect(await fileCalendarLine("public holiday Monday")).toEqual({ ok: false, error: NOT_ONE });
    expect(inserts).toEqual([]);
  });

  it("refuses a public holiday named as one, on the day it is", async () => {
    modelSays({ title: "Labour Day", title_in_sentence: "Labour Day", kind: "public_holiday", day: "2026-10-05" });
    expect(await fileCalendarLine("Labour Day is a public holiday")).toEqual({
      ok: false,
      error: "Labour Day is already on the calendar.",
    });
    expect(inserts).toEqual([]);
  });

  it("says a public holiday is not on the calendar when the workspace has no state to take them from", async () => {
    orgState = null;
    modelSays({ ...PUBLIC_HOLIDAY, kind: "public_holiday", day: "2026-10-05" });
    expect(await fileCalendarLine("public holiday Monday week")).toEqual({
      ok: false,
      error: "Mon 5 Oct isn't a public holiday on the calendar. If the yard's closed, say it's a shutdown.",
    });
    expect(holidayReads()).toEqual([]);
    expect(inserts).toEqual([]);
  });

  it("refuses a shutdown whose every day is already a public holiday, and keeps one that only runs over some", async () => {
    modelSays({ title: "Yard closed", title_in_sentence: "yard closed", kind: "shutdown", day: "2026-12-25" });
    expect(await fileCalendarLine("yard closed christmas day")).toEqual({
      ok: false,
      error: "Christmas Day is already on the calendar.",
    });
    modelSays({ title: "Shutdown", title_in_sentence: "shutdown", kind: "shutdown", day: "2026-12-25", last_day: "2026-12-26" });
    expect(await fileCalendarLine("shutdown 25 to 26 Dec")).toEqual({
      ok: false,
      error: "Christmas Day and Boxing Day are already on the calendar.",
    });
    expect(inserts).toEqual([]);
    /* The check's own line: the Christmas break runs over three of them. */
    modelSays({ title: "Shutdown", title_in_sentence: "shutdown", kind: "shutdown", day: "2026-12-22", last_day: "2027-01-06" });
    expect(await fileCalendarLine("shutdown 22 Dec to 6 Jan")).toMatchObject({
      ok: true,
      say: "Done. Shutdown is on the calendar from Tue 22 Dec to Wed 6 Jan.",
    });
    expect(inserts.map((i) => [i.row.kind, i.row.starts_on, i.row.ends_on])).toEqual([
      ["shutdown", "2026-12-22", "2027-01-06"],
    ]);
  });

  it("files nothing when the state's list can't be read, rather than put a date on a holiday", async () => {
    holidayError = { message: "boom" };
    modelSays({ ...PUBLIC_HOLIDAY, kind: "public_holiday", day: "2026-10-05" });
    expect(await fileCalendarLine("public holiday Monday week")).toEqual({
      ok: false,
      error: "Couldn't add that to the calendar.",
    });
    modelSays({ title: "BBQ", title_in_sentence: "BBQ", repeat: "month", repeat_day: "fri", repeat_nth: "last", repeat_word: "every" });
    expect(await fileCalendarLine("BBQ every last Friday of the month")).toEqual({
      ok: false,
      error: "Couldn't add that to the calendar.",
    });
    expect(inserts).toEqual([]);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("puts a one-off on a public holiday as said, without reading the list", async () => {
    modelSays({ title: "Christmas party", title_in_sentence: "Christmas party", day: "2026-12-25", time: "18:00" });
    expect(await fileCalendarLine("christmas party christmas day 6pm")).toMatchObject({ ok: true });
    expect(inserts.map((i) => i.row.starts_on)).toEqual(["2026-12-25"]);
    expect(holidayReads()).toEqual([]);
  });

  const BBQ = {
    title: "BBQ",
    title_in_sentence: "BBQ",
    time: "15:00",
    where: "The yard",
    repeat: "month",
    repeat_day: "fri",
    repeat_nth: "last",
  };

  /* "BBQ at the yard last Friday of the month 3pm" went on as eleven
     monthly dates: the line never says every. */
  it("puts the last Friday of the month on once, the next one, when the words never say it repeats", async () => {
    for (const repeat_word of ["", "monthly", "of the month", "month"]) {
      inserts.length = 0;
      modelSays({ ...BBQ, repeat_word });
      const res = await fileCalendarLine("BBQ at the yard last Friday of the month 3pm");
      expect(res).toMatchObject({
        ok: true,
        say: "Done. BBQ is on the calendar for Fri 30 Oct at 3:00 pm.",
        plan: [{ lead: "Fri 30 Oct", text: "BBQ, 3:00 pm" }],
        door: "1 event on the calendar",
      });
      expect(inserts.map((i) => [i.row.starts_on, i.row.series_id, i.row.repeat])).toEqual([["2026-10-30", null, null]]);
    }
  });

  it("puts on the next one from the day the model gave, never before today", async () => {
    modelSays({ ...BBQ, day: "2026-09-25" });
    await fileCalendarLine("BBQ at the yard last Friday of the month 3pm");
    modelSays({ ...BBQ, day: "2026-11-02" });
    await fileCalendarLine("BBQ at the yard last Friday of November 3pm");
    expect(inserts.map((i) => i.row.starts_on)).toEqual(["2026-10-30", "2026-11-27"]);
  });

  it("keeps a repeat the words say: every, each, monthly, in an answer, or the speaker's own word in the line", async () => {
    const said: [string, string, string[]][] = [
      ["BBQ at the yard every last Friday of the month 3pm", "", []],
      ["BBQ at the yard, last Friday of each month, 3pm", "", []],
      ["Monthly BBQ at the yard, the last Friday, 3pm", "", []],
      ["BBQ at the yard 3pm", "", ["every last Friday"]],
      ["Grillen im Hof jeden letzten Freitag im Monat 15 Uhr", "jeden", []],
    ];
    for (const [words, repeat_word, answers] of said) {
      inserts.length = 0;
      modelSays({ ...BBQ, repeat_word });
      expect(await fileCalendarLine(words, "text", answers)).toMatchObject({ ok: true, door: "9 events on the calendar" });
      expect(new Set(inserts.map((i) => i.row.series_id)).size).toBe(1);
      expect(inserts[0]!.row.series_id).not.toBeNull();
    }
  });

  it("never takes the speaker's word for it when the word isn't in what they said", async () => {
    modelSays({ ...BBQ, repeat_word: "jeden" });
    expect(await fileCalendarLine("BBQ at the yard last Friday of the month 3pm")).toMatchObject({
      ok: true,
      door: "1 event on the calendar",
    });
  });

  /* The same line with every went on over Christmas Day and Good Friday. */
  it("leaves the public holidays out of a series, and says which", async () => {
    modelSays({ ...BBQ, repeat_word: "every" });
    const res = await fileCalendarLine("BBQ at the yard every last Friday of the month 3pm");
    expect(res).toMatchObject({
      ok: true,
      say: "Done. BBQ is on the calendar for Fri 30 Oct at 3:00 pm, then the last Friday of every month until Aug 2027. Skips Christmas Day and Good Friday.",
      door: "9 events on the calendar",
    });
    if (!res.ok) throw new Error("not filed");
    expect(res.ids).toHaveLength(9);
    expect(inserts.map((i) => i.row.starts_on)).toEqual([
      "2026-10-30",
      "2026-11-27",
      "2027-01-29",
      "2027-02-26",
      "2027-04-30",
      "2027-05-28",
      "2027-06-25",
      "2027-07-30",
      "2027-08-27",
    ]);
    /* The list is read over the series' own dates. */
    expect(holidayReads()[0]!.range).toEqual(
      expect.arrayContaining([
        ["holiday_date", "gte", "2026-10-30"],
        ["holiday_date", "lte", "2027-08-27"],
      ]),
    );
  });

  /* The check's site meeting landed on Easter Monday and Anzac Day's extra Monday. */
  it("leaves them out of a fortnightly series too", async () => {
    modelSays({
      title: "Site meeting",
      title_in_sentence: "site meeting",
      time: "07:00",
      repeat: "fortnight",
      repeat_day: "mon",
      repeat_word: "every",
    });
    const res = await fileCalendarLine("every second Monday site meeting 7am");
    expect(res).toMatchObject({
      ok: true,
      say: "Done. Site meeting is on the calendar for Mon 28 Sept at 7:00 am, then every second Monday until Aug 2027. Skips Easter Monday and Anzac Day (additional day).",
      door: "23 events on the calendar",
    });
    expect(inserts.map((i) => i.row.starts_on)).not.toContain("2027-03-29");
    expect(inserts.map((i) => i.row.starts_on)).not.toContain("2027-04-26");
  });

  it("leaves a shutdown's days out of a series, the caller's own shutdowns only, and says so", async () => {
    rows = [
      { id: "sd", org_id: "org-1", kind: "shutdown", title: "Christmas shutdown", starts_on: "2026-12-23", ends_on: "2027-01-08" },
      { id: "sd2", org_id: "org-2", kind: "shutdown", title: "Theirs", starts_on: "2027-02-03", ends_on: "2027-02-03" },
      { id: "ev", org_id: "org-1", kind: "event", title: "Stocktake", starts_on: "2027-03-03", ends_on: "2027-03-03" },
    ];
    const WALK = { title: "Site walk", title_in_sentence: "site walk", repeat_word: "every" };
    modelSays({ ...WALK, repeat: "week", repeat_day: "wed" });
    const weekly = await fileCalendarLine("site walk every Wednesday");
    expect(weekly).toMatchObject({ ok: true, say: expect.stringMatching(/ Skips 3 dates in the shutdown\.$/) });
    const days = inserts.map((i) => i.row.starts_on);
    for (const d of ["2026-12-23", "2026-12-30", "2027-01-06"]) expect(days).not.toContain(d);
    for (const d of ["2027-02-03", "2027-03-03"]) expect(days).toContain(d);

    inserts.length = 0;
    modelSays({ ...WALK, repeat: "month", repeat_day: "wed", repeat_nth: "first" });
    expect(await fileCalendarLine("site walk every first Wednesday")).toMatchObject({
      ok: true,
      say: expect.stringMatching(/ Skips Wed 6 Jan in the shutdown\.$/),
    });
  });

  it("puts nothing on when every date a series would land on is already closed, and says so", async () => {
    rows = [{ id: "sd", org_id: "org-1", kind: "shutdown", title: "Shutdown", starts_on: "2027-08-02", ends_on: "2027-08-06" }];
    modelSays({
      title: "Toolbox talk",
      title_in_sentence: "toolbox talk",
      day: "2027-08-01",
      repeat: "month",
      repeat_day: "thu",
      repeat_nth: "first",
      repeat_word: "every",
    });
    expect(await fileCalendarLine("toolbox talk every first Thursday from August")).toEqual({
      ok: false,
      error: "Every date it lands on is a public holiday or a shutdown, so nothing went on the calendar.",
    });
    expect(inserts).toEqual([]);
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

/* ── what is already on the calendar ── */

/** Rows as filings left them: the caller's series of three, a one-off and a
    shutdown, and another workspace's row under the same series id. */
function seed() {
  const base = { kind: "event", title: "Toolbox talk", starts_at: "06:45", ends_at: null, location: null, audience: null, note: null };
  rows = [
    { ...base, id: "a", org_id: "org-1", starts_on: "2026-10-01", ends_on: "2026-10-01", series_id: "s1" },
    { ...base, id: "b", org_id: "org-1", starts_on: "2026-11-05", ends_on: "2026-11-05", series_id: "s1" },
    { ...base, id: "c", org_id: "org-1", starts_on: "2026-12-03", ends_on: "2026-12-03", series_id: "s1" },
    { ...base, id: "d", org_id: "org-1", title: "Team meeting", starts_on: "2026-10-14", ends_on: "2026-10-14", series_id: null },
    { ...base, id: "x", org_id: "org-2", starts_on: "2026-10-01", ends_on: "2026-10-01", series_id: "s1", note: "theirs" },
    {
      ...base,
      id: "sd",
      org_id: "org-1",
      kind: "shutdown",
      title: "Christmas shutdown",
      starts_at: null,
      starts_on: "2026-12-23",
      ends_on: "2027-01-08",
      series_id: null,
    },
  ];
}
const byId = (id: string) => rows.find((r) => r.id === id);
const theirs = () => rows.find((r) => r.org_id === "org-2")!;
/** A call that names the caller's workspace and the row or series it is about. */
const namesBothKeys = (c: Call) =>
  c.eq.some(([k, v]) => k === "org_id" && v === "org-1") &&
  (c.eq.some(([k]) => k === "id" || k === "series_id") || c.in.some(([k]) => k === "id"));

describe("noteOnCalendarEvents", () => {
  beforeEach(seed);

  it("keeps a reply on each event it names, added to what it says, in the caller's workspace only", async () => {
    byId("b")!.note = "Working at heights";
    expect(await noteOnCalendarEvents(["a", "b", "x", "a"], "  Put it in the  yard ")).toEqual({ ok: true });
    expect(byId("a")!.note).toBe("Put it in the yard");
    expect(byId("b")!.note).toBe("Working at heights. Put it in the yard");
    expect(theirs().note).toBe("theirs");
    expect(calls.every(namesBothKeys)).toBe(true);
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard");
  });

  it("finds nothing of another workspace's, and says it is gone", async () => {
    session = { orgId: "org-3", user: { sub: "auth0|me" } };
    expect(await noteOnCalendarEvents(["a"], "x")).toEqual({ ok: false, error: "That's no longer on the calendar." });
    expect(byId("a")!.note).toBeNull();
  });

  it("is refused without `team`, and needs words", async () => {
    allowed = new Set();
    expect(await noteOnCalendarEvents(["a"], "x")).toEqual({ ok: false, error: "You can't change the calendar." });
    allowed = new Set(["team"]);
    expect(await noteOnCalendarEvents(["a"], "  ")).toEqual({ ok: false, error: "There was nothing to add." });
    expect(byId("a")!.note).toBeNull();
  });

  /* Otherwise Tiff says "Got it. I have added that…" when nothing was kept. */
  it("says so when the note does not go in, and tells Home nothing", async () => {
    updateError = { message: "boom" };
    expect(await noteOnCalendarEvents(["a"], "Put it in the yard")).toEqual({
      ok: false,
      error: "Couldn't change that on the calendar.",
    });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  /* The browser names the rows, so what it names is held to what one filing
     can put on: strings, each once, and no more than a series has dates. */
  it("names no more rows than one filing puts on, and only as strings", async () => {
    const many = [...Array.from({ length: 60 }, (_, i) => `r${i}`), 7, "a"] as unknown as string[];
    await noteOnCalendarEvents(many, "x");
    const named = calls[0]!.in.find(([c]) => c === "id")![1];
    expect(named).toHaveLength(53);
    expect(named.every((v) => typeof v === "string")).toBe(true);
  });
});

describe("undoCalendarLine", () => {
  beforeEach(seed);

  it("takes off only what the filing put on, in the caller's workspace, and counts it", async () => {
    expect(await undoCalendarLine(["a", "b", "x"])).toEqual({ ok: true, summary: "2 events taken back." });
    expect(rows.map((r) => r.id)).toEqual(["c", "d", "x", "sd"]);
    expect(calls.every(namesBothKeys)).toBe(true);
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard");
  });

  it("says so when none of it is there any more", async () => {
    expect(await undoCalendarLine(["gone"])).toEqual({ ok: false, error: "That's no longer on the calendar." });
    expect(await undoCalendarLine([])).toEqual({ ok: false, error: "That's no longer on the calendar." });
  });

  it("is refused without `team`, and takes nothing off", async () => {
    allowed = new Set();
    expect(await undoCalendarLine(["a"])).toEqual({ ok: false, error: "You can't change the calendar." });
    expect(rows).toHaveLength(6);
  });

  /* A failed delete is not "no longer on the calendar": it still is. */
  it("says it couldn't, not that it's gone, when the delete does not go in", async () => {
    deleteError = { message: "boom" };
    expect(await undoCalendarLine(["a"])).toEqual({ ok: false, error: "Couldn't change that on the calendar." });
    expect(rows).toHaveLength(6);
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe("editCalendarEvent", () => {
  beforeEach(seed);

  const patch = (over: Partial<CalendarEventPatch> = {}): CalendarEventPatch => ({
    title: " Toolbox  talk: ladders ",
    startsOn: "2026-11-06",
    endsOn: null,
    startsAt: "07:00",
    endsAt: "07:30",
    location: " The yard ",
    audience: "Everyone",
    note: " Bring a harness ",
    ...over,
  });

  it("changes this one alone, its day included, and leaves the rest of its series as it was", async () => {
    expect(await editCalendarEvent("b", patch(), "one")).toEqual({ ok: true });
    expect(byId("b")).toMatchObject({
      title: "Toolbox talk: ladders",
      starts_on: "2026-11-06",
      ends_on: "2026-11-06",
      starts_at: "07:00",
      ends_at: "07:30",
      location: "The yard",
      audience: "Everyone",
      note: "Bring a harness",
    });
    expect(byId("a")).toMatchObject({ title: "Toolbox talk", starts_at: "06:45", starts_on: "2026-10-01" });
    expect(byId("c")).toMatchObject({ title: "Toolbox talk" });
    expect(calls.every(namesBothKeys)).toBe(true);
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard");
  });

  it("changes what every date in the series says, moving only this one's day, never another workspace's", async () => {
    expect(await editCalendarEvent("b", patch(), "series")).toEqual({ ok: true });
    for (const id of ["a", "b", "c"]) {
      expect(byId(id)).toMatchObject({ title: "Toolbox talk: ladders", starts_at: "07:00", note: "Bring a harness" });
    }
    expect(byId("a")!.starts_on).toBe("2026-10-01");
    expect(byId("c")!.starts_on).toBe("2026-12-03");
    expect(byId("b")!.starts_on).toBe("2026-11-06");
    expect(theirs()).toMatchObject({ title: "Toolbox talk", note: "theirs" });
    expect(byId("d")!.title).toBe("Team meeting");
    expect(calls.every(namesBothKeys)).toBe(true);
  });

  it("changes only itself when it is in no series, whatever scope was asked", async () => {
    expect(await editCalendarEvent("d", patch({ startsOn: "2026-10-14" }), "series")).toEqual({ ok: true });
    expect(byId("d")!.title).toBe("Toolbox talk: ladders");
    // the shutdown is in no series either, and is not this one
    expect(byId("sd")!.title).toBe("Christmas shutdown");
    expect(calls.some((c) => c.eq.some(([k]) => k === "series_id"))).toBe(false);
  });

  /* "Save all 3" counted the dates the calendar shows: all is those. A date
     from a month gone by is off the calendar, uncounted, and kept as it was. */
  it("changes the series' dates the calendar shows, and none from a month gone by", async () => {
    rows.push({ ...byId("a")!, id: "p", starts_on: "2026-08-06", ends_on: "2026-08-06" });
    rows.push({ ...byId("a")!, id: "f", starts_on: "2027-09-02", ends_on: "2027-09-02" });
    expect(await editCalendarEvent("b", patch(), "series")).toEqual({ ok: true });
    for (const id of ["a", "b", "c"]) expect(byId(id)!.title).toBe("Toolbox talk: ladders");
    expect(byId("p")!.title).toBe("Toolbox talk");
    expect(byId("f")!.title).toBe("Toolbox talk");
  });

  it("keeps a date in a series to one day, and a range to its last day", async () => {
    await editCalendarEvent("b", patch({ endsOn: "2026-11-09" }), "one");
    expect(byId("b")!.ends_on).toBe("2026-11-06");
    await editCalendarEvent("sd", patch({ startsOn: "2026-12-24", endsOn: "2027-01-10" }), "one");
    expect(byId("sd")).toMatchObject({ starts_on: "2026-12-24", ends_on: "2027-01-10" });
  });

  it("gives a shutdown no hours, whatever the form sent", async () => {
    await editCalendarEvent("sd", patch({ startsOn: "2026-12-23", endsOn: "2027-01-08" }), "one");
    expect(byId("sd")).toMatchObject({ starts_at: null, ends_at: null });
  });

  it("clears the hours, the place, who and the note when the form leaves them empty", async () => {
    await editCalendarEvent("d", patch({ startsAt: null, endsAt: "", location: "  ", audience: null, note: "" }), "one");
    expect(byId("d")).toMatchObject({ starts_at: null, ends_at: null, location: null, audience: null, note: null });
  });

  it.each([
    [{ title: "  " }, "Give it a name first."],
    [{ title: `${"x".repeat(120)}!` }, "Keep it to 120 characters."],
    [{ startsOn: "2026-02-30" }, "Pick the day it's on."],
    [{ endsOn: "2026-11-01" }, "It can't end before it starts."],
    [{ startsAt: "7am" }, "That time isn't one I can read."],
    [{ startsAt: null, endsAt: "07:30" }, "Give it a start time first."],
    [{ endsAt: "06:30" }, "It has to finish after it starts."],
  ])("refuses %j and changes nothing", async (over, error) => {
    const before = JSON.stringify(rows);
    expect(await editCalendarEvent("d", patch(over), "one")).toEqual({ ok: false, error });
    expect(JSON.stringify(rows)).toBe(before);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("finds nothing of another workspace's, and is refused without `team`", async () => {
    expect(await editCalendarEvent("x", patch(), "series")).toEqual({ ok: false, error: "That's no longer on the calendar." });
    expect(theirs().title).toBe("Toolbox talk");
    allowed = new Set();
    expect(await editCalendarEvent("b", patch(), "one")).toEqual({ ok: false, error: "You can't change the calendar." });
    expect(byId("b")!.title).toBe("Toolbox talk");
  });

  it("says so when the change does not go in", async () => {
    updateError = { message: "boom" };
    expect(await editCalendarEvent("b", patch(), "series")).toEqual({ ok: false, error: "Couldn't change that on the calendar." });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe("deleteCalendarEvent", () => {
  beforeEach(seed);

  it("deletes this one and leaves the rest of its series", async () => {
    expect(await deleteCalendarEvent("b", "one")).toEqual({ ok: true, count: 1 });
    expect(rows.map((r) => r.id)).toEqual(["a", "c", "d", "x", "sd"]);
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard");
  });

  it("deletes every date in the series, and nothing of another workspace's under the same series", async () => {
    expect(await deleteCalendarEvent("b", "series")).toEqual({ ok: true, count: 3 });
    expect(rows.map((r) => r.id)).toEqual(["d", "x", "sd"]);
    expect(calls.every(namesBothKeys)).toBe(true);
  });

  it("deletes only itself when it is in no series, whatever scope was asked", async () => {
    expect(await deleteCalendarEvent("d", "series")).toEqual({ ok: true, count: 1 });
    expect(rows.map((r) => r.id)).toEqual(["a", "b", "c", "x", "sd"]);
  });

  it("finds nothing of another workspace's, and is refused without `team`", async () => {
    expect(await deleteCalendarEvent("x", "series")).toEqual({ ok: false, error: "That's no longer on the calendar." });
    allowed = new Set();
    expect(await deleteCalendarEvent("a", "one")).toEqual({ ok: false, error: "You can't change the calendar." });
    expect(rows).toHaveLength(6);
  });

  /* "Delete all 3" deletes the three it counted: the dates the calendar
     shows. A date from a month gone by was not on it, and is kept. */
  it("deletes the series' dates the calendar shows, and none from a month gone by", async () => {
    rows.push({ ...byId("a")!, id: "p", starts_on: "2026-08-06", ends_on: "2026-08-06" });
    rows.push({ ...byId("a")!, id: "f", starts_on: "2027-09-02", ends_on: "2027-09-02" });
    expect(await deleteCalendarEvent("b", "series")).toEqual({ ok: true, count: 3 });
    expect(rows.map((r) => r.id)).toEqual(["d", "x", "sd", "p", "f"]);
  });

  /* Otherwise the form closes as deleted while the event stays on. */
  it("says so when the delete does not go in, and tells Home nothing", async () => {
    deleteError = { message: "boom" };
    for (const scope of ["one", "series"] as const) {
      expect(await deleteCalendarEvent("b", scope)).toEqual({
        ok: false,
        error: "Couldn't change that on the calendar.",
      });
    }
    expect(rows).toHaveLength(6);
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
