/* The page allowance: the arithmetic, and the month it is counted in.

   THE MONTH IS THE PART THAT BITES. Every AU state is ahead of UTC, so on the
   last evening of a month a UTC server has already rolled over — an org would
   get its new allowance hours early, and (worse) the pages it processed that
   evening would land in the wrong bucket, so the following month starts
   already spent. The boundary is pinned in both directions below. */

const rpc = jest.fn<Promise<{ error: null }>, [fn: string, args: Record<string, unknown>]>(
  async () => ({ error: null })
);
const rows: Record<string, Record<string, unknown> | null> = {};

jest.mock("@/lib/supabase-server", () => ({
  supabaseAdmin: {
    from: (table: string) => {
      const chain: Record<string, unknown> = {};
      const self = () => chain;
      chain.select = self;
      chain.eq = self;
      chain.maybeSingle = async () => ({ data: rows[table] ?? null });
      return chain;
    },
    rpc: (fn: string, args: Record<string, unknown>) => rpc(fn, args),
  },
}));

import {
  addKbUsage,
  asPlan,
  auMonthStart,
  kbQuotaFor,
  nextMonthStart,
  PAGE_QUOTAS,
  pagesRemaining,
} from "../quota";

beforeEach(() => {
  rpc.mockClear();
  delete rows.organizations;
  delete rows.kb_usage;
});

afterEach(() => {
  jest.useRealTimers();
});

describe("the AU month bucket", () => {
  /* 14:00 UTC on 31 August is 00:00 on 1 September in Sydney (AEST, +10).
     A UTC-derived bucket says August for another ten hours. */
  it("rolls at AU midnight, not UTC midnight", () => {
    expect(auMonthStart(new Date("2026-08-31T13:59:00Z"))).toBe("2026-08-01");
    expect(auMonthStart(new Date("2026-08-31T14:00:00Z"))).toBe("2026-09-01");
  });

  it("does not roll early on the UTC side of the same boundary", () => {
    // UTC still says July here; the yard has been in August since midnight
    expect(auMonthStart(new Date("2026-07-31T14:30:00Z"))).toBe("2026-08-01");
    expect(auMonthStart(new Date("2026-07-31T13:00:00Z"))).toBe("2026-07-01");
  });

  /* Daylight saving moves the anchor to +11 from October, which moves the
     boundary an hour earlier in UTC — the formatter handles it, so the test
     exists to prove nobody hard-coded +10. */
  it("follows the anchor through daylight saving", () => {
    expect(auMonthStart(new Date("2026-11-30T12:59:00Z"))).toBe("2026-11-01");
    expect(auMonthStart(new Date("2026-11-30T13:00:00Z"))).toBe("2026-12-01");
  });

  it("reads the clock when nobody passes one", () => {
    jest.useFakeTimers().setSystemTime(new Date("2026-12-31T14:00:00Z"));
    // 1 January in the yard, and a new year's bucket
    expect(auMonthStart()).toBe("2027-01-01");
  });

  it("names the month the allowance resets in, across a year end", () => {
    expect(nextMonthStart("2026-08-01")).toBe("2026-09-01");
    expect(nextMonthStart("2026-12-01")).toBe("2027-01-01");
  });
});

describe("tiers", () => {
  it("holds the placeholder caps Isaac tunes", () => {
    expect(PAGE_QUOTAS).toEqual({
      trial: 200,
      standard: 2000,
      pro: 10000,
      unlimited: Infinity,
    });
  });

  it("counts down and stops at zero", () => {
    expect(pagesRemaining("trial", 0)).toBe(200);
    expect(pagesRemaining("trial", 199)).toBe(1);
    expect(pagesRemaining("trial", 200)).toBe(0);
    // a part-batch can overshoot; "minus 3 pages" is not a thing to render
    expect(pagesRemaining("trial", 260)).toBe(0);
    expect(pagesRemaining("standard", -5)).toBe(2000);
  });

  it("never runs out on unlimited", () => {
    expect(pagesRemaining("unlimited", 999_999)).toBe(Infinity);
  });

  /* A junk plan must not read as a suspended account: the failure mode of
     "0 pages" is a customer who paid and can't upload. */
  it("reads an unknown plan as the default tier", () => {
    for (const junk of ["enterprise", "", null, 7, undefined]) expect(asPlan(junk)).toBe("standard");
    expect(asPlan("pro")).toBe("pro");
  });
});

describe("the org's standing this month", () => {
  it("joins the plan to the month's counters", async () => {
    jest.useFakeTimers().setSystemTime(new Date("2026-08-04T02:00:00Z"));
    rows.organizations = { plan: "trial" };
    rows.kb_usage = { pages_processed: 150, questions_asked: 12 };

    expect(await kbQuotaFor("org-1")).toEqual({
      plan: "trial",
      month: "2026-08-01",
      pagesUsed: 150,
      questionsAsked: 12,
      pagesAllowed: 200,
      pagesRemaining: 50,
      resetsOn: "2026-09-01",
    });
  });

  it("treats a month with no row as zero used, not as an error", async () => {
    jest.useFakeTimers().setSystemTime(new Date("2026-08-04T02:00:00Z"));
    rows.organizations = { plan: "standard" };

    const quota = await kbQuotaFor("org-1");
    expect(quota.pagesUsed).toBe(0);
    expect(quota.pagesRemaining).toBe(2000);
  });

  it("falls back to the default tier when the org row is missing", async () => {
    const quota = await kbQuotaFor("org-1");
    expect(quota.plan).toBe("standard");
  });
});

describe("counting", () => {
  it("adds through the atomic RPC, never a read-modify-write", async () => {
    jest.useFakeTimers().setSystemTime(new Date("2026-08-04T02:00:00Z"));
    await addKbUsage("org-1", { pages: 20 });

    expect(rpc).toHaveBeenCalledWith("kb_usage_add", {
      p_org: "org-1",
      p_month: "2026-08-01",
      p_pages: 20,
      p_questions: 0,
    });
  });

  it("never sends a negative or fractional count", async () => {
    await addKbUsage("org-1", { pages: -4, questions: 1.7 });
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_pages: 0, p_questions: 1 });
  });
});
