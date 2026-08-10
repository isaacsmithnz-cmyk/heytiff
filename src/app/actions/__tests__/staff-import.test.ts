/**
 * @jest-environment node
 */

/* Importing people from a connected system — the accept rule, enforced
   server-side, for both providers on the one path.

   The client is trusted for VALUES (the reviewer edited them) but never for
   FACTS: which ids exist, what the provider calls them, who is active. Every
   test that matters here is about a lie the browser could tell — an id not in
   the account, a person already imported, a race lost after the card was
   already inserted — and what the action refuses to let it do.

   The Xero block additionally pins the two things that make it Xero: the
   payroll link is written by the SAME writer Time & Pay uses (two writers for
   one kind is how two screens end up disagreeing), and nothing pay-shaped is
   ever copied onto a card. */

type Row = Record<string, unknown>;

const calls: { table: string; op: string; payload?: unknown; filters: Row }[] = [];

let role: string | null = "owner";
let session: unknown = { orgId: "org-1", user: { sub: "auth0|boss" } };
let connection: Row | null = { tenantId: "vendor-1", status: "connected" };
let liveRows: Row[] = [];
let liveRead: { ok: true; data: Row[] } | { ok: false; error: string } | null = null;
let sm8Links: Row[] = [];
let xeroLinks: Row[] = [];
let xeroEmployees: Row[] = [];
let xeroRead: { ok: true; data: Row[] } | { ok: false; error: string } | null = null;
let linkResult: { ok: true } | { ok: false; error: string } = { ok: true };
let staffCardRow: { id: string; status: string } | null = null;
let insertFails = false;
let staffListRows: Row[] = [];

const linkSpy = jest.fn(async () => linkResult);
const xeroLinkSpy = jest.fn(async () => linkResult);
const unlinkSpy = jest.fn(async () => ({ ok: true }));

const table = (name: string) => {
  const call = { table: name, op: "select", payload: undefined as unknown, filters: {} as Row };
  const c: Record<string, unknown> = {};
  c.select = () => c;
  c.eq = (k: string, v: unknown) => ((call.filters[k] = v), c);
  c.is = (k: string, v: unknown) => ((call.filters[`is:${k}`] = v), c);
  c.in = () => c;
  c.maybeSingle = async () => {
    calls.push(call);
    if (name === "organizations") return { data: { state: "QLD" }, error: null };
    if (name === "staff_profiles") return { data: staffCardRow, error: null };
    return { data: null, error: null };
  };
  c.single = async () => {
    calls.push(call);
    if (insertFails) return { data: null, error: { message: "boom" } };
    return { data: { id: `card-for-${(call.payload as Row)?.full_name}` }, error: null };
  };
  c.insert = (payload: unknown) => ((call.op = "insert"), (call.payload = payload), c);
  c.delete = () => ((call.op = "delete"), c);
  c.then = (res: (v: { data: unknown; error: null }) => unknown) => {
    calls.push(call);
    return Promise.resolve({
      data: call.op === "select" && name === "staff_profiles" ? staffListRows : [],
      error: null,
    }).then(res);
  };
  return c;
};

jest.mock("@/lib/supabase-server", () => ({ supabaseAdmin: { from: (n: string) => table(n) } }));
jest.mock("@/lib/auth0", () => ({ auth0: { getSession: jest.fn(async () => session) } }));
jest.mock("@/lib/permissions-server", () => ({ getDbRole: jest.fn(async () => role) }));
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));
jest.mock("@/lib/integrations/store", () => ({
  getConnectionView: jest.fn(async () => connection),
}));
jest.mock("@/lib/integrations/sm8-read", () => ({
  readSm8StaffRows: jest.fn(async () => liveRead ?? { ok: true, data: liveRows }),
}));
jest.mock("@/lib/integrations/xero-read", () => ({
  listPayrollEmployees: jest.fn(async () => xeroRead ?? { ok: true, data: xeroEmployees }),
}));
jest.mock("@/lib/integrations/links", () => ({
  listSm8StaffLinks: jest.fn(async () => sm8Links),
  linkSm8StaffMember: (...args: unknown[]) => linkSpy(...(args as [])),
  unlinkSm8StaffMember: (...args: unknown[]) => unlinkSpy(...(args as [])),
  listPayrollLinks: jest.fn(async () => xeroLinks),
  linkPayrollEmployee: (...args: unknown[]) => xeroLinkSpy(...(args as [])),
}));
jest.mock("@/lib/staff/query", () => ({ emailsByUser: jest.fn(async () => new Map()) }));

