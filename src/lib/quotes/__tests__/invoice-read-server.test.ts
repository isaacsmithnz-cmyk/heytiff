/**
 * @jest-environment node
 */
/* An invoice, a PDF or a photo, read by Tiff for the person to look over:
   what's asked of the model, what a refusal or a cut-off says, and each
   line beside what the book holds for its code. The model is a fake client
   handed in, as the proposal writer's tests do. */
import type Anthropic from "@anthropic-ai/sdk";

jest.mock("server-only", () => ({}));

type Row = Record<string, unknown>;
let HELD: Row[] = [];
const asked: { table: string; filters: [string, unknown][] }[] = [];
jest.mock("@/lib/supabase-server", () => ({
  supabaseAdmin: {
    from: (table: string) => {
      const filters: [string, unknown][] = [];
      const q = {
        select: () => q,
        eq: (c: string, v: unknown) => (filters.push([c, v]), q),
        in: async (c: string, vs: unknown[]) => {
          filters.push([c, vs]);
          asked.push({ table, filters });
          const keep = (r: Row) => filters.every(([f, v]) => (Array.isArray(v) ? v.includes(r[f]) : r[f] === v));
          return { data: HELD.filter(keep), error: null };
        },
      };
      return q;
    },
  },
}));

import { readInvoice } from "../invoice-read-server";
import type { Supplier } from "../price-book";

const aad: Supplier = { key: "aad", name: "AAD", pricing: "net", file: "csv", format: "aad_csv", discountPct: 0, rules: [] };

function clientSaying(body: unknown, stop = "end_turn") {
  const create = jest.fn(async (_req: unknown) => ({ stop_reason: stop, content: [{ type: "text", text: typeof body === "string" ? body : JSON.stringify(body) }] }));
  return { client: { beta: { messages: { create } } } as unknown as Anthropic, create };
}

const invoice = {
  supplier: "AAD Pty Ltd",
  invoiceNo: "INV-55120",
  invoiceDate: "2026-09-29",
  lines: [
    { code: "AST-09KMTC", description: "Fujitsu Lifestyle indoor 2.5kW", qty: 1, unitPriceExGst: 222, lineTotalExGst: 222 },
    { code: "CMADJ", description: "Pipe clamp", qty: 20, unitPriceExGst: 1.15, lineTotalExGst: 23 },
    { code: "FRT", description: "Freight", qty: 1, unitPriceExGst: 25, lineTotalExGst: 25 },
  ],
};

beforeEach(() => {
  HELD = [];
  asked.length = 0;
});

it("sends the PDF before the ask, to Sonnet at medium effort with the invoice schema, and reads every product line", async () => {
  HELD = [
    {
      org_id: "org-1",
      supplier_key: "aad",
      code: "CMADJ",
      name: "Pipe clamp",
      cents: 120,
      current: true,
      on_list: true,
      paid_cents: null,
      paid_on: null,
      listed_on: "2026-09-01",
      priced_on: "2026-09-01",
      last_import_at: "2026-09-01T00:00:00Z",
    },
    /* another business's price for the same code is never read */
    { org_id: "org-2", supplier_key: "aad", code: "AST-09KMTC", cents: 1, current: true, on_list: true },
  ];
  const { client, create } = clientSaying(invoice);
  const res = await readInvoice("org-1", aad, Buffer.from("%PDF-1.7"), "application/pdf", client);

  const req = create.mock.calls[0]![0] as {
    model: string;
    output_config: { effort: string; format: { type: string } };
    messages: { content: { type: string; source?: { media_type: string } }[] }[];
  };
  expect(req.model).toBe("claude-sonnet-5-5");
  expect(req.output_config.effort).toBe("medium");
  expect(req.output_config.format.type).toBe("json_schema");
  expect(req.messages[0]!.content.map((b) => b.type)).toEqual(["document", "text"]);
  expect(req.messages[0]!.content[0]!.source!.media_type).toBe("application/pdf");

  expect(asked[0]!.filters).toEqual([
    ["org_id", "org-1"],
    ["supplier_key", "aad"],
    ["code", ["AST-09KMTC", "CMADJ"]],
  ]);
  expect(res).toEqual({
    ok: true,
    read: {
      supplier: "AAD Pty Ltd",
      invoiceNo: "INV-55120",
      invoiceDate: "2026-09-29",
      lines: [
        { code: "AST-09KMTC", name: "Fujitsu Lifestyle indoor 2.5kW", qty: 1, cents: 22200, now: null, after: 22200 },
        { code: "CMADJ", name: "Pipe clamp", qty: 20, cents: 115, now: 120, after: 115 },
      ],
      skipped: [{ name: "Freight", why: "not a product" }],
    },
  });
});

it("sends a photo as an image", async () => {
  const { client, create } = clientSaying(invoice);
  await readInvoice("org-1", aad, Buffer.from("jpeg"), "image/jpeg", client);
  const req = create.mock.calls[0]![0] as { messages: { content: { type: string; source?: { media_type: string } }[] }[] };
  expect(req.messages[0]!.content[0]).toMatchObject({ type: "image", source: { type: "base64", media_type: "image/jpeg" } });
});

it("says so when Tiff declines, runs out of room, or answers with something that isn't JSON", async () => {
  expect(await readInvoice("org-1", aad, Buffer.from("x"), "application/pdf", clientSaying(invoice, "refusal").client)).toEqual({
    ok: false,
    reason: "Tiff declined to read this invoice.",
  });
  expect(await readInvoice("org-1", aad, Buffer.from("x"), "application/pdf", clientSaying(invoice, "max_tokens").client)).toEqual({
    ok: false,
    reason: "That invoice is too long to read in one go.",
  });
  jest.spyOn(console, "error").mockImplementation(() => {});
  expect(await readInvoice("org-1", aad, Buffer.from("x"), "application/pdf", clientSaying("{not json").client)).toEqual({
    ok: false,
    reason: "Tiff's reading couldn't be used. Try again.",
  });
  expect(asked).toHaveLength(0);
});
