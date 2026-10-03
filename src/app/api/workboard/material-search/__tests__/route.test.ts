/**
 * @jest-environment node
 */
const grants = new Set<string>();
jest.mock("@/lib/auth0", () => ({ auth0: { getSession: async () => ({ orgId: "org-a" }) } }));
jest.mock("@/lib/permissions-server", () => ({ can: async (g: string) => grants.has(g) }));
const findOffers = jest.fn();
jest.mock("@/lib/quotes/price-book-server", () => ({
  readSuppliers: async () => [],
  findOffers: (...a: unknown[]) => findOffers(...a),
}));

import { GET } from "../route";

const offer = { supplierKey: "aad", supplierName: "AAD", code: "PC1438", name: "PAIRED COIL", netCents: 15747 };
beforeEach(() => {
  grants.clear();
  findOffers.mockReset().mockResolvedValue([{ code: "PC1438", name: "PAIRED COIL", offers: [offer], cheapest: offer, savesCents: null }]);
});
const get = (q: string) => GET(new Request(`http://x/api/workboard/material-search?q=${encodeURIComponent(q)}`));

it("finds in the reader's own org's price book; the price only with financials", async () => {
  grants.add("workboard");
  expect(await (await get("pair coil")).json()).toEqual({ ok: true, hits: [{ code: "PC1438", name: "PAIRED COIL", supplier: "AAD", priceCents: null }] });
  expect(findOffers.mock.calls[0][0]).toBe("org-a");
  grants.add("financials");
  expect((await (await get("pair coil")).json()).hits[0].priceCents).toBe(15747);
});

it("refuses without Workboard access, and asks nothing for a word too short", async () => {
  expect((await get("pair coil")).status).toBe(403);
  grants.add("workboard");
  expect(await (await get("p")).json()).toEqual({ ok: true, hits: [] });
  expect(findOffers).not.toHaveBeenCalled();
});
