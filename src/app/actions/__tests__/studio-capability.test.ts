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

function tableChain(result: unknown) {
  const node: Record<string, unknown> = {
    maybeSingle: async () => ({ data: null, error: null }),
    then: (resolve: (v: unknown) => unknown) =>
      Promise.resolve({ data: result, error: null }).then(resolve),
  };
  for (const m of ["select", "eq", "in", "order", "update", "upsert", "delete", "insert"]) {
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
  return tableChain([]);
});

const storageFrom = jest.fn((bucket: string) => {
  studioTouch(`storage:${bucket}`);
  return {
    createSignedUploadUrl: async () => ({ data: { token: "tok" }, error: null }),
    createSignedUrl: async () => ({ data: { signedUrl: "https://signed" }, error: null }),
    remove: async () => ({ error: null }),
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
} from "../studio";
import { createPlanUpload, planImageUrl, deletePlanImage } from "../studio-plans";
import { createShareLink, getShareLink, revokeShareLink } from "../studio-share";
import { listDesignContributors } from "../studio-contributors";
import { loadStudioPack, listStudioPackBrands } from "../studio-packs";

const ACTIONS: [string, () => Promise<unknown>][] = [
  ["listStudioDesigns", () => listStudioDesigns()],
  ["loadStudioDesign", () => loadStudioDesign("d-1")],
  ["saveStudioDesign", () => saveStudioDesign({})],
  ["deleteStudioDesign", () => deleteStudioDesign("d-1")],
  ["searchStudioJobs", () => searchStudioJobs("wallace")],
  ["createPlanUpload", () => createPlanUpload("png")],
  ["planImageUrl", () => planImageUrl("org/org-1/plan.png")],
  ["deletePlanImage", () => deletePlanImage("org/org-1/plan.png")],
  ["createShareLink", () => createShareLink("d-1")],
  ["getShareLink", () => getShareLink("d-1")],
  ["revokeShareLink", () => revokeShareLink("d-1")],
  ["listDesignContributors", () => listDesignContributors("d-1")],
  ["loadStudioPack", () => loadStudioPack("me")],
  ["listStudioPackBrands", () => listStudioPackBrands()],
];

beforeEach(() => {
  studioTouch.mockClear();
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

  it("answers the pack picker", async () => {
    expect(await listStudioPackBrands()).toEqual([]);
    expect(await loadStudioPack("me")).toBeNull();
  });

  it("lists contributors", async () => {
    expect(await listDesignContributors("d-1")).toEqual([]);
  });

  it("reports no share link for an unshared design", async () => {
    expect(await getShareLink("d-1")).toBeNull();
  });
});