import {
  getSm8PeopleData,
  getXeroPeopleData,
  importPeople,
  linkPerson,
  unlinkSm8Staff,
} from "../staff-import";

const dan = (over: Row = {}): Row => ({
  uuid: "u-dan",
  first: "Dan",
  last: "Smith",
  job_title: "Technician",
  email: "Dan@Acme.COM",
  mobile: "0412 000 111",
  active: 1,
  ...over,
});

const inserts = () => calls.filter((c) => c.table === "staff_profiles" && c.op === "insert");
const deletes = () => calls.filter((c) => c.table === "staff_profiles" && c.op === "delete");

beforeEach(() => {
  calls.length = 0;
  linkSpy.mockClear();
  xeroLinkSpy.mockClear();
  unlinkSpy.mockClear();
  role = "owner";
  session = { orgId: "org-1", user: { sub: "auth0|boss" } };
  connection = { tenantId: "vendor-1", status: "connected" };
  liveRows = [dan()];
  liveRead = null;
  sm8Links = [];
  xeroLinks = [];
  xeroEmployees = [];
  xeroRead = null;
  linkResult = { ok: true };
  staffCardRow = null;
  insertFails = false;
  staffListRows = [];
});

describe("importPeople (ServiceM8) — the accept rule, server side", () => {
  it("writes exactly the accepted values, normalising the email", async () => {
    const res = await importPeople("servicem8", [
      { uuid: "u-dan", firstName: "Daniel", lastName: "Smith", email: "Dan@Acme.COM" },
    ]);

    expect(res).toEqual({ ok: true, imported: 1, skipped: 0 });
    const payload = inserts()[0].payload as Row;
    expect(payload).toMatchObject({
      org_id: "org-1",
      first_name: "Daniel", // the reviewer's edit, not ServiceM8's value
      last_name: "Smith",
      full_name: "Daniel Smith",
      contact_email: "dan@acme.com", // normalised on write — the claim path compares normalised
      status: "Active",
      state: "QLD", // the org seed every card gets, so holidays resolve
    });
    // unticked fields never arrive, so they land as null — not as SM8's value
    expect(payload.job_title).toBeNull();
    expect(payload.phone).toBeNull();

    expect(linkSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: "org-1",
        tenantId: "vendor-1",
        remoteId: "u-dan",
        remoteLabel: "Dan Smith", // ServiceM8's own name — provenance, not the card
        matchedBy: "manual",
      })
    );
  });

  it("never creates a claimed card: user_id is absent from the insert", async () => {
    await importPeople("servicem8", [{ uuid: "u-dan" }]);
    expect("user_id" in (inserts()[0].payload as Row)).toBe(false);
  });

  it("falls back to ServiceM8's names when the payload carries none", async () => {
    await importPeople("servicem8", [{ uuid: "u-dan" }]);
    expect(inserts()[0].payload).toMatchObject({ first_name: "Dan", last_name: "Smith" });
  });

  it("imports an inactive person as an Inactive card", async () => {
    liveRows = [dan({ active: 0 })];
    await importPeople("servicem8", [{ uuid: "u-dan" }]);
    expect((inserts()[0].payload as Row).status).toBe("Inactive");
  });

  it("skips a uuid the account doesn't contain — the browser doesn't get to invent people", async () => {
    const res = await importPeople("servicem8", [{ uuid: "u-fake" }]);
    expect(res).toEqual({ ok: true, imported: 0, skipped: 1 });
    expect(inserts()).toHaveLength(0);
  });

  it("skips someone already linked, so re-running an import is safe", async () => {
    sm8Links = [{ staffProfileId: "s-1", remoteId: "u-dan" }];
    const res = await importPeople("servicem8", [{ uuid: "u-dan" }]);
    expect(res).toEqual({ ok: true, imported: 0, skipped: 1 });
    expect(inserts()).toHaveLength(0);
  });

  it("removes the fresh card when the link loses the race — no duplicate-in-waiting", async () => {
    linkResult = { ok: false, error: "already linked" };
    const res = await importPeople("servicem8", [{ uuid: "u-dan" }]);

    expect(res).toEqual({ ok: true, imported: 0, skipped: 1 });
    expect(deletes()).toHaveLength(1);
    // the guard: never delete a card somebody claimed in the gap
    expect(deletes()[0].filters["is:user_id"]).toBeNull();
  });

  it("refuses a non-owner outright", async () => {
    role = "admin";
    const res = await importPeople("servicem8", [{ uuid: "u-dan" }]);
    expect(res.ok).toBe(false);
    expect(inserts()).toHaveLength(0);
  });

  it("refuses an oversized batch rather than half-running it", async () => {
    const res = await importPeople("servicem8", 
      Array.from({ length: 201 }, (_, i) => ({ uuid: `u-${i}` }))
    );
    expect(res.ok).toBe(false);
    expect(inserts()).toHaveLength(0);
  });
});

