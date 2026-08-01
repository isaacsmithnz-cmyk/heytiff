/* Maintenance actions. The load-bearing behaviours: readiness ticks are the
   `workboard` tier and rebuild the stored jsonb FROM the whitelist (now the
   two-gate whitelist, D1); cadence edits go through prune-and-regenerate;
   creating an agreement generates its visits immediately; a mirror pick is
   re-resolved inside the org; the close-out is the only rich completion
   path (K1); and identity colours are decided at creation, once (B2). */

const inserts: { table: string; payload: unknown }[] = [];
const updates: { table: string; patch: Record<string, unknown>; filters: Record<string, unknown> }[] = [];
const upserts: { table: string; payload: unknown; opts?: unknown }[] = [];
const deletes: { table: string; filters: Record<string, unknown> }[] = [];

let rows: Record<string, Record<string, unknown> | null> = {};
let counts: Record<string, number> = {};
let insertFails: Set<string> = new Set();

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
      chain.in = self;
      chain.maybeSingle = async () => ({ data: rows[table] ?? null });
      // awaiting the bare chain = the head/count read
      chain.then = (res: (v: { data: null; count: number; error: null }) => unknown) =>
        Promise.resolve({ data: null, count: counts[table] ?? 0, error: null }).then(res);
      chain.insert = (payload: unknown) => {
        inserts.push({ table, payload });
        const error = insertFails.has(table) ? { message: "duplicate" } : null;
        return {
          select: () => ({
            single: async () => (error ? { data: null, error } : { data: { id: "a-new" }, error: null }),
          }),
          then: (res: (v: { error: unknown }) => unknown) => Promise.resolve({ error }).then(res),
        };
      };
      chain.upsert = (payload: unknown, opts?: unknown) => {
        upserts.push({ table, payload, opts });
        return {
          then: (res: (v: { error: null }) => unknown) => Promise.resolve({ error: null }).then(res),
        };
      };
      chain.delete = () => {
        const d = { table, filters: {} as Record<string, unknown> };
        const sub: Record<string, unknown> = {};
        sub.eq = (col: string, v: unknown) => {
          d.filters = { ...d.filters, [col]: v };
          return sub;
        };
        sub.then = (res: (v: { error: null }) => unknown) => {
          deletes.push(d);
          return Promise.resolve({ error: null }).then(res);
        };
        return sub;
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
jest.mock("@/lib/workboard/projects-query", () => ({
  staffIdFor: async () => "staff-me",
}));

import {
  addPackingItem,
  assignVisitTech,
  clearVisitPlacement,
  completeVisit,
  createAgreement,
  createCategory,
  createTag,
  linkVisitJob,
  placeVisit,
  setAgreementCategory,
  setVisitPacked,
  setVisitReadiness,
  setVisitStatus,
  tagAgreement,
  updateAgreementSchedule,
} from "../workboard-maintenance";
import { CATEGORY_ACCENTS, tagToneFor } from "@/lib/workboard/tags";
import { todayInZone } from "@/lib/workboard/dates";

const TODAY = todayInZone("Australia/Brisbane");

beforeEach(() => {
  inserts.length = 0;
  updates.length = 0;
  upserts.length = 0;
  deletes.length = 0;
  rows = {};
  counts = {};
  insertFails = new Set();
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

describe("setVisitReadiness — the tick tier, two-gate whitelist", () => {
  beforeEach(() => {
    rows.maintenance_visits = {
      id: "v-1",
      agreement_id: "a-1",
      status: "upcoming",
      readiness: { access_confirmed: true, junk_key: true, parts_ready: true },
    };
  });

  it("works with only `workboard`, and rebuilds the jsonb from the whitelist", async () => {
    caps = new Set(["workboard"]);
    const res = await setVisitReadiness("v-1", "equipment_ready", true);
    expect(res.ok).toBe(true);
    // stored object: whitelist keys only, true-only — junk AND legacy keys
    // are gone; the next tick after the migration completes the cutover
    expect(updates[0].patch.readiness).toEqual({ access_confirmed: true, equipment_ready: true });
  });

  it("kills junk keys at the door — including the retired legacy keys", async () => {
    for (const key of ["vibes_confirmed", "parts_ready", "time_confirmed", "customer_notified"]) {
      const res = await setVisitReadiness("v-1", key, true);
      expect(res.ok).toBe(false);
    }
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

describe("createAgreement — the L2 fields arrive validated", () => {
  const input = {
    label: "Warehouse quarterly",
    clientName: "Acme",
    intervalMonths: 3,
    anchorDate: "2026-08-01",
  };

  it("stores capacity, contact and estimate; capacity defaults to one tech", async () => {
    await createAgreement({
      ...input,
      billingContact: "  accounts@acme.com ",
      techsNeeded: 2,
      hoursEstimate: 3.25,
    });
    expect(inserts[0].payload).toMatchObject({
      billing_contact: "accounts@acme.com",
      techs_needed: 2,
      hours_estimate: 3.3,
    });

    inserts.length = 0;
    await createAgreement(input);
    expect(inserts[0].payload).toMatchObject({ techs_needed: 1, hours_estimate: null });
  });

  it("refuses out-of-range capacity and nonsense hours before any write", async () => {
    expect((await createAgreement({ ...input, techsNeeded: 0 })).ok).toBe(false);
    expect((await createAgreement({ ...input, techsNeeded: 7 })).ok).toBe(false);
    expect((await createAgreement({ ...input, hoursEstimate: -2 })).ok).toBe(false);
    expect((await createAgreement({ ...input, hoursEstimate: 40 })).ok).toBe(false);
    expect(inserts).toHaveLength(0);
  });

  it("a category id is re-resolved inside the org", async () => {
    expect((await createAgreement({ ...input, categoryId: "cat-foreign" })).ok).toBe(false);
    expect(inserts).toHaveLength(0);

    rows.agreement_categories = { id: "cat-1" };
    await createAgreement({ ...input, categoryId: "cat-1" });
    expect(inserts[0].payload).toMatchObject({ category_id: "cat-1" });
  });
});

describe("completeVisit — the close-out (K1)", () => {
  beforeEach(() => {
    rows.maintenance_visits = { id: "v-1", agreement_id: "a-1", status: "booked", readiness: {} };
  });

  it("stamps the run date, actuals and the technician's note, then tops the horizon up", async () => {
    const res = await completeVisit("v-1", {
      ranOn: "2026-07-29",
      actualHours: 3.25,
      note: "  Belts swapped, filters done. ",
    });
    expect(res).toEqual({ ok: true });
    expect(updates[0].patch).toEqual({
      status: "done",
      completed_at: "2026-07-29",
      completed_source: "manual",
      actual_hours: 3.3,
      completion_note: "Belts swapped, filters done.",
    });
    // the loop closes: the next visit exists the moment this one is history
    expect(ensureVisits).toHaveBeenCalledWith("org-1", { agreementId: "a-1" });
  });

  it("defaults the run date to today on the account's clock", async () => {
    await completeVisit("v-1", {});
    expect(updates[0].patch.completed_at).toBe(TODAY);
  });

  it("refuses future run dates, junk hours, and closed visits", async () => {
    expect((await completeVisit("v-1", { ranOn: "2099-01-01" })).ok).toBe(false);
    expect((await completeVisit("v-1", { actualHours: 0 })).ok).toBe(false);
    expect((await completeVisit("v-1", { actualHours: 25 })).ok).toBe(false);
    rows.maintenance_visits = { id: "v-1", agreement_id: "a-1", status: "done", readiness: {} };
    expect((await completeVisit("v-1", {})).ok).toBe(false);
    expect(updates).toHaveLength(0);
    expect(ensureVisits).not.toHaveBeenCalled();
  });

  it("is manage-tier", async () => {
    caps = new Set(["workboard"]);
    expect((await completeVisit("v-1", {})).ok).toBe(false);
  });
});

describe("placement — time_confirmed's successor (D1)", () => {
  beforeEach(() => {
    rows.maintenance_visits = {
      id: "v-1",
      agreement_id: "a-1",
      status: "upcoming",
      readiness: {},
      remote_id: null,
      job_number: null,
    };
  });

  it("placing books the visit onto the day", async () => {
    const res = await placeVisit("v-1", "2026-08-05");
    expect(res.ok).toBe(true);
    expect(updates[0].patch).toEqual({ booked_date: "2026-08-05", status: "booked" });
  });

  it("weekend placement is allowed on purpose (B9's deliberate half)", async () => {
    const res = await placeVisit("v-1", "2026-08-01"); // a Saturday
    expect(res.ok).toBe(true);
    expect(updates[0].patch.booked_date).toBe("2026-08-01");
  });

  it("re-placing a booked visit moves the day without touching status", async () => {
    rows.maintenance_visits = { ...rows.maintenance_visits!, status: "booked" };
    await placeVisit("v-1", "2026-08-06");
    expect(updates[0].patch).toEqual({ booked_date: "2026-08-06" });
  });

  it("closed visits and junk dates are refused", async () => {
    expect((await placeVisit("v-1", "someday")).ok).toBe(false);
    rows.maintenance_visits = { ...rows.maintenance_visits!, status: "done" };
    expect((await placeVisit("v-1", "2026-08-05")).ok).toBe(false);
    expect(updates).toHaveLength(0);
  });

  it("clearing returns an unlinked visit to upcoming; a linked one stays booked", async () => {
    rows.maintenance_visits = { ...rows.maintenance_visits!, status: "booked", booked_date: "2026-08-05" };
    await clearVisitPlacement("v-1");
    expect(updates[0].patch).toEqual({ booked_date: null, status: "upcoming" });

    updates.length = 0;
    rows.maintenance_visits = { ...rows.maintenance_visits!, remote_id: "j-1" };
    await clearVisitPlacement("v-1");
    expect(updates[0].patch).toEqual({ booked_date: null });
  });
});

describe("technicians — the Crew gate's substance (D2)", () => {
  beforeEach(() => {
    rows.maintenance_visits = { id: "v-1", agreement_id: "a-1", status: "upcoming", readiness: {} };
  });

  it("assignment re-resolves the person inside the org, then upserts once", async () => {
    rows.staff_profiles = { id: "staff-9" };
    const res = await assignVisitTech("v-1", "staff-9");
    expect(res.ok).toBe(true);
    expect(upserts[0]).toMatchObject({
      table: "maintenance_visit_techs",
      payload: { org_id: "org-1", visit_id: "v-1", staff_profile_id: "staff-9" },
    });
  });

  it("a stranger to the org is refused; closed visits are refused; manage-tier", async () => {
    rows.staff_profiles = null;
    expect((await assignVisitTech("v-1", "staff-x")).ok).toBe(false);

    rows.staff_profiles = { id: "staff-9" };
    rows.maintenance_visits = { id: "v-1", agreement_id: "a-1", status: "done", readiness: {} };
    expect((await assignVisitTech("v-1", "staff-9")).ok).toBe(false);

    caps = new Set(["workboard"]);
    expect((await assignVisitTech("v-1", "staff-9")).ok).toBe(false);
    expect(upserts).toHaveLength(0);
  });
});

describe("packing — the agreement owns the list, the visit owns the ticks (D5)", () => {
  beforeEach(() => {
    rows.maintenance_visits = { id: "v-1", agreement_id: "a-1", status: "upcoming", readiness: {} };
    rows.agreement_packing_items = { id: "item-1", agreement_id: "a-1" };
  });

  it("an empty label never reaches the list", async () => {
    rows.maintenance_agreements = { id: "a-1" };
    expect((await addPackingItem("a-1", "   ")).ok).toBe(false);
    expect(inserts).toHaveLength(0);
  });

  it("ticking is the workboard tier and records who packed it", async () => {
    caps = new Set(["workboard"]);
    const res = await setVisitPacked("v-1", "item-1", true);
    expect(res.ok).toBe(true);
    expect(upserts[0]).toMatchObject({
      table: "maintenance_visit_packed",
      payload: { visit_id: "v-1", item_id: "item-1", packed_by: "staff-me" },
    });
  });

  it("unticking deletes the row", async () => {
    await setVisitPacked("v-1", "item-1", false);
    expect(deletes[0]).toMatchObject({
      table: "maintenance_visit_packed",
      filters: { org_id: "org-1", visit_id: "v-1", item_id: "item-1" },
    });
  });

  it("an item from another agreement's list is refused — B13 stays dead", async () => {
    rows.agreement_packing_items = { id: "item-1", agreement_id: "a-OTHER" };
    const res = await setVisitPacked("v-1", "item-1", true);
    expect(res.ok).toBe(false);
    expect(upserts).toHaveLength(0);
  });
});

describe("categories and tags — identity decided at creation (D10, B2)", () => {
  it("a category is born with the next accent in the rotation, stored", async () => {
    counts.agreement_categories = 2;
    const res = await createCategory("Retail sites");
    expect(res.ok).toBe(true);
    expect(inserts[0].payload).toMatchObject({
      name: "Retail sites",
      accent: CATEGORY_ACCENTS[2],
    });
  });

  it("an empty category name is refused (B16), a duplicate is a kind error", async () => {
    expect((await createCategory("  ")).ok).toBe(false);
    insertFails = new Set(["agreement_categories"]);
    const res = await createCategory("Retail sites");
    expect(res.ok).toBe(false);
  });

  it("a tag's colour is the pure function of its name, stored once", async () => {
    const res = await createTag("Our install");
    expect(res.ok).toBe(true);
    expect(inserts[0].payload).toMatchObject({
      name: "Our install",
      color: tagToneFor("Our install"),
    });
  });

  it("tagging re-resolves the tag inside the org", async () => {
    rows.maintenance_agreements = { id: "a-1" };
    rows.agreement_tags = null;
    expect((await tagAgreement("a-1", "t-x")).ok).toBe(false);

    rows.agreement_tags = { id: "t-1" };
    const res = await tagAgreement("a-1", "t-1");
    expect(res.ok).toBe(true);
    expect(upserts[0]).toMatchObject({
      table: "agreement_tag_links",
      payload: { agreement_id: "a-1", tag_id: "t-1" },
    });
  });

  it("moving an agreement is explicit — a null clears, a foreign category refuses (B17)", async () => {
    rows.maintenance_agreements = { id: "a-1" };
    rows.agreement_categories = null;
    expect((await setAgreementCategory("a-1", "cat-x")).ok).toBe(false);

    const res = await setAgreementCategory("a-1", null);
    expect(res.ok).toBe(true);
    expect(updates[0].patch).toMatchObject({ category_id: null });
  });
});
