/* THE COST LANE (v2 step 6, slice C) — the schema, the prompt rule, the
   shaper, and the pure half of "how much was it?" and the receipt. The
   server half (filing through the expense form's action, the receipt photo,
   Undo, the gates) is in actions/__tests__/workboard-notes-costs.test.ts.
   No model is called. */

import {
  NOTE_SCHEMA,
  TIFF_NOTE_SCHEMA,
  isEmptyProposal,
  rowLine,
  shapeProposal,
  systemBlocks,
  type NoteContext,
} from "../note-brain";
import { planRows, storedProposal, toDraft, withoutRows } from "../note-draft";
import { recordStrings, withTranslations } from "../note-english";
import {
  costCards,
  costDescription,
  costDoneLine,
  costGap,
  costQuestion,
  costsOf,
  effectiveCost,
  receiptOf,
  withReceipt,
  type CostMade,
  type ProposedCost,
} from "../note-cost";
import { costRoute } from "../note-cost-file";
import { appliedOf, doorsOf, takesBack, undoSummary } from "../note-applied";

jest.mock("@/lib/supabase-server", () => ({ supabaseAdmin: {} }));
jest.mock("@/lib/images/for-claude", () => ({ imageForClaude: jest.fn() }));
jest.mock("@/app/actions/expense-ai", () => ({ readExpenseReceipt: jest.fn() }));
jest.mock("@/app/actions/expenses", () => ({ submitClaim: jest.fn() }));

const STAFF = [
  { id: "s-me", fullName: "Isaac Smith" },
  { id: "s-lyle", fullName: "Lyle Irving" },
  { id: "s-alex-l", fullName: "Alex Lomond" },
  { id: "s-alex-b", fullName: "Alex Brown" },
];
const ctx: NoteContext = {
  staff: STAFF,
  todayISO: "2026-10-13",
  author: { id: "s-me", fullName: "Isaac Smith" },
  askWho: true,
  speak: true,
};

const raw = (costs: unknown[], over: Record<string, unknown> = {}) => ({
  tasks: [],
  visits: [],
  costs,
  bring_items: [],
  flags: [],
  progress_bullets: [],
  commissioning_entries: [],
  issue_entries: [],
  kb_entries: [],
  plain_note: "",
  say: "",
  clarify_needed: false,
  clarify_question: "",
  clarify_options: [],
  ...over,
});

/** "$85 at Reece for fittings, on this job", as the model writes it. */
const reece = (over: Record<string, unknown> = {}) => ({
  amount: 85,
  gst: 0,
  gst_basis: "unsaid",
  supplier: "Reece",
  what_for: "fittings",
  category: "materials",
  day: "",
  paid_with: "own",
  payer_hint: "",
  ...over,
});

const COST: ProposedCost = {
  amount: 85,
  gst: 0,
  gstBasis: "unsaid",
  supplier: "Reece",
  whatFor: "fittings",
  category: "materials",
  day: "",
  paidWith: "own",
  payerId: null,
  payerHint: "",
};

describe("the schema", () => {
  type Lane = {
    type: string;
    items: { properties: Record<string, { type: string; enum?: string[] }>; required: string[] };
  };

  it("has a costs lane, every field required and none nullable", () => {
    for (const schema of [NOTE_SCHEMA, TIFF_NOTE_SCHEMA]) {
      const lane = (schema.properties as Record<string, unknown>).costs as Lane;
      expect(lane.type).toBe("array");
      expect(Object.keys(lane.items.properties).sort()).toEqual(
        ["amount", "category", "day", "gst", "gst_basis", "paid_with", "payer_hint", "supplier", "what_for"],
      );
      expect(lane.items.required.sort()).toEqual(Object.keys(lane.items.properties).sort());
      expect(lane.items.properties.amount.type).toBe("number");
      expect(lane.items.properties.gst.type).toBe("number");
      expect(lane.items.properties.gst_basis.enum).toEqual(["inc", "plus", "unsaid"]);
      expect(lane.items.properties.paid_with.enum).toEqual(["own", "company"]);
      expect(lane.items.properties.category.enum).toEqual(["materials", "tools", "travel", "meals", "fuel", "other"]);
      expect(schema.required).toContain("costs");
    }
  });

  it("adds no nullable field: the schema still has none of its 16", () => {
    expect(JSON.stringify(TIFF_NOTE_SCHEMA)).not.toMatch(/"null"|nullable|anyOf/);
  });
});

