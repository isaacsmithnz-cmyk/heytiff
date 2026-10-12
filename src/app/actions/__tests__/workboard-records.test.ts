/* OPENING A VISIT OR AN AGREEMENT WHERE YOU ARE. Gated as the Workboard is,
   read off the maintenance board on the account's clock, and nothing for a
   record the board does not hold. */

jest.unmock("@/app/actions/workboard-records");

const caps = new Set<string>(["workboard"]);
const session = jest.fn(async (): Promise<{ user: { sub: string }; orgId: string } | null> => ({
  user: { sub: "auth0|me" },
  orgId: "org-1",
}));
jest.mock("@/lib/auth0", () => ({ auth0: { getSession: () => session() } }));
jest.mock("@/lib/permissions-server", () => ({ can: async (c: string) => caps.has(c) }));
const view = jest.fn(async (): Promise<{ status: string } | null> => ({ status: "connected" }));
jest.mock("@/lib/integrations/store", () => ({ getConnectionView: () => view() }));
jest.mock("@/lib/workboard/query", () => ({ getSm8Timezone: async () => "Australia/Sydney" }));
jest.mock("@/lib/workboard/dates", () => ({ todayInZone: (tz: string | null) => (tz ? "2026-10-11" : "2026-10-10") }));
const loadBoard = jest.fn();
jest.mock("@/lib/workboard/board-query", () => ({ loadMaintenanceBoard: (...a: unknown[]) => loadBoard(...a) }));

import { openMaintenanceCard } from "../workboard-records";

const board = {
  visits: [{ id: "v-7", agreementId: "a-1", status: "upcoming" }],
  agreements: [{ id: "a-1", label: "Bayview HVAC", lastDone: null, siteAddress: null, siteRequirements: null, equipment: [] }],
  staff: [],
  tagPool: [],
  categories: [],
  tasks: [],
};

beforeEach(() => {
  caps.clear();
  caps.add("workboard");
  loadBoard.mockReset().mockResolvedValue(board);
  view.mockResolvedValue({ status: "connected" });
});

it("reads a visit's card off the maintenance board, on the account's clock", async () => {
  const read = await openMaintenanceCard("visit", "v-7");
  expect(loadBoard).toHaveBeenCalledWith("org-1", "2026-10-11");
  expect(read).toMatchObject({ kind: "visit", card: { visit: { id: "v-7" }, today: "2026-10-11", connected: true } });
});

it("reads an agreement's card", async () => {
  expect(await openMaintenanceCard("agreement", "a-1")).toMatchObject({ kind: "agreement", card: { agreement: { id: "a-1" } } });
});

it("is standalone without ServiceM8, on the server's clock", async () => {
  view.mockResolvedValue(null);
  const read = await openMaintenanceCard("visit", "v-7");
  expect(loadBoard).toHaveBeenCalledWith("org-1", "2026-10-10");
  expect(read).toMatchObject({ card: { connected: false } });
});

it("is nothing for a record the board does not hold", async () => {
  expect(await openMaintenanceCard("visit", "v-gone")).toBeNull();
});

it("is nothing without the Workboard, and reads nothing", async () => {
  caps.clear();
  expect(await openMaintenanceCard("visit", "v-7")).toBeNull();
  expect(loadBoard).not.toHaveBeenCalled();
});

it("is nothing for a kind it does not open, or no id", async () => {
  expect(await openMaintenanceCard("project" as "visit", "p-1")).toBeNull();
  expect(await openMaintenanceCard("visit", "  ")).toBeNull();
  expect(loadBoard).not.toHaveBeenCalled();
});
