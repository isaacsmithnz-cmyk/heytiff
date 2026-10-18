import type { BuildUp } from "./buildup";
import type { ProposalDraft } from "./proposal";
import { variationInSm8, type Variation } from "./lines-job";
import { optionLines, type SendLine } from "./sm8-send-plan";
import { QUOTE_WORDS, type QuoteRowInput } from "@/lib/integrations/sm8-quote-plan";

/* AN ACCEPTED VARIATION, AS SERVICEM8 WILL HOLD IT (Isaac, 2026-10-18,
   decision 21 of the layout plan: an approved variation goes to ServiceM8
   as extra lines on the original job, 6-revisions.md).

   ADD, NEVER REMOVE. The job's lines stay where they are: the accepted
   quote's, anything a person put on in ServiceM8, an earlier variation's.
   A variation only adds lines, each named as its own: "Variation 1: return
   grille, Bed 2". No job record is written, so its status and descriptions
   are never touched.

   PRICED AS THE DIFFERENCE, the way the variation is priced (6-revisions.md,
   "Versions and variations"; the variation paper's "Variation 1 +$420").
   Where the customer sees totals only, one line at what the variation adds
   to the accepted quote. Where they see line items, each line the accepted
   option's build and the variation's build disagree on: one it adds at its
   price, one it has more of for the extra, one it takes off or has fewer of
   as a credit (a negative price, the variation's own pricing producing it),
   and one whose price moved at the difference. So the lines always come to
   what the variation adds, ex GST, as the quote send prices its lines: a
   unit price and unit cost on the tax rate the business's own lines use.

   ONCE. A variation whose lines are all in ServiceM8 for real sends
   nothing again (variationInSm8); the queue's own key, one row per line per
   variation, holds the same if two presses race. Pure. */

export type VariationSendPlan =
  | {
      ok: true;
      n: number;
      lines: SendLine[];
      /** the lines already on the job: the variation's sort after them */
      after: number;
      taxRateUuid: string;
      /** what the lines come to, ex GST: the variation's difference */
      exGstCents: number;
      /** the job's invoice has gone already: it is sent again from ServiceM8 */
      invoiced: boolean;
      jobNumber: string | null;
    }
  | { ok: false; why: string };

/** Said once a variation's lines are on a job whose invoice went before
    them: HeyTiff's write path adds lines to an invoiced job (the line
    sender reads no job status), and the invoice is ServiceM8's to send
    again. */
export const INVOICE_AGAIN = "The job's invoice went before the variation: send it again from ServiceM8 to bill it.";

/** The statuses a variation's lines may be added in: the accepted quote's
    work order, and the work done. */
export const VARIATION_STATUSES = ["Work Order", "Completed"] as const;

/** "return grille, Bed 2" from "Return grille, Bed 2"; a model code or an
    acronym keeps its capitals. */
function lower(name: string): string {
  const first = name.split(/[\s,:]/)[0] ?? "";
  return /^[A-Z][a-z]/.test(first) ? `${name.charAt(0).toLowerCase()}${name.slice(1)}` : name;
}

export const variationLineName = (n: number, name: string) => `Variation ${n}: ${lower(name.trim())}`.slice(0, 200);

type Sum = { name: string; qty: number; total: number; cost: number | null };

/** One option's lines by name, as ServiceM8 would add them up. */
function byName(lines: readonly SendLine[]): Map<string, Sum> {
  const out = new Map<string, Sum>();
  for (const l of lines) {
    const k = l.name.trim().toLowerCase();
    const was = out.get(k) ?? { name: l.name, qty: 0, total: 0, cost: 0 };
    out.set(k, {
      name: was.name,
      qty: was.qty + l.quantity,
      total: was.total + l.quantity * l.unitPriceCents,
      cost: was.cost === null || l.unitCostCents === null ? null : was.cost + l.quantity * l.unitCostCents,
    });
  }
  return out;
}

const tiny = (c: number) => Math.abs(c) < 0.005;
const round4 = (n: number) => Math.round(n * 10000) / 10000;

/** THE VARIATION'S LINES: what it adds to the accepted option, ex GST.
    `showLines` as the quote send has it: the customer sees line items, or
    totals only. */
export function variationLines(input: {
  draft: ProposalDraft;
  variation: Pick<Variation, "n" | "of" | "option" | "what">;
  base: BuildUp;
  varied: BuildUp;
  showLines: boolean;
}): SendLine[] {
  const { draft, variation: v, base, varied } = input;
  if (!input.showLines) {
    const diff = varied.exGstCents - base.exGstCents;
    if (tiny(diff)) return [];
    const what = v.what.trim().replace(/[.\s]+$/, "");
    return [
      {
        name: what ? variationLineName(v.n, what) : `Variation ${v.n}, as per variation`,
        quantity: 1,
        unitPriceCents: diff,
        unitCostCents: varied.buyCents - base.buyCents,
      },
    ];
  }
  const was = byName(optionLines(draft, v.of, base, true));
  const now = byName(optionLines(draft, v.option, varied, true));
  const out: SendLine[] = [];
  const unit = (s: Sum) => (s.qty !== 0 ? s.total / s.qty : s.total);
  const unitCost = (s: Sum) => (s.cost === null ? null : s.qty !== 0 ? s.cost / s.qty : s.cost);
  for (const [k, s] of now) {
    const b = was.get(k);
    const name = variationLineName(v.n, s.name);
    if (!b) {
      if (!tiny(s.total)) out.push({ name, quantity: round4(s.qty), unitPriceCents: unit(s), unitCostCents: unitCost(s) });
      continue;
    }
    if (tiny(s.total - b.total)) continue;
    /* the same price each, to the cent a line's rounding moves it by */
    if (Math.abs(unit(s) - unit(b)) < 1 && s.qty !== b.qty) {
      /* more of it, or fewer: the extra at its price, or a credit for the
         fewer, each priced so the lines come to the difference exactly */
      const extra = round4(s.qty - b.qty);
      const each = (s.total - b.total) / extra;
      const cost = s.cost === null || b.cost === null ? null : (s.cost - b.cost) / extra;
      out.push(
        extra > 0
          ? { name, quantity: extra, unitPriceCents: each, unitCostCents: cost }
          : { name, quantity: -extra, unitPriceCents: -each, unitCostCents: cost === null ? null : -cost }
      );
      continue;
    }
    /* its price moved: the difference, once */
    out.push({ name, quantity: 1, unitPriceCents: s.total - b.total, unitCostCents: s.cost === null || b.cost === null ? null : s.cost - b.cost });
  }
  for (const [k, b] of was) {
    if (now.has(k) || tiny(b.total)) continue;
    /* taken off: a credit, at what it was on the accepted quote */
    const each = unitCost(b);
    out.push({ name: variationLineName(v.n, b.name), quantity: round4(b.qty), unitPriceCents: -unit(b), unitCostCents: each === null ? null : -each });
  }
  return out;
}

