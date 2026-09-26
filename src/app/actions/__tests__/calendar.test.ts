/**
 * @jest-environment node
 */

/* The Home calendar's Save (H21). Every rule is decided on the server, so
   every rule is pinned here: who may add (`team`, as posting a notice), what
   the words become (trimmed, one line, the table's 120), whose workspace the
   row lands in (the session's, whatever the request says), which day (the
   workspace's, the one the calendar draws Today on, never Sydney's), and
   that Home is told to draw it. Nothing here reaches a database. */

type Insert = { table: string; row: Record<string, unknown> };
const inserts: Insert[] = [];
let insertError: { message: string } | null = null;
let allowed = new Set<string>(["team"]);
let staffId: string | null = "s-me";
let zone: string | null = "Australia/Sydney";
let session: { orgId?: string; user?: { sub: string } } | null = { orgId: "org-1", user: { sub: "auth0|me" } };

jest.mock("@/lib/supabase-server", () => ({
  supabaseAdmin: {
    from: (table: string) => ({
      insert: (row: Record<string, unknown>) => {
        inserts.push({ table, row });
        const done: Record<string, unknown> = {};
        done.select = () => done;
        done.single = async () => (insertError ? { data: null, error: insertError } : { data: { id: "ev-new" }, error: null });
        return done;
      },
    }),
  },
}));
jest.mock("@/lib/auth0", () => ({ auth0: { getSession: jest.fn(async () => session) } }));
jest.mock("@/lib/permissions-server", () => ({ can: jest.fn(async (cap: string) => allowed.has(cap)) }));
jest.mock("@/lib/fleet/query", () => ({ staffProfileIdFor: jest.fn(async () => staffId) }));
jest.mock("@/lib/workboard/query", () => ({ getSm8Timezone: jest.fn(async () => zone) }));
const revalidatePath = jest.fn();
jest.mock("next/cache", () => ({ revalidatePath: (p: string) => revalidatePath(p) }));

import { addCalendarEvent } from "../calendar";

beforeEach(() => {
  inserts.length = 0;
  insertError = null;
  allowed = new Set(["team"]);
  staffId = "s-me";
  zone = "Australia/Sydney";
  session = { orgId: "org-1", user: { sub: "auth0|me" } };
  revalidatePath.mockClear();
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
