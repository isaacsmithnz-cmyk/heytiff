/* DO TWO READS OF A NOTE AGREE? — pure, for the Phase 0 probes.

   The universal-Tiff plan moves notes from the router's own call onto one
   loop whose `file_note` tool takes the router's proposal as its input.
   Probe P0 reads every note both ways and asks whether they would file the
   same things. "The same" is judged on what LANDS, never on wording: two
   reads never phrase a task alike, and a probe that compared titles would
   fail every note and prove nothing.

   What counts: how many tasks and who each one goes to, their dates and
   times, how many flags and how urgent, and the counts of every other lane.
   A plain note is reported but never fails a pair on its own — both reads
   keep the words either way, and whether a remark rides along beside a task
   changes nothing anyone has to do. A question back ("Which Lyle?") does
   count: asking where the other filed is a different turn for the person. */

import type { NoteProposal } from "@/lib/workboard/note-brain";

export type RowShape = {
  /** One per task: who (a staff id, or "?" when nobody was matched), the
      day and the time, sorted so order never decides a match. */
  tasks: string[];
  flags: string[];
  bring: number;
  progress: number;
  commissioning: number;
  issues: number;
  kb: number;
  plain: boolean;
  asks: boolean;
};

export function shapeOf(p: NoteProposal): RowShape {
  return {
    tasks: p.tasks
      .map((t) => `${t.assigneeId ?? "?"}|${t.dueDate || "-"}|${t.remindTime || "-"}`)
      .sort(),
    flags: p.flags.map((f) => f.severity).sort(),
    bring: p.bringItems.length,
    progress: p.progressBullets.length,
    commissioning: p.commissioningEntries.length,
    issues: p.issueEntries.length,
    kb: p.kbEntries.length,
    plain: p.plainNote.trim() !== "",
    asks: p.clarify !== null,
  };
}

export type RowVerdict = {
  same: boolean;
  /** Plain words for each difference, for the report. */
  diffs: string[];
  /** Someone got work the other read gave to a different person. A task one
      read left unassigned (and so asked about) is a difference, not this. */
  wrongAssignee: boolean;
};

const ids = (shape: RowShape) =>
  shape.tasks.map((t) => t.split("|")[0]).filter((id) => id !== "?");

export function compareRows(a: NoteProposal, b: NoteProposal): RowVerdict {
  const x = shapeOf(a);
  const y = shapeOf(b);
  const diffs: string[] = [];

  if (x.tasks.join(",") !== y.tasks.join(",")) {
    diffs.push(`tasks ${x.tasks.join(" ") || "none"} against ${y.tasks.join(" ") || "none"}`);
  }
  if (x.flags.join(",") !== y.flags.join(",")) {
    diffs.push(`flags ${x.flags.join(" ") || "none"} against ${y.flags.join(" ") || "none"}`);
  }
  for (const lane of ["bring", "progress", "commissioning", "issues", "kb"] as const) {
    if (x[lane] !== y[lane]) diffs.push(`${lane} ${x[lane]} against ${y[lane]}`);
  }
  if (x.asks !== y.asks) diffs.push(x.asks ? "only the first asks a question" : "only the second asks a question");

  const failing = diffs.length > 0;
  if (x.plain !== y.plain) diffs.push(x.plain ? "only the first keeps a remark" : "only the second keeps a remark");

  const xi = ids(x);
  const yi = ids(y);
  const wrongAssignee =
    xi.length > 0 && yi.length > 0 && (xi.some((id) => !yi.includes(id)) || yi.some((id) => !xi.includes(id)));

  return { same: !failing, diffs, wrongAssignee };
}

/** The p-th percentile of some timings, by nearest rank. */
export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((m, n) => m - n);
  const rank = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[rank];
}

/* Per million tokens, US dollars, from the Claude API's price list as the
   claude-api skill carries it on 2026-09-27. A cache write costs 1.25 times
   input and a cache read a tenth of it on Opus 5; Opus 5.5 reads at $0.20. */
const PRICES: Record<string, { input: number; output: number; cacheRead: number }> = {
  "claude-opus-5": { input: 5, output: 25, cacheRead: 0.5 },
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2 },
  "claude-opus-4-8": { input: 5, output: 25, cacheRead: 0.5 },
};

export type Usage = {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
};

/** What one call cost, in US dollars. An unknown model costs nothing here
    rather than a guess: the report says which model answered. */
export function costOf(model: string, usage: Usage): number {
  /* Longest name first: "claude-opus-5-5" also starts with "claude-opus-5". */
  const price = Object.entries(PRICES)
    .sort(([m], [n]) => n.length - m.length)
    .find(([name]) => model.startsWith(name))?.[1];
  if (!price) return 0;
  const write = usage.cache_creation_input_tokens ?? 0;
  const read = usage.cache_read_input_tokens ?? 0;
  return (
    (usage.input_tokens * price.input +
      write * price.input * 1.25 +
      read * price.cacheRead +
      usage.output_tokens * price.output) /
    1_000_000
  );
}
