/* Deep-linkable leaf routes carry the same capability gate as their index
   pages — a revoked member typing the URL lands back on /dashboard, exactly
   as if they'd tried the nav entry that is no longer there.

   Also pins the ONE deliberate exception: the studio Data Library stays open
   to any signed-in member (see that page's header comment) — if the decision
   ever changes, this test is the tripwire, not a silent drift. */

let allowed = false;
const can = jest.fn(async (_capability: string) => allowed);
const redirect = jest.fn((to: string): never => {
  throw new Error(`REDIRECT:${to}`);
});

jest.mock("@/lib/permissions-server", () => ({ can: (c: string) => can(c) }));
jest.mock("next/navigation", () => ({ redirect: (to: string) => redirect(to) }));

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

import HeatLoadPage from "../toolbox/heat-load/page";
import OutdoorUnitPage from "../toolbox/outdoor-unit/page";
import RunningPressuresPage from "../toolbox/running-pressures/page";
import TroubleshootingPage from "../toolbox/troubleshooting/page";
import KnowledgeBasePage from "../tiff/knowledge/page";
import DataLibraryPage from "../studio/data-library/page";

const LEAVES: [string, () => Promise<unknown>, string][] = [
  ["toolbox/heat-load", HeatLoadPage, "toolbox"],
  ["toolbox/outdoor-unit", OutdoorUnitPage, "toolbox"],
  ["toolbox/running-pressures", RunningPressuresPage, "toolbox"],
  ["toolbox/troubleshooting", TroubleshootingPage, "toolbox"],
  ["tiff/knowledge", KnowledgeBasePage, "tiff"],
];

beforeEach(() => {
  can.mockClear();
  redirect.mockClear();
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

describe("the deliberate exception", () => {
  it("the Data Library renders for a member with nothing granted — pinned on purpose", async () => {
    allowed = false;
    expect(await DataLibraryPage()).toBeTruthy();
    expect(can).not.toHaveBeenCalled();
    expect(redirect).not.toHaveBeenCalled();
  });
});
