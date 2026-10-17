/**
 * @jest-environment node
 */
/* Where a job's quote stands, for the job card's Quote section: anyone on the
   Workboard reads it, and nothing in it is money. */
const grants = new Set<string>();
jest.mock("@/lib/auth0", () => ({ auth0: { getSession: async () => ({ orgId: "org-a", user: { sub: "u-tech" } }) } }));
jest.mock("@/lib/permissions-server", () => ({ can: async (g: string) => grants.has(g) }));
jest.mock("@/lib/workboard/all-jobs-query", () => ({ resolveJobCard: async () => ({ parentRemoteId: "job-1" }) }));
const line = (o: Record<string, unknown>) => ({ optionIndex: 0, costCents: 400000, sellCents: 520000, source: "book", estimate: false, updatedAt: "2026-10-10T00:00:00Z", ...o });
jest.mock("@/lib/quotes/lines-server", () => ({
  readLines: async () => [
    line({}),
    line({ optionIndex: 1, source: "unknown", costCents: 0, sellCents: null, updatedAt: "2026-10-12T00:00:00Z" }),
  ],
}));
jest.mock("@/lib/quotes/lines-job-server", () => ({
  readByHand: async () => ({ accepted: [], names: [], loading: {}, compare: {}, supplier: null, proposal: null, researched: {}, variations: [], sent: null }),
}));
jest.mock("@/lib/quotes/quote-versions-server", () => ({ readVersions: async () => [] }));
jest.mock("@/lib/quotes/old-draft-server", () => ({ readStoredProposal: async () => null }));
jest.mock("@/lib/quotes/session/store-server", () => ({
  readSession: async () => ({ id: "s-1", spentUsd: 0, turnId: null, turnSince: null }),
  hasTalked: async () => true,
  readOpenQuestions: async () => [{ id: 1, question: "Which ceiling?", put: "" }],
}));

const readLanding = jest.fn(async (_org: string, _job: string, read: { money: boolean }) => ({ name: "Ducted", money: read.money, totalCents: read.money ? 520000 : null }));
jest.mock("@/lib/quotes/quote-landing-server", () => ({ readLanding: (...a: Parameters<typeof readLanding>) => readLanding(...a) }));

import { GET } from "../route";

const get = (q = "") => GET(new Request(`http://x/api/workboard/quote-status?job=job-1${q}`));

beforeEach(() => {
  grants.clear();
  readLanding.mockClear();
});

it("reads the landing only when the Quote tab asks for it", async () => {
  grants.add("workboard");
  const a = (await (await get()).json()) as Record<string, unknown>;
  expect(a.landing).toBeUndefined();
  expect(readLanding).not.toHaveBeenCalled();
});

it("gives the landing its money only for a reader with money access", async () => {
  grants.add("workboard");
  const tech = (await (await get("&landing=1")).json()) as { landing: { money: boolean; totalCents: number | null } };
  expect(readLanding).toHaveBeenLastCalledWith("org-a", "job-1", expect.objectContaining({ money: false, session: expect.objectContaining({ id: "s-1" }) }));
  expect(tech.landing).toEqual({ name: "Ducted", money: false, totalCents: null });
  grants.add("financials");
  const office = (await (await get("&landing=1")).json()) as { landing: { money: boolean; totalCents: number | null } };
  expect(readLanding).toHaveBeenLastCalledWith("org-a", "job-1", expect.objectContaining({ money: true }));
  expect(office.landing.totalCents).toBe(520000);
});

it("tells a tech where the quote stands, with no money in it", async () => {
  grants.add("workboard");
  const a = (await (await get()).json()) as { ok: boolean; facts: Record<string, unknown> };
  expect(a).toEqual({
    ok: true,
    facts: { lines: 2, options: 2, toConfirm: 2, changedAt: "2026-10-12T00:00:00Z", talked: true, drafted: false, approved: false, version: 1, sent: null, accepted: [] },
  });
  expect(JSON.stringify(a)).not.toMatch(/400000|520000|Cents/);
});

it("is the Workboard's only", async () => {
  expect((await get()).status).toBe(403);
});
