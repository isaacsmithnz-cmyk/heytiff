/* The Home calendar's reads. The gates are the point: the fleet only for
   `assets_all`, the business's papers only for the owner, and the two new
   tables allowed not to exist yet without costing anyone their Home. The
   fake database below answers the filters the way Postgres would, so a
   filter that is missing shows up as a row that should not be there. */

type Filter = { op: "eq" | "lte" | "gte" | "is"; col: string; val: unknown };
type Call = { table: string; columns?: string; filters: Filter[]; order?: string };

/* Every read and the holiday top-up, in the order they happened. */
const log: string[] = [];
let rows: Record<string, Record<string, unknown>[]> = {};
let failing: Record<string, { code: string; message: string }> = {};
const calls: Call[] = [];

function matches(r: Record<string, unknown>, f: Filter): boolean {
  const v = r[f.col];
  if (f.op === "eq") return v === f.val;
  if (f.op === "is") return f.val === null ? v === null || v === undefined : v === f.val;
  // dates compare as text, as ISO days do
  if (v === null || v === undefined) return false;
  return f.op === "lte" ? String(v) <= String(f.val) : String(v) >= String(f.val);
}

const table = (name: string) => {
  const call: Call = { table: name, filters: [] };
  calls.push(call);
  log.push(name);
  const answer = () => {
    if (failing[name]) return { data: null, error: failing[name] };
    const data = (rows[name] ?? []).filter((r) => call.filters.every((f) => matches(r, f)));
    const by = call.order;
    if (by) data.sort((a, b) => (String(a[by]) < String(b[by]) ? -1 : String(a[by]) > String(b[by]) ? 1 : 0));
    return { data, error: null };
  };
  const chain: Record<string, unknown> = {};
  chain.select = (cols: string) => {
    call.columns = cols;
    return chain;
  };
  for (const op of ["eq", "lte", "gte", "is"] as const) {
    chain[op] = (col: string, val: unknown) => {
      call.filters.push({ op, col, val });
      return chain;
    };
  }
  chain.order = (col: string) => {
    call.order = col;
    return chain;
  };
  chain.limit = () => chain;
  chain.maybeSingle = async () => {
    const a = answer();
    return { data: a.data?.[0] ?? null, error: a.error };
  };
  chain.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(answer()).then(res, rej);
  return chain;
};

jest.mock("@/lib/supabase-server", () => ({ supabaseAdmin: { from: (n: string) => table(n) } }));

const ensureHolidays = jest.fn(async (...args: unknown[]): Promise<void> => void args);
jest.mock("@/lib/timepay/holiday-sync", () => ({
  ensureHolidays: (...args: unknown[]) => ensureHolidays(...args),
}));

import { loadCompanyCalendar, schoolDivisionOf, type CompanyCalendarContext } from "../query";
import type { Capability } from "@/lib/permissions";
import type { OrgCredential } from "@/lib/org/credentials";

const ORG = "org-1";
const TODAY = "2026-09-25";

const policy: OrgCredential = {
  id: "c1",
  kind: "insurance",
  name: "Public liability",
  number: null,
  issuer: "QBE Insurance (Australia) Ltd",
  expiryDate: "2026-11-10",
  color: null,
};

const ctx = (over: Partial<CompanyCalendarContext> = {}, caps: Capability[] = ["team", "assets_all"]): CompanyCalendarContext => ({
  orgId: ORG,
  caps: new Set(caps),
  isOwner: true,
  today: TODAY,
  names: new Map([["s1", "Isaac"]]),
  shared: { expiry: { warnDays: 30, email: true }, orgCredentials: [policy] },
  ...over,
});

const of = (t: string) => calls.filter((c) => c.table === t);
const ids = (out: { items: { id: string }[] }) => out.items.map((x) => x.id);

