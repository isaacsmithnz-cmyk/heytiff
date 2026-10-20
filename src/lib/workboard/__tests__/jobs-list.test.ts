import type { AllJobsMirrorJob } from "@/lib/workboard/all-jobs";
import { jobMoneyOf } from "@/lib/workboard/job-money";
import {
  ANYONE,
  NOBODY,
  crewOf,
  jobsListRows,
  listHref,
  peopleOf,
  readListState,
  rowsFor,
  sortRows,
  viewCounts,
  viewsFor,
  withListState,
  type JobsListAgreement,
  type JobsListInput,
  type JobsListProject,
  type JobsListRow,
  type JobsListVisit,
} from "@/lib/workboard/jobs-list";

const TODAY = "2026-10-13";

const job = (over: Partial<AllJobsMirrorJob> & { remoteId: string }): AllJobsMirrorJob => ({
  jobNumber: "3323",
  status: "Work Order",
  clientName: "Northgate Realty",
  description: "Service call",
  suburb: "Mascot",
  categoryName: "Installation",
  categoryColour: "#2563eb",
  date: "2026-09-20 09:00:00",
  quoteDate: null,
  completionDate: null,
  nextBooking: null,
  money: null,
  paidCents: 0,
  ...over,
});

const visit = (over: Partial<JobsListVisit> & { id: string }): JobsListVisit => ({
  agreementId: "ag-1",
  jobNo: 1042,
  remoteId: null,
  clientName: "Meridian Data",
  label: "Quarterly service",
  siteLabel: "Alexandria",
  category: { name: "Maintenance", accent: "#facc15" },
  dueDate: "2026-10-20",
  bookedDate: null,
  status: "upcoming",
  completedAt: null,
  invoicedAt: null,
  techs: [],
  ...over,
});

const agreement = (over: Partial<JobsListAgreement> & { id: string }): JobsListAgreement => ({
  label: "Quarterly service",
  clientName: "Meridian Data",
  siteLabel: "Alexandria",
  intervalMonths: 3,
  status: "active",
  category: null,
  nextDue: "2026-10-20",
  overdueCount: 0,
  ...over,
});

const project = (over: Partial<JobsListProject> & { id: string }): JobsListProject => ({
  name: "Heuvel roof plant",
  clientName: "Heuvel Construction",
  siteLabel: "Chatswood",
  stage: "Rough-in",
  status: "active",
  updatedAt: "2026-10-10T00:00:00Z",
  jobs: [],
  ...over,
});

const money = (total: string) => jobMoneyOf({ total_invoice_amount: total });

function input(over: Partial<JobsListInput> = {}): JobsListInput {
  return {
    jobs: [],
    projectLinks: [],
    visits: [],
    agreements: [],
    projects: [],
    trips: [],
    crew: {},
    wonOn: {},
    today: TODAY,
    moneyVisible: true,
    ...over,
  };
}

const keys = (rows: JobsListRow[]) => rows.map((r) => r.key).sort();
const row = (rows: JobsListRow[], key: string) => rows.find((r) => r.key === key)!;

/* one of everything the seven views read */
const BOOK = input({
  jobs: [
    job({ remoteId: "wo-booked", jobNumber: "3342", clientName: "Rifkin, Julian", suburb: "Bellevue Hill", nextBooking: `${TODAY} 09:00:00`, money: money("9840") }),
    job({ remoteId: "wo-waiting", jobNumber: "3323", description: "Ducted install, two zones", suburb: "Ryde", money: money("24600") }),
    job({ remoteId: "q-new", jobNumber: "3361", status: "Quote", clientName: "Okafor, Ada", suburb: "Riverview", categoryName: null, categoryColour: null, date: `${TODAY} 08:00:00`, quote: { lines: 0, priced: false, headline: null } }),
    job({ remoteId: "q-sent", jobNumber: "3294", status: "Quote", clientName: "Belmont Holdings", date: "2026-10-02 08:00:00", quote: { lines: 2, priced: true, headline: null } }),
    job({ remoteId: "done-owed", jobNumber: "2380", status: "Completed", clientName: "Kingsford Bakery", completionDate: "2026-10-01 08:30:00", money: money("420") }),
    job({ remoteId: "done-paid", jobNumber: "2381", status: "Completed", completionDate: "2026-10-01 08:30:00", money: money("500"), paidCents: 50000 }),
    job({ remoteId: "lost", jobNumber: "2390", status: "Unsuccessful", completionDate: "2026-10-01 08:30:00" }),
    job({ remoteId: "proj-install", jobNumber: "3302", clientName: "Heuvel Construction", categoryName: "Project", categoryColour: "#a855f7", nextBooking: `${TODAY} 07:00:00`, money: money("188000") }),
  ],
  projectLinks: [{ remoteId: "proj-install", projectId: "p-linked" }],
  projects: [
    project({ id: "p-linked", jobs: [{ remoteId: "proj-install", role: "install" }] }),
    project({ id: "p-native", name: "Scott Group fit-out", clientName: "Scott Group", status: "blocked" }),
    project({ id: "p-done", status: "done" }),
  ],
  trips: [{ projectId: "p-linked", status: "booked", bookedDate: TODAY, techs: ["Kim Lee", "Dan West"] }],
  visits: [
    visit({ id: "v-open", techs: ["Dan West"] }),
    visit({ id: "v-done", status: "done", completedAt: "2026-10-12T21:30:00Z", clientName: "Kingsford Clinic", agreementId: "ag-2" }),
    visit({ id: "v-invoiced", status: "done", completedAt: "2026-10-12T21:30:00Z", invoicedAt: "2026-10-13T01:00:00Z" }),
  ],
  agreements: [agreement({ id: "ag-1" }), agreement({ id: "ag-ended", status: "ended" }), agreement({ id: "ag-paused", status: "paused" })],
  crew: { "wo-booked": ["Lyle Irving", "Chris Adams"] },
  wonOn: { "wo-waiting": "2026-10-09" },
});

