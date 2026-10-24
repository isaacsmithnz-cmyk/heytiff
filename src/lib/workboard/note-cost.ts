import { visitDay, longDay, dayWord } from "./note-visit";
import {
  EXPENSE_CATEGORIES,
  MAX_CLAIM,
  isExpenseCategory,
  isPaidWith,
  type ExpenseCategory,
  type PaidWith,
} from "@/lib/expenses/claim";

/* A COST FROM A JOB'S CONVERSATION — pure, on both sides of the wire.

   v2 step 6, slice C. "$85 at Reece for fittings, on this job" said in a
   job's conversation records a cost against the job. The router reads it
   into the `costs` lane (note-brain); this file holds what a cost is, what
   Tiff asks when one is short of a figure, and what the conversation shows
   once it is made.

   WHERE A COST LIVES. A job has no cost record of its own: today a cost on a
   job IS an expense claim with the job picked (Add › Cost opens the expense
   form, 4-review.md "The Add table"), and `expense_claims.job_kind` takes a
   project, a maintenance visit or an agreement, never a ServiceM8 job (its
   check, docs/migrations/expense_paid_with.sql). So a cost is filed through
   the expense form's own action (`submitClaim`), as the speaker's claim, or
   as a company-card receipt when the card paid: linked to the job where the
   column can hold it, and with the ServiceM8 job named in its words where it
   can't (`costDescription`). A ServiceM8 material line was the other thing
   that exists, and it is not a cost: it is a line on the customer's invoice,
   a price change, which decision 13 asks first.

   DECISION 13 (6-revisions.md): in a job's conversation, costs just happen.
   So a cost with its amount files at once; one without asks "How much was
   it?" first, through the note's own question, as a visit with no day does.

   THE RECEIPT WINS, the way the expense form's scan does (my-expenses-face's
   `draftFromRead`): a figure the receipt reader read replaces the one said,
   and what was said fills only what the receipt couldn't read. GST IS NEVER
   DERIVED: "$85 plus GST" with no receipt asks for the total, rather than
   multiplying by 1.1. */

/** At most this many costs come off one note. */
export const COSTS_MAX = 3;

/** Whether the GST was said: in the amount ("85 inc"), on top of it ("85
    plus GST"), or not at all. */
export const GST_BASES = ["inc", "plus", "unsaid"] as const;
export type GstBasis = (typeof GST_BASES)[number];
export const isGstBasis = (v: unknown): v is GstBasis => (GST_BASES as readonly unknown[]).includes(v);

/** The categories the lane may file under: the claim's own. */
export const COST_CATEGORIES = EXPENSE_CATEGORIES;

export type ProposedCost = {
  /** In dollars as said, 0 when no amount was said. */
  amount: number;
  /** The GST figure, only when it was said; 0 when it wasn't. Never worked
      out from the amount. */
  gst: number;
  gstBasis: GstBasis;
  /** "Reece", as said. "" when not said. */
  supplier: string;
  /** What it was for, in the record's language: "fittings". */
  whatFor: string;
  category: ExpenseCategory;
  /** "YYYY-MM-DD" when a day was said, "" for today. */
  day: string;
  /** Whose money: the speaker's own, or the company card. */
  paidWith: PaidWith;
  /** Who paid, when it wasn't the speaker: a resolved staff_profile id, or
      null for the speaker (or a name nobody here goes by, which is asked). */
  payerId: string | null;
  /** The payer as the note said them; "" for the speaker. */
  payerHint: string;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

/** A dollar figure as the model wrote it: positive, at most a claim's
    ceiling, to the cent; 0 for none (or not a number). */
export const costAmount = (v: unknown): number =>
  typeof v === "number" && Number.isFinite(v) && v > 0 && v <= MAX_CLAIM ? round2(v) : 0;

const text = (v: unknown, max: number): string =>
  typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "";

/** One cost, re-derived field by field from what came in (the model's, or a
    stored proposal's). Null when it names no money and nothing bought: that
    is not a cost. The payer is resolved by the caller, which has the roster. */
export function costFields(r: {
  amount: unknown;
  gst: unknown;
  gstBasis: unknown;
  supplier: unknown;
  whatFor: unknown;
  category: unknown;
  day: unknown;
  paidWith: unknown;
  payerHint: unknown;
}): Omit<ProposedCost, "payerId"> | null {
  const amount = costAmount(r.amount);
  const supplier = text(r.supplier, 120);
  const whatFor = text(r.whatFor, 160);
  if (!amount && !supplier && !whatFor) return null;
  const gst = costAmount(r.gst);
  return {
    amount,
    /* GST above the total is a mis-hearing, as the receipt reader's own rule
       has it for a mis-read */
    gst: amount && gst > amount ? 0 : gst,
    gstBasis: isGstBasis(r.gstBasis) ? r.gstBasis : "unsaid",
    supplier,
    whatFor,
    category: isExpenseCategory(r.category) ? r.category : "materials",
    day: visitDay(r.day),
    paidWith: isPaidWith(r.paidWith) ? r.paidWith : "own",
    payerHint: text(r.payerHint, 200),
  };
}

/* ── the receipt ─────────────────────────────────────────────────────── */

/** What today's receipt reader (`readExpenseReceipt`) read off the photo:
    its own fields, null where it couldn't read one. */
export type ReceiptRead = {
  total: number | null;
  gst: number | null;
  supplier: string | null;
  date: string | null;
  description: string | null;
  category: ExpenseCategory | null;
};

/** A receipt photo that came with the note: the document it is (kind
    `receipt`, uploaded by the speaker) and what was read off it, or null
    when it couldn't be read. Kept on the note's proposal as `receipt`. */
export type NoteReceipt = { documentId: string; read: ReceiptRead | null };

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v > 0 ? round2(v) : null);
const strOrNull = (v: unknown, max: number): string | null => text(v, max) || null;

