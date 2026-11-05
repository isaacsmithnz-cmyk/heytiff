import type { QuoteLine } from "./lines";

/* THE SAME LINE ON THE OTHER OPTIONS (Isaac, 6 November 2026, on 3054:
   "Need to be able to remove line items, swap them out etc on web and
   mobile"; the mock https://claude.ai/artifact/1RAW4dd7ik8Ei8th7p7KYe).
   Options are often copies of one another, so a part that's wrong on one is
   wrong on the others: Remove asks whether it's this option or every one it
   is on, and Swap offers to swap it on the others as well.

   A line's twin is the line on another option that is the same thing: the
   same system, group, kind, name and code. One per option, the first.
   A variation's option is its own change, never a twin. Pure. */

const same = (a: QuoteLine, b: QuoteLine) =>
  a.system === b.system && a.group === b.group && a.kind === b.kind && a.name === b.name && (a.code ?? null) === (b.code ?? null);

/** The same line on the quote's other options, by option. */
export function twinsOf(line: QuoteLine, all: readonly QuoteLine[], skip: ReadonlySet<number> = new Set()): QuoteLine[] {
  const seen = new Set<number>([line.optionIndex]);
  const out: QuoteLine[] = [];
  for (const l of [...all].sort((a, b) => a.optionIndex - b.optionIndex || a.position - b.position)) {
    if (seen.has(l.optionIndex) || skip.has(l.optionIndex) || !same(l, line)) continue;
    seen.add(l.optionIndex);
    out.push(l);
  }
  return out;
}

/** Where a change went, said: "Option 1", "both options", "all 3 options". */
export function optionsWords(lines: readonly Pick<QuoteLine, "optionIndex">[]): string {
  if (lines.length === 1) return `Option ${lines[0].optionIndex + 1}`;
  return lines.length === 2 ? "both options" : `all ${lines.length} options`;
}

/** The other options a twin is on, said for a tick: "On Option 2 as well". */
export function alsoWords(twins: readonly Pick<QuoteLine, "optionIndex">[]): string {
  const n = twins.map((t) => String(t.optionIndex + 1));
  if (n.length === 1) return `On Option ${n[0]} as well`;
  return `On Options ${n.slice(0, -1).join(", ")} and ${n[n.length - 1]} as well`;
}
