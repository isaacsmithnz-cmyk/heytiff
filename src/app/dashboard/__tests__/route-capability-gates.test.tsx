/* Deep-linkable leaf routes carry the same capability gate as their index
   pages — a revoked member typing the URL lands back on /dashboard, exactly
   as if they'd tried the nav entry that is no longer there.

   The studio Data Library is the one that isn't capability-gated: it is
   admin+, role-intrinsic like the Admin section (Isaac, 2026-07-26). Its
   tests live here too, because "which door does this URL check?" is the
   question this file exists to answer. */

let allowed = false;
let role: string | null = "staff";
const can = jest.fn<Promise<boolean>, [capability: string]>(async () => allowed);
const getDbRole = jest.fn(async () => role);
const redirect = jest.fn((to: string): never => {
  throw new Error(`REDIRECT:${to}`);
});

jest.mock("@/lib/permissions-server", () => ({
  can: (c: string) => can(c),
  getDbRole: () => getDbRole(),
}));
jest.mock("next/navigation", () => ({
  redirect: (to: string) => redirect(to),
  notFound: (): never => {
    throw new Error("NOT_FOUND");
  },
}));

/* the leaves' bodies are client components with suites of their own — the
   gate is what's under test, so they render to nothing here */
jest.mock("@/components/toolbox/tool-page", () => ({ ToolPage: () => null }));
jest.mock("@/components/toolbox/heat-load", () => ({ HeatLoadCalculator: () => null }));
jest.mock("@/components/toolbox/outdoor-unit", () => ({ OutdoorUnit: () => null }));
jest.mock("@/components/toolbox/running-pressures", () => ({ RunningPressures: () => null }));
jest.mock("@/components/toolbox/fault-finder", () => ({ FaultFinder: () => null }));
jest.mock("@/components/tiff/knowledge", () => ({ KnowledgeBase: () => null }));
jest.mock("@/components/studio/data-library", () => ({ DataLibrary: () => null }));
jest.mock("@/lib/studio/packs/server", () => ({ installedPacks: jest.fn(async () => []) }));
jest.mock("@/lib/studio/packs/overrides-server", () => ({ loadPackWithOverrides: jest.fn() }));
jest.mock("@/components/workboard/overview-screen", () => ({ OverviewScreen: () => null }));
jest.mock("@/lib/workboard/page-data", () => ({
  loadWorkboardPage: jest.fn(async () => ({ manage: false, connection: "none" })),
}));
jest.mock("@/components/workboard/projects-screen", () => ({ ProjectsScreen: () => null }));
jest.mock("@/components/workboard/project-detail-screen", () => ({
  ProjectDetailScreen: () => null,
}));
jest.mock("@/lib/workboard/projects-query", () => ({
  listProjects: jest.fn(async () => []),
  getProjectDetail: jest.fn(async () => ({ id: "p-1", jobs: [], checklist: [], equipment: [] })),
}));
jest.mock("@/lib/integrations/store", () => ({
  getConnectionView: jest.fn(async () => null),
}));
jest.mock("@/lib/auth0", () => ({
  auth0: { getSession: jest.fn(async () => ({ user: { sub: "auth0|me" }, orgId: "org-1" })) },
}));

import HeatLoadPage from "../toolbox/heat-load/page";
import OutdoorUnitPage from "../toolbox/outdoor-unit/page";
import RunningPressuresPage from "../toolbox/running-pressures/page";
import TroubleshootingPage from "../toolbox/troubleshooting/page";
import KnowledgeBasePage from "../tiff/knowledge/page";
import DataLibraryPage from "../studio/data-library/page";
import WorkboardPage from "../workboard/page";
import WorkboardProjectsPage from "../workboard/projects/page";
import WorkboardProjectPage from "../workboard/projects/[id]/page";

const LEAVES: [string, () => Promise<unknown>, string][] = [
  ["toolbox/heat-load", HeatLoadPage, "toolbox"],
  ["toolbox/outdoor-unit", OutdoorUnitPage, "toolbox"],
  ["toolbox/running-pressures", RunningPressuresPage, "toolbox"],
  ["toolbox/troubleshooting", TroubleshootingPage, "toolbox"],
  ["tiff/knowledge", KnowledgeBasePage, "tiff"],
  ["workboard", WorkboardPage, "workboard"],
  ["workboard/projects", WorkboardProjectsPage, "workboard"],
];

beforeEach(() => {
  can.mockClear();
  redirect.mockClear();
  role = "staff";
});

describe("revoked → straight back to /dashboard", () => {
  it.each(LEAVES)("%s", async (_route, Page, capability) => {
    allowed = false;
    await expect(Page()).rejects.toThrow("REDIRECT:/dashboard");
    expect(can).toHaveBeenCalledWith(capability);
  });
});

describe("held → the page renders", () => {
  it.each(LEAVES)("%s", async (_route, Page) => {
    allowed = true;
    expect(await Page()).toBeTruthy();
    expect(redirect).not.toHaveBeenCalled();
  });
});

describe("workboard/projects/[id] — the dynamic leaf checks the same door", () => {
  const props = { params: Promise.resolve({ id: "p-1" }) };

  it("revoked → straight back to /dashboard", async () => {
    allowed = false;
    await expect(WorkboardProjectPage(props)).rejects.toThrow("REDIRECT:/dashboard");
    expect(can).toHaveBeenCalledWith("workboard");
  });

  it("held → the page renders", async () => {
    allowed = true;
    expect(await WorkboardProjectPage(props)).toBeTruthy();
    expect(redirect).not.toHaveBeenCalled();
  });
});

describe("the Data Library is admin+, by role and not by capability", () => {
  it.each(["admin", "owner"])("renders for %s", async (r) => {
    role = r;
    expect(await DataLibraryPage()).toBeTruthy();
    expect(redirect).not.toHaveBeenCalled();
  });

  it("turns staff away even holding every capability there is", async () => {
    // the point of role-intrinsic: no grant buys a way in
    role = "staff";
    allowed = true;
    await expect(DataLibraryPage()).rejects.toThrow("REDIRECT:/dashboard");
  });

  it("fails closed when there's no membership to read a role from", async () => {
    role = null;
    await expect(DataLibraryPage()).rejects.toThrow("REDIRECT:/dashboard");
  });
});
