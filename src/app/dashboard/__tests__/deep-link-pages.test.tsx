/* The two pages the doors land on read their own address: `?v=` and
   `?screen=` on Assets, `?visit=` on the Workboard. What the screens do with
   a link is pinned beside them (vehicle-link.test.tsx, overview-screen); this
   pins what each PAGE hands over, which is the half a screen test wiring its
   own props can never see break. */

const redirect = jest.fn((to: string) => {
  throw new Error(`REDIRECT:${to}`);
});
jest.mock("next/navigation", () => ({ redirect: (to: string) => redirect(to) }));

const loadFleetPage = jest.fn();
jest.mock("@/lib/fleet/page-data", () => ({ loadFleetPage: () => loadFleetPage() }));
jest.mock("@/components/fleet/assets-screen", () => ({ AssetsScreen: () => null }));

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

import AssetsPage from "../assets/page";
import WorkboardPage from "../workboard/page";

type Search = Record<string, string | string[] | undefined>;
const propsOf = async (page: Promise<unknown>) => ((await page) as { props: Record<string, unknown> }).props;

describe("Assets hands the screen the vehicle and screen the address names", () => {
  const assets = (search: Search) => propsOf(AssetsPage({ searchParams: Promise.resolve(search) }));

  beforeEach(() => {
    loadFleetPage.mockResolvedValue({
      own: { vehicle: null, pickable: [], logs: [] },
      register: { vehicles: [] },
      today: "2026-09-25",
      warnDays: 30,
      viewerStaffId: null,
    });
  });

  it("reads a vehicle and the screen to open its card on", async () => {
    expect((await assets({ v: "v1", screen: "rego" })).openVehicle).toEqual({ id: "v1", screen: "rego" });
    expect((await assets({ v: "v1", screen: "add:service" })).openVehicle).toEqual({
      id: "v1",
      screen: "add:service",
    });
    expect((await assets({ v: "v1" })).openVehicle).toEqual({ id: "v1", screen: null });
  });

  it("opens the card on its main screen for a screen a link may not name", async () => {
    for (const screen of ["financials", "log:l1", "add:fuel", "nonsense"])
      expect((await assets({ v: "v1", screen })).openVehicle).toEqual({ id: "v1", screen: null });
  });

  it("names nothing without one vehicle, whatever the screen says", async () => {
    expect((await assets({ screen: "rego" })).openVehicle).toBeNull();
    expect((await assets({ v: "" })).openVehicle).toBeNull();
    expect((await assets({ v: ["v1", "v2"] })).openVehicle).toBeNull();
  });

  it("hands a fresh object per render, so the screen can tell a naming from a re-render", async () => {
    const a = (await assets({ v: "v1" })).openVehicle;
    const b = (await assets({ v: "v1" })).openVehicle;
    expect(a).toEqual(b);
    expect(a).not.toBe(b);
  });

  it("still sends someone without the register to their own vehicle", async () => {
    loadFleetPage.mockResolvedValue({ own: {}, register: undefined });
    await expect(assets({ v: "v1", screen: "rego" })).rejects.toThrow("REDIRECT:/dashboard/my-vehicle");
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

  it("hands over nothing for a visit the board doesn't hold, or none named", async () => {
    expect((await workboard({ visit: "vis-gone" })).openVisit).toBeNull();
    expect((await workboard({})).openVisit).toBeNull();
    expect((await workboard({ visit: ["vis-1", "vis-2"] })).openVisit).toBeNull();
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