beforeEach(() => {
  calls.length = 0;
  log.length = 0;
  failing = {};
  ensureHolidays.mockReset();
  ensureHolidays.mockResolvedValue(undefined);
  rows = {
    organizations: [{ id: ORG, state: "NSW" }],
    public_holidays: [
      { org_id: ORG, state: "NSW", suppressed: false, holiday_date: "2026-10-05", name: "Labour Day" },
      { org_id: ORG, state: "NSW", suppressed: true, holiday_date: "2026-12-26", name: "Boxing Day" },
      { org_id: ORG, state: "VIC", suppressed: false, holiday_date: "2026-11-03", name: "Melbourne Cup" },
      { org_id: "org-2", state: "NSW", suppressed: false, holiday_date: "2026-12-25", name: "Christmas Day" },
      // outside the window at both ends
      { org_id: ORG, state: "NSW", suppressed: false, holiday_date: "2026-08-03", name: "Bank Holiday" },
      { org_id: ORG, state: "NSW", suppressed: false, holiday_date: "2027-10-04", name: "Labour Day" },
    ],
    school_holidays: [
      { state: "NSW", division: "eastern", season: "spring", starts_on: "2026-09-28", ends_on: "2026-10-09", students_back: "2026-10-13" },
      { state: "NSW", division: "western", season: "summer", starts_on: "2026-12-18", ends_on: "2027-02-03", students_back: "2027-02-10" },
      { state: "NSW", division: "eastern", season: "winter", starts_on: "2026-07-06", ends_on: "2026-07-17", students_back: "2026-07-21" },
      { state: "VIC", division: "all", season: "spring", starts_on: "2026-09-19", ends_on: "2026-10-04", students_back: null },
    ],
    calendar_events: [
      {
        org_id: ORG,
        id: "e1",
        kind: "event",
        title: "Toolbox talk",
        starts_on: "2026-10-01",
        ends_on: "2026-10-01",
        starts_at: "06:45:00",
        ends_at: "07:15:00",
        location: "The yard",
        audience: "Everyone",
        note: null,
        series_id: null,
        repeat: null,
        created_by: "s1",
        created_at: "2026-09-24T02:00:00Z",
      },
      // began last month, still on: an overlap, not a start inside the window
      { org_id: ORG, id: "e2", kind: "shutdown", title: "Winter shutdown", starts_on: "2026-08-28", ends_on: "2026-09-02" },
      { org_id: ORG, id: "e3", kind: "event", title: "Ended in August", starts_on: "2026-08-10", ends_on: "2026-08-31" },
      { org_id: "org-2", id: "e4", kind: "event", title: "Someone else's", starts_on: "2026-10-02", ends_on: "2026-10-02" },
    ],
    notices: [
      { org_id: ORG, id: "n1", kind: "event", title: "Christmas party", event_date: "2026-12-11", event_time: "18:00:00", event_location: "The Rocks", archived_at: null },
      { org_id: ORG, id: "n2", kind: "event", title: "Filed away", event_date: "2026-10-15", event_time: null, event_location: null, archived_at: "2026-09-20T00:00:00Z" },
      { org_id: ORG, id: "n3", kind: "notice", title: "Not an event", event_date: "2026-10-16", archived_at: null },
      { org_id: ORG, id: "n4", kind: "event", title: "Last year", event_date: "2025-12-12", archived_at: null },
      { org_id: "org-2", id: "n5", kind: "event", title: "Someone else's", event_date: "2026-10-20", archived_at: null },
    ],
    vehicles: [
      { org_id: ORG, id: "v1", name: "Spare van", plate: "CY14FE", status: "active", rego_expiry: "2026-09-17", insurance_expiry: null, ctp_expiry: null },
      { org_id: ORG, id: "v2", name: "Old ute", plate: "OLD1", status: "sold", rego_expiry: "2026-10-01", insurance_expiry: null, ctp_expiry: null },
      { org_id: ORG, id: "v3", name: "Trailer", plate: "TC22BJ", status: null, rego_expiry: "2026-10-20", insurance_expiry: null, ctp_expiry: null },
      { org_id: "org-2", id: "v4", name: "Theirs", plate: "X1", status: "active", rego_expiry: "2026-10-02", insurance_expiry: null, ctp_expiry: null },
    ],
  };
});

