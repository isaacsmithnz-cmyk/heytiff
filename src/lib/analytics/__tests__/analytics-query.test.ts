/* The analytics read off the mirror: every page of jobs, the late-finished
   ones once, and each job shaped for the figures. */
jest.mock("server-only", () => ({}));

const byColumn: Record<string, Record<string, unknown>[]> = {};
const ranges: { column: string; from: number; to: number }[] = [];
let failOn: string | null = null;
let categories: Record<string, unknown>[] = [];
let quoteDocs: Record<string, unknown>[] = [];
let drafts: Record<string, unknown>[] = [];
let lines: Record<string, unknown>[] = [];
let decisions: { data: Record<string, unknown>[] | null; error: unknown } = { data: [], error: null };

jest.mock("@/lib/supabase-server", () => ({
  supabaseAdmin: {
    from: (table: string) => {
      let column = "";
      let span: [number, number] | null = null;
      const sub: Record<string, unknown> = {};
      sub.select = () => sub;
      sub.eq = () => sub;
      sub.order = () => sub;
      sub.gte = (c: string) => {
        column = c;
        return sub;
      };
      sub.range = (from: number, to: number) => {
        span = [from, to];
        ranges.push({ column, from, to });
        return sub;
      };
      sub.then = (res: (v: { data: unknown[] | null; error: unknown }) => unknown) => {
        if (table === "sm8_attachments") return Promise.resolve({ data: quoteDocs, error: null }).then(res);
        if (table === "sm8_categories") return Promise.resolve({ data: categories, error: null }).then(res);
        if (table === "quote_drafts") return Promise.resolve({ data: drafts, error: null }).then(res);
        if (table === "sm8_job_materials") return Promise.resolve({ data: span ? lines.slice(span[0], span[1] + 1) : lines, error: null }).then(res);
        if (table === "job_analytics_decisions") return Promise.resolve(decisions).then(res);
        if (failOn === column) return Promise.resolve({ data: null, error: { message: "down" } }).then(res);
        const all = byColumn[column] ?? [];
        return Promise.resolve({ data: span ? all.slice(span[0], span[1] + 1) : all, error: null }).then(res);
      };
      return sub;
    },
  },
}));

import { readAnalyticsJobs, readDecisions } from "../analytics-query";
import { DEFAULT_SETTINGS } from "../settings";

const row = (uuid: string, over: Record<string, unknown> = {}) => ({
  uuid,
  status: "Quote",
  date: "2026-09-01 08:00:00",
  quote_sent_stamp: null,
  work_order_date: null,
  completion_date: null,
  total_invoice_amount: "0.0000",
  category_uuid: null,
  job_description: null,
  ...over,
});

