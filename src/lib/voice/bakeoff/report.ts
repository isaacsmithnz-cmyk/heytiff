/* The scorecard. Pure string building — the runner prints what this returns.

   Written to be read by someone deciding whether to ship, which means the
   failures come first and every miss shows what was heard INSTEAD. "Wyndham →
   'windham'" tells you the keyterm list needs the street; a bare ✗ tells you
   nothing and gets ignored. */

import type { CaseScore, Match, RunSummary } from "./score";

const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

function missLine(m: Match): string {
  const heard = m.closest === "" ? "nothing close" : `"${m.closest}"`;
  return `${m.expected} → ${heard} (${m.score.toFixed(2)})`;
}

/** One line per case: the verdict, then every hard miss spelled out. */
export function caseLine(score: CaseScore, conditions: string): string {
  const verdict = score.routable ? "ROUTED" : "FAILED";
  const soft = score.soft.length
    ? ` · terms ${score.soft.filter((m) => m.hit).length}/${score.soft.length}`
    : "";
  const head = `  ${verdict.padEnd(6)} ${score.id.padEnd(18)} WER ${pct(score.wer).padStart(6)}${soft}  [${conditions}]`;
  const misses = score.hard.filter((m) => !m.hit).map((m) => `\n           ✗ ${missLine(m)}`);
  const softMisses = score.soft
    .filter((m) => !m.hit)
    .map((m) => `\n           · ${missLine(m)}`);
  return head + misses.join("") + softMisses.join("");
}

export function summaryLine(s: RunSummary): string {
  const routable = s.cases === 0 ? 0 : s.routable / s.cases;
  return [
    `  ${s.label.padEnd(24)}`,
    `routed ${String(s.routable).padStart(3)}/${String(s.cases).padEnd(3)} (${pct(routable)})`,
    `hard ${s.hardHits}/${s.hardTotal}`,
    `soft ${s.softHits}/${s.softTotal}`,
    `mean WER ${pct(s.meanWer)}`,
  ].join("  ");
}

export function report(
  runs: readonly { summary: RunSummary; scores: readonly CaseScore[] }[],
  conditionsById: ReadonlyMap<string, string>,
): string {
  const out: string[] = ["", "═══ VOICE BAKE-OFF ═══", ""];

  for (const run of runs) {
    out.push(`── ${run.summary.label} ──`);
    const failed = run.scores.filter((s) => !s.routable);
    const passed = run.scores.filter((s) => s.routable);
    for (const s of [...failed, ...passed]) {
      out.push(caseLine(s, conditionsById.get(s.id) ?? ""));
    }
    out.push("");
  }

  out.push("═══ SCORECARD ═══", "");
  for (const run of runs) out.push(summaryLine(run.summary));
  out.push(
    "",
    "  `routed` is the number that decides this: every hard expectation met,",
    "  so the note needed no human rescue. WER is for comparison with published",
    "  benchmarks — it is not the verdict.",
    "",
  );
  return out.join("\n");
}
