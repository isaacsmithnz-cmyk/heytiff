/* Maintenance actions. The load-bearing behaviours: readiness ticks are the
   `workboard` tier and rebuild the stored jsonb FROM the whitelist; cadence
   edits go through prune-and-regenerate; creating an agreement generates its
   visits immediately; and a mirror pick is re-resolved inside the org. */

const inserts: { table: string; payload: unknown }[] = [];
const updates: { table: string; patch: Record<string, unknown>; filters: Record<string, unknown> }[] = [];

let rows: Record<string, Record<string, unknown> | null> = {};

jest.mock("@/lib/supabase-server", () => ({
  supabaseAdmin: {
    from: (table: string) => {
      const filters: Record<string, unknown> = {};
      const chain: Record<string, unknown> = {};
      const self = () => chain;
      chain.select = self;
      chain.eq = (col: string, v: unknown) => {
        filters[col] = v;
        return chain;
      };
      chain.gte = self;
      chain.order = self;
      chain.limit = self;
      chain.maybeSingle = async () => ({ data: rows[table] ?? null });
      chain.insert = (payload: unknown) => {
        inserts.push({ table, payload });
        return {
          select: () => ({ single: async () => ({ data: { id: "a-new" }, error: null }) }),
          then: (res: (v: { error: null }) => unknown) => Promise.resolve({ error: null }).then(res),
        };
      };
      chain.update = (patch: Record<string, unknown>) => {
        const u = { table, patch, filters };
        const sub: Record<string, unknown> = {};
        sub.eq = (col: string, v: unknown) => {
          u.filters = { ...u.filters, [col]: v };
          return sub;
        };
        sub.in = () => sub;
        sub.then = (res: (v: { error: null }) => unknown) => {
          updates.push(u);
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
jest.mock("@/lib/permissions-server", () => ({
  can: async (c: string) => caps.has(c),
}));

const ensureVisits = jest.fn(async () => {});
const pruneAndRegenerate = jest.fn(async () => {});
jest.mock("@/lib/workboard/visit-ensure", () => ({
  ensureVisits: (...a: unknown[]) => ensureVisits(...(a as [])),
  pruneAndRegenerate: (...a: unknown[]) => pruneAndRegenerate(...(a as [])),
}));
jest.mock("@/lib/workboard/query", () => ({
  getSm8Timezone: async () => "Australia/Brisbane",
}));

import {
  createAgreement,
  linkVisitJob,
  setVisitReadiness,
  setVisitStatus,
  updateAgreementSchedule,
} from "../workboard-maintenance";

beforeEach(() => {
  inserts.length = 0;
  updates.length = 0;
  rows = {};
  caps = new Set(["workboard", "workboard_manage"]);
  ensureVisits.mockClear();
  pruneAndRegenerate.mockClear();
});

describe("createAgreement", () => {
  const input = {
    label: "Warehouse quarterly",
    clientName: "Acme",
    intervalMonths: 3,
    anchorDate: "2026-08-01",
  };

  it("creates and generates the visits immediately — the radar never waits", async () => {
    const res = await createAgreement(input);
    expect(res).toEqual({ ok: true, id: "a-new" });
    expect(inserts[0].payload).toMatchObject({
      org_id: "org-1",
      label: "Warehouse quarterly",
      interval_months: 3,
      anchor_date: "2026-08-01",
    });
    expect(ensureVisits).toHaveBeenCalledWith("org-1", { agreementId: "a-new" });
  });

  it("refuses junk dates and intervals before any write", async () => {
    expect((await createAgreement({ ...input, anchorDate: "next tuesday" })).ok).toBe(false);
    expect((await createAgreement({ ...input, intervalMonths: 0 })).ok).toBe(false);
    expect(inserts).toHaveLength(0);
  });

  it("is manage-tier", async () => {
    caps = new Set(["workboard"]);
    expect((await createAgreement(input)).ok).toBe(false);
    expect(inserts).toHaveLength(0);
  });
});

describe("updateAgreementSchedule", () => {
  it("saves the cadence, then redraws only the pristine future", async () => {
    rows.maintenance_agreements = { id: "a-1" };
    const res = await updateAgreementSchedule("a-1", {
      intervalMonths: 6,
      anchorDate: "2026-09-01",
    });
    expect(res.ok).toBe(true);
    expect(updates[0].patch).toMatchObject({ interval_months: 6, anchor_date: "2026-09-01" });
    expect(pruneAndRegenerate).toHaveBeenCalledWith("org-1", "a-1");
  });
});

describe("setVisitReadiness — the tick tier", () => {
  beforeEach(() => {
    rows.maintenance_visits = {
      id: "v-1",
      agreement_id: "a-1",
      status: "upcoming",
      readiness: { access_confirmed: true, junk_key: true },
    };
  });

  it("works with only `workboard`, and rebuilds the jsonb from the whitelist", async () => {
    caps = new Set(["workboard"]);
    const res = await setVisitReadiness("v-1", "parts_ready", true);
    expect(res.ok).toBe(true);
    // stored object: whitelist keys only, true-only — the junk key is gone
    expect(updates[0].patch.readiness).toEqual({ access_confirmed: true, parts_ready: true });
  });

  it("kills junk keys at the door", async () => {
    const res = await setVisitReadiness("v-1", "vibes_confirmed", true);
    expect(res.ok).toBe(false);
    expect(updates).toHaveLength(0);
  });

  it("unticking removes the key entirely", async () => {
    await setVisitReadiness("v-1", "access_confirmed", false);
    expect(updates[0].patch.readiness).toEqual({});
  });
});

describe("setVisitStatus", () => {
  beforeEach(() => {
    rows.maintenance_visits = { id: "v-1", agreement_id: "a-1", status: "upcoming", readiness: {} };
  });

  it("manual done stamps today and the manual source", async () => {
    const res = await setVisitStatus("v-1", "done");
    expect(res.ok).toBe(true);
    expect(updates[0].patch).toMatchObject({ status: "done", completed_source: "manual" });
    expect(String(updates[0].patch.completed_at)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("is manage-tier — ticking chips is not moving visits", async () => {
    caps = new Set(["workboard"]);
    expect((await setVisitStatus("v-1", "done")).ok).toBe(false);
  });

  it("junk statuses die before any read", async () => {
    expect((await setVisitStatus("v-1", "vanished")).ok).toBe(false);
    expect(updates).toHaveLength(0);
  });
});

describe("linkVisitJob", () => {
  beforeEach(() => {
    rows.maintenance_visits = { id: "v-1", agreement_id: "a-1", status: "upcoming", readiness: {} };
  });

  it("a mirror pick is re-resolved inside the org and books the visit", async () => {
    rows.sm8_jobs = { uuid: "j-9", generated_job_id: "2001" };
    rows.sm8_job_activities = { start_date: "2026-08-02 07:30:00" };
    const res = await linkVisitJob("v-1", { remoteId: "j-9" });
    expect(res.ok).toBe(true);
    expect(updates[0].patch).toMatchObject({
      provider: "servicem8",
      remote_id: "j-9",
      job_number: "2001",
      booked_start_cached: "2026-08-02 07:30:00",
      status: "booked",
    });
  });

  it("a foreign mirror id links nothing", async () => {
    rows.sm8_jobs = null;
    expect((await linkVisitJob("v-1", { remoteId: "x" })).ok).toBe(false);
    expect(updates).toHaveLength(0);
  });

  it("typed mode stores the number with no provider", async () => {
    await linkVisitJob("v-1", { jobNumber: " 77 " });
    expect(updates[0].patch).toMatchObject({
      job_number: "77",
      provider: null,
      remote_id: null,
    });
  });
});
