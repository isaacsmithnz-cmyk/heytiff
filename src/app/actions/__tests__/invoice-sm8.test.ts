/**
 * @jest-environment node
 */

/* NEW INVOICE TO SERVICEM8 (the job page plan's build 10): the ticked lines
   put on the job, only by a press, through the accepted quote's one door.
   The draft is faked at its read; ServiceM8, the press and the queue at
   their doors. The queue keeps one row per subject, as sm8_writes' key does,
   so a second press of the same line queues nothing new. */

type Row = Record<string, unknown>;

let caps = new Set<string>();
jest.mock("@/lib/permissions-server", () => ({
  can: async (c: string) => caps.has(c),
  requireOrg: async (c: string) => {
    if (!caps.has(c)) throw new Error("no");
    return { orgId: "org-1" };
  },
}));

let writes: Row[] = [];
jest.mock("@/lib/supabase-server", () => ({
  supabaseAdmin: {
    from: () => {
      const filters: [string, unknown[]][] = [];
      const b: Record<string, unknown> = {};
      b.select = () => b;
      b.eq = () => b;
      b.in = (col: string, vals: unknown[]) => (filters.push([col, vals]), b);
      b.then = (res: (v: unknown) => unknown) =>
        Promise.resolve({ data: writes.filter((w) => filters.every(([c, v]) => v.includes(w[c]))).map((w) => ({ ...w })), error: null, count: 2 }).then(res);
      return b;
    },
  },
}));
jest.mock("@/lib/integrations/sm8-kinds", () => ({ sm8QuotesAllowed: () => true }));
jest.mock("@/lib/integrations/sm8-press", () => ({ sm8PressFromSession: async () => ({ orgId: "org-1", userId: "auth0|me", staffId: "s-me", at: Date.now() }) }));
jest.mock("@/lib/integrations/sm8-writes", () => ({ readSm8WriteState: jest.fn() }));
const sendRefusal = jest.fn((): string | null => null);
jest.mock("@/lib/integrations/sm8-write-plan", () => ({ sendRefusal: () => sendRefusal() }));
jest.mock("@/lib/integrations/sm8-drain", () => ({ settlePressedWrites: jest.fn(async () => undefined) }));
jest.mock("@/lib/integrations/sm8-freshness", () => ({ syncSm8AfterSend: jest.fn() }));
jest.mock("@/lib/integrations/sm8-store", () => ({ sm8AccessResult: async () => ({ ok: true, access: {} }) }));
jest.mock("@/lib/integrations/sm8-http", () => ({ sm8CallOf: () => ({}) }));
const readSm8Raw = jest.fn();
jest.mock("@/lib/integrations/sm8-write", () => ({ readSm8Raw: (...a: unknown[]) => readSm8Raw(...a) }));
jest.mock("@/lib/integrations/sm8-quote-trial", () => ({ quotesOnTrial: async () => false }));

const readInvoiceDraft = jest.fn();
jest.mock("@/lib/jobs/invoice-draft-server", () => ({
  readInvoiceDraft: (...a: unknown[]) => readInvoiceDraft(...a),
  invoicePressId: () => "0000000c-0000-4000-8000-000000000001",
  invoiceRowKey: (k: string) => `inv-${k.replace(/[^a-z0-9]/gi, "")}`,
}));

const queued: { pressId: string; rows: Row[] }[] = [];
let n = 0;
jest.mock("../sm8-quote-queue", () => ({
  queueAcceptedQuote: async (_press: unknown, pressId: string, _job: string, rows: Row[]) => {
    queued.push({ pressId, rows });
    const ids: string[] = [];
    for (const r of rows) {
      const subject = `quote:${pressId}:${r.key}`;
      let w = writes.find((x) => x.subject === subject);
      if (!w) {
        w = { id: `w-${++n}`, subject, status: "sent", last_error: null };
        writes.push(w);
        ids.push(w.id as string);
      }
    }
    return { ok: true, ids };
  },
}));

import { sendInvoiceToSm8 } from "../invoice-sm8";

