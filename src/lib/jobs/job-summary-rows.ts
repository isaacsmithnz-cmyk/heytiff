import type { LineFields } from "@/lib/quotes/lines";

/* THE OVERVIEW'S SUMMARY, AS ROWS (Isaac, 25 October 2026, "Yes, build the
   refined Overview A"): what the job is, grouped, the thing in ink on the
   left and its model number grey on the right. Pure.

   ONLY WHAT THE JOB ALREADY SAYS. Nothing here is written for the job:
     - where the job has a quote in HeyTiff, its lines, grouped by the
       quote's own systems ("Upstairs", "Downstairs"), the thing as the
       line names it and the line's code beside it. The option the client
       took, or the only option there is; a quote of several options with
       none taken isn't yet what the job is, so it says nothing here. The
       labour lines are hours, not a thing that goes in, and stay on the
       quote;
     - else the description's own lines, under its own headings where it
       has them (a line that ends with a colon, "Next visit:");
     - else nothing, and the page says the job has nothing written. */

export type SummaryRow = { key: string; thing: string; detail: string };
export type SummaryGroup = { key: string; title: string | null; rows: SummaryRow[] };

type Line = Pick<LineFields, "optionIndex" | "system" | "name" | "code" | "kind" | "qty" | "unit">;

const qtyWord = (n: number) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100));

/** A line as a thing: how many, where the quote says more than one. */
function thingOf(l: Line): string {
  const name = l.name.trim();
  if (l.unit === "m" && l.qty > 0) return `${name}, ${qtyWord(l.qty)} m`;
  if (l.unit === "" && l.qty > 1) return `${qtyWord(l.qty)} × ${name}`;
  return name;
}

/** The quote's lines as groups, in the quote's order: its systems as they
    first appear, a line with no system last, under no heading. Null when
    the quote can't say what the job is. */
export function summaryFromQuote(lines: readonly Line[], accepted: readonly number[]): SummaryGroup[] | null {
  const options = new Set(lines.map((l) => l.optionIndex));
  const taken = accepted.filter((i) => options.has(i));
  const option = taken.length ? Math.min(...taken) : options.size === 1 ? [...options][0]! : null;
  if (option === null) return null;
  const groups = new Map<string, SummaryGroup>();
  let n = 0;
  for (const l of lines) {
    if (l.optionIndex !== option || l.kind === "labour" || !l.name.trim()) continue;
    const system = l.system.trim();
    const key = system.toLowerCase();
    let g = groups.get(key);
    if (!g) {
      g = { key: `q:${key}`, title: system || null, rows: [] };
      groups.set(key, g);
    }
    g.rows.push({ key: `q:${n++}`, thing: thingOf(l), detail: (l.code ?? "").trim() });
  }
  const out = [...groups.values()].filter((g) => g.title !== null);
  const loose = groups.get("");
  if (loose) out.push(loose);
  return out.length ? out : null;
}

const BULLET = /^(?:[-*•·–]|\d+[.)])\s+/;

/** The description's own lines, under its own headings. A description with
    no heading is one group with no title: its lines as plain rows. */
export function summaryFromText(text: string | null | undefined): SummaryGroup[] {
  const lines = (text ?? "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const groups: SummaryGroup[] = [];
  let cur: SummaryGroup | null = null;
  lines.forEach((raw, i) => {
    const heading = /^(.{1,80}):$/.exec(raw) ?? /^#{1,3}\s+(.{1,80})$/.exec(raw);
    if (heading) {
      cur = { key: `d:${i}`, title: heading[1]!.trim(), rows: [] };
      groups.push(cur);
      return;
    }
    if (!cur) {
      cur = { key: `d:${i}`, title: null, rows: [] };
      groups.push(cur);
    }
    cur.rows.push({ key: `d:${i}`, thing: raw.replace(BULLET, ""), detail: "" });
  });
  /* a heading the description left empty says nothing */
  return groups.filter((g) => g.rows.length > 0);
}