/** The proposal's `receipt`, shaped: anything that isn't one we wrote is no
    receipt at all. */
export function receiptOf(proposal: unknown): NoteReceipt | null {
  const p = (proposal && typeof proposal === "object" ? proposal : {}) as Record<string, unknown>;
  const r = (p.receipt && typeof p.receipt === "object" ? p.receipt : null) as Record<string, unknown> | null;
  if (!r || typeof r.documentId !== "string" || !r.documentId) return null;
  const x = (r.read && typeof r.read === "object" ? r.read : null) as Record<string, unknown> | null;
  return {
    documentId: r.documentId,
    read: x
      ? {
          total: num(x.total),
          gst: num(x.gst),
          supplier: strOrNull(x.supplier, 120),
          date: visitDay(x.date) || null,
          description: strOrNull(x.description, 200),
          category: isExpenseCategory(x.category) ? x.category : null,
        }
      : null,
  };
}

/** The cost with the receipt laid over it: what the receipt read wins, and
    what was said fills the rest. A total read off a receipt includes GST
    (the reader's own definition), so "plus GST" is settled by it. */
export function withReceipt(c: ProposedCost, read: ReceiptRead | null): ProposedCost {
  if (!read) return c;
  const amount = read.total ?? c.amount;
  const said = read.total === null ? c.gst : 0;
  const gst = read.gst ?? (said && said <= amount ? said : 0);
  return {
    ...c,
    amount,
    gst,
    gstBasis: read.total !== null ? "inc" : c.gstBasis,
    supplier: read.supplier ?? c.supplier,
    whatFor: read.description ?? c.whatFor,
    category: read.category ?? c.category,
    day: read.date ?? c.day,
  };
}

/** Which cost the receipt is for: the first, the one a photo with a note
    most plainly is. A second cost on the same note is filed from its words. */
export const RECEIPT_COST = 0;

/** The cost as it will be filed: the receipt's figures on the first. */
export const effectiveCost = (c: ProposedCost, index: number, receipt: NoteReceipt | null): ProposedCost =>
  index === RECEIPT_COST && receipt ? withReceipt(c, receipt.read) : c;

/* ── what is still missing, and the question ──────────────────────────── */

/** What a cost is short of before it can be filed: its amount, or the
    total where only a figure before GST was said. Null: nothing. */
export type CostGap = "amount" | "total";

export function costGap(c: Pick<ProposedCost, "amount" | "gstBasis">): CostGap | null {
  if (!c.amount) return "amount";
  if (c.gstBasis === "plus") return "total";
  return null;
}