beforeEach(() => {
  for (const k of Object.keys(byColumn)) delete byColumn[k];
  ranges.length = 0;
  failOn = null;
  categories = [];
  quoteDocs = [];
  drafts = [];
  lines = [];
  decisions = { data: [], error: null };
  jest.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => jest.restoreAllMocks());

describe("readAnalyticsJobs", () => {
  it("reads past the first thousand rows", async () => {
    byColumn.date = Array.from({ length: 2300 }, (_, i) => row(`j${i}`));
    const read = await readAnalyticsJobs("org", "2024-10-08");
    expect(read?.jobs).toHaveLength(2300);
    expect(read?.truncated).toBe(false);
    expect(ranges.filter((r) => r.column === "date").map((r) => r.from)).toEqual([0, 1000, 2000]);
  });

  it("adds a job finished in the window but raised before it, once", async () => {
    byColumn.date = [row("a")];
    byColumn.completion_date = [row("a"), row("old", { date: "2023-05-01 09:00:00", status: "Completed", completion_date: "2025-02-01 10:00:00" })];
    const read = await readAnalyticsJobs("org", "2024-10-08");
    expect(read?.jobs.map((j) => j.id)).toEqual(["a", "old"]);
  });

  it("shapes a job: days off the stamps, money from its lines ex GST, the kind from its words, lines and category", async () => {
    categories = [{ uuid: "c1", name: "Annual Maintenance " }, { uuid: "c2", name: "Install" }];
    byColumn.date = [
      row("won", {
        status: "Completed",
        date: "2026-08-01 09:15:00",
        quote_date: "2026-08-01 10:00:00",
        quote_sent_stamp: null,
        work_order_date: "2026-08-20 07:30:00",
        job_description: "As per quote",
        generated_job_id: "1042",
        geo_city: "Mosman",
        company_uuid: "co-1",
        category_uuid: "c2",
      }),
      row("svc", { category_uuid: "c1" }),
    ];
    lines = [
      { uuid: "l1", job_uuid: "won", name: "MITSUBISHI ELEC. DUCTED 12.5KW", quantity: "1.0000", price: "9800.0000" },
      { uuid: "l2", job_uuid: "won", name: "HVAC Labour", quantity: "16.0000", price: "95.5000" },
      // ServiceM8's netting row for a claim: the job is worth its whole work
      { uuid: "l3", job_uuid: "won", name: "Partial invoice #1042A", quantity: "-1.0000", price: "3000.0000" },
    ];
    const read = await readAnalyticsJobs("org", "2024-10-08");
    expect(read?.jobs[0]).toEqual({
      id: "won",
      status: "Completed",
      raisedOn: "2026-08-01",
      quoteSentOn: null,
      quotedOn: "2026-08-01",
      wonOn: "2026-08-20",
      claimedOn: null,
      quoteDocOn: null,
      closedUnanswered: false,
      completedOn: null,
      valueCents: 980_000 + 152_800,
      kind: "ducted",
      category: "Install",
      role: "install",
      paid: false,
      acceptedInHeyTiff: false,
      number: "1042",
      suburb: "Mosman",
      brief: "As per quote",
      clientId: "co-1",
    });
    // nothing priced is no value, not a $0 job
    expect(read?.jobs[1]).toMatchObject({ valueCents: null, kind: "maintenance" });
  });

  it("leaves a progress claim out: it is part of its parent, not a job", async () => {
    byColumn.date = [row("parent", { generated_job_id: "2380" }), row("claim", { generated_job_id: "2380A" })];
    const read = await readAnalyticsJobs("org", "2024-10-08");
    expect(read?.jobs.map((j) => j.id)).toEqual(["parent"]);
  });

  it("gives a job the day of its first claim, a deposit being a yes", async () => {
    byColumn.date = [
      row("parent", { generated_job_id: "2587", status: "Work Order", work_order_date: "2026-09-25 12:23:13" }),
      row("deposit", { generated_job_id: "2587A", status: "Completed", date: "2026-08-28 00:00:00" }),
    ];
    byColumn.completion_date = [row("stage", { generated_job_id: "2587B", status: "Completed", date: "2026-09-25 00:00:00" })];
    const read = await readAnalyticsJobs("org", "2024-10-08");
    expect(read?.jobs).toHaveLength(1);
    expect(read?.jobs[0]).toMatchObject({ id: "parent", wonOn: "2026-09-25", claimedOn: "2026-08-28" });
  });

  it("reads the day a quote document was first made, and finds the age ServiceM8 closes an unanswered Quote at", async () => {
    quoteDocs = [
      { uuid: "a2", related_object_uuid: "c0", timestamp: "2026-03-14 10:00:00" },
      { uuid: "a1", related_object_uuid: "c0", timestamp: "2026-03-12 09:00:00" },
    ];
    // five closed 60 days to the hour after they became a Quote, one by hand
    byColumn.date = [
      ...["09", "10", "11", "12", "13"].map((d, i) =>
        row(`c${i}`, { status: "Unsuccessful", quote_date: `2026-03-${Number(d) + 1} 09:14:02`, edit_date: `2026-05-${d} 09:20:00` }),
      ),
      row("hand", { status: "Unsuccessful", quote_date: "2026-03-11 09:14:02", edit_date: "2026-06-01 15:00:00" }),
    ];
    const read = await readAnalyticsJobs("org", "2024-10-08");
    expect(read?.found.closeAge).toEqual({ days: 60, count: 5 });
    expect(read?.jobs.find((j) => j.id === "c0")).toMatchObject({ quoteDocOn: "2026-03-12", closedUnanswered: true });
    expect(read?.jobs.find((j) => j.id === "hand")).toMatchObject({ quoteDocOn: null, closedUnanswered: false });

    // the business says ServiceM8 doesn't close quotes: none is said to be
    const off = await readAnalyticsJobs("org", "2024-10-08", { ...DEFAULT_SETTINGS, autoCloseDays: 0 });
    expect(off?.jobs.filter((j) => j.closedUnanswered)).toEqual([]);
  });

  it("leaves out the cards of clients that are bookings, found or listed, and keeps work done for them", async () => {
    const day = (id: string, client: string) => row(id, { status: "Work Order", company_uuid: client, job_description: "UNIVERSITY" });
    byColumn.date = [
      ...[1, 2, 3, 4, 5, 6].map((i) => day(`tafe${i}`, "tafe")),
      row("other", { status: "Work Order", company_uuid: "co-2" }),
    ];
    // found: six cards, none quoted, invoiced or paid
    const found = await readAnalyticsJobs("org", "2024-10-08");
    expect(found?.found.bookingClients).toEqual([{ clientId: "tafe", cards: 6 }]);
    expect(found?.jobs.map((j) => j.id)).toEqual(["other"]);

    // the business's list replaces what was found; an invoiced card still counts
    byColumn.date.push(row("work", { status: "Completed", company_uuid: "co-2", invoice_sent: 1 }));
    const listed = await readAnalyticsJobs("org", "2024-10-08", { ...DEFAULT_SETTINGS, notCustomers: ["co-2"] });
    expect(listed?.jobs.map((j) => j.id)).toEqual(["tafe1", "tafe2", "tafe3", "tafe4", "tafe5", "tafe6", "work"]);
  });

  it("reads each category's role, the business's or from its name, and leaves out a category of not jobs", async () => {
    categories = [
      { uuid: "c-ins", name: "Install" },
      { uuid: "c-tafe", name: "Bookings" },
    ];
    byColumn.date = [row("i", { category_uuid: "c-ins" }), row("b", { category_uuid: "c-tafe" }), row("n")];
    const read = await readAnalyticsJobs("org", "2024-10-08", { ...DEFAULT_SETTINGS, categoryRoles: { "c-tafe": "not_job" } });
    expect(read?.jobs.map((j) => [j.id, j.role])).toEqual([
      ["i", "install"],
      ["n", "other"],
    ]);
    expect(read?.found.byCategory).toEqual({ "c-ins": 1, "c-tafe": 1, "": 1 });
  });

  it("marks a job paid in ServiceM8, and one whose proposal has an option accepted", async () => {
    byColumn.date = [row("paid", { status: "Unsuccessful", payment_received: 1 }), row("acc"), row("draft-only")];
    drafts = [
      { sm8_job_uuid: "acc", accepted: [1] },
      { sm8_job_uuid: "draft-only", accepted: [] },
    ];
    const read = await readAnalyticsJobs("org", "2024-10-08");
    expect(read?.jobs.map((j) => [j.id, j.paid, j.acceptedInHeyTiff])).toEqual([
      ["paid", true, false],
      ["acc", false, true],
      ["draft-only", false, false],
    ]);
  });

  it("says nothing rather than a quiet year when the mirror can't be read", async () => {
    byColumn.date = [row("a")];
    failOn = "completion_date";
    expect(await readAnalyticsJobs("org", "2024-10-08")).toBeNull();
  });
});

describe("readDecisions", () => {
  it("makes the stored answers one map", async () => {
    decisions = { data: [{ sm8_job_uuid: "a", question: "kind", answer: "ducted" }], error: null };
    const read = await readDecisions("org");
    expect(read.ready).toBe(true);
    expect(read.decisions.get("a")).toEqual({ kind: "ducted" });
  });

  it("says it can't keep answers while the table isn't there, quietly", async () => {
    decisions = { data: null, error: { code: "PGRST205", message: "Could not find the table" } };
    const read = await readDecisions("org");
    expect(read).toEqual({ decisions: new Map(), ready: false });
    expect(console.error).not.toHaveBeenCalled();
  });
});
