/**
 * @jest-environment node
 */
/* Isaac, 2026-10-12: "the quoting section should still be accessible. For
   techs who are quoting a job, but… the money visibility can be hidden…
   anyone with money access can review the quote and check the pricing".
   The money never leaves the server for someone without it. */
const grants = new Set<string>();
jest.mock("@/lib/auth0", () => ({ auth0: { getSession: async () => ({ orgId: "org-a", user: { sub: "u-tech" } }) } }));
jest.mock("@/lib/permissions-server", () => ({ can: async (g: string) => grants.has(g) }));
jest.mock("@/lib/workboard/all-jobs-query", () => ({ resolveJobCard: async () => ({ parentRemoteId: "job-1" }) }));
const changeLine = jest.fn(async () => ({ ok: true, line: null }));
const approveProposal = jest.fn(async () => ({ ok: true, byHand: {} }));
const setNoDesign = jest.fn(async () => ({ ok: true }));
const LINE = {
  id: "l1", version: 1, updatedAt: "", updatedBy: "", optionIndex: 0, system: "", group: "Units", position: 0, name: "PEA-M125HAA",
  code: "PEA-M125HAA", supplierKey: "aad", kind: "unit", qty: 1, unit: "", costCents: 400000, sellCents: 520000, source: "said", why: "", duct: false,
};
jest.mock("@/lib/quotes/lines-server", () => ({
  readEngine: async () => "lines",
  readLines: async () => [LINE],
  readChanges: async () => [{ id: 7, lineId: "l1", action: "change", before: { sellCents: 500000 }, after: { sellCents: 520000 }, why: "", madeBy: "u", madeAt: "" }],
  namesBySignIn: async () => ({}),
  changeLine: (...a: unknown[]) => (changeLine as jest.Mock)(...a),
  addLine: jest.fn(),
  copyOption: jest.fn(),
  removeLine: jest.fn(),
  setEngine: jest.fn(),
  undoChange: jest.fn(),
}));
jest.mock("@/lib/quotes/kits-server", () => ({ addKit: jest.fn() }));
jest.mock("@/lib/quotes/lookups-server", () => ({ packMakers: async () => [{ key: "daikin", name: "Daikin" }, { key: "fujitsu", name: "Fujitsu" }] }));
jest.mock("@/lib/quotes/fit-server", () => ({ linesFit: async () => [] }));
jest.mock("@/lib/quotes/lines-job-server", () => ({
  readByHand: async () => ({ accepted: [], names: [], loading: {}, compare: {}, supplier: null, proposal: null, researched: {}, variations: [] }),
  approveProposal: (...a: unknown[]) => (approveProposal as jest.Mock)(...a),
  markAccepted: jest.fn(),
  markVariation: jest.fn(),
  nameOption: jest.fn(),
  saveProposal: jest.fn(),
  setLoading: jest.fn(),
  setNoDesign: (...a: unknown[]) => (setNoDesign as jest.Mock)(...a),
  setSupplier: jest.fn(),
  startVariation: jest.fn(),
  startVersion: jest.fn(),
}));
jest.mock("@/lib/studio/job-designs-server", () => ({ readJobDesigns: async () => [{ id: "dsn_1", name: "6 Bishops Avenue", updatedAt: "2026-10-27T03:00:00Z" }] }));
jest.mock("@/lib/quotes/quote-versions-server", () => ({ readVersions: async () => [{ n: 1, what: "", approvedAt: null, madeAt: "", options: [{ name: "Option 1", exGstCents: 1, incGstCents: 1, lines: [] }] }] }));
jest.mock("@/lib/templates/query", () => ({ orgTemplates: async () => null }));
jest.mock("@/lib/quotes/price-book-server", () => ({ readSuppliers: async () => [{ key: "aad", name: "AAD", itemCount: 9 }] }));
jest.mock("@/lib/quotes/session/store-server", () => ({ addEvents: jest.fn(), readSession: async () => null }));
jest.mock("@/lib/quotes/accepted-materials-server", () => ({ putAcceptedOnJob: jest.fn(), putVariationOnJob: jest.fn() }));
jest.mock("@/lib/workboard/visit-tasks-server", () => ({ addTasksToJob: jest.fn(), makeTasksFromQuote: jest.fn() }));
jest.mock("@/lib/quotes/settings-query", () => ({ readQuoteSettings: async () => ({ taskHours: { zone: null, grille: null, metre: null, visit: null } }) }));
jest.mock("@/lib/quotes/org-day-server", () => ({ readOrgDay: async () => ({ hours: { hours: 8 } }) }));