describe("the prompt rule", () => {
  const head = systemBlocks(ctx)[0]!.text;
  const rule = head.slice(head.indexOf("- costs:"), head.indexOf("- variations:"));

  it("is in the cached head, said once, short", () => {
    expect(head).toContain("- costs: money spent for the job, '$85 at Reece for fittings'.");
    expect(head).toContain("A cost is not also a task.");
    expect(head.match(/- costs:/g)).toHaveLength(1);
    // the head grew by this much, as note-brain's systemBlocks says
    expect(rule.length).toBe(266);
  });

  it("names nobody and no day: the head is the same bytes for every note", () => {
    expect(systemBlocks({ staff: [], todayISO: "2027-01-01" })[0]!.text).toBe(head);
  });

  it("says a receipt came with the note after the cache mark, only when one did", () => {
    expect(systemBlocks({ ...ctx, receipt: true })[1]!.text).toContain("A receipt photo came with this note: it is a cost");
    expect(systemBlocks(ctx)[1]!.text).not.toContain("receipt");
  });
});

describe("the shaper", () => {
  it("reads $85 at Reece for fittings: the speaker's own money, today", () => {
    const p = shapeProposal(raw([reece()]), ctx);
    expect(p.costs).toEqual([COST]);
    expect(p.clarify).toBeNull();
    expect(isEmptyProposal(p)).toBe(false);
  });

  it("holds every figure to a claim's rules: cents, positive, GST under the amount, a real day", () => {
    const p = shapeProposal(
      raw([
        reece({ amount: 85.456, gst: 7.734, day: "2026-10-12" }),
        reece({ amount: -3, gst: 900, day: "2026-02-31" }),
        reece({ amount: 1e9 }),
      ]),
      ctx,
    );
    expect(p.costs.map((c) => [c.amount, c.gst, c.day])).toEqual([
      [85.46, 7.73, "2026-10-12"],
      [0, 900, ""],
      [0, 0, ""],
    ]);
    expect(shapeProposal(raw([reece({ amount: 10, gst: 20 })]), ctx).costs[0]!.gst).toBe(0);
  });

  it("drops a cost that names no money and nothing bought", () => {
    expect(shapeProposal(raw([reece({ amount: 0, supplier: "", what_for: "" })]), ctx).costs).toEqual([]);
  });

  it("falls back where the model strays: materials, the speaker's own money, GST unsaid", () => {
    const [c] = shapeProposal(raw([reece({ category: "snacks", paid_with: "mum", gst_basis: "maybe" })]), ctx).costs;
    expect(c).toMatchObject({ category: "materials", paidWith: "own", gstBasis: "unsaid" });
  });

  it("keeps three costs off one note at most", () => {
    expect(shapeProposal(raw([reece(), reece(), reece(), reece()]), ctx).costs).toHaveLength(3);
  });

  it("resolves who paid: someone else by name, the speaker as themselves", () => {
    expect(shapeProposal(raw([reece({ payer_hint: "Lyle" })]), ctx).costs[0]).toMatchObject({
      payerId: "s-lyle",
      payerHint: "Lyle",
    });
    expect(shapeProposal(raw([reece({ payer_hint: "me" })]), ctx).costs[0]).toMatchObject({ payerId: null, payerHint: "" });
  });

  it("asks which one when two people answer to the payer's name", () => {
    const p = shapeProposal(raw([reece({ payer_hint: "Alex" })]), ctx);
    expect(p.clarify).toEqual({ question: "Which Alex did you mean?", options: ["Alex L", "Alex B"] });
  });

  it("asks who paid when nobody here goes by the name, unless the company card paid", () => {
    expect(shapeProposal(raw([reece({ payer_hint: "Bobo" })]), ctx, "Bobo paid $85 at Reece, ask Lyle").clarify).toEqual({
      question: "Who paid: Bobo?",
      options: ["Me", "Lyle"],
    });
    expect(shapeProposal(raw([reece({ payer_hint: "Bobo", paid_with: "company" })]), ctx).clarify).toBeNull();
  });
});

