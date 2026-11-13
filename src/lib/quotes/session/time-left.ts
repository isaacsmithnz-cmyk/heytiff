/* ABOUT HOW LONG SHE HAS LEFT (Isaac, 1 November 2026: "a progress timer to
   show estimated time remaining for building the quote"). Unlike an upload,
   nothing says how much of her thinking has gone, so the bar runs on how long a
   turn usually takes: the medians of 61 turns on 18 quotes in production, on
   1 November 2026. Most first turns took 70 to 150 s, most changes 15 to 55. */

type TurnEvent = { turnId: string | null; kind: string; body: Record<string, unknown>; at: string };

/** A first turn builds the quote; a later one mostly changes it. */
const USUAL_FIRST_S = 100;
const USUAL_LATER_S = 35;
/** A quick answer is over before a bar would mean anything. */
const QUIET_LATER_S = 5;
/** The bar holds here past the usual time: it never says she's finished before she is. */
const MOST_PERCENT = 95;

const STEP_OF: Record<string, string> = {
  read_quote: "Reading the job",
  read_design: "Reading the job",
  job_files: "Reading the job",
  look_at: "Reading the job",
  your_corrections: "Reading the job",
  compare_with: "Reading the job",
  plan_parts: "Choosing the parts",
  unit_specs: "Choosing the parts",
  room_load: "Choosing the parts",
  airflow_check: "Choosing the parts",
  pairing_check: "Choosing the parts",
  refrigerant_charge: "Choosing the parts",
  search_book: "Pricing the parts",
  research_price: "Pricing the parts",
  add_kit: "Pricing the parts",
  add_lines: "Pricing the parts",
  change_line: "Pricing the parts",
  remove_line: "Pricing the parts",
  copy_option: "Pricing the parts",
  build_labour: "Pricing the parts",
  name_option: "Writing the proposal",
  write_up: "Writing the proposal",
  write_proposal: "Writing the proposal",
};

const lastTurn = (events: readonly TurnEvent[]) => events.findLast((e) => e.turnId)?.turnId ?? null;

/** When the turn under way began, or null when the thread's last turn has finished: the send has just gone and its first event isn't back. */
export function turnStartOf(events: readonly TurnEvent[]): number | null {
  const turn = lastTurn(events);
  if (!turn || events.some((e) => e.turnId === turn && e.kind === "usage")) return null;
  const at = Date.parse(events.find((e) => e.turnId === turn)!.at);
  return Number.isNaN(at) ? null : at;
}

/** No turn has finished yet, so this one is building the quote. */
export const isFirstTurn = (events: readonly TurnEvent[]) => !events.some((e) => e.kind === "usage");

/** What she's doing, from the last tool of the turn under way; the question she paused on doesn't change it. */
export function stepOf(events: readonly TurnEvent[]): string | null {
  const turn = turnStartOf(events) === null ? null : lastTurn(events);
  if (!turn) return null;
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]!;
    const step = e.turnId === turn && e.kind === "tool" ? STEP_OF[String(e.body.name)] : undefined;
    if (step) return step;
  }
  return null;
}

/** The time left in words, to the 10 s: finer would claim more than the estimate knows. */
export function leftInWords(leftS: number): string {
  if (leftS <= 0) return "Taking longer than usual";
  if (leftS < 10) return "Almost done";
  const s = Math.ceil(leftS / 10) * 10;
  if (s < 60) return `about ${s} sec left`;
  return `about ${Math.floor(s / 60)} min${s % 60 ? ` ${s % 60}` : ""} left`;
}

/** The bar and its words at this many seconds in; null is too early for a
    bar. `took`: how long this business's turns of this kind took, sorted
    (tookOf): what's left is then the middle of what those that ran this long
    still took, so it moves as she goes and a long one stretches rather than
    giving up at a fixed time. Without enough of them, the usual times. */
export function timeLeft(elapsedS: number, first: boolean, took?: readonly number[]): { percent: number; words: string } | null {
  if (!first && elapsedS < QUIET_LATER_S) return null;
  const e = Math.max(0, elapsedS);
  if (took && took.length >= TOOK_MIN) {
    const left = stillToGo(took, e);
    if (left === null) return { percent: MOST_PERCENT, words: leftInWords(0) };
    return { percent: Math.min(MOST_PERCENT, (e / (e + left)) * 100), words: leftInWords(left) };
  }
  const usual = first ? USUAL_FIRST_S : USUAL_LATER_S;
  return { percent: Math.min(MOST_PERCENT, (e / usual) * 100), words: leftInWords(usual - elapsedS) };
}

/* HOW LONG IS REALLY LEFT (Isaac, 13 November 2026: "is there a way to show
   the estimated time remaining accurately?"). Every turn after the first was
   taken as 35 s. In production, 30 days to 13 November, the middle half of
   later turns took 11 to 36 s and of first builds 41 to 120 s; at the start
   an answer can't be told from a change (both about 20 to 28 s), so the
   kinds are a first build and everything after, and the estimate narrows
   from how long the turn has run. */

/** Fewer turns of a kind than this, and the usual times stand. */
export const TOOK_MIN = 8;
/** At most this many turns of each kind are kept, the newest. */
export const TOOK_KEEP = 200;

/** The middle of what the turns that ran past `elapsedS` still took; null
    when none ran that long. `took` sorted. */
export function stillToGo(took: readonly number[], elapsedS: number): number | null {
  const rest = took.filter((t) => t > elapsedS).map((t) => t - elapsedS);
  if (rest.length === 0) return null;
  const mid = Math.floor(rest.length / 2);
  return rest.length % 2 ? rest[mid]! : (rest[mid - 1]! + rest[mid]!) / 2;
}

type KindEvent = TurnEvent & { id?: number };

/** A first build: no turn had finished before it, or it was Read the job. */
export function isFirstBuild(events: readonly KindEvent[], turn: string): boolean {
  const at = events.findIndex((e) => e.turnId === turn);
  if (at < 0) return false;
  if (!events.slice(0, at).some((e) => e.kind === "usage")) return true;
  return events.some((e) => e.turnId === turn && e.kind === "message" && e.body.read === true);
}

/** Whether the turn under way is a first build. */
export function buildingFirst(events: readonly KindEvent[]): boolean {
  const turn = turnStartOf(events) === null ? null : lastTurn(events);
  return turn ? isFirstBuild(events, turn) : isFirstTurn(events);
}

/** How long each finished turn of a thread took, first builds apart. */
export function turnTimes(events: readonly KindEvent[]): { first: boolean; seconds: number }[] {
  const turns = [...new Set(events.filter((e) => e.turnId && e.kind === "usage").map((e) => e.turnId!))];
  return turns.flatMap((turn) => {
    const own = events.filter((e) => e.turnId === turn).map((e) => Date.parse(e.at)).filter((t) => !Number.isNaN(t));
    if (own.length === 0) return [];
    return [{ first: isFirstBuild(events, turn), seconds: Math.round((Math.max(...own) - Math.min(...own)) / 1000) }];
  });
}

export type Took = { first: number[]; later: number[] };

/** Each kind's times, newest TOOK_KEEP, sorted: what the bar reads. `times` oldest first. */
export function tookOf(times: readonly { first: boolean; seconds: number }[]): Took {
  const of = (first: boolean) => times.filter((t) => t.first === first).slice(-TOOK_KEEP).map((t) => t.seconds).sort((a, b) => a - b);
  return { first: of(true), later: of(false) };
}
