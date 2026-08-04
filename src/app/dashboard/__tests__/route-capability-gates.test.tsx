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
jest.mock("@/components/tiff/assistant", () => ({ TiffAssistant: () => null }));
jest.mock("@/lib/tiff/query", () => ({
  kbDocsForOrg: jest.fn(async () => []),
  kbUploaderNames: jest.fn(async () => ({})),
  kbCategoryCounts: jest.fn(async () => ({ install: 3, faults: 2, specs: 0, sops: 0 })),
}));
jest.mock("@/lib/tiff/quota", () => ({
  kbQuotaFor: jest.fn(async () => ({
    plan: "standard",
    month: "2026-08-01",
    pagesUsed: 0,
    questionsAsked: 0,
    pagesAllowed: 2000,
    pagesRemaining: 2000,
    resetsOn: "2026-09-01",
  })),
}));
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
jest.mock("@/lib/workboard/projects-board-query", () => ({
  loadProjectsBoard: jest.fn(async () => ({ projects: [], visits: [], staff: [] })),
}));
jest.mock("@/components/workboard/maintenance-screen", () => ({ MaintenanceScreen: () => null }));
jest.mock("@/components/workboard/agreement-detail-screen", () => ({
  AgreementDetailScreen: () => null,
}));
jest.mock("@/lib/workboard/maintenance-query", () => ({
  listAgreements: jest.fn(async () => []),
  getAgreementDetail: jest.fn(async () => ({ id: "a-1", equipment: [], open: [], history: [] })),
}));
jest.mock("@/lib/workboard/visit-ensure", () => ({
  ensureVisits: jest.fn(async () => {}),
  autoCompleteVisitsFromMirror: jest.fn(async () => 0),
}));
jest.mock("@/lib/workboard/query", () => ({
  getSm8Timezone: jest.fn(async () => null),
}));
jest.mock("@/lib/workboard/notes-query", () => ({
  listProjectEntries: jest.fn(async () => []),
  listIssues: jest.fn(async () => []),
  listFlags: jest.fn(async () => []),
}));
jest.mock("@/lib/voice/transcribe", () => ({ isTranscriptionConfigured: () => false }));
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
import TiffPage from "../tiff/page";
import KnowledgeBasePage from "../tiff/knowledge/page";
import DataLibraryPage from "../studio/data-library/page";
import WorkboardPage from "../workboard/page";
import WorkboardProjectsPage from "../workboard/projects/page";
import WorkboardProjectPage from "../workboard/projects/[id]/page";
import WorkboardMaintenancePage from "../workboard/maintenance/page";
import WorkboardAgreementPage from "../workboard/maintenance/[id]/page";

const LEAVES: [string, () => Promise<unknown>, string][] = [
  ["toolbox/heat-load", HeatLoadPage, "toolbox"],
  ["toolbox/outdoor-unit", OutdoorUnitPage, "toolbox"],
  ["toolbox/running-pressures", RunningPressuresPage, "toolbox"],
  ["toolbox/troubleshooting", TroubleshootingPage, "toolbox"],
  ["tiff", TiffPage, "tiff"],
  ["tiff/knowledge", KnowledgeBasePage, "tiff"],
  ["workboard", WorkboardPage, "workboard"],
  ["workboard/projects", WorkboardProjectsPage, "workboard"],
  ["workboard/maintenance", WorkboardMaintenancePage, "workboard"],
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

describe("the dynamic leaves check the same door", () => {
  const DYNAMIC: [string, (p: { params: Promise<{ id: string }> }) => Promise<unknown>][] = [
    ["workboard/projects/[id]", WorkboardProjectPage],
    ["workboard/maintenance/[id]", WorkboardAgreementPage],
  ];
  const props = { params: Promise.resolve({ id: "x-1" }) };

  it.each(DYNAMIC)("%s — revoked → straight back to /dashboard", async (_route, Page) => {
    allowed = false;
    await expect(Page(props)).rejects.toThrow("REDIRECT:/dashboard");
    expect(can).toHaveBeenCalledWith("workboard");
  });

  it.each(DYNAMIC)("%s — held → the page renders", async (_route, Page) => {
    allowed = true;
    expect(await Page(props)).toBeTruthy();
    expect(redirect).not.toHaveBeenCalled();
  });
});

/* The knowledge base has a second question after "may you be here": what may
   you DO here. Managing is `tiff_manage` and removing is the owner, decided on
   the server and re-decided by every action — these pin that the page answers
   both, rather than handing the client a blanket yes. */
describe("the knowledge base hands the client what this viewer may do", () => {
  // the page returns the element; its props ARE the answer being handed over
  const propsOf = async (search?: Record<string, string>) => {
    const el = (await KnowledgeBasePage(
      search ? { searchParams: Promise.resolve(search) } : undefined
    )) as { props: Record<string, unknown> };
    return el.props;
  };

  beforeEach(() => {
    allowed = true;
  });

  it("asks for tiff_manage separately from tiff", async () => {
    const props = await propsOf();
    expect(can).toHaveBeenCalledWith("tiff");
    expect(can).toHaveBeenCalledWith("tiff_manage");
    expect(props.canManage).toBe(true);
  });

  it("holds removal back to the owner, whatever the capability says", async () => {
    role = "admin";
    expect((await propsOf()).isOwner).toBe(false);
    role = "owner";
    expect((await propsOf()).isOwner).toBe(true);
  });

  it("opens on the category the URL named, and ignores an invented one", async () => {
    expect((await propsOf({ cat: "faults" })).initialCategory).toBe("faults");
    expect((await propsOf({ cat: "nonsense" })).initialCategory).toBeNull();
    expect((await propsOf()).initialCategory).toBeNull();
  });

  it("nulls the unlimited tier's page ceiling rather than sending Infinity", async () => {
    const props = (await propsOf()).quota as Record<string, unknown>;
    expect(props.pagesAllowed).toBe(2000);
    expect(props).not.toHaveProperty("pagesRemaining");
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
