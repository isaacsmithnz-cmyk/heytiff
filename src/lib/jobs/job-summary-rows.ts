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
       has them (a line with no bullet over bulleted ones, or a line that
       ends with a colon, "Next visit:"), a model code on the right;
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

/* THE DESCRIPTION, AS THE OFFICE WRITES ONE (the walk of 25 October 2026,
   job 3385's "Pick List"): a line with no bullet is a group's heading, the
   bulleted lines under it are its rows, and a heading with nothing under it
   ("Pick List") says nothing. A model code in a row moves to the right,
   grey and in capitals: "Wall controller - 41maam" is "Wall controller"
   with 41MAAM. A description with no bullet at all is the older kind: its
   own "Heading:" lines over its lines, or its lines as plain rows. */
const BULLET = /^(?:\*{1,2}|[-•·–])\s*/;
const NUMBERED = /^\d+[.)]\s+/;

/** A size, a rating or a length, never a code: 250mm, 7.1kW, 12m, 20A. */
const SIZE = /^\d+(?:\.\d+)?(?:mm|cm|m|mtr|kw|w|kva|va|v|a|amp|amps|hp|kg|g|l|lt|ltr|pa|db|deg|c|x)$/i;
/** A refrigerant, never a code: R32, R410a. */
const GAS = /^r\d{2,3}[a-z]?$/i;

/** A maker's model code: five or more letters, digits and dashes, with two
    letters and two digits in it at least, as PEAD-M71JAAD, SUZ-M71VAD2-A,
    41MAAM or MSZ-AP25VGKD2-A2. */
export function isModelCode(token: string): boolean {
  const t = token.replace(/[,;:]+$/, "");
  if (t.length < 5 || !/^[A-Za-z0-9][A-Za-z0-9-]*[A-Za-z0-9]$/.test(t)) return false;
  if (!/[A-Za-z]/.test(t) || !/\d/.test(t)) return false;
  if (SIZE.test(t) || GAS.test(t)) return false;
  /* a range of sizes, 10-20mm, is still a size */
  if (t.split("-").every((seg) => /^\d+(?:\.\d+)?$/.test(seg) || SIZE.test(seg))) return false;
  /* two letters and two digits at least, so 2-way, 3-phase or 2nd isn't one */
  return (t.match(/[A-Za-z]/g) ?? []).length >= 2 && (t.match(/\d/g) ?? []).length >= 2;
}

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** A row's words and the model code in them, moved to the right. */
export function rowOf(text: string): { thing: string; detail: string } {
  const words = text.replace(/\s+/g, " ").trim().split(" ");
  const at = words.findIndex(isModelCode);
  if (at < 0) return { thing: words.join(" "), detail: "" };
  const detail = words[at]!.replace(/[,;:]+$/, "").toUpperCase();
  const rest = [...words.slice(0, at), ...words.slice(at + 1)]
    .join(" ")
    /* the separator the code stood behind, "Wall controller - 41maam" */
    .replace(/\s*[-–:,]\s*$/, "")
    .replace(/^\s*[-–:,]\s*/, "")
    .trim();
  if (!rest) return { thing: detail, detail: "" };
  return { thing: at === 0 ? capital(rest) : rest, detail };
}

/** The description's own lines, under its own headings. A description with
    no heading is one group with no title: its lines as plain rows. */
export function summaryFromText(text: string | null | undefined): SummaryGroup[] {
  const lines = (text ?? "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const bulleted = lines.some((l) => BULLET.test(l));
  const groups: SummaryGroup[] = [];
  let cur: SummaryGroup | null = null;
  lines.forEach((raw, i) => {
    const heading = bulleted
      ? BULLET.test(raw)
        ? null
        : [raw, raw.replace(/:$/, "")]
      : (/^(.{1,80}):$/.exec(raw) ?? /^#{1,3}\s+(.{1,80})$/.exec(raw));
    if (heading) {
      cur = { key: `d:${i}`, title: heading[1]!.trim(), rows: [] };
      groups.push(cur);
      return;
    }
    if (!cur) {
      cur = { key: `d:${i}`, title: null, rows: [] };
      groups.push(cur);
    }
    const words = raw.replace(bulleted ? BULLET : NUMBERED, "").replace(BULLET, "");
    if (words.trim()) cur.rows.push({ key: `d:${i}`, ...rowOf(words) });
  });
  /* a heading the description left empty says nothing */
  return groups.filter((g) => g.rows.length > 0);
}
