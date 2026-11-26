/* SET SCALE'S DOORS (app/actions/job-plans.ts). A server action is reachable
   by direct POST, so each one checks for itself: the job card's is behind
   `workboard`, the Studio's behind `studio`, and what's typed is checked
   before the plan is touched. */

let session: { orgId?: string; user?: { sub: string } } | null = { orgId: "org-1", user: { sub: "auth0|u1" } };
let permissions: Record<string, boolean> = {};

jest.mock("@/lib/auth0", () => ({ auth0: { getSession: async () => session } }));
jest.mock("@/lib/permissions-server", () => ({ can: async (cap: string) => permissions[cap] !== false }));
jest.mock("@/lib/fleet/query", () => ({ staffProfileIdFor: async () => "staff-1" }));

const setPlanScale = jest.fn(async (..._args: unknown[]) => null as string | null);
const choosePlanFloors = jest.fn(async (..._args: unknown[]) => null as string | null);
const planPageForScale = jest.fn(async (..._args: unknown[]) => ({ url: "https://x/p.png", width: 2000, height: 1200, at: null }));
const planPagesToView = jest.fn(async (..._args: unknown[]) => [{ n: 3, url: "https://x/p3.png", width: 2400, height: 1697 }]);
jest.mock("@/lib/jobs/plans-server", () => ({
  addJobPlans: jest.fn(),
  readJobPlans: jest.fn(),
  setPlanScale: (...args: unknown[]) => setPlanScale(...args),
  planPageForScale: (...args: unknown[]) => planPageForScale(...args),
  planPagesToView: (...args: unknown[]) => planPagesToView(...args),
  choosePlanFloors: (...args: unknown[]) => choosePlanFloors(...args),
}));

import { chooseFloorsOnPlan, pageForScale, pagesToView, savePlanScaleFromDesign, setScaleOnPlan } from "../job-plans";

const a = { x: 200, y: 600 };
const b = { x: 944, y: 600 };

beforeEach(() => {
  session = { orgId: "org-1", user: { sub: "auth0|u1" } };
  permissions = {};
  setPlanScale.mockClear();
  planPageForScale.mockClear();
  choosePlanFloors.mockClear();
});

/* bug 119: a plan's pages, big, read in the caller's own org behind `workboard` */
describe("a plan's pages to look at", () => {
  it("reads them in the caller's own org, and nothing without `workboard` or a session", async () => {
    expect(await pagesToView("job-1", "jplan_1")).toEqual([{ n: 3, url: "https://x/p3.png", width: 2400, height: 1697 }]);
    expect(planPagesToView).toHaveBeenCalledWith("org-1", "job-1", "jplan_1");
    planPagesToView.mockClear();
    permissions = { workboard: false };
    expect(await pagesToView("job-1", "jplan_1")).toBeNull();
    session = null;
    permissions = {};
    expect(await pagesToView("job-1", "jplan_1")).toBeNull();
    expect(planPagesToView).not.toHaveBeenCalled();
  });
});

describe("Set scale from the job card", () => {
  it("saves the two points and the length on the caller's own org's plan, as them", async () => {
    expect(await setScaleOnPlan("job-1", "jplan_1", 1, a, b, 7440)).toBeNull();
    expect(setPlanScale).toHaveBeenCalledWith("org-1", "jplan_1", 1, { a, b, mm: 7440 }, "staff-1", "job-1");
  });

  it("refuses without `workboard`, or signed out, before touching the plan", async () => {
    permissions = { workboard: false };
    expect(await setScaleOnPlan("job-1", "jplan_1", 1, a, b, 7440)).toBe("You can't set a plan's scale.");
    expect(await pageForScale("job-1", "jplan_1", 1)).toBeNull();
    session = null;
    permissions = {};
    expect(await setScaleOnPlan("job-1", "jplan_1", 1, a, b, 7440)).toBe("You can't set a plan's scale.");
    expect(setPlanScale).not.toHaveBeenCalled();
    expect(planPageForScale).not.toHaveBeenCalled();
  });

  it("asks for the two ends and a length that could be one", async () => {
    expect(await setScaleOnPlan("job-1", "jplan_1", 1, a, { x: Number.NaN, y: 0 }, 7440)).toBe("Press the two ends of a length first.");
    expect(await setScaleOnPlan("job-1", "jplan_1", 1, a, b, 0)).toBe("Type the length between the two points, in millimetres.");
    expect(await setScaleOnPlan("job-1", "jplan_1", 1, a, b, 9_000_000)).toBe("Type the length between the two points, in millimetres.");
    expect(setPlanScale).not.toHaveBeenCalled();
  });

  it("opens the page's picture for the caller's org and job", async () => {
    expect(await pageForScale("job-1", "jplan_1", 1)).toMatchObject({ width: 2000 });
    expect(planPageForScale).toHaveBeenCalledWith("org-1", "job-1", "jplan_1", 1);
  });
});

describe("a scale measured in a design", () => {
  it("goes onto the plan's page behind `studio`", async () => {
    expect(await savePlanScaleFromDesign("jplan_1", 3, 21.3)).toBeNull();
    expect(setPlanScale).toHaveBeenCalledWith("org-1", "jplan_1", 3, { mmPerPx: 21.3 }, "staff-1");
  });

  it("refuses without `studio`, and a scale that isn't one", async () => {
    expect(await savePlanScaleFromDesign("jplan_1", 3, 0)).toBe("That scale can't be used.");
    permissions = { studio: false };
    expect(await savePlanScaleFromDesign("jplan_1", 3, 21.3)).toBe("You can't set a plan's scale.");
    expect(setPlanScale).not.toHaveBeenCalled();
  });
});

describe("Choose floors", () => {
  it("saves a level or Not a floor plan by page on the caller's org's plan, as them, and drops anything else", async () => {
    expect(await chooseFloorsOnPlan("job-1", "jplan_1", { 3: "0", 4: "none", 5: "Level 9", 0: "1", 6: "-1" } as Record<number, string>)).toBeNull();
    expect(choosePlanFloors).toHaveBeenCalledWith("org-1", "jplan_1", { 3: "0", 4: "none", 6: "-1" }, "staff-1", "job-1");
  });

  it("refuses without `workboard`, before touching the plan", async () => {
    permissions = { workboard: false };
    expect(await chooseFloorsOnPlan("job-1", "jplan_1", { 3: "0" })).toBe("You can't change a plan's floors.");
    expect(choosePlanFloors).not.toHaveBeenCalled();
  });
});
