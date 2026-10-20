/**
 * @jest-environment node
 */

/* AN ACCEPTED VARIATION TO SERVICEM8 (Isaac, 2026-10-18, decision 21: extra
   lines on the original job) — the press.

   The plan is the real one (sm8-variation-plan, against a faked read of the
   quote and the mirror); ServiceM8, the press and the queue are faked at
   their doors. The queue keeps one row per subject, as sm8_writes' key
   does, so a second press of the same variation queues nothing new. */

type Row = Record<string, unknown>;

let caps = new Set<string>();
jest.mock("@/lib/permissions-server", () => ({
  can: async (c: string) => caps.has(c),
  requireOrg: async (c: string) => {
    if (!caps.has(c)) throw new Error("no");
    return { orgId: "org-1" };
  },
}));

/* sm8_writes, as the queue fills it */
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
        Promise.resolve({ data: writes.filter((w) => filters.every(([c, v]) => v.includes(w[c]))).map((w) => ({ ...w })), error: null }).then(res);
      return b;
    },
  },
}));
jest.mock("@/lib/integrations/sm8-kinds", () => ({ sm8QuotesAllowed: () => true }));
jest.mock("@/lib/integrations/sm8-press", () => ({ sm8PressFromSession: async () => ({ orgId: "org-1", userId: "auth0|me", staffId: "s-me", at: Date.now() }) }));
jest.mock("@/lib/integrations/sm8-writes", () => ({ readSm8WriteState: jest.fn() }));
/* nothing holds a quote unless a test says so */
const sendRefusal = jest.fn((): string | null => null);
jest.mock("@/lib/integrations/sm8-write-plan", () => ({ offersSend: () => true, sendRefusal: () => sendRefusal() }));
jest.mock("@/lib/integrations/sm8-drain", () => ({ settlePressedWrites: jest.fn(async () => undefined) }));
jest.mock("@/lib/integrations/sm8-freshness", () => ({ syncSm8AfterSend: jest.fn() }));
jest.mock("@/lib/integrations/sm8-store", () => ({ sm8AccessResult: async () => ({ ok: true, access: {} }) }));
jest.mock("@/lib/integrations/sm8-http", () => ({ sm8CallOf: () => ({}) }));
const readSm8Raw = jest.fn();
jest.mock("@/lib/integrations/sm8-write", () => ({ readSm8Raw: (...a: unknown[]) => readSm8Raw(...a) }));
let onTrial = false;
jest.mock("@/lib/integrations/sm8-quote-trial", () => ({ quotesOnTrial: async () => onTrial }));

const readVariationSendView = jest.fn();
jest.mock("@/lib/quotes/sm8-send-server", () => ({
  readSm8SendView: jest.fn(),
  readVariationSendView: (...a: unknown[]) => readVariationSendView(...a),
}));
const markVariationSent = jest.fn(async () => ({ ok: true }));
jest.mock("@/lib/quotes/lines-job-server", () => ({
  markSent: jest.fn(),
  markVariationSent: (...a: unknown[]) => (markVariationSent as jest.Mock)(...a),
}));

/* the queue's one door: one row per subject, for good */
let status = "sent";
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
        w = { id: `w-${++n}`, subject, status, last_error: null, remote_uuid: `0000000a-0000-4000-8000-00000000000${n}` };
        writes.push(w);
        ids.push(w.id as string);
      } else if (w.status !== "sent") {
        w.status = status;
        ids.push(w.id as string);
      }
    }
    return { ok: true, ids };
  },
}));

import { sendQuoteToSm8, sendVariationToSm8 } from "../quote-sm8";
import { variationSendPlan, INVOICE_AGAIN } from "@/lib/quotes/sm8-variation-plan";
import { QUOTE_WORDS } from "@/lib/integrations/sm8-quote-plan";
import type { Variation } from "@/lib/quotes/lines-job";

const JOB = "0000000b-0000-4000-8000-000000003209";
const variation = (over: Partial<Variation> = {}): Variation => ({
  n: 1,
  option: 1,
  of: 0,
  what: "return grille in Bed 2",
  startedAt: "2026-10-18T01:00:00.000Z",
  startedBy: "auth0|me",
  approvedAt: "2026-10-18T02:00:00.000Z",
  acceptedAt: "2026-10-18T03:00:00.000Z",
  ...over,
});
const LINES = [
  { name: "Variation 1: return grille, Bed 2", quantity: 1, unitPriceCents: 5600, unitCostCents: 4000 },
  { name: "Variation 1: flexible duct 150", quantity: 3, unitPriceCents: 1200, unitCostCents: 800 },
  { name: "Variation 1: labour", quantity: 0.25, unitPriceCents: 112000, unitCostCents: null },
];
function view(v: Variation | null = variation(), job = { status: "Work Order", invoiced: false, number: "3209" }) {
  readVariationSendView.mockResolvedValue({
    variation: v,
    plan: variationSendPlan({ variation: v, lines: LINES, left: 0, job, existing: 4, taxRateUuid: "gst" }),
  });
}

beforeEach(() => {
  caps = new Set(["workboard_manage", "financials"]);
  writes = [];
  queued.length = 0;
  n = 0;
  status = "sent";
  readSm8Raw.mockReset().mockResolvedValue({ ok: true, found: true, active: 1, row: { status: "Work Order" } });
  markVariationSent.mockClear();
  view();
});