describe("the Jobs list's views", () => {
  const rows = jobsListRows(BOOK);
  const view = (v: Parameters<typeof rowsFor>[1]["view"]) => keys(rowsFor(rows, { view: v, who: ANYONE, q: "" }));

  it("All is every open job, with the finished work still to invoice or owed", () => {
    expect(view("all")).toEqual(
      ["sm8:wo-booked", "sm8:wo-waiting", "sm8:q-new", "sm8:q-sent", "sm8:done-owed", "sm8:proj-install", "visit:v-open", "visit:v-done", "project:p-native"].sort(),
    );
  });

  it("To book is the work waiting on a day", () => {
    expect(view("to-book")).toEqual(["project:p-native", "sm8:wo-waiting", "visit:v-open"]);
  });

  it("Quotes is the quote worklist", () => {
    expect(view("quotes")).toEqual(["sm8:q-new", "sm8:q-sent"]);
    expect(row(rows, "sm8:q-new").state).toBe("Quote to write");
    expect(row(rows, "sm8:q-sent")).toMatchObject({ state: "Follow up", tone: "look" });
  });

  it("To invoice is a visit done and not ticked invoiced", () => {
    expect(view("to-invoice")).toEqual(["visit:v-done"]);
    expect(row(rows, "visit:v-done")).toMatchObject({ state: "Ready to invoice", tone: "look", next: "Done 13 Oct" });
  });

  it("To invoice leaves a visit whose ServiceM8 job is completed, and joins one whose job is open", () => {
    const r = jobsListRows(
      input({
        jobs: [job({ remoteId: "closed", status: "Completed", completionDate: "2026-10-12 08:00:00" }), job({ remoteId: "open" })],
        visits: [
          visit({ id: "a", remoteId: "closed", status: "done", completedAt: "2026-10-12T01:00:00Z" }),
          visit({ id: "b", remoteId: "open", status: "done", completedAt: "2026-10-12T01:00:00Z" }),
        ],
      }),
    );
    expect(keys(rowsFor(r, { view: "to-invoice", who: ANYONE, q: "" }))).toEqual(["sm8:open"]);
    expect(row(r, "sm8:open")).toMatchObject({ state: "Ready to invoice", href: "/dashboard/jobs/open" });
    expect(r.filter((x) => x.key === "sm8:open")).toHaveLength(1);
  });

  it("Owed is finished work worth a known amount, not all of it paid", () => {
    expect(view("owed")).toEqual(["sm8:done-owed"]);
    expect(row(rows, "sm8:done-owed")).toMatchObject({ state: "Awaiting payment", next: "Completed 1 Oct", valueCents: 42000 });
  });

  it("Projects is every project not done, one row each", () => {
    expect(view("projects")).toEqual(["project:p-linked", "project:p-native"]);
    expect(row(rows, "project:p-linked")).toMatchObject({
      href: "/dashboard/jobs/proj-install",
      number: "3302",
      kind: "Project",
      hue: "purple",
      state: "Rough-in",
      next: "Today",
      who: ["Kim Lee", "Dan West"],
    });
    expect(row(rows, "project:p-native")).toMatchObject({ href: "/dashboard/workboard/projects/p-native", state: "Blocked", tone: "wrong" });
  });

  it("Agreements is the active and paused service agreements", () => {
    expect(view("agreements")).toEqual(["agreement:ag-1", "agreement:ag-paused"]);
    expect(row(rows, "agreement:ag-1")).toMatchObject({ state: "Every 3 months", next: "Due 20 Oct", who: ["Dan West"] });
    expect(row(rows, "agreement:ag-paused")).toMatchObject({ state: "Paused", tone: "look", who: [] });
  });

  it("counts each view under the same person and search", () => {
    const counts = viewCounts(rows, { who: ANYONE, q: "" });
    expect(counts).toMatchObject({ all: 9, "to-book": 3, quotes: 2, "to-invoice": 1, owed: 1, projects: 2, agreements: 2 });
    expect(viewCounts(rows, { who: ANYONE, q: "kingsford" })).toMatchObject({ all: 2, owed: 1, "to-invoice": 1, quotes: 0 });
  });
});

