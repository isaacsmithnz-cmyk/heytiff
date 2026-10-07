/* The analytics read off the mirror: every page of jobs, the late-finished
   ones once, and each job shaped for the figures. */
jest.mock("server-only", () => ({}));

const byColumn: Record<string, Record<string, unknown>[]> = {};
const ranges: { column: string; from: number; to: number }[] = [];
let failOn: string | null = null;
let categories: Record<string, unknown>[] = [];
let drafts: Record<string, unknown>[] = [];
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
        if (table === "sm8_categories") return Promise.resolve({ data: categories, error: null }).then(res);
        if (table === "quote_drafts") return Promise.resolve({ data: drafts, error: null }).then(res);
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
  drafts = [];
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

  it("shapes a job: days off the stamps, money in cents, the kind from its words and category", async () => {
    categories = [{ uuid: "c1", name: "Maintenance" }];
    byColumn.date = [
      row("won", {
        status: "Work Order",
        date: "2026-08-01 09:15:00",
        quote_sent_stamp: "2026-08-03 14:00:00",
        work_order_date: "2026-08-20 07:30:00",
        total_invoice_amount: "8250.5000",
        job_description: "Supply and install 14kW ducted system",
        generated_job_id: "1042",
        geo_city: "Mosman",
        company_uuid: "co-1",
      }),
      row("svc", { category_uuid: "c1", total_invoice_amount: "0.0000" }),
    ];
    const read = await readAnalyticsJobs("org", "2024-10-08");
    expect(read?.jobs[0]).toEqual({
      id: "won",
      status: "Work Order",
      raisedOn: "2026-08-01",
      quoteSentOn: "2026-08-03",
      wonOn: "2026-08-20",
      completedOn: null,
      valueCents: 825_050,
      kind: "ducted",
      paid: false,
      acceptedInHeyTiff: false,
      number: "1042",
      suburb: "Mosman",
      brief: "14kW ducted system",
      clientId: "co-1",
    });
    // ServiceM8's zero is "not priced", not a $0 job
    expect(read?.jobs[1]).toMatchObject({ valueCents: null, kind: "maintenance" });
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