it("adds the variation's lines to the job and takes nothing off, and keeps what went on the variation", async () => {
  const a = await sendVariationToSm8(JOB, 1);
  expect(a).toEqual({ ok: true, trial: false, sent: 3, lines: 3, waiting: 0, failed: [], invoiced: false, said: "Sent to ServiceM8 as 3 lines on job 3209." });
  const rows = queued[0]!.rows;
  expect(rows.map((r) => [r.object, r.op])).toEqual([
    ["jobmaterial", "create"],
    ["jobmaterial", "create"],
    ["jobmaterial", "create"],
  ]);
  expect(rows.map((r) => (r.fields as Row).name)).toEqual(["Variation 1: return grille, Bed 2", "Variation 1: flexible duct 150", "Variation 1: labour"]);
  /* what went, on which job, under which uuids */
  expect(markVariationSent).toHaveBeenCalledWith(
    "org-1",
    JOB,
    1,
    expect.objectContaining({ trial: false, jobNumber: "3209", lines: 3, sent: 3, lineUuids: writes.map((w) => w.remote_uuid) }),
    "auth0|me"
  );
});

it("goes once: a second press is the same rows, and one after it all went queues nothing", async () => {
  await sendVariationToSm8(JOB, 1);
  await sendVariationToSm8(JOB, 1);
  /* the variation's own press id, the same both times: the queue made no new row */
  expect(queued[1]!.pressId).toBe(queued[0]!.pressId);
  expect(writes).toHaveLength(3);

  /* recorded as all gone: nothing is queued at all */
  const sent = variation({ sm8: { at: "2026-10-18T03:01:00.000Z", by: "auth0|me", trial: false, jobNumber: "3209", lines: 3, sent: 3, lineUuids: [] } });
  view(sent);
  queued.length = 0;
  const again = await sendVariationToSm8(JOB, 1);
  expect(again).toEqual({ ok: false, error: "Variation 1 is on job 3209 in ServiceM8 already, so nothing goes twice. A further change is a new variation." });
  expect(queued).toHaveLength(0);
});

it("gives a variation started again in its place a press id of its own", async () => {
  await sendVariationToSm8(JOB, 1);
  view(variation({ startedAt: "2026-10-19T01:00:00.000Z" }));
  await sendVariationToSm8(JOB, 1);
  expect(queued[1]!.pressId).not.toBe(queued[0]!.pressId);
  expect(queued[0]!.pressId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
});

it("adds its lines to an invoiced job, and says to send the invoice again from ServiceM8", async () => {
  view(variation(), { status: "Completed", invoiced: true, number: "3209" });
  const a = await sendVariationToSm8(JOB, 1);
  expect(a.ok && a.invoiced).toBe(true);
  expect(a.ok && a.said).toBe(`Sent to ServiceM8 as 3 lines on job 3209. ${INVOICE_AGAIN}`);
});

it("says a trial run sent nothing, and a later press goes again", async () => {
  status = "trial";
  const a = await sendVariationToSm8(JOB, 1);
  expect(a).toMatchObject({ ok: true, trial: true, sent: 0, said: "Trial run: 3 lines for job 3209 checked, and nothing went to ServiceM8." });
  expect(markVariationSent).toHaveBeenCalledWith("org-1", JOB, 1, expect.objectContaining({ trial: true, sent: 0, lineUuids: [] }), "auth0|me");
});

it("is the quote send's own gate: Workboard manage and money access", async () => {
  caps = new Set(["financials"]);
  expect(await sendVariationToSm8(JOB, 1)).toEqual({ ok: false, error: QUOTE_WORDS.press.noManage });
  caps = new Set(["workboard_manage"]);
  expect(await sendVariationToSm8(JOB, 1)).toEqual({ ok: false, error: QUOTE_WORDS.press.noManage });
  expect(queued).toHaveLength(0);
});

it("sends nothing to a job ServiceM8 no longer has, or one still a quote", async () => {
  readSm8Raw.mockResolvedValue({ ok: true, found: false });
  expect(await sendVariationToSm8(JOB, 1)).toEqual({ ok: false, error: QUOTE_WORDS.row.gone });
  view(variation(), { status: "Quote", invoiced: false, number: "3209" });
  expect((await sendVariationToSm8(JOB, 1)).ok).toBe(false);
  expect(queued).toHaveLength(0);
});

/* 3414, 21 October: a grant without manage_job_materials queued "0 sent,
   2 still going" for good. Held is said at the press, and nothing queues */
it("says what holds a quote before anything is queued, a trial run aside", async () => {
  sendRefusal.mockReturnValue(QUOTE_WORDS.press.scope);
  expect(await sendVariationToSm8(JOB, 1)).toEqual({ ok: false, error: QUOTE_WORDS.press.scope });
  expect(await sendQuoteToSm8(JOB, "0000000b-0000-4000-8000-000000000001", "2026-10-21 08:26:46", "plan", "quote")).toEqual({ ok: false, error: QUOTE_WORDS.press.scope });
  expect(queued).toHaveLength(0);
  /* a quote on its own trial run goes nowhere, so the permission doesn't hold it */
  onTrial = true;
  expect((await sendVariationToSm8(JOB, 1)).ok).toBe(true);
  /* the owner's own Off holds even a trial run */
  sendRefusal.mockReturnValue(QUOTE_WORDS.press.kindOff);
  expect(await sendVariationToSm8(JOB, 1)).toEqual({ ok: false, error: QUOTE_WORDS.press.kindOff });
  onTrial = false;
  sendRefusal.mockReturnValue(null);
});
