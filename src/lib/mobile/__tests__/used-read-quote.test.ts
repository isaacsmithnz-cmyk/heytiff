/**
 * @jest-environment node
 */

/* Bug 12 (Isaac, 17 November 2026: "Not looking at quote for units, pipe
   etc"): what you say you used is looked for on the job's own quote first.
   Run against the network, not the SDK (the house rule): `fetch` answers. */

jest.mock("server-only", () => ({}));
jest.mock("@/lib/supabase-server", () => {
  const rows = [
    { supplier_key: null, code: "PEAD-M71JAADR1.TH", name: "Indoor unit", kind: "unit", unit: null },
    { supplier_key: null, code: "PEAD-M71JAADR1.TH", name: "Indoor unit", kind: "unit", unit: null },
    { supplier_key: "ardent", code: "9800008-1", name: 'ARDENT PR CU 3/8" X 5/8" R410A 20M (COIL)', kind: "material", unit: null },
    { supplier_key: null, code: null, name: "Return plenum", kind: "material", unit: null },
  ];
  const q = { select: () => q, eq: () => q, in: () => q, order: () => Promise.resolve({ data: rows, error: null }) };
  return { supabaseAdmin: { from: () => q } };
});
jest.mock("@/lib/quotes/price-book-server", () => ({
  matchingItems: async () => [{ supplierKey: "lighting", code: "SALSL9732", name: "LED Linear Diffused Batten", uom: "EA", timesBought: 0 }],
  readPreferred: async () => new Set(),
  readSameDecisions: async () => ({ confirmed: [] }),
}));

import { readUsedWords } from "../used-read";

const asked: string[] = [];
const answers = [
  { things: [{ said: "the indoor unit", name: "Indoor unit", qty: 1, unit: "", search: ["indoor", "unit"] }, { said: "10 metres of pipe", name: "Pipe", qty: 10, unit: "m", search: ["pipe"] }] },
  { picks: [{ pick: 0, choices: [] }, { pick: 1, choices: [] }] },
];
const realFetch = globalThis.fetch;
beforeEach(() => {
  asked.length = 0;
  process.env.ANTHROPIC_API_KEY = "test-key";
  globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as { messages: { content: string }[] };
    asked.push(body.messages[0]!.content);
    const reply = answers[asked.length - 1];
    return new Response(
      JSON.stringify({ id: "m", type: "message", role: "assistant", model: "claude-sonnet-5-5", content: [{ type: "text", text: JSON.stringify(reply) }], stop_reason: "end_turn", stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }) as typeof fetch;
});
afterAll(() => {
  globalThis.fetch = realFetch;
});

test("the job's quote is offered first, once, and a pick from it is the quote's item", async () => {
  const found = await readUsedWords("org-1", "the indoor unit and 10 metres of pipe", "job-3054");
  const pick = asked[1]!;
  expect(pick.startsWith("This job's quote:\n  0. Indoor unit PEAD-M71JAADR1.TH (PEAD-M71JAADR1.TH)\n  1. ARDENT PR CU")).toBe(true);
  /* the note line with no code isn't an item, and each thing's own are numbered on from the quote's */
  expect(pick).not.toContain("Return plenum");
  expect(pick).toContain('Thing 1: "the indoor unit", 1\n  2. LED Linear Diffused Batten');
  expect(found).toEqual([
    { said: "the indoor unit", qty: 1, unit: null, name: "Indoor unit PEAD-M71JAADR1.TH", supplierKey: "", code: "PEAD-M71JAADR1.TH", choices: null },
    { said: "10 metres of pipe", qty: 10, unit: "m", name: 'ARDENT PR CU 3/8" X 5/8" R410A 20M (COIL)', supplierKey: "ardent", code: "9800008-1", choices: null },
  ]);
});
