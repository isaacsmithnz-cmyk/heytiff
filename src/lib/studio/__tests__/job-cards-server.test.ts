/* New design's jobs, read as job cards (Isaac, 14 November 2026: "Job picker
   should look more like job cards", "Recent jobs at top", "Both"). The read
   joins the client, the kind and its colour, and whether plans are read. */

type Ask = { table: string; calls: [string, unknown[]][] };
const asks: Ask[] = [];
let tables: Record<string, unknown[]> = {};
let failing: string | null = null;

jest.mock("server-only", () => ({}));
jest.mock("@/lib/supabase-server", () => ({
  supabaseAdmin: {
    from: (table: string) => {
      const ask: Ask = { table, calls: [] };
      asks.push(ask);
      const node: Record<string, unknown> = {
        then: (resolve: (v: unknown) => unknown) =>
          Promise.resolve(failing === table ? { data: null, error: { message: "down" } } : { data: tables[table] ?? [], error: null }).then(resolve),
      };
      for (const m of ["select", "eq", "in", "not", "order", "range"]) node[m] = (...a: unknown[]) => (ask.calls.push([m, a]), node);
      return node;
    },
  },
}));

import { studioJobsByIds, studioJobsByNumber, STUDIO_JOBS_MOST } from "../job-cards-server";

const job = (uuid: string, number: string, over: Record<string, unknown> = {}) => ({
  uuid,
  generated_job_id: number,
  status: "Work Order",
  company_uuid: "co-1",
  category_uuid: "cat-install",
  geo_city: "Chatswood",
  job_address: "2 Neridah Street, Chatswood NSW, Australia",
  job_description: "Removal",
  ...over,
});

beforeEach(() => {
  asks.length = 0;
  failing = null;
  jest.spyOn(console, "error").mockImplementation(() => {});
  tables = {
    sm8_jobs: [job("J-3465", "3465", { status: "Quote" }), job("j-3517", "3517"), job("j-3526", "3526", { company_uuid: null, category_uuid: null })],
    sm8_companies: [{ uuid: "co-1", name: "Lenzner, Mark" }],
    sm8_categories: [{ uuid: "cat-install", name: "Install ", colour: "e7b5ff" }],
    job_plans: [{ job_uuid: "j-3465" }],
  };
});
afterEach(() => jest.restoreAllMocks());

const said = (table: string, method: string) => asks.filter((a) => a.table === table).flatMap((a) => a.calls.filter(([m]) => m === method).map(([, args]) => args));

describe("a job as its card", () => {
  it("carries the client, the kind, the colour and whether plans are read", async () => {
    const [quote, booked, bare] = await studioJobsByIds("org-1", ["J-3465", "j-3517", "j-3526"]);
    expect(quote).toMatchObject({ remoteId: "J-3465", jobNumber: "3465", clientName: "Lenzner, Mark", kind: "Install", plansRead: true });
    // a quote is orange whatever its category; a booked job wears its category's colour
    expect(quote.hue).toBe("orange");
    expect(booked).toMatchObject({ hue: "purple", plansRead: false });
    // no client and no category: a grey card that still names the job
    expect(bare).toMatchObject({ jobNumber: "3526", clientName: null, kind: null, hue: "grey" });
  });

  it("counts only plans Tiff has read, and only this business's", async () => {
    await studioJobsByIds("org-1", ["J-3465"]);
    expect(said("job_plans", "eq")).toEqual(expect.arrayContaining([["org_id", "org-1"], ["state", "read"]]));
  });

  it("answers in the order asked, leaving out a job that's gone", async () => {
    const got = await studioJobsByIds("org-1", ["j-3517", "gone", "j-3465", "j-3517"]);
    expect(got.map((j) => j.jobNumber)).toEqual(["3517", "3465"]);
  });

  it("asks nothing for no ids", async () => {
    expect(await studioJobsByIds("org-1", [" ", ""])).toEqual([]);
    expect(asks).toHaveLength(0);
  });

  it("is empty, not a throw, when the mirror can't be read", async () => {
    failing = "sm8_jobs";
    expect(await studioJobsByIds("org-1", ["j-3517"])).toEqual([]);
    expect(await studioJobsByNumber("org-1", 0, 6)).toEqual([]);
  });
});

describe("All jobs, newest number first", () => {
  it("pages by number, without the claims, inside this business", async () => {
    await studioJobsByNumber("org-1", 6, 12);
    expect(said("sm8_jobs", "eq")).toEqual(expect.arrayContaining([["org_id", "org-1"], ["active", 1]]));
    expect(said("sm8_jobs", "not")).toEqual([["generated_job_id", "match", "[A-Z]$"]]);
    expect(said("sm8_jobs", "order")[0]).toEqual(["job_number", { ascending: false, nullsFirst: false }]);
    expect(said("sm8_jobs", "range")).toEqual([[6, 17]]);
  });

  it("holds an ask to its limits", async () => {
    await studioJobsByNumber("org-1", -4, 500);
    expect(said("sm8_jobs", "range")).toEqual([[0, STUDIO_JOBS_MOST - 1]]);
  });
});
