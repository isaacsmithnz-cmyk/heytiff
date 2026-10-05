import type { BuildUp } from "./buildup";
import { optionHeading, type ProposalDraft } from "./proposal";

/* THE ACCEPTED QUOTE, AS SERVICEM8 WILL HOLD IT (Isaac, 2026-10-05: "if a
   quote is accepted, then it can turn that into the work order for service
   mate… copy the scope and line items to service mate so that we can see the
   basic version of the accepted quote in service mate correctly and then
   also our invoicing through service mate will be correct").

   What one press sends, worked out before anything is sent so the card can
   show it: the job made a Work Order, the accepted options' scope as its
   invoice description, and its lines — one per accepted option at its total
   when the customer sees totals only, or every line of its build (labour by
   the person-day) when they see line items. The job's own lines already in ServiceM8 come off (a soft
   delete; ServiceM8 keeps them inactive). Prices are ServiceM8's way: a unit
   price and unit cost ex GST, on the tax rate the business's own lines use.

   A quote with anything left to price isn't sent: what ServiceM8 invoices
   must be the whole quote. Pure. */

/** A line as ServiceM8 takes it: unit price and unit cost, ex GST. */
export type SendLine = { name: string; quantity: number; unitPriceCents: number; unitCostCents: number | null };

export type SendOption = { index: number; build: BuildUp; left: number };

export type SendPlan =
  | {
      ok: true;
      status: { from: string; to: "Work Order" } | null;
      workDone: string;
      lines: SendLine[];
      /** the job's live lines in ServiceM8 that come off, with their names */
      remove: { uuid: string; name: string }[];
      taxRateUuid: string;
      /** what the lines come to, ex GST: the accepted options' totals */
      exGstCents: number;
    }
  | { ok: false; why: string };

/** Said when no option is marked accepted: the card shows nothing then. */
export const NONE_ACCEPTED = "No option is marked accepted.";

/** ServiceM8's statuses a send may take a job from. */
const SENDABLE = ["Quote", "Work Order"];

const scopeOf = (draft: ProposalDraft, i: number) => {
  const o = draft.options[i]!;
  return [optionHeading(draft, i), ...o.lines.map((l) => `- ${l}`)].join("\n");
};

/** One accepted option's lines: one at its total, or every line of its
    build, its labour by the person-day, its contingency. */
export function optionLines(draft: ProposalDraft, i: number, build: BuildUp, showLines: boolean): SendLine[] {
  if (!showLines) {
    return [{ name: `${optionHeading(draft, i)}, as per quote`, quantity: 1, unitPriceCents: build.exGstCents, unitCostCents: build.buyCents }];
  }
  const out: SendLine[] = build.groups.flatMap((g) =>
    g.lines.map((l) => ({
      /* a unit says what its order code gives it: "MSZ-AP25VGD2, Wi-Fi built in" */
      name: l.features?.length ? `${l.name}, ${l.features.join(", ")}` : l.name,
      quantity: l.qty,
      unitPriceCents: l.qty > 0 ? l.sellCents / l.qty : l.sellCents,
      unitCostCents: l.unitBuyCents,
    }))
  );
  if (build.contingency) out.push({ name: "Duct contingency", quantity: 1, unitPriceCents: build.contingency.sellCents, unitCostCents: build.contingency.buyCents });
  /* labour by the person-day at the business's own day, as its ServiceM8
     lines already carry it; the contingency's hours on their own line */
  const visitsCents = build.labour.visits.reduce((n, v) => n + v.sellCents, 0);
  if (build.labour.personDays > 0 && visitsCents > 0) {
    out.push({ name: "Labour", quantity: build.labour.personDays, unitPriceCents: visitsCents / build.labour.personDays, unitCostCents: null });
  }
  const extraCents = build.labour.sellCents - visitsCents;
  if (build.labour.hours > 0 && extraCents > 0) {
    out.push({ name: "Labour, duct contingency", quantity: build.labour.hours, unitPriceCents: extraCents / build.labour.hours, unitCostCents: null });
  }
  return out;
}

export function sendPlan(input: {
  draft: ProposalDraft;
  /** the accepted options, priced */
  accepted: readonly SendOption[];
  showLines: boolean;
  /** the job as the mirror holds it */
  job: { status: string | null; invoiced: boolean };
  /** the job's live lines in ServiceM8 */
  existing: readonly { uuid: string; name: string }[];
  /** the tax rate the business's own lines use */
  taxRateUuid: string | null;
}): SendPlan {
  const { draft, accepted, showLines, job } = input;
  if (accepted.length === 0) return { ok: false, why: NONE_ACCEPTED };
  const status = (job.status ?? "").trim();
  if (!SENDABLE.includes(status)) return { ok: false, why: `The job is ${status ? `a ${status}` : "in no status"} in ServiceM8, so it can't be sent.` };
  if (job.invoiced) return { ok: false, why: "The job is invoiced in ServiceM8: a change now is a variation, its own job." };
  const short = accepted.filter((a) => a.left > 0);
  if (short.length) {
    const n = short.reduce((s, a) => s + a.left, 0);
    return { ok: false, why: `The accepted ${short.length === 1 ? "option has" : "options have"} ${n} still to price: ServiceM8 must get the whole quote.` };
  }
  if (!input.taxRateUuid) return { ok: false, why: "No tax rate to put the lines on: ServiceM8 has none on this business's lines yet." };
  return {
    ok: true,
    status: status === "Quote" ? { from: "Quote", to: "Work Order" } : null,
    workDone: accepted.map((a) => scopeOf(draft, a.index)).join("\n\n"),
    lines: accepted.flatMap((a) => optionLines(draft, a.index, a.build, showLines)),
    remove: input.existing.map((e) => ({ uuid: e.uuid, name: e.name })),
    taxRateUuid: input.taxRateUuid,
    exGstCents: accepted.reduce((s, a) => s + a.build.exGstCents, 0),
  };
}

/** A unit price as ServiceM8 keeps it: dollars to four places. */
export const sm8Amount = (cents: number) => (cents / 100).toFixed(4);

/** The most-used tax rate on the business's own lines: the one its quotes
    already go out on. Null when it has none. */
export function usualTaxRate(rates: readonly (string | null)[]): string | null {
  const n = new Map<string, number>();
  for (const r of rates) if (r) n.set(r, (n.get(r) ?? 0) + 1);
  return [...n.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

/** ServiceM8's total for the job after the send, against the quote's, ex
    GST: the check-back. Lines are unit price × quantity, as ServiceM8 adds
    them; a cent a line is rounding. */
export function checkBack(lines: readonly { quantity: number; unitPrice: number }[], quotedExGstCents: number): { sm8Cents: number; gapCents: number; matches: boolean } {
  const sm8Cents = Math.round(lines.reduce((s, l) => s + l.quantity * l.unitPrice * 100, 0));
  const gapCents = sm8Cents - quotedExGstCents;
  return { sm8Cents, gapCents, matches: Math.abs(gapCents) <= Math.max(1, lines.length) };
}
