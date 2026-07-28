/* Scoring a transcript — on OUTCOMES first, word error rate second.

   WHY NOT WER: the leaderboards rank on it and it is the wrong question for us.
   A note that mangles "condensate" but still lands on job 337 assigned to Luke
   routes perfectly and the tech never notices. A note that is 98% word-perfect
   but hears "Wyndham" as "Windham" files a commissioning entry against the
   wrong site. Those two failures are not the same size, and any single
   percentage that averages them tells you nothing about whether to ship.

   So every case declares what has to SURVIVE, split in two:

     HARD — the job number, the site, the people. These drive routing. Miss one
            and the note is wrong or needs a human to rescue it. `routable` is
            true only when every hard check passes, and that is the headline
            number: "24 of 28 notes routed with no intervention".

     SOFT — trade vocabulary. Nice, visible on the review card, fixable in a
            second, and it never sends work to the wrong person.

   WER is still computed and reported, because it is the number that moves when
   audio quality changes and it is comparable to the published benchmarks. It
   just isn't the number you decide on.

   Both sides are normalised identically before anything is compared — including
   spoken numbers — so "thirty six" against "36" is a match, not an error. It is
   the same information; counting it as a miss would flatter whichever vendor
   happens to share the human transcriber's formatting habits. */

import { spokenToDigits } from "../spoken-numbers";

/** Lowercase, depunctuate, spoken numbers → digits, collapse whitespace.
    Applied to truth and hypothesis alike — never to only one side. */
export function normalise(text: string): string {
  const flattened = text
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[-/]/g, " ")
    // Keep apostrophes inside words ("didn't"); drop everything else that
    // isn't a letter, digit or space.
    .replace(/[^a-z0-9'\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return spokenToDigits(flattened).replace(/\s+/g, " ").trim();
}

export const tokenise = (text: string): string[] =>
  normalise(text).split(" ").filter(Boolean);

/** Levenshtein over two token arrays, two rows at a time. */
function editDistance(a: readonly string[], b: readonly string[]): number {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i, ...new Array<number>(b.length).fill(0)];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + cost);
    }
    prev = row;
  }
  return prev[b.length];
}

/** Substitutions + insertions + deletions over the reference length. Returns 0
    for two empty transcripts and 1 when the reference is empty but words were
    produced — a transcriber inventing speech from silence is a total miss. */
export function wordErrorRate(truth: string, hypothesis: string): number {
  const ref = tokenise(truth);
  const hyp = tokenise(hypothesis);
  if (ref.length === 0) return hyp.length === 0 ? 0 : 1;
  return editDistance(ref, hyp) / ref.length;
}

/** 1 = identical, 0 = nothing in common. Character-level, for near-miss
    reporting: "Wyndham" heard as "Windham" scores 0.86 — one letter out, and
    obviously the same street once you see it written down. */
export function similarity(a: string, b: string): number {
  const x = [...a];
  const y = [...b];
  const longest = Math.max(x.length, y.length);
  if (longest === 0) return 1;
  return 1 - editDistance(x, y) / longest;
}

/* Below this, two strings are different words rather than one word heard
   badly. Deliberately strict: for names and street names a loose threshold
   invents matches, and a false "it worked" is the one result this harness
   must never produce. */
export const MATCH_THRESHOLD = 0.82;

export type Match = {
  /** What the case said had to survive. */
  expected: string;
  hit: boolean;
  /** Closest thing actually transcribed — the diagnosis when hit is false. */
  closest: string;
  score: number;
};

/** Look for `expected` (one word or several) anywhere in the transcript,
    comparing every window of the same word-count and keeping the best. */
export function findPhrase(hypothesis: string, expected: string): Match {
  const hyp = tokenise(hypothesis);
  const want = tokenise(expected);
  if (want.length === 0) return { expected, hit: true, closest: "", score: 1 };

  const target = want.join(" ");
  let best = { closest: "", score: 0 };
  for (let i = 0; i + want.length <= hyp.length; i++) {
    const window = hyp.slice(i, i + want.length).join(" ");
    const score = similarity(target, window);
    if (score > best.score) best = { closest: window, score };
  }
  return { expected, hit: best.score >= MATCH_THRESHOLD, ...best };
}

/* A site is "36 Wyndham Street". The street NUMBER has to be exact — 36 and 38
   are different houses and fuzzy matching them is worse than useless — while
   the street name is allowed to be heard imperfectly, because the resolver
   ranks it against a real list of streets and will recover it. Checking them
   separately is the only way to tell those two failures apart in a report. */
export function findSite(hypothesis: string, site: string): Match[] {
  const parts = tokenise(site);
  const leadsWithNumber = parts.length > 1 && /^\d+$/.test(parts[0]);
  if (!leadsWithNumber) return [findPhrase(hypothesis, site)];

  const [number, ...rest] = parts;
  const hyp = tokenise(hypothesis);
  return [
    {
      expected: number,
      hit: hyp.includes(number),
      closest: hyp.includes(number) ? number : "",
      score: hyp.includes(number) ? 1 : 0,
    },
    findPhrase(hypothesis, rest.join(" ")),
  ];
}

/** What a recording declares must survive transcription. */
export type Expectations = {
  /** Human job number as spoken, e.g. "337". */
  job?: string;
  /** Street address of the site, e.g. "36 Wyndham Street". */
  site?: string;
  /** Names that must resolve to people — first names as actually said. */
  people?: string[];
  /** Trade vocabulary and model strings. Soft: visible, fixable, never routes. */
  terms?: string[];
};

export type CaseScore = {
  id: string;
  wer: number;
  hard: Match[];
  soft: Match[];
  /** Every hard check passed — the note needed no human rescue. */
  routable: boolean;
};

export function scoreCase(
  id: string,
  truth: string,
  hypothesis: string,
  expect: Expectations,
): CaseScore {
  const hard: Match[] = [];
  if (expect.job) hard.push(findPhrase(hypothesis, expect.job));
  if (expect.site) hard.push(...findSite(hypothesis, expect.site));
  for (const person of expect.people ?? []) hard.push(findPhrase(hypothesis, person));

  const soft = (expect.terms ?? []).map((term) => findPhrase(hypothesis, term));

  return {
    id,
    wer: wordErrorRate(truth, hypothesis),
    hard,
    soft,
    routable: hard.every((m) => m.hit),
  };
}

export type RunSummary = {
  label: string;
  cases: number;
  routable: number;
  /** Mean WER across cases — the comparable-to-benchmarks number, not the verdict. */
  meanWer: number;
  hardHits: number;
  hardTotal: number;
  softHits: number;
  softTotal: number;
};

export function summarise(label: string, scores: readonly CaseScore[]): RunSummary {
  const sum = (ns: readonly number[]) => ns.reduce((a, b) => a + b, 0);
  return {
    label,
    cases: scores.length,
    routable: scores.filter((s) => s.routable).length,
    meanWer: scores.length === 0 ? 0 : sum(scores.map((s) => s.wer)) / scores.length,
    hardHits: sum(scores.map((s) => s.hard.filter((m) => m.hit).length)),
    hardTotal: sum(scores.map((s) => s.hard.length)),
    softHits: sum(scores.map((s) => s.soft.filter((m) => m.hit).length)),
    softTotal: sum(scores.map((s) => s.soft.length)),
  };
}