describe("the draft, the plan and a reply", () => {
  const p = shapeProposal(raw([reece()]), ctx);

  it("is a plan row the modal can take off, with words a reply can read", () => {
    const rows = planRows(p);
    expect(rows).toEqual([{ key: "costs:0", lane: "costs", index: 0, text: "$85.00 at Reece, fittings" }]);
    expect(rowLine(rows[0]!, p, STAFF)).toBe("Cost: $85.00, fittings at Reece, paid by the speaker, today");
    expect(withoutRows(toDraft(p), ["costs:0"]).costs[0]!.on).toBe(false);
  });

  it("says where the amount is still to come, and what plus GST meant", () => {
    const later = shapeProposal(raw([reece({ amount: 0 }), reece({ gst_basis: "plus", payer_hint: "Lyle" })]), ctx);
    expect(planRows(later).map((r) => r.text)).toEqual(["Fittings at Reece", "$85.00 at Reece, fittings"]);
    expect(rowLine(planRows(later)[1]!, later, STAFF)).toBe(
      "Cost: $85.00 plus GST, fittings at Reece, paid by Lyle Irving, today",
    );
  });

  it("comes back from storage through the same checks, and a proposal from before the lane has none", () => {
    expect(storedProposal(JSON.parse(JSON.stringify(p)))!.costs).toEqual(p.costs);
    expect(storedProposal({ ...p, costs: [{ ...p.costs[0], amount: "lots", gst: -1 }] })!.costs[0]).toMatchObject({
      amount: 0,
      gst: 0,
    });
    const { costs: _gone, ...old } = p;
    void _gone;
    expect(storedProposal(old)!.costs).toEqual([]);
  });

  it("records what it was for in English, and leaves the supplier's name as said", () => {
    const vi = shapeProposal(raw([reece({ what_for: "phụ kiện", supplier: "Reece Phú" })]), ctx);
    expect(recordStrings(vi)).toEqual(["phụ kiện"]);
    expect(withTranslations(vi, new Map([["phụ kiện", "fittings"]])).costs[0]).toMatchObject({
      whatFor: "fittings",
      supplier: "Reece Phú",
    });
  });
});

describe("the receipt", () => {
  const read = {
    total: 93.5,
    gst: 8.5,
    supplier: "Reece Plumbing Preston",
    date: "2026-10-12",
    description: "Copper fittings and flux",
    category: "materials" as const,
  };

  it("wins over what was said, field by field, as the expense form's scan does", () => {
    expect(withReceipt(COST, read)).toEqual({
      ...COST,
      amount: 93.5,
      gst: 8.5,
      gstBasis: "inc",
      supplier: "Reece Plumbing Preston",
      whatFor: "Copper fittings and flux",
      day: "2026-10-12",
    });
  });

  it("lets the words fill what it couldn't read", () => {
    const blank = { total: null, gst: null, supplier: null, date: null, description: null, category: null };
    expect(withReceipt({ ...COST, gst: 7.73 }, blank)).toEqual({ ...COST, gst: 7.73 });
    expect(withReceipt(COST, null)).toBe(COST);
  });

  it("settles plus GST with its total, and is the first cost's only", () => {
    const plus = { ...COST, gstBasis: "plus" as const };
    const receipt = { documentId: "doc-1", read };
    expect(costGap(effectiveCost(plus, 0, receipt))).toBeNull();
    expect(costGap(effectiveCost(plus, 1, receipt))).toBe("total");
  });

  it("comes off the proposal only as we wrote it", () => {
    expect(receiptOf({ receipt: { documentId: "doc-1", read: { ...read, date: "yesterday", category: "snacks" } } })).toEqual({
      documentId: "doc-1",
      read: { ...read, date: null, category: null },
    });
    expect(receiptOf({ receipt: { documentId: "doc-1", read: null } })).toEqual({ documentId: "doc-1", read: null });
    expect(receiptOf({ receipt: { documentId: 7 } })).toBeNull();
    expect(receiptOf(null)).toBeNull();
  });
});

describe("what is asked first", () => {
  it("asks how much when no amount was said", () => {
    expect(costGap({ amount: 0, gstBasis: "unsaid" })).toBe("amount");
    expect(costQuestion({ ...COST, amount: 0 }, "amount")).toBe("How much was it: fittings at Reece?");
    expect(costQuestion({ ...COST, amount: 0, whatFor: "", supplier: "" }, "amount")).toBe("How much was it: that?");
  });

  it("asks for the total when only a figure before GST was said: GST is never worked out", () => {
    expect(costGap({ amount: 85, gstBasis: "plus" })).toBe("total");
    expect(costQuestion(COST, "total")).toBe("What was the total with GST: $85.00 plus GST at Reece?");
    expect(costGap({ amount: 85, gstBasis: "inc" })).toBeNull();
  });
});

