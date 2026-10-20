/**
 * @jest-environment node
 */
/* The landing's read: the thread's first event, the last word a person
   said, when an option was accepted, everyone's names, and the price only
   for a reader with money access, never read at all for anyone else. */

jest.mock("server-only", () => ({}));

type Row = { author: string; at: string; body: Record<string, unknown> | null; kind: string };
const thread: Row[] = [
  { kind: "message", author: "u-isaac", at: "2026-10-16T22:00:00Z", body: { text: "Ducted for the upstairs" } },
  { kind: "reply", author: "tiff", at: "2026-10-16T22:01:00Z", body: { text: "On it" } },
  { kind: "milestone", author: "u-isaac", at: "2026-10-21T22:00:00Z", body: { text: "Option 1 accepted" } },
  { kind: "message", author: "u-luke", at: "2026-10-22T01:00:00Z", body: { text: "Add a return grille" } },
  { kind: "milestone", author: "u-luke", at: "2026-10-22T01:05:00Z", body: { text: "Variation 1 started" } },
];

/* a query over the thread above, as far as the read uses one */
function query() {
  let rows = thread.map((r, id) => ({ ...r, id }));
  const q = {
    select: () => q,
    eq: (k: string, v: unknown) => ((rows = k === "kind" ? rows.filter((r) => r.kind === v) : rows), q),
    neq: (k: string, v: unknown) => ((rows = rows.filter((r) => (r as unknown as Record<string, unknown>)[k] !== v)), q),
    order: (_k: string, o: { ascending: boolean }) => ((rows = [...rows].sort((a, b) => (o.ascending ? a.id - b.id : b.id - a.id))), q),
    limit: (n: number) => Promise.resolve({ data: rows.slice(0, n) }),
  };
  return q;
}
jest.mock("@/lib/supabase-server", () => ({ supabaseAdmin: { from: () => query() } }));
jest.mock("../lines-server", () => ({ namesBySignIn: async (_o: string, ids: string[]) => Object.fromEntries(ids.filter((i) => i !== "u-gone").map((i) => [i, i === "u-luke" ? "Luke Ingold" : "Isaac Smith"])) }));
const readQuotePrice = jest.fn(async () => ({ ok: true, options: [{ build: { exGstCents: 2457463 } }, { build: { exGstCents: 2498663 } }], chargeOutCents: 14000 }));
jest.mock("../quote-price-server", () => ({ readQuotePrice: () => readQuotePrice() }));
jest.mock("../session/store-server", () => ({ holding: () => false }));

import { readLanding } from "../quote-landing-server";

const byHand = {
  accepted: [0],
  names: ["Ducted"],
  loading: {},
  compare: {},
  supplier: null,
  proposal: null,
  researched: {},
  variations: [{ n: 1, option: 1, of: 0, what: "return grille", startedAt: "2026-10-22T01:05:00Z", startedBy: "u-luke", approvedAt: null, acceptedAt: null }],
  sent: null,
};
const read = (money: boolean) => readLanding("org-a", "job-1", { byHand, versions: [], lines: [], session: { id: "s-1", spentUsd: 0, turnId: null, turnSince: null }, money });

beforeEach(() => readQuotePrice.mockClear());

it("reads who last spoke to Tiff, when it began and when it was accepted, with the figures for a reader with money access", async () => {
  const l = await read(true);
  expect(l.startedAt).toBe("2026-10-16T22:00:00Z");
  expect(l.who).toEqual({ name: "Luke Ingold", at: "2026-10-22T01:00:00Z", now: false });
  expect(l.acceptedAt).toBe("2026-10-21T22:00:00Z");
  expect(l.totalCents).toBe(2457463);
  expect(l.variations[0]).toMatchObject({ n: 1, by: "Luke Ingold", cents: 41200 });
});

it("never prices the quote for a reader without money access", async () => {
  const l = await read(false);
  expect(readQuotePrice).not.toHaveBeenCalled();
  expect(l.totalCents).toBeNull();
  expect(l.variations[0]!.cents).toBeNull();
});