const JOB = "0000000b-0000-4000-8000-000000003221";
const line = (key: string, over: Row = {}) => ({ key, kind: "labour", name: `Labour, ${key}`, detail: "Isaac 3.5 h", qty: 3.5, unit: "h", unitSellCents: 14_000, unitCostCents: null, sent: false, ...over });
const draft = (lines: Row[], over: Row = {}) => ({
  cardId: JOB,
  taxRateUuid: "tax-1",
  draft: { ok: true, lines, from: { days: [], used: 0 }, quoted: false, invoiced: false, jobNumber: "3221", ...over },
});

beforeEach(() => {
  caps = new Set(["workboard", "workboard_money", "financials"]);
  writes = [];
  queued.length = 0;
  sendRefusal.mockReturnValue(null);
  readSm8Raw.mockResolvedValue({ ok: true, found: true, active: 1 });
  readInvoiceDraft.mockResolvedValue(draft([line("a"), line("b"), line("c", { unitSellCents: null }), line("d", { sent: true })]));
});

it("puts only the ticked lines on the job, priced as the server works them out", async () => {
  const a = await sendInvoiceToSm8(JOB, ["a", "c", "d", "nobody"]);
  expect(a).toMatchObject({ ok: true, sent: 1, lines: 1, said: "1 of 1 line on job 3221 in ServiceM8." });
  expect(queued).toHaveLength(1);
  expect(queued[0]!.rows.map((r) => [r.key, (r.fields as Row).price, (r.fields as Row).quantity])).toEqual([["inv-a", "140.0000", "3.5"]]);
});

it("queues the same line twice as the same row: a day never goes on the job twice", async () => {
  await sendInvoiceToSm8(JOB, ["a"]);
  await sendInvoiceToSm8(JOB, ["a"]);
  expect(writes).toHaveLength(1);
});

it("sends nothing without money and the business's figures, or with nothing ticked", async () => {
  caps = new Set(["workboard", "workboard_money"]);
  expect(await sendInvoiceToSm8(JOB, ["a"])).toMatchObject({ ok: false });
  caps = new Set(["workboard", "financials"]);
  expect(await sendInvoiceToSm8(JOB, ["a"])).toMatchObject({ ok: false });
  caps = new Set(["workboard", "workboard_money", "financials"]);
  expect(await sendInvoiceToSm8(JOB, [])).toEqual({ ok: false, error: "Tick the lines to put on the job first." });
  expect(await sendInvoiceToSm8("not-a-uuid", ["a"])).toMatchObject({ ok: false });
  expect(queued).toHaveLength(0);
});

it("sends nothing the draft can't price, and says why", async () => {
  readInvoiceDraft.mockResolvedValue({ cardId: JOB, taxRateUuid: "tax-1", draft: { ok: false, why: "Set a charge-out rate in Quoting to price an invoice." } });
  expect(await sendInvoiceToSm8(JOB, ["a"])).toEqual({ ok: false, error: "Set a charge-out rate in Quoting to price an invoice." });
  expect(queued).toHaveLength(0);
});

it("holds when sending to ServiceM8 is held, and when the job has gone there", async () => {
  sendRefusal.mockReturnValue("Sending quotes to ServiceM8 is paused.");
  expect(await sendInvoiceToSm8(JOB, ["a"])).toEqual({ ok: false, error: "Sending quotes to ServiceM8 is paused." });
  sendRefusal.mockReturnValue(null);
  readSm8Raw.mockResolvedValue({ ok: true, found: false, active: 0 });
  expect(await sendInvoiceToSm8(JOB, ["a"])).toMatchObject({ ok: false });
  expect(queued).toHaveLength(0);
});

it("says the invoice is sent again from ServiceM8 when it went before these lines", async () => {
  readInvoiceDraft.mockResolvedValue(draft([line("a")], { invoiced: true }));
  const a = await sendInvoiceToSm8(JOB, ["a"]);
  expect(a).toMatchObject({ ok: true, said: "1 of 1 line on job 3221 in ServiceM8. The job's invoice went before these lines: send it again from ServiceM8 to bill them." });
});