describe("a row", () => {
  const rows = jobsListRows(BOOK);

  it("opens the job's page by its ServiceM8 uuid", () => {
    expect(row(rows, "sm8:wo-booked").href).toBe("/dashboard/jobs/wo-booked");
  });

  it("opens a visit with no ServiceM8 job, and an agreement, over the page", () => {
    expect(row(rows, "visit:v-open").href).toBe("/dashboard/workboard?visit=v-open");
    expect(row(rows, "agreement:ag-1").href).toBe("/dashboard/workboard?open=agreement.ag-1");
  });

  it("says where a job is up to and what's next", () => {
    expect(row(rows, "sm8:wo-booked")).toMatchObject({
      number: "3342",
      client: "Rifkin, Julian",
      site: "Bellevue Hill",
      kind: "Installation",
      hue: "blue",
      state: "Booked",
      next: "Today 9am",
      ahead: true,
      who: ["Lyle Irving", "Chris Adams"],
    });
    expect(row(rows, "sm8:wo-waiting")).toMatchObject({ state: "Waiting on a day", tone: "look", next: "Won 9 Oct", who: [] });
    expect(row(rows, "sm8:q-new")).toMatchObject({ kind: "Quote", hue: "grey" });
  });

  it("marks HeyTiff's own number on a visit", () => {
    expect(row(rows, "visit:v-open")).toMatchObject({ number: "1042", numberOurs: true, state: "Not booked", next: "Due 20 Oct" });
    const late = jobsListRows(input({ visits: [visit({ id: "x", dueDate: "2026-10-01" })] }));
    expect(late[0]).toMatchObject({ state: "Overdue", tone: "wrong", next: "Was due 1 Oct" });
  });
});

describe("the money gate", () => {
  const rows = jobsListRows({ ...BOOK, jobs: BOOK.jobs.map((j) => ({ ...j, money: null, paidCents: 0 })), moneyVisible: false });

  it("carries no value and no Owed without the grant", () => {
    expect(rows.every((r) => r.valueCents === null)).toBe(true);
    expect(rows.some((r) => r.views.includes("owed"))).toBe(false);
  });

  it("offers neither Owed nor Biggest first, and the address can't ask for them", () => {
    expect(viewsFor(false).map((v) => v.key)).not.toContain("owed");
    expect(viewsFor(true).map((v) => v.key)).toContain("owed");
    expect(readListState({ view: "owed", sort: "value" }, false)).toMatchObject({ view: "all", sort: "next" });
    expect(readListState({ view: "owed", sort: "value" }, true)).toMatchObject({ view: "owed", sort: "value" });
  });

  it("never shows a value even if one arrived", () => {
    const leaked = jobsListRows(input({ jobs: [job({ remoteId: "x", money: money("100") })], moneyVisible: false }));
    expect(leaked[0]!.valueCents).toBeNull();
  });
});