import { GET, POST } from "../route";

const get = () => GET(new Request("http://x/api/workboard/quote-lines?job=job-1"));
const post = (body: Record<string, unknown>) => POST(new Request("http://x/api/workboard/quote-lines", { method: "POST", body: JSON.stringify({ job: "job-1", ...body }) }));

beforeEach(() => {
  grants.clear();
  changeLine.mockClear();
  approveProposal.mockClear();
  setNoDesign.mockClear();
});

it("is the Workboard's: a tech reads the quote's work, never its money", async () => {
  expect((await get()).status).toBe(403);
  grants.add("workboard");
  const a = await (await get()).json();
  expect(a).toMatchObject({ ok: true, money: false, versions: [], suppliers: [] });
  expect(a.lines[0]).toMatchObject({ name: "PEA-M125HAA", qty: 1, costCents: 0, sellCents: null });
  /* the history's price change is gone */
  expect(a.changes).toEqual([]);
  expect(JSON.stringify(a)).not.toMatch(/520000|400000/);
  /* a tech adds a kit too: every installed pack its unit can be read off */
  expect(a.packs).toEqual([{ key: "daikin", name: "Daikin" }, { key: "fujitsu", name: "Fujitsu" }]);
});

it("gives the money to whoever has it", async () => {
  grants.add("workboard").add("financials");
  const a = await (await get()).json();
  expect(a).toMatchObject({ money: true });
  expect(a.lines[0]).toMatchObject({ costCents: 400000, sellCents: 520000 });
  expect(a.versions).toHaveLength(1);
});

it("lets a tech change the work, never a price, and keeps pricing and approving for money access", async () => {
  grants.add("workboard");
  await post({ op: "change", id: "l1", version: 1, patch: { qty: 2, sellCents: 1 } });
  expect(changeLine).toHaveBeenCalledWith("org-a", "job-1", "l1", 1, { qty: 2 }, "u-tech", "");
  const refused = await post({ op: "approve" });
  expect(refused.status).toBe(403);
  expect(approveProposal).not.toHaveBeenCalled();
  expect((await post({ op: "supplier", key: "aad" })).status).toBe(403);
  expect((await post({ op: "accept", option: 0 })).status).toBe(403);
});

/* the Design step (Isaac, 28 October 2026): the job's designs and No design
   go to whoever has the Studio, and only they press No design */
it("gives the job's designs to whoever has the Studio, and nothing to anyone else", async () => {
  grants.add("workboard");
  const without = await (await get()).json();
  expect(without.designs).toBeNull();
  grants.add("studio");
  const a = await (await get()).json();
  expect(a.designs).toEqual([{ id: "dsn_1", name: "6 Bishops Avenue", updatedAt: "2026-10-27T03:00:00Z" }]);
  expect(a.noDesign).toBeNull();
});

it("keeps No design for anyone quoting with the Studio, a tech included", async () => {
  grants.add("workboard");
  expect((await post({ op: "design", skip: true })).status).toBe(403);
  expect(setNoDesign).not.toHaveBeenCalled();
  grants.add("studio");
  await post({ op: "design", skip: true });
  expect(setNoDesign).toHaveBeenCalledWith("org-a", "job-1", true, "u-tech");
  await post({ op: "design", skip: false });
  expect(setNoDesign).toHaveBeenLastCalledWith("org-a", "job-1", false, "u-tech");
});
