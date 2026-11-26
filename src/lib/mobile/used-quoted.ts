import type { QuoteLine } from "@/lib/quotes/lines";
import { keyOf, qtyOf, unitOf } from "./used-plan";

/* WHAT THE QUOTE SAYS WOULD BE USED, OFFERED ON THE DAY'S LIST (bug 109,
   Isaac, 26 November 2026: "Isn't show suggested items from quote"). 3521's
   wrap-up showed "Nothing on it yet" while the job's quote held R410A and
   a bottle of nitrogen for the repair the client took: the quote's lines
   were only ever looked at once something was said (bug 12, used-read.ts).
   Now the parts of the option the client took sit under the list, each
   one tap to put on it at the quoted amount.

   Which option was taken: HeyTiff's own accepted mark; else ServiceM8's,
   where the office takes the other options' "Option N" lines off the job
   (3521: Option 1 inactive, Option 2 active) or the work done reads
   "Option 2: …"; else the only option there is. Where that can't be told,
   every option's parts, each with its option named. Labour isn't a thing
   used, and a line with no code is an allowance or a note on the quote
   (contingency, consumables, painting), not an item. Pure. */

export type QuotedItem = {
  key: string;
  supplierKey: string | null;
  code: string;
  name: string;
  qty: number;
  unit: string | null;
  /** the options it's on, from 0; empty when the option taken is known */
  options: number[];
};

export type QuoteLinePart = Pick<QuoteLine, "optionIndex" | "kind" | "code" | "supplierKey" | "name" | "qty" | "unit">;
export type Sm8OptionLine = { name: string | null; active: number | boolean | null };

const OPTION = /^\s*option\s*(\d{1,2})\b/i;
const WORK_DONE_OPTION = /^\s*option\s*(\d{1,2})\s*[:.,\-–]/i;
const on = (a: number | boolean | null) => a === true || (typeof a === "number" && a !== 0);

/** The options the client took, from 0; null when it can't be told. */
export function takenOptions(input: {
  /** HeyTiff's accepted mark (the quote's byHand.accepted) */
  accepted: readonly number[];
  /** the options the quote's lines are on */
  options: readonly number[];
  /** the job's ServiceM8 materials */
  sm8: readonly Sm8OptionLine[];
  /** the job's ServiceM8 work done description */
  workDone: string | null;
}): number[] | null {
  const there = new Set(input.options);
  const known = (list: number[]) => {
    const out = [...new Set(list)].filter((i) => there.has(i)).sort((a, b) => a - b);
    return out.length ? out : null;
  };
  const mine = known([...input.accepted]);
  if (mine) return mine;
  /* the "Option N" lines on the ServiceM8 job: once some are taken off, the ones left are the ones taken */
  const lines = input.sm8.map((l) => ({ i: Number(OPTION.exec(l.name ?? "")?.[1] ?? NaN) - 1, active: on(l.active) })).filter((l) => Number.isInteger(l.i) && l.i >= 0);
  if (lines.some((l) => !l.active) && lines.some((l) => l.active)) {
    const left = known(lines.filter((l) => l.active).map((l) => l.i));
    if (left) return left;
  }
  const said = WORK_DONE_OPTION.exec(input.workDone ?? "");
  if (said) {
    const one = known([Number(said[1]) - 1]);
    if (one) return one;
  }
  return there.size === 1 ? [...there] : null;
}

/** The quote's parts to offer: of the options taken (all of them when `taken` is null), each once, those not on the list already. */
export function quotedItems(lines: readonly QuoteLinePart[], taken: readonly number[] | null, onList: ReadonlySet<string>): QuotedItem[] {
  const use = taken ? new Set(taken) : null;
  /* per option, each part's amount; across options, the most any one quoted */
  const per = new Map<string, Map<number, number>>();
  const first = new Map<string, QuotedItem>();
  for (const l of lines) {
    if (l.kind === "labour" || (use && !use.has(l.optionIndex))) continue;
    const code = l.code?.trim();
    const name = l.name?.trim();
    const qty = qtyOf(l.qty);
    if (!code || !name || qty === null) continue;
    const supplierKey = l.supplierKey?.trim() || null;
    /* a unit's line is named for its place ("Indoor unit, Living"): its model goes with it */
    const full = l.kind === "unit" && !name.includes(code) ? `${name} ${code}` : name;
    const key = keyOf({ supplierKey, code, name: full });
    if (onList.has(key)) continue;
    if (!first.has(key)) first.set(key, { key, supplierKey, code, name: full, qty, unit: unitOf(l.unit), options: [] });
    const byOption = per.get(key) ?? new Map<number, number>();
    byOption.set(l.optionIndex, (byOption.get(l.optionIndex) ?? 0) + qty);
    per.set(key, byOption);
  }
  return [...first.values()].map((item) => {
    const byOption = per.get(item.key)!;
    const most = Math.max(...byOption.values());
    return { ...item, qty: qtyOf(most) ?? item.qty, options: taken ? [] : [...byOption.keys()].sort((a, b) => a - b) };
  });
}