const money = (n: number) =>
  `$${n.toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** "fittings at Reece", "fittings", "Reece", "that". */
export function costWhat(c: Pick<ProposedCost, "whatFor" | "supplier">): string {
  const w = c.whatFor.trim();
  const s = c.supplier.trim();
  return w && s ? `${w} at ${s}` : w || s || "that";
}

/** "How much was it: fittings at Reece?"; "What was the total with GST:
    $85.00 plus GST at Reece?" Answered in words, so no tap answers: a
    figure Tiff offered would be one she made up. */
export function costQuestion(c: ProposedCost, gap: CostGap): string {
  if (gap === "amount") return `How much was it: ${costWhat(c)}?`;
  return `What was the total with GST: ${money(c.amount)} plus GST${c.supplier ? ` at ${c.supplier}` : ""}?`;
}

/* ── what the claim says ─────────────────────────────────────────────── */

/** The claim's description: what it was for, and the job where the claim's
    own column can't name it (a ServiceM8 job). A cost said with no "what
    for" is the purchase at the supplier. Within the claim's 200. */
export function costDescription(c: Pick<ProposedCost, "whatFor" | "supplier">, unlinkedJob: string | null): string {
  const what = c.whatFor.trim() || (c.supplier.trim() ? `Purchase at ${c.supplier.trim()}` : "Purchase");
  const job = (unlinkedJob ?? "").trim();
  return (job ? `${what}, for ${job}` : what).slice(0, 200);
}

/* ── what a cost became ──────────────────────────────────────────────── */

/** How a cost was made:
      claim     the speaker's own money: an expense claim, waiting on approval;
      company   the company card: a receipt on record, nothing owed;
      task      it can't be the speaker's to file (`why`), so it is a task. */
export const COST_HOWS = ["claim", "company", "task"] as const;
export type CostHow = (typeof COST_HOWS)[number];

/** Why a cost became a task:
      payer   someone else paid from their own pocket, and a claim is the
              payer's own to make (`submitClaim` files for the caller only);
      fuel    fuel goes on the vehicle's log, as the expense form sends it. */
export const COST_WHYS = ["payer", "fuel"] as const;
export type CostWhy = (typeof COST_WHYS)[number];

/** A cost a note made, as `workboard_notes.applied.costs` records it: enough
    to draw its card and for Undo to take it back. */
export type CostMade = {
  /** Its place in the stored proposal's `costs`. */
  index: number;
  how: CostHow;
  why: CostWhy | null;
  amount: number;
  /** The GST figure filed, or 0 for none. */
  gst: number;
  supplier: string;
  whatFor: string;
  /** The day it is filed under. */
  day: string;
  /** The person whose task it is, for a `task`. */
  staffId: string | null;
  /** Their first name. */
  name: string;
  /** The expense claim it is, for `claim` and `company`: what Undo cancels. */
  claimId: string | null;
  /** The task it is, for a `task`. */
  taskId: string | null;
  /** The receipt document filed with it, when there was one. */
  receiptId: string | null;
  /** Its figures came off the receipt. */
  fromReceipt: boolean;
  /** Taken back by its own Undo. */
  undone: boolean;
};

const s = (v: unknown) => (typeof v === "string" ? v : "");

/** The column's `costs`, shaped: anything that is not one we wrote is
    dropped. */
export function costsOf(raw: unknown): CostMade[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((x): CostMade[] => {
    if (!x || typeof x !== "object") return [];
    const r = x as Record<string, unknown>;
    if (!Number.isInteger(r.index) || !(COST_HOWS as readonly unknown[]).includes(r.how)) return [];
    return [
      {
        index: r.index as number,
        how: r.how as CostHow,
        why: (COST_WHYS as readonly unknown[]).includes(r.why) ? (r.why as CostWhy) : null,
        amount: typeof r.amount === "number" ? r.amount : 0,
        gst: typeof r.gst === "number" ? r.gst : 0,
        supplier: s(r.supplier),
        whatFor: s(r.whatFor),
        day: s(r.day),
        staffId: s(r.staffId) || null,
        name: s(r.name),
        claimId: s(r.claimId) || null,
        taskId: s(r.taskId) || null,
        receiptId: s(r.receiptId) || null,
        fromReceipt: r.fromReceipt === true,
        undone: r.undone === true,
      },
    ];
  });
}

/** "$85.00 at Reece", "$85.00". */
export const costTitle = (c: Pick<CostMade, "amount" | "supplier">): string =>
  `${money(c.amount)}${c.supplier.trim() ? ` at ${c.supplier.trim()}` : ""}`;

/** The title of the task a cost became: "Claim $85.00 at Reece", "Log fuel:
    $85.00 at BP". */
export function costTaskTitle(c: Pick<CostMade, "amount" | "supplier">, why: CostWhy): string {
  return why === "fuel" ? `Log fuel: ${costTitle(c)}` : `Claim ${costTitle(c)}`;
}

/** What that task says: what it was for, the day, the job, and for a payer
    who the cost was said by. */
export function costTaskDetail(
  c: Pick<CostMade, "whatFor" | "day">,
  why: CostWhy,
  input: { job: string | null; saidBy: string; today: string },
): string {
  const day = dayWord(c.day, input.today);
  const what = [c.whatFor.trim(), day, input.job ? `for ${input.job}` : ""].filter(Boolean).join(", ");
  const tail =
    why === "payer"
      ? `${input.saidBy || "Someone"} said you paid. Claim it in Expense claims.`
      : "Log it on your vehicle.";
  return [what && `${what[0]!.toUpperCase()}${what.slice(1)}.`, tail].filter(Boolean).join(" ");
}

/** The card the conversation draws for a cost made. */
export type CostCard = {
  index: number;
  how: CostHow;
  /** "$85.00 at Reece"; the task's own title for a `task`. */
  title: string;
  /** "Fittings, Tuesday 13 October". */
  line: string;
  /** Where the claim stands, or whose task it is: said under it. */
  aside: string;
  /** Its figures came off the receipt. */
  receipt: boolean;
  /** Its own Undo is offered. */
  undo: boolean;
};

export const COST_ASIDE = {
  claim: "Waiting on approval.",
  company: "On the company card.",
} as const;

/** The cards, one per cost still standing, in the order they were said. */
export function costCards(made: readonly CostMade[]): CostCard[] {
  return made
    .filter((c) => !c.undone)
    .sort((a, b) => a.index - b.index)
    .map((c) => {
      const what = c.whatFor.trim();
      return {
        index: c.index,
        how: c.how,
        title: c.how === "task" ? costTaskTitle(c, c.why ?? "payer") : costTitle(c),
        line: [what && `${what[0]!.toUpperCase()}${what.slice(1)}`, longDay(c.day)].filter(Boolean).join(", "),
        aside: c.how === "task" ? (c.name ? `A task for ${c.name}.` : "") : COST_ASIDE[c.how],
        receipt: c.fromReceipt,
        undo: !!c.claimId || !!c.taskId,
      };
    });
}

/* ── what Tiff says ──────────────────────────────────────────────────── */

/** Her line for a cost made, in the record's language like her other
    server lines. `said`: the amount the words gave, when the receipt read
    another, so she says which she used. */
export function costDoneLine(c: CostMade, said: number, receiptUnread: boolean): string {
  const title = costTitle(c);
  const what = c.whatFor.trim() ? `, ${c.whatFor.trim()}` : "";
  const from =
    c.fromReceipt && said && said !== c.amount
      ? ` The receipt says ${money(c.amount)}, so that's what I used.`
      : receiptUnread
        ? " I couldn't read the receipt, so it's from what you said."
        : "";
  switch (c.how) {
    case "claim":
      return `Claimed: ${title}${what}. It's waiting on approval.${from}`;
    case "company":
      return `On the company card: ${title}${what}.${from}`;
    case "task":
      return c.why === "fuel"
        ? `Fuel goes on the vehicle's log, so I've made it a task: ${costTaskTitle(c, "fuel")}.${from}`
        : `A claim is the payer's own to make, so I've made it a task for ${c.name || "them"}: ${costTaskTitle(c, "payer")}.${from}`;
  }
}

