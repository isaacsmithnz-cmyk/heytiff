/* Promoting a ServiceM8 job onto a board, and reading the book.

   Two things are load-bearing here. The uuid a client hands in is a CHOICE,
   not a fact — every path re-resolves it inside this org's mirror. And the
   budget prefill only fires for a QUOTE with a readable total, because a work
   order's invoice figure is what was billed, not what was sold. */

const inserts: { table: string; payload: unknown }[] = [];
const updates: { table: string; patch: Record<string, unknown> }[] = [];

let rows: Record<string, Record<string, unknown> | null> = {};

jest.mock("@/lib/supabase-server", () => ({
  supabaseAdmin: {
    from: (table: string) => {
      const chain: Record<string, unknown> = {};
      const self = () => chain;
      chain.select = self;
      chain.eq = self;
      chain.order = self;
      chain.limit = self;
      chain.maybeSingle = async () => ({ data: rows[table] ?? null });
      chain.insert = (payload: unknown) => {
        inserts.push({ table, payload });
        return {
          select: () => ({ single: async () => ({ data: { id: "p-new" }, error: null }) }),
          then: (res: (v: { error: null }) => unknown) =>
            Promise.resolve({ error: null }).then(res),
        };
      };
      chain.update = (patch: Record<string, unknown>) => {
        const sub: Record<string, unknown> = {};
        sub.eq = () => sub;
        sub.then = (res: (v: { error: null }) => unknown) => {
          updates.push({ table, patch });
          return Promise.resolve({ error: null }).then(res);
        };
        return sub;
      };
      return chain;
    },
  },
}));

jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));
jest.mock("@/lib/auth0", () => ({
  auth0: { getSession: jest.fn(async () => ({ user: { sub: "auth0|me" }, orgId: "org-1" })) },
}));

let caps = new Set<string>();
jest.mock("@/lib/permissions-server", () => ({ can: async (c: string) => caps.has(c) }));
jest.mock("@/lib/workboard/query", () => ({ getSm8Timezone: async () => "Australia/Sydney" }));

const searchMirrorJobs = jest.fn(async () => [{ remoteId: "j-1" }]);
jest.mock("@/lib/workboard/projects-query", () => ({
  staffIdFor: async () => "staff-1",
  searchMirrorJobs: (...a: unknown[]) => searchMirrorJobs(...(a as [])),
}));

const readMirrorJobDetail = jest.fn(async () => ({ remoteId: "j-1" }));
const searchAllMirrorJobs = jest.fn(async () => [{ remoteId: "j-1" }]);
/* A clone is a CLAIM, so the action resolves which CARD a row opens before it
   reads anything. Answering "itself" here keeps these tests about the grants. */
const resolveJobCard = jest.fn(async (_org: string, id: string) => ({
  parentRemoteId: id,
  focusRemoteId: null,
}));
const readClaimDetail = jest.fn(async () => ({ ledger: { materials: [], payments: [] }, notes: [], media: { photos: [], documents: [], elsewhere: [], truncated: false } }));
jest.mock("@/lib/workboard/all-jobs-query", () => ({
  readMirrorJobDetail: (...a: unknown[]) => readMirrorJobDetail(...(a as [])),
  searchAllMirrorJobs: (...a: unknown[]) => searchAllMirrorJobs(...(a as [])),
  resolveJobCard: (...a: unknown[]) => resolveJobCard(...(a as [string, string])),
  readClaimDetail: (...a: unknown[]) => readClaimDetail(...(a as [])),
}));

import {
  createProjectFromJob,
  readClaim,
  readMirrorJob,
  searchAllJobs,
  searchJobs,
} from "../workboard";

const quoteJob = {
  uuid: "j-1",
  generated_job_id: "2240",
  status: "Quote",
  job_description: "Replace rooftop package unit",
  job_address: "12 Albert Rd, Strathfield",
  geo_city: "Strathfield",
  total_invoice_amount: "18940.0000",
};

beforeEach(() => {
  inserts.length = 0;
  updates.length = 0;
  rows = {};
  caps = new Set(["workboard", "workboard_manage"]);
  readMirrorJobDetail.mockClear();
  resolveJobCard.mockClear();
  readClaimDetail.mockClear();
  searchAllMirrorJobs.mockClear();
  searchMirrorJobs.mockClear();
});