/** WHAT ONE SEND OF A VARIATION WOULD ADD, or why it can't go. */
export function variationSendPlan(input: {
  variation: Variation | null;
  lines: readonly SendLine[];
  /** what the variation still has to price */
  left: number;
  job: { status: string | null; invoiced: boolean; number: string | null };
  /** the job's live lines in ServiceM8 */
  existing: number;
  taxRateUuid: string | null;
}): VariationSendPlan {
  const v = input.variation;
  if (!v) return { ok: false, why: "That option isn't a variation." };
  if (variationInSm8(v)) {
    return { ok: false, why: `Variation ${v.n} is on ${v.sm8?.jobNumber ? `job ${v.sm8.jobNumber}` : "the job"} in ServiceM8 already, so nothing goes twice. A further change is a new variation.` };
  }
  if (!v.acceptedAt) return { ok: false, why: `Mark variation ${v.n} accepted first: what goes to ServiceM8 is what the client agreed to.` };
  if (input.left > 0) return { ok: false, why: `Variation ${v.n} has ${input.left} still to price: ServiceM8 must get all of it.` };
  const status = (input.job.status ?? "").trim();
  if (status === "Quote") return { ok: false, why: "The job is still a Quote in ServiceM8. Send the accepted quote first, and the variation's lines go on its work order." };
  if (!(VARIATION_STATUSES as readonly string[]).includes(status)) {
    return { ok: false, why: `The job is ${status ? `a ${status}` : "in no status"} in ServiceM8, so the variation can't go.` };
  }
  if (!input.taxRateUuid) return { ok: false, why: "No tax rate to put the lines on: ServiceM8 has none on this business's lines yet." };
  if (input.lines.length === 0) return { ok: false, why: `Variation ${v.n} changes nothing on the price, so nothing goes to ServiceM8.` };
  return {
    ok: true,
    n: v.n,
    lines: [...input.lines],
    after: input.existing,
    taxRateUuid: input.taxRateUuid,
    exGstCents: Math.round(input.lines.reduce((s, l) => s + l.quantity * l.unitPriceCents, 0)),
    invoiced: input.job.invoiced,
    jobNumber: input.job.number,
  };
}

/** A unit amount as ServiceM8 keeps it, as the quote's rows write it. */
const amount = (cents: number) => (cents / 100).toFixed(4);
const quantityOf = (n: number) => String(Math.round(n * 10000) / 10000);

/** The rows one send queues: a line added per line, through the accepted
    quote's own record and fields (sm8-quote-plan's QUOTE_FIELDS), sorted
    after the lines already on the job. No job row, and no line taken off. */
export function variationRows(plan: Extract<VariationSendPlan, { ok: true }>): QuoteRowInput[] {
  return plan.lines.map((l, i) => {
    const price = amount(l.unitPriceCents);
    return {
      object: "jobmaterial" as const,
      op: "create" as const,
      uuid: null,
      fields: {
        name: l.name.slice(0, 200),
        quantity: quantityOf(l.quantity),
        price,
        ...(l.unitCostCents != null ? { cost: amount(l.unitCostCents) } : {}),
        displayed_amount: price,
        displayed_amount_is_tax_inclusive: "0",
        tax_rate_uuid: plan.taxRateUuid,
        sort_order: String(plan.after + i + 1),
      },
      label: QUOTE_WORDS.label.variationAdd.replace("{name}", l.name.slice(0, 60)),
      key: `add:${i + 1}`,
    };
  });
}

/** What the rail says a variation's send came to: "Sent to ServiceM8 as 3
    lines on job 3209". Null before anything was sent. */
export function variationSentLine(v: Pick<Variation, "sm8">): string | null {
  const s = v.sm8;
  if (!s || s.lines === 0) return null;
  const on = s.jobNumber ? `job ${s.jobNumber}` : "the job";
  const lines = (n: number) => `${n} ${n === 1 ? "line" : "lines"}`;
  if (s.trial) return `Trial run: ${lines(s.lines)} for ${on} checked, and nothing went to ServiceM8.`;
  if (s.sent >= s.lines) return `Sent to ServiceM8 as ${lines(s.lines)} on ${on}.`;
  return `${s.sent} of ${lines(s.lines)} on ${on} in ServiceM8 so far.`;
}
