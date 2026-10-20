/* The two pages the doors land on read their own address: `?v=` and
   `?screen=` on Assets (now only to send them on), `?visit=` on the Workboard. What the screens do with
   a link is pinned beside them (vehicle-link.test.tsx, overview-screen); this
   pins what each PAGE hands over, which is the half a screen test wiring its
   own props can never see break. */

const redirect = jest.fn((to: string) => {
  throw new Error(`REDIRECT:${to}`);
});
jest.mock("next/navigation", () => ({ redirect: (to: string) => redirect(to) }));

jest.mock("@/lib/permissions-server", () => ({ can: jest.fn(async () => true) }));
const board = { board: { visits: [{ id: "vis-1" }] } };
const loadLinkedJob = jest.fn();
const linkedVisit = jest.fn();
jest.mock("@/lib/workboard/page-data", () => ({
  loadWorkboardPage: jest.fn(async () => board),
  loadLinkedJob: (...a: unknown[]) => loadLinkedJob(...a),
  linkedVisit: (...a: unknown[]) => linkedVisit(...a),
}));
jest.mock("@/components/workboard/overview-screen", () => ({ OverviewScreen: () => null }));

import { can } from "@/lib/permissions-server";
import AssetsPage from "../assets/page";
import WorkboardPage from "../workboard/page";

type Search = Record<string, string | string[] | undefined>;
const propsOf = async (page: Promise<unknown>) => ((await page) as { props: Record<string, unknown> }).props;

/* Assets is retired (the v2 audit, 20 October 2026): its doors land on the
   vehicle's own page, or on Team's Vehicles view. */
describe("Assets sends its doors to the vehicle's own page", () => {
  const assets = (search: Search) => AssetsPage({ searchParams: Promise.resolve(search) });

  it("opens a named vehicle on its page, on Service for the old Log service door", async () => {
    await expect(assets({ v: "v1", screen: "rego" })).rejects.toThrow("REDIRECT:/dashboard/vehicles/v1");
    await expect(assets({ v: "v1", screen: "add:service" })).rejects.toThrow("REDIRECT:/dashboard/vehicles/v1?tab=service");
  });

  it("lands on Team's Vehicles without one vehicle named", async () => {
    await expect(assets({})).rejects.toThrow("REDIRECT:/dashboard/team?view=vehicles");
    await expect(assets({ v: ["v1", "v2"] })).rejects.toThrow("REDIRECT:/dashboard/team?view=vehicles");
  });

  it("still sends someone without the register to their own vehicle", async () => {
    (can as jest.Mock).mockResolvedValueOnce(false);
    await expect(assets({ v: "v1" })).rejects.toThrow("REDIRECT:/dashboard/my-vehicle");
  });
});

describe("the Workboard hands the screen the visit the address names", () => {
  const workboard = (search: Search) =>
    propsOf(WorkboardPage({ searchParams: Promise.resolve(search) as never }));

  beforeEach(() => {
    loadLinkedJob.mockReset();
    linkedVisit.mockReset();
    linkedVisit.mockImplementation((_d: unknown, id: string) => (id === "vis-1" ? { id } : null));
  });

  it("asks the board it loaded about the visit, and hands over the answer", async () => {
    const props = await workboard({ visit: "vis-1" });
    expect(linkedVisit).toHaveBeenCalledWith(board, "vis-1");
    expect(props.openVisit).toEqual({ id: "vis-1" });
    expect(props.openJob).toBeNull();
  });

  it("hands over nothing for a visit the board doesn't hold", async () => {
    expect((await workboard({ visit: "vis-gone" })).openVisit).toBeNull();
  });

  /* the rest of the board is retired (the v2 audit, 20 October 2026) */
  it("sends an address with no one visit to Jobs", async () => {
    await expect(workboard({})).rejects.toThrow("REDIRECT:/dashboard/jobs");
    await expect(workboard({ visit: ["vis-1", "vis-2"] })).rejects.toThrow("REDIRECT:/dashboard/jobs");
  });

  it("lets a job named in the same address win, and asks nothing about the visit", async () => {
    const job = { remoteId: "j-7" };
    loadLinkedJob.mockResolvedValue(job);
    const props = await workboard({ job: "j-7", visit: "vis-1" });
    expect(props.openJob).toBe(job);
    expect(props.openVisit).toBeNull();
    expect(linkedVisit).not.toHaveBeenCalled();
  });

  it("opens the visit when the job named beside it isn't held", async () => {
    loadLinkedJob.mockResolvedValue(null);
    expect((await workboard({ job: "j-gone", visit: "vis-1" })).openVisit).toEqual({ id: "vis-1" });
  });
});
