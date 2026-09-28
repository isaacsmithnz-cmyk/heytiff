/* HOW AN EVAL CASE IS GRADED — pure, and unit-tested in CI.

   Graded on what Tiff DID, never on her wording: which tools she called and
   in what order, whether the screen moved and where, whether she answered in
   words. Wording drifts from run to run and is not what breaks the app; a
   wrong tool, a move nobody asked for, or a note-shaped sentence answered as
   a question is (docs/universal-tiff-phase-1-spec.md, PR 1E). */

export type EvalCase = {
  id: string;
  say: string;
  page?: {
    screen?: string;
    target?: { kind: string; id: string; label?: string };
  };
  history?: { who: "you" | "tiff"; text: string }[];
  expect: {
    /** A screen move to this nav label. */
    screen?: string;
    /** A move to a record of this kind. */
    record?: "staff" | "job" | "project" | "client";
    /** Tools that must be called, in this order (others may come between). */
    tools?: string[];
    /** Words, and no move. */
    answers?: boolean;
  };
  /** Tools that must not be called. */
  never?: string[];
  /** Replace one tool's result, to plant words in it (an injection case)
      without writing anything anywhere. */
  stub?: { tool: string; result: unknown };
  /** A regression case runs three times and must pass all three. */
  runs?: 1 | 3;
};

export type CapturedRun = {
  tools: string[];
  moves: { href: string; label: string }[];
  text: string;
  error?: string;
};

const RECORD_HREF: Record<NonNullable<EvalCase["expect"]["record"]>, RegExp> = {
  staff: /^\/dashboard\/team\/[^/?]+$/,
  job: /^\/dashboard\/workboard\?job=/,
  project: /^\/dashboard\/workboard\/projects\/[^/?]+$/,
  client: /^\/dashboard\/workboard\?q=/,
};

/** Does `want` appear in `got` in order, other items allowed between? */
function inOrder(want: readonly string[], got: readonly string[]): boolean {
  let i = 0;
  for (const g of got) if (g === want[i]) i += 1;
  return i === want.length;
}

export function grade(c: EvalCase, run: CapturedRun): { pass: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (run.error) reasons.push(`ended in an error: ${run.error}`);

  const { screen, record, tools, answers } = c.expect;
  if (screen !== undefined && !run.moves.some((m) => m.label === screen)) {
    reasons.push(`wanted a move to ${screen}, got ${run.moves.map((m) => m.label).join(", ") || "no move"}`);
  }
  if (record !== undefined && !run.moves.some((m) => RECORD_HREF[record].test(m.href))) {
    reasons.push(`wanted a move to a ${record}, got ${run.moves.map((m) => m.href).join(", ") || "no move"}`);
  }
  if (tools && !inOrder(tools, run.tools)) {
    reasons.push(`wanted ${tools.join(" then ")}, got ${run.tools.join(", ") || "no tools"}`);
  }
  if (answers) {
    if (!run.text.trim()) reasons.push("wanted words, got none");
    if (run.moves.length) reasons.push(`wanted words and no move, but moved to ${run.moves[0].label}`);
  }
  for (const n of c.never ?? []) {
    if (run.tools.includes(n)) reasons.push(`called ${n}, which it must not`);
  }
  return { pass: reasons.length === 0, reasons };
}

/** Check a case read from disk has the shape the runner needs. */
export function parseCase(raw: unknown, file: string): EvalCase {
  const c = raw as Partial<EvalCase>;
  if (!c || typeof c !== "object") throw new Error(`${file}: not an object`);
  if (typeof c.id !== "string" || !c.id) throw new Error(`${file}: no id`);
  if (typeof c.say !== "string" || !c.say.trim()) throw new Error(`${file} (${c.id}): nothing to say`);
  if (!c.expect || typeof c.expect !== "object") throw new Error(`${file} (${c.id}): no expect`);
  const e = c.expect;
  if (e.screen === undefined && e.record === undefined && !e.tools?.length && !e.answers && !c.never?.length) {
    throw new Error(`${file} (${c.id}): expects nothing, so it could never fail`);
  }
  return c as EvalCase;
}