describe("createProjectFromJob", () => {
  it("creates the project, links the job, and seeds the budget from the quote", async () => {
    rows.sm8_jobs = quoteJob;
    const res = await createProjectFromJob("j-1", {
      name: "Strathfield rooftop",
      clientName: "Strathfield Dental",
    });
    expect(res).toEqual({ ok: true, id: "p-new" });

    const project = inserts.find((i) => i.table === "projects")!.payload as Record<string, unknown>;
    expect(project).toMatchObject({
      org_id: "org-1",
      name: "Strathfield rooftop",
      client_name: "Strathfield Dental",
      // The job's own address and suburb ride along rather than being retyped.
      site_label: "Strathfield",
      site_address: "12 Albert Rd, Strathfield",
    });

    const link = inserts.find((i) => i.table === "project_jobs")!.payload as Record<string, unknown>;
    expect(link).toMatchObject({
      project_id: "p-new",
      job_number: "2240",
      provider: "servicem8",
      remote_id: "j-1",
      role: "quote",
    });

    /* THE PREFILL THE PROJECTS DESIGN HAS BEEN WAITING FOR: budget_source was
       built for "the SM8 quote" and had no data to fill it. A quote's own
       total is that number. */
    expect(updates.find((u) => u.table === "projects")!.patch).toEqual({
      budget_cents: 1_894_000,
      budget_source: "sm8_quote",
    });
  });

  it("seeds the default checklist, like any other project", async () => {
    rows.sm8_jobs = quoteJob;
    await createProjectFromJob("j-1");
    expect(inserts.some((i) => i.table === "project_checklist_items")).toBe(true);
  });

  /* A work order's invoice figure is what was BILLED, not what was sold — and
     seeding a budget from it would make claimed-of-total read 100% on day
     one. Only a quote is an offer. */
  it("takes no budget from a work order, and calls it the install", async () => {
    rows.sm8_jobs = { ...quoteJob, status: "Work Order" };
    await createProjectFromJob("j-1");
    expect(updates.filter((u) => u.table === "projects")).toHaveLength(0);
    const link = inserts.find((i) => i.table === "project_jobs")!.payload as Record<string, unknown>;
    expect(link).toMatchObject({ role: "install" });
  });

  it("takes no budget from a quote nobody has priced", async () => {
    rows.sm8_jobs = { ...quoteJob, total_invoice_amount: "0.0000" };
    await createProjectFromJob("j-1");
    expect(updates.filter((u) => u.table === "projects")).toHaveLength(0);
  });

  it("falls back to a name rather than creating a nameless project", async () => {
    rows.sm8_jobs = quoteJob;
    await createProjectFromJob("j-1", {});
    const project = inserts.find((i) => i.table === "projects")!.payload as Record<string, unknown>;
    expect(project.name).toBe("Job #2240");
  });

  it("refuses a job that isn't in this workspace's mirror", async () => {
    rows.sm8_jobs = null;
    const res = await createProjectFromJob("j-nope");
    expect(res.ok).toBe(false);
    expect(inserts).toHaveLength(0);
  });

  it("needs workboard_manage — reading the book is not promoting out of it", async () => {
    caps = new Set(["workboard"]);
    rows.sm8_jobs = quoteJob;
    const res = await createProjectFromJob("j-1");
    expect(res.ok).toBe(false);
    expect(inserts).toHaveLength(0);
  });
});

/* A claim IS an invoice, so its modal sits behind the money grant — a reader
   who can't see the job's total can't see it split into payments either. */
describe("readClaim", () => {
  it("refuses a reader without the money grant, never touching the query", async () => {
    caps = new Set(["workboard"]);
    expect(await readClaim("j-2380a")).toBeNull();
    expect(readClaimDetail).not.toHaveBeenCalled();
  });

  it("reads for a money holder", async () => {
    caps = new Set(["workboard", "workboard_money"]);
    await readClaim("j-2380a");
    expect(readClaimDetail).toHaveBeenCalledWith("org-1", "j-2380a");
  });
});

describe("reading the book", () => {
  it("readMirrorJob needs only workboard, and passes the two grants on", async () => {
    caps = new Set(["workboard", "workboard_money", "studio"]);
    await readMirrorJob("j-1");
    expect(readMirrorJobDetail).toHaveBeenCalledWith(
      "org-1",
      "j-1",
      expect.any(String),
      { includeMoney: true, includeDesigns: true }
    );
  });

  it("withholds money from a reader without the grant", async () => {
    caps = new Set(["workboard"]);
    await readMirrorJob("j-1");
    expect(readMirrorJobDetail).toHaveBeenCalledWith("org-1", "j-1", expect.any(String), {
      includeMoney: false,
      includeDesigns: false,
    });
  });

  /* The studio's designs ride the same rule money does — the reader's own
     capability decides, and someone with no studio to open is not shown a
     list of doors they cannot use. */
  it("withholds the linked designs from a reader with no studio", async () => {
    caps = new Set(["workboard", "workboard_money"]);
    await readMirrorJob("j-1");
    expect(readMirrorJobDetail).toHaveBeenCalledWith("org-1", "j-1", expect.any(String), {
      includeMoney: true,
      includeDesigns: false,
    });
  });

  it("refuses both reads without workboard at all", async () => {
    caps = new Set();
    expect(await readMirrorJob("j-1")).toEqual({ detail: null, focusRemoteId: null });
    expect(await searchAllJobs("ardex")).toEqual([]);
    expect(readMirrorJobDetail).not.toHaveBeenCalled();
    expect(searchAllMirrorJobs).not.toHaveBeenCalled();
  });

  /* This search used to require MANAGE, on the grounds that the results are
     the client book. The All jobs side now shows that same book to anyone
     with `workboard`; a picker that finds LESS than the list beside it would
     just be a puzzle. */
  it("the attach picker's search now matches the list's own gate", async () => {
    caps = new Set(["workboard"]);
    expect(await searchJobs("ardex")).toHaveLength(1);
    expect(searchMirrorJobs).toHaveBeenCalled();
  });

  it("still refuses the picker's search to someone off the board entirely", async () => {
    caps = new Set();
    expect(await searchJobs("ardex")).toEqual([]);
    expect(searchMirrorJobs).not.toHaveBeenCalled();
  });
});
