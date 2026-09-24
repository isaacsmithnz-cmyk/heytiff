/* ⌘K's one round trip (2026-09-24): staff, clients, projects and jobs, each
   group answering under its own grant — the staff under `team`, where the
   staff card opens, and the work under `workboard`, where all of it opens. */

let caps = new Set<string>();
jest.mock("@/lib/permissions-server", () => ({ can: async (c: string) => caps.has(c) }));
const getSession = jest.fn();
jest.mock("@/lib/auth0", () => ({ auth0: { getSession: () => getSession() } }));
jest.mock("@/lib/workboard/query", () => ({ getSm8Timezone: async () => "Australia/Sydney" }));

const searchAllMirrorJobs = jest.fn(async () => [{ remoteId: "j-1" }]);
jest.mock("@/lib/workboard/all-jobs-query", () => ({
  searchAllMirrorJobs: (...a: unknown[]) => searchAllMirrorJobs(...(a as [])),
}));
const searchStaff = jest.fn(async () => [{ id: "s-1", name: "Robert Smith" }]);
const searchClients = jest.fn(async () => [{ uuid: "c-1", name: "Kingsford Bakery" }]);
const searchProjects = jest.fn(async () => [{ id: "p-9", name: "Kingsford fitout" }]);
jest.mock("@/lib/workboard/palette-query", () => ({
  searchStaff: (...a: unknown[]) => searchStaff(...(a as [])),
  searchClients: (...a: unknown[]) => searchClients(...(a as [])),
  searchProjects: (...a: unknown[]) => searchProjects(...(a as [])),
}));

const searchPhotos = jest.fn(async () => ({
  ok: true,
  hits: [{ remoteId: "ph-1" }],
  banked: 12,
  capped: false,
}));
jest.mock("../photo-search", () => ({
  searchPhotos: (...a: unknown[]) => searchPhotos(...(a as [])),
}));

import { searchPalette } from "../palette";

const NONE = { staff: [], clients: [], projects: [], jobs: [], photos: [] };

beforeEach(() => {
  caps = new Set(["team", "workboard"]);
  getSession.mockResolvedValue({ user: { sub: "auth0|me" }, orgId: "org-1" });
  for (const f of [searchAllMirrorJobs, searchStaff, searchClients, searchProjects, searchPhotos]) {
    f.mockClear();
  }
});

describe("searchPalette", () => {
  it("asks every group for this org, and never for money", async () => {
    caps = new Set(["team", "workboard", "workboard_money"]);
    expect(await searchPalette("kingsford")).toEqual({
      staff: [{ id: "s-1", name: "Robert Smith" }],
      clients: [{ uuid: "c-1", name: "Kingsford Bakery" }],
      projects: [{ id: "p-9", name: "Kingsford fitout" }],
      jobs: [{ remoteId: "j-1" }],
      photos: [{ remoteId: "ph-1" }],
    });
    // a handful of photos — the palette is a list to choose from
    expect(searchPhotos).toHaveBeenCalledWith("kingsford", 6);
    expect(searchStaff).toHaveBeenCalledWith("org-1", "kingsford");
    expect(searchClients).toHaveBeenCalledWith("org-1", "kingsford");
    expect(searchProjects).toHaveBeenCalledWith("org-1", "kingsford");
    // the palette shows no money, so even a reader who holds it is not sent any
    expect(searchAllMirrorJobs).toHaveBeenCalledWith("org-1", "kingsford", expect.any(String), {
      includeMoney: false,
    });
  });

  it("gives the staff only to whoever holds team", async () => {
    caps = new Set(["workboard"]);
    const found = await searchPalette("smith");
    expect(found.staff).toEqual([]);
    expect(found.jobs).toHaveLength(1);
    expect(searchStaff).not.toHaveBeenCalled();
  });

  it("gives the work only to whoever can open the Workboard", async () => {
    caps = new Set(["team"]);
    const found = await searchPalette("smith");
    expect(found).toEqual({ ...NONE, staff: [{ id: "s-1", name: "Robert Smith" }] });
    expect(searchClients).not.toHaveBeenCalled();
    expect(searchProjects).not.toHaveBeenCalled();
    expect(searchAllMirrorJobs).not.toHaveBeenCalled();
    expect(searchPhotos).not.toHaveBeenCalled();
  });

  it("asks nothing for someone holding neither, or signed out", async () => {
    caps = new Set();
    expect(await searchPalette("smith")).toEqual(NONE);
    caps = new Set(["team", "workboard"]);
    getSession.mockResolvedValue(null);
    expect(await searchPalette("smith")).toEqual(NONE);
    expect(searchStaff).not.toHaveBeenCalled();
    expect(searchAllMirrorJobs).not.toHaveBeenCalled();
  });

  it("asks nothing for a single character", async () => {
    expect(await searchPalette(" k ")).toEqual(NONE);
    expect(searchStaff).not.toHaveBeenCalled();
    expect(searchClients).not.toHaveBeenCalled();
  });
});