describe("linkPerson (ServiceM8)", () => {
  it("links an Active card to a person the account really contains", async () => {
    staffCardRow = { id: "s-1", status: "Active" };
    const res = await linkPerson("servicem8", "s-1", "u-dan", "auto");
    expect(res).toEqual({ ok: true });
    expect(linkSpy).toHaveBeenCalledWith(
      expect.objectContaining({ staffProfileId: "s-1", remoteId: "u-dan", matchedBy: "auto" })
    );
  });

  it("refuses an archived card — restore them in Team first", async () => {
    staffCardRow = { id: "s-1", status: "Inactive" };
    const res = await linkPerson("servicem8", "s-1", "u-dan", "manual");
    expect(res.ok).toBe(false);
    expect(linkSpy).not.toHaveBeenCalled();
  });

  it("refuses a remote id that isn't in the connected account", async () => {
    staffCardRow = { id: "s-1", status: "Active" };
    const res = await linkPerson("servicem8", "s-1", "u-nope", "manual");
    expect(res.ok).toBe(false);
    expect(linkSpy).not.toHaveBeenCalled();
  });
});

describe("unlinkSm8Staff", () => {
  it("removes the link for the connected account", async () => {
    const res = await unlinkSm8Staff("s-1");
    expect(res).toEqual({ ok: true });
    expect(unlinkSpy).toHaveBeenCalledWith("org-1", "vendor-1", "s-1");
  });
});

describe("getSm8PeopleData", () => {
  it("carries a failed read as a sentence instead of vanishing", async () => {
    liveRead = { ok: false, error: "ServiceM8 couldn't be reached just now. Try again shortly." };
    const view = await getSm8PeopleData();
    expect(view).toEqual({ rows: [], linkable: [], error: expect.stringContaining("ServiceM8") });
  });

  it("assembles rows and the linkable picker, active unlinked cards only", async () => {
    staffListRows = [
      { id: "s-1", user_id: null, first_name: "Old", last_name: "Hand", full_name: "Old Hand", preferred_name: null, contact_email: null, status: "Active" },
      { id: "s-2", user_id: null, first_name: "Archived", last_name: "Person", full_name: "Archived Person", preferred_name: null, contact_email: null, status: "Inactive" },
    ];
    const view = await getSm8PeopleData();
    expect(view?.rows).toHaveLength(1);
    expect(view?.linkable).toEqual([{ staffProfileId: "s-1", name: "Old Hand" }]);
  });

  it("returns null when ServiceM8 isn't connected — the card simply doesn't render", async () => {
    connection = null;
    expect(await getSm8PeopleData()).toBeNull();
  });
});