/** Her line when the expense action refused it: its own words. */
export const costRefusedLine = (c: Pick<ProposedCost, "amount" | "supplier">, error: string): string =>
  `${c.amount ? costTitle(c) : "That cost"} wasn't recorded. ${error.trim()}`;

/** Her line when its own Undo took it back. */
export const costUndoneLine = (c: Pick<CostMade, "amount" | "supplier" | "how">): string =>
  c.how === "task" ? `${costTitle(c)} task taken back.` : `${costTitle(c)} taken back.`;

/** The cost as the router is told it on a reply. */
export function costRowLine(c: ProposedCost, payer: string): string {
  const amount = c.amount
    ? `${money(c.amount)}${c.gstBasis === "plus" ? " plus GST" : c.gstBasis === "inc" ? " inc GST" : ""}`
    : "no amount yet";
  const paid = c.paidWith === "company" ? "company card" : `paid by ${payer}`;
  return `Cost: ${amount}, ${costWhat(c)}, ${paid}, ${c.day || "today"}`;
}

/** The plan row's words: "$85.00 at Reece, fittings"; "Fittings at Reece"
    while the amount is to come. */
export function costRowText(c: ProposedCost): string {
  if (!c.amount) {
    const w = costWhat(c);
    return `${w[0]!.toUpperCase()}${w.slice(1)}`;
  }
  return `${costTitle(c)}${c.whatFor.trim() ? `, ${c.whatFor.trim()}` : ""}`;
}
