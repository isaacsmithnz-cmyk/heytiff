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
  readSession: async () => ({ id: "s-1", messages: [{ role: "user", content: "Ducted, 5 outlets" }] }),
  readOpenQuestions: async () => [{ id: 1, question: "Which ceiling?", put: "" }],
}));

import { GET } from "../route";

const get = () => GET(new Request("http://x/api/workboard/quote-status?job=job-1"));

beforeEach(() => grants.clear());

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
