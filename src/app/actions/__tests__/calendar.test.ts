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
type Call = { table: string; action: "select" | "insert" | "update" | "delete"; eq: [string, unknown][]; in: [string, unknown[]][] };
const inserts: Insert[] = [];
const calls: Call[] = [];
/** calendar_events, as the fake database holds it. */
let rows: Row[] = [];
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
      const call: Call = { table, action: "select", eq: [], in: [] };
      let payload: unknown = null;
      let returning = false;
      const matches = (r: Row) =>
        call.eq.every(([c, v]) => r[c] === v) && call.in.every(([c, vs]) => vs.includes(r[c]));
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
        const found = rows.filter(matches).map((r) => ({ ...r }));
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
    const res = await fileCalendarLine("Toolbox talk first Thursday of the month, 6:45");
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
});