describe("the address", () => {
  it("reads the view, who, sort and search, and defaults the rest", () => {
    expect(readListState({}, true)).toEqual({ view: "all", who: ANYONE, sort: "next", q: "" });
    expect(readListState({ view: "quotes", who: "Lyle Irving", sort: "oldest", q: "  rifkin " }, true)).toEqual({
      view: "quotes",
      who: "lyle irving",
      sort: "oldest",
      q: "rifkin",
    });
    expect(readListState({ view: "nonsense", sort: ["next", "value"] }, true)).toMatchObject({ view: "all", sort: "next" });
  });

  it("writes only what differs from the default", () => {
    expect(listHref({ view: "all", who: ANYONE, sort: "next", q: "" })).toBe("/dashboard/jobs");
    expect(listHref({ view: "to-book", who: "kim lee", sort: "newest", q: "ryde" })).toBe(
      "/dashboard/jobs?view=to-book&who=kim+lee&sort=newest&q=ryde",
    );
  });

  it("keeps the rest of the address, an open record's say", () => {
    expect(withListState("https://x.test/dashboard/jobs?open=agreement.a1&view=quotes", { view: "owed", who: ANYONE, sort: "next", q: "" })).toBe(
      "/dashboard/jobs?open=agreement.a1&view=owed",
    );
    expect(withListState("https://x.test/dashboard/jobs?view=quotes&q=x", { view: "all", who: ANYONE, sort: "next", q: "" })).toBe("/dashboard/jobs");
  });

  it("round-trips through the address", () => {
    const s = { view: "projects" as const, who: NOBODY, sort: "oldest" as const, q: "heuvel" };
    const params = Object.fromEntries(new URL(listHref(s), "https://x.test").searchParams);
    expect(readListState(params, true)).toEqual(s);
  });
});

describe("search and who", () => {
  const rows = jobsListRows(BOOK);

  it("matches every typed word, against the number, client, site and description", () => {
    expect(keys(rowsFor(rows, { view: "all", who: ANYONE, q: "3342" }))).toEqual(["sm8:wo-booked"]);
    expect(keys(rowsFor(rows, { view: "all", who: ANYONE, q: "bellevue rifkin" }))).toEqual(["sm8:wo-booked"]);
    expect(keys(rowsFor(rows, { view: "all", who: ANYONE, q: "two zones ryde" }))).toEqual(["sm8:wo-waiting"]);
    expect(rowsFor(rows, { view: "all", who: ANYONE, q: "rifkin zzz" })).toEqual([]);
  });

  it("narrows to a person, or to nobody yet", () => {
    expect(keys(rowsFor(rows, { view: "all", who: "dan west", q: "" }))).toEqual(["visit:v-open"]);
    expect(rowsFor(rows, { view: "all", who: NOBODY, q: "" }).every((r) => r.who.length === 0)).toBe(true);
    expect(peopleOf(rows).map((p) => p.label)).toEqual(["Chris Adams", "Dan West", "Kim Lee", "Lyle Irving"]);
  });
});

describe("the sort", () => {
  const r = (key: string, on: string | null, ahead: boolean, valueCents: number | null = null) =>
    ({ key, on, ahead, valueCents }) as JobsListRow;
  const list = [r("a", "2026-10-01", false, 100), r("b", "2026-10-20", true), r("c", "2026-10-14", true, 900), r("d", null, false), r("e", "2026-10-05", false)];

  it("puts what's coming first, soonest first, then the rest, the latest first", () => {
    expect(sortRows(list, "next").map((x) => x.key)).toEqual(["c", "b", "e", "a", "d"]);
  });
  it("runs newest and oldest on the day, undated last", () => {
    expect(sortRows(list, "newest").map((x) => x.key)).toEqual(["b", "c", "e", "a", "d"]);
    expect(sortRows(list, "oldest").map((x) => x.key)).toEqual(["a", "e", "c", "b", "d"]);
  });
  it("puts the biggest first", () => {
    expect(sortRows(list, "value").map((x) => x.key).slice(0, 2)).toEqual(["c", "a"]);
  });
});

describe("who is on a job", () => {
  const names = new Map([
    ["s1", "Lyle Irving"],
    ["s2", "Chris Adams"],
    ["s3", "Kim Lee"],
  ]);
  it("is the people booked from today on, soonest first", () => {
    const crew = crewOf(
      [
        { job_uuid: "j", staff_uuid: "s2", start_date: "2026-10-15 07:00:00" },
        { job_uuid: "j", staff_uuid: "s1", start_date: "2026-10-13 07:00:00" },
        { job_uuid: "j", staff_uuid: "s3", start_date: "2026-10-01 07:00:00" },
      ],
      names,
      TODAY,
    );
    expect(crew).toEqual({ j: ["Lyle Irving", "Chris Adams"] });
  });
  it("is the people on its last day booked when nothing is ahead", () => {
    const crew = crewOf(
      [
        { job_uuid: "j", staff_uuid: "s3", start_date: "2026-09-01 07:00:00" },
        { job_uuid: "j", staff_uuid: "s1", start_date: "2026-10-02 07:00:00" },
        { job_uuid: "j", staff_uuid: "s2", start_date: "2026-10-02 12:00:00" },
        { job_uuid: "k", staff_uuid: null, start_date: "2026-10-02 12:00:00" },
      ],
      names,
      TODAY,
    );
    expect(crew).toEqual({ j: ["Lyle Irving", "Chris Adams"] });
  });
});