describe("which way it goes", () => {
  it("is the speaker's claim, or the company's receipt", () => {
    expect(costRoute(COST, "s-me")).toEqual({ kind: "claim" });
    expect(costRoute({ ...COST, paidWith: "company", payerId: "s-lyle" }, "s-me")).toEqual({ kind: "claim" });
  });

  it("is a task for whoever paid from their own pocket, and for the speaker's fuel", () => {
    expect(costRoute({ ...COST, payerId: "s-lyle" }, "s-me")).toEqual({ kind: "task", why: "payer", staffId: "s-lyle" });
    expect(costRoute({ ...COST, category: "fuel" }, "s-me")).toEqual({ kind: "task", why: "fuel", staffId: "s-me" });
  });

  it("names a ServiceM8 job in the claim's words, where its column can't hold one", () => {
    expect(costDescription(COST, "#3209 — Richards")).toBe("fittings, for #3209 — Richards");
    expect(costDescription({ whatFor: "", supplier: "Reece" }, null)).toBe("Purchase at Reece");
  });
});

describe("what it became", () => {
  const made = (over: Partial<CostMade> = {}): CostMade => ({
    index: 0,
    how: "claim",
    why: null,
    amount: 85,
    gst: 0,
    supplier: "Reece",
    whatFor: "fittings",
    day: "2026-10-13",
    staffId: null,
    name: "",
    claimId: "claim-1",
    taskId: null,
    receiptId: null,
    fromReceipt: false,
    undone: false,
    ...over,
  });

  it("draws a card per cost standing, each with its own Undo", () => {
    expect(
      costCards([
        made({ index: 1, how: "company", claimId: "claim-2" }),
        made(),
        made({ index: 2, how: "task", why: "payer", claimId: null, taskId: "t-1", name: "Lyle" }),
        made({ index: 3, undone: true }),
      ]),
    ).toEqual([
      { index: 0, how: "claim", title: "$85.00 at Reece", line: "Fittings, Tuesday 13 October", aside: "Waiting on approval.", receipt: false, undo: true },
      { index: 1, how: "company", title: "$85.00 at Reece", line: "Fittings, Tuesday 13 October", aside: "On the company card.", receipt: false, undo: true },
      { index: 2, how: "task", title: "Claim $85.00 at Reece", line: "Fittings, Tuesday 13 October", aside: "A task for Lyle.", receipt: false, undo: true },
    ]);
  });

  it("says what she did, which figure she used, and why a task", () => {
    expect(costDoneLine(made(), 85, false)).toBe("Claimed: $85.00 at Reece, fittings. It's waiting on approval.");
    expect(costDoneLine(made({ amount: 93.5, fromReceipt: true }), 85, false)).toBe(
      "Claimed: $93.50 at Reece, fittings. It's waiting on approval. The receipt says $93.50, so that's what I used.",
    );
    expect(costDoneLine(made({ how: "company" }), 85, true)).toBe(
      "On the company card: $85.00 at Reece, fittings. I couldn't read the receipt, so it's from what you said.",
    );
    expect(costDoneLine(made({ how: "task", why: "payer", name: "Lyle" }), 85, false)).toBe(
      "A claim is the payer's own to make, so I've made it a task for Lyle: Claim $85.00 at Reece.",
    );
    expect(costDoneLine(made({ how: "task", why: "fuel", supplier: "BP" }), 85, false)).toBe(
      "Fuel goes on the vehicle's log, so I've made it a task: Log fuel: $85.00 at BP.",
    );
  });

  it("is on the record for Undo, a door, and in what Undo says it took", () => {
    const a = appliedOf({ v: 2, taskIds: [], costs: [made(), made({ index: 1, undone: true }), { index: "x" }] });
    expect(a.costs).toHaveLength(2);
    expect(costsOf("nope")).toEqual([]);
    expect(takesBack(a)).toBe(true);
    expect(doorsOf(a)).toEqual([{ kind: "costs", count: 1, label: "1 cost recorded", ids: ["claim-1"] }]);
    expect(undoSummary(a)).toBe("1 cost taken back.");
  });
});