/* Xero rides the same path — these pin what makes it Xero. */
describe("Xero people", () => {
  const employee = (over: Row = {}): Row => ({
    employeeId: "x-1",
    firstName: "Dan",
    lastName: "Smith",
    name: "Dan Smith",
    email: "dan@acme.com",
    jobTitle: "Technician",
    active: true,
    employmentType: "CONTRACTOR",
    payrollCalendarId: "cal-1",
    ...over,
  });

  beforeEach(() => {
    xeroEmployees = [employee()];
    connection = { tenantId: "tenant-1", status: "connected" };
  });

  it("writes the payroll link through the SAME writer Time & Pay uses", async () => {
    const res = await importPeople("xero", [{ uuid: "x-1" }]);

    expect(res).toEqual({ ok: true, imported: 1, skipped: 0 });
    expect(xeroLinkSpy).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: "tenant-1", remoteId: "x-1", remoteLabel: "Dan Smith" })
    );
    // never the ServiceM8 writer, whatever the shape similarity
    expect(linkSpy).not.toHaveBeenCalled();
  });

  it("copies NOTHING pay-shaped onto the card — employment type included", async () => {
    await importPeople("xero", [
      { uuid: "x-1", firstName: "Dan", lastName: "Smith", jobTitle: "Technician" },
    ]);

    const payload = inserts()[0].payload as Row;
    expect(payload.employment_type).toBeUndefined();
    expect(payload.pay_basis).toBeUndefined();
    expect(payload.hourly_wage).toBeUndefined();
    expect(Object.values(payload)).not.toContain("CONTRACTOR");
  });

  it("a terminated employee imports as an Inactive card", async () => {
    xeroEmployees = [employee({ active: false })];
    await importPeople("xero", [{ uuid: "x-1" }]);
    expect((inserts()[0].payload as Row).status).toBe("Inactive");
  });

  it("skips an employee id the tenant doesn't contain", async () => {
    const res = await importPeople("xero", [{ uuid: "x-nope" }]);
    expect(res).toEqual({ ok: true, imported: 0, skipped: 1 });
    expect(inserts()).toHaveLength(0);
  });

  it("skips someone an existing payroll link already claims — including one made from Time & Pay", async () => {
    xeroLinks = [{ staffProfileId: "s-1", remoteId: "x-1" }];
    const res = await importPeople("xero", [{ uuid: "x-1" }]);
    expect(res).toEqual({ ok: true, imported: 0, skipped: 1 });
  });

  it("links an existing card to an employee, and says Xero when it can't", async () => {
    staffCardRow = { id: "s-1", status: "Active" };
    expect(await linkPerson("xero", "s-1", "x-1", "auto")).toEqual({ ok: true });
    expect(xeroLinkSpy).toHaveBeenCalledWith(expect.objectContaining({ matchedBy: "auto" }));

    const missing = await linkPerson("xero", "s-1", "x-nope", "manual");
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.error).toMatch(/Xero/);
  });

  it("assembles the view, and carries a failed payroll read as its sentence", async () => {
    staffListRows = [
      {
        id: "s-1",
        user_id: null,
        first_name: "Dan",
        last_name: "Smith",
        full_name: "Dan Smith",
        preferred_name: null,
        contact_email: "dan@acme.com",
        status: "Active",
      },
    ];
    const view = await getXeroPeopleData();
    // same address on both sides — the matcher's strongest evidence
    expect(view?.rows[0]).toMatchObject({ kind: "suggested", staffProfileId: "s-1", reason: "email" });

    xeroRead = { ok: false, error: "Xero couldn't be reached just now." };
    expect(await getXeroPeopleData()).toEqual({
      rows: [],
      linkable: [],
      error: "Xero couldn't be reached just now.",
    });
  });
});
