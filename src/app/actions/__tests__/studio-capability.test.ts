/* Every studio server action refuses a caller whose `studio` capability has
   been revoked — the integration audit found they checked only the session,
   so a member with studio switched off could still POST all of them
   (createShareLink worst of all: it mints a PUBLIC unauthenticated
   /live/[token] URL).

   The gate is requireOrg("studio") → the REAL can() reading the membership
   row, so these tests mock only the session and the database, and flip the
   stored override to flip the verdict. */

let permissions: Record<string, boolean> = {};
const studioTouch = jest.fn(); // any read/write of a studio table or bucket
let jobPlans: unknown[] = []; // the job_plans rows a stored file is found on
const removed = jest.fn(); // what storage was asked to delete

function tableChain(result: unknown) {
  const node: Record<string, unknown> = {
    maybeSingle: async () => ({ data: null, error: null }),
    then: (resolve: (v: unknown) => unknown) =>
      Promise.resolve({ data: result, error: null }).then(resolve),
  };
  for (const m of ["select", "eq", "in", "not", "order", "range", "limit", "contains", "update", "upsert", "delete", "insert"]) {
    node[m] = () => node;
  }
  return node;
}

const from = jest.fn((table: string) => {
  if (table === "memberships") {
    const node: Record<string, unknown> = {
      maybeSingle: async () => ({ data: { role: "staff", permissions }, error: null }),
    };
    node.select = () => node;
    node.eq = () => node;
    return node;
  }
  if (table === "organizations") {
    const node: Record<string, unknown> = {
      maybeSingle: async () => ({
        data: { primary_owner_user_id: "auth0|owner", trading_name: null, logo_url: null },
        error: null,
      }),
    };
    node.select = () => node;
    node.eq = () => node;
    return node;
  }
  // a studio table — record the touch and serve an empty, error-free result
  studioTouch(table);
  return tableChain(table === "job_plans" ? jobPlans : []);
});

const storageFrom = jest.fn((bucket: string) => {
  studioTouch(`storage:${bucket}`);
  return {
    createSignedUploadUrl: async () => ({ data: { token: "tok" }, error: null }),
    createSignedUrl: async () => ({ data: { signedUrl: "https://signed" }, error: null }),
    remove: async (refs: string[]) => (removed(refs), { error: null }),
  };
});

jest.mock("@/lib/supabase-server", () => ({
  supabaseAdmin: {
    from: (...a: unknown[]) => from(...(a as [string])),
    storage: { from: (...a: unknown[]) => storageFrom(...(a as [string])) },
  },
}));
jest.mock("@/lib/auth0", () => ({
  auth0: {
    getSession: jest.fn(async () => ({ user: { sub: "auth0|u1" }, orgId: "org-1" })),
  },
}));
// packs read the server's disk — stubbed, the gate is what's under test here
jest.mock("@/lib/studio/packs/server", () => ({
  installedPacks: jest.fn(async () => []),
  latestInstalledPack: jest.fn(async () => null),
}));
jest.mock("@/lib/studio/packs/overrides-server", () => ({
  loadPackWithOverrides: jest.fn(async () => ({ pack: {} })),
}));

import {
  listStudioDesigns,
  loadStudioDesign,
  saveStudioDesign,
  deleteStudioDesign,
  searchStudioJobs,
  readStudioJobs,
  listStudioJobs,
} from "../studio";
import { createPlanUpload, planImageUrl, deletePlanImage } from "../studio-plans";
import { createShareLink, getShareLink, revokeShareLink } from "../studio-share";
import { listDesignContributors } from "../studio-contributors";
import { loadStudioPack } from "../studio-packs";

const ACTIONS: [string, () => Promise<unknown>][] = [
  ["listStudioDesigns", () => listStudioDesigns()],
  ["loadStudioDesign", () => loadStudioDesign("d-1")],
  ["saveStudioDesign", () => saveStudioDesign({})],
  ["deleteStudioDesign", () => deleteStudioDesign("d-1")],
  ["searchStudioJobs", () => searchStudioJobs("wallace")],
  ["readStudioJobs", () => readStudioJobs(["j-1"])],
  ["listStudioJobs", () => listStudioJobs(0, 6)],
  ["createPlanUpload", () => createPlanUpload("png")],
  ["planImageUrl", () => planImageUrl("org/org-1/plan.png")],
  ["deletePlanImage", () => deletePlanImage("org/org-1/plan.png")],
  ["createShareLink", () => createShareLink("d-1")],
  ["getShareLink", () => getShareLink("d-1")],
  ["revokeShareLink", () => revokeShareLink("d-1")],
  ["listDesignContributors", () => listDesignContributors("d-1")],
  ["loadStudioPack", () => loadStudioPack("me")],
];

beforeEach(() => {
  studioTouch.mockClear();
  removed.mockClear();
  jobPlans = [];
});

describe("with `studio` revoked, every studio action refuses before touching data", () => {
  beforeEach(() => {
    permissions = { studio: false };
  });

  it.each(ACTIONS)("%s", async (_name, act) => {
    await expect(act()).rejects.toThrow("Insufficient permissions");
    expect(studioTouch).not.toHaveBeenCalled();
  });
});

describe("with `studio` held (the staff default), the same doors open", () => {
  beforeEach(() => {
    permissions = {};
  });

  it("lists designs", async () => {
    expect(await listStudioDesigns()).toEqual([]);
    expect(studioTouch).toHaveBeenCalledWith("studio_designs");
  });

  it("hands out a plan-upload slot scoped to the caller's org", async () => {
    const slot = await createPlanUpload("png");
    expect(slot.token).toBe("tok");
    expect(slot.ref.startsWith("org/org-1/")).toBe(true);
  });

  /* A design made from a job's plans shows the job's own pages. Deleting a
     floor there, or closing a dialog, asked storage to delete the page, and
     the job's Plans lost its picture (found 14 November 2026). */
  it("deletes a plan picture that is the design's own", async () => {
    await deletePlanImage("org/org-1/plan.png");
    expect(studioTouch).toHaveBeenCalledWith("job_plans");
    expect(removed).toHaveBeenCalledWith(["org/org-1/plan.png"]);
  });

  it("leaves a job's plan in storage, and says nothing is wrong", async () => {
    jobPlans = [{ id: "jplan_1" }];
    await expect(deletePlanImage("org/org-1/plan.png")).resolves.toBeUndefined();
    expect(removed).not.toHaveBeenCalled();
  });

  it("New design's jobs are empty for someone without the Workboard", async () => {
    permissions = { workboard: false };
    expect(await readStudioJobs(["j-1"])).toEqual([]);
    expect(await listStudioJobs(0, 6)).toEqual([]);
    expect(studioTouch).not.toHaveBeenCalledWith("sm8_jobs");
  });

  it("answers the pack picker", async () => {
    expect(await loadStudioPack("me")).toBeNull();
  });

  it("lists contributors", async () => {
    expect(await listDesignContributors("d-1")).toEqual([]);
  });

  it("reports no share link for an unshared design", async () => {
    expect(await getShareLink("d-1")).toBeNull();
  });
});