describe("loadCompanyCalendar", () => {
  it("draws the org's twelve months from every source", async () => {
    const out = await loadCompanyCalendar(ctx());
    expect(out).toMatchObject({
      today: TODAY,
      windowStart: "2026-09-01",
      windowEnd: "2027-08-31",
      stateName: "NSW",
      warnDays: 30,
      canAdd: true,
      hasSchool: true,
    });
    expect(ids(out)).toEqual([
      "ph:2026-10-05",
      "sch:2026-09-28",
      "ev:e2",
      "ev:e1",
      "nt:n1",
      "veh:v1:rego",
      "veh:v3:rego",
      "cred:c1",
    ]);
    expect(out.items.find((x) => x.id === "ev:e1")?.facts).toContainEqual(["Added", "Isaac, Thu 24 Sept"]);
    expect(out.items.find((x) => x.id === "veh:v1:rego")?.overdue).toBe(true);
  });

  it("reads each source over the window, scoped to the org", async () => {
    await loadCompanyCalendar(ctx());
    for (const t of ["public_holidays", "calendar_events", "notices", "vehicles"]) {
      expect(of(t)).toHaveLength(1);
      expect(of(t)[0].filters).toContainEqual({ op: "eq", col: "org_id", val: ORG });
    }
    expect(of("calendar_events")[0].filters).toEqual(
      expect.arrayContaining([
        { op: "lte", col: "starts_on", val: "2027-08-31" },
        { op: "gte", col: "ends_on", val: "2026-09-01" },
      ]),
    );
    expect(of("school_holidays")[0].filters).toEqual(
      expect.arrayContaining([
        { op: "eq", col: "state", val: "NSW" },
        { op: "eq", col: "division", val: "eastern" },
      ]),
    );
    // the vehicles' sold filter is in code, never a `neq` that drops NULLs
    expect(of("vehicles")[0].filters).toEqual([{ op: "eq", col: "org_id", val: ORG }]);
  });

  it("tops the public holidays up first, then reads them", async () => {
    /* A fill that takes a moment: a read that did not wait for it would be
       logged before it. */
    ensureHolidays.mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 5));
      log.push("ensure");
    });
    const out = await loadCompanyCalendar(ctx());
    expect(ensureHolidays).toHaveBeenCalledTimes(1);
    expect(ensureHolidays).toHaveBeenCalledWith(ORG, "NSW", TODAY);
    expect(ids(out)).toContain("ph:2026-10-05");
    expect(log.indexOf("ensure")).toBeGreaterThan(-1);
    expect(log.indexOf("ensure")).toBeLessThan(log.indexOf("public_holidays"));
  });

  it("keeps the holidays it has when the top-up fails", async () => {
    ensureHolidays.mockRejectedValue(new Error("write refused"));
    const out = await loadCompanyCalendar(ctx());
    expect(ids(out)).toContain("ph:2026-10-05");
  });

  it("shows the business's papers to the owner and nobody else", async () => {
    const owner = await loadCompanyCalendar(ctx({ isOwner: true }));
    expect(ids(owner)).toContain("cred:c1");
    // even if a caller hands a non-owner the credentials, they are not drawn
    const crew = await loadCompanyCalendar(ctx({ isOwner: false }));
    expect(ids(crew).some((id) => id.startsWith("cred:"))).toBe(false);
  });

  it("does not read the fleet at all without assets_all", async () => {
    const out = await loadCompanyCalendar(ctx({}, ["team"]));
    expect(of("vehicles")).toHaveLength(0);
    expect(ids(out).some((id) => id.startsWith("veh:"))).toBe(false);
  });

  it("lets anyone with team add, and nobody else", async () => {
    expect((await loadCompanyCalendar(ctx({}, ["team"]))).canAdd).toBe(true);
    expect((await loadCompanyCalendar(ctx({}, ["assets_all"]))).canAdd).toBe(false);
    expect((await loadCompanyCalendar(ctx({}, []))).canAdd).toBe(false);
  });

  it("draws the rest when the two new tables are not there yet", async () => {
    failing = {
      school_holidays: { code: "PGRST205", message: "Could not find the table 'public.school_holidays'" },
      calendar_events: { code: "42P01", message: 'relation "public.calendar_events" does not exist' },
    };
    const out = await loadCompanyCalendar(ctx());
    expect(ids(out)).toEqual(["ph:2026-10-05", "nt:n1", "veh:v1:rego", "veh:v3:rego", "cred:c1"]);
    expect(out.hasSchool).toBe(false);
  });

  it("draws no holidays, and asks for none, for a workspace with no state", async () => {
    rows.organizations = [{ id: ORG, state: null }];
    const out = await loadCompanyCalendar(ctx());
    expect(out.stateName).toBe("");
    expect(out.hasSchool).toBe(false);
    expect(ensureHolidays).not.toHaveBeenCalled();
    expect(of("public_holidays")).toHaveLength(0);
    expect(of("school_holidays")).toHaveLength(0);
    expect(ids(out).some((id) => id.startsWith("ph:") || id.startsWith("sch:"))).toBe(false);
  });

  it("reads a whole-state calendar outside NSW", async () => {
    rows.organizations = [{ id: ORG, state: "VIC" }];
    const out = await loadCompanyCalendar(ctx());
    expect(ids(out).filter((id) => id.startsWith("ph:") || id.startsWith("sch:"))).toEqual([
      "ph:2026-11-03",
      "sch:2026-09-19",
    ]);
  });

  it("follows the org's own warning window", async () => {
    rows.vehicles = [
      { org_id: ORG, id: "v1", name: "Van", plate: "A1", status: "active", rego_expiry: "2026-09-24", insurance_expiry: null, ctp_expiry: null },
    ];
    for (const warnDays of [14, 30]) {
      const out = await loadCompanyCalendar(ctx({ shared: { expiry: { warnDays, email: true }, orgCredentials: [] } }));
      expect(out.warnDays).toBe(warnDays);
      expect(out.items.find((x) => x.id === "veh:v1:rego")?.overdue).toBe(true);
    }
  });

  it("takes the new Home's loader context as it is", async () => {
    /* DeskContext (lib/dashboard/desk-data) carries more than the calendar
       needs; a structural superset must pass without a cast. */
    const desk = {
      ...ctx(),
      viewerStaffId: "s1",
      railDay: TODAY,
      tz: "Australia/Sydney",
      mineUuid: null,
      names: new Map<string, string>(),
    };
    await expect(loadCompanyCalendar(desk)).resolves.toMatchObject({ windowStart: "2026-09-01" });
  });
});

describe("schoolDivisionOf", () => {
  it("reads NSW's Eastern division and every other state whole", () => {
    expect(schoolDivisionOf("NSW")).toBe("eastern");
    for (const s of ["VIC", "QLD", "SA", "WA", "TAS", "NT", "ACT"]) expect(schoolDivisionOf(s)).toBe("all");
  });
});
