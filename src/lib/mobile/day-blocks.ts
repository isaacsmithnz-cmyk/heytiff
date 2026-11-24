/* YOUR REAL DAY BESIDE THE BOOKINGS (bug 89, Isaac, 24 November 2026: "My
   actual day is very different"). On 24 November his Today listed bookings
   8:00 to 12:30 back to back, while his check-ins ran 7:45 to 8:49, then
   nothing until 1:21, then four short visits, with three bookings never
   visited. Today now shows each booking beside when you were there, the
   office from where your phone was, and any stretch over half an hour with
   nothing logged, with Add missing time.

   Pure, and its own module: the day (./day) reads and writes the blocks,
   these are the rules.

   A BLOCK is a stretch of the clocked day said to be Admin, Travel, a
   Supplier run, Lunch, At the office, Unpaid, or something else in your
   own words (day_time_blocks). A GAP is a stretch over half an hour inside
   the day with no job, office or block on it. */

export const BLOCK_KINDS = ["admin", "travel", "supplier", "lunch", "office", "unpaid", "other"] as const;
export type BlockKind = (typeof BLOCK_KINDS)[number];

export type DayBlock = { id: string; from: string; until: string; kind: BlockKind; note: string | null; source: "manual" | "gps" };
export type DayGap = { from: string; until: string; minutes: number };

/** Over this long with nothing logged is a gap. */
export const GAP_MINUTES = 30;
const NOTE_MAX = 200;

export const BLOCK_WORDS = {
  noKind: "Pick what the time was.",
  noTime: "Pick the time.",
  backwards: "It has to finish after it starts.",
  outside: "That time isn't in your day.",
  overlaps: "That's over time you've already added.",
  noBlock: "That time isn't in your day.",
} as const;

/** The stretches over `min` minutes, from `from` to `until`, that none of the spans cover. An open span runs to `until`. */
export function gapsOf(p: { from: string; until: string; spans: readonly { from: string; until: string | null }[] }, min: number = GAP_MINUTES): DayGap[] {
  const a = Date.parse(p.from);
  const z = Date.parse(p.until);
  if (!(z > a)) return [];
  const covered = p.spans
    .map((s) => [Math.max(a, Date.parse(s.from)), Math.min(z, s.until ? Date.parse(s.until) : z)] as const)
    .filter(([f, u]) => Number.isFinite(f) && Number.isFinite(u) && u > f)
    .sort((x, y) => x[0] - y[0]);
  const out: DayGap[] = [];
  let t = a;
  const push = (f: number, u: number) => {
    const minutes = Math.round((u - f) / 60_000);
    if (minutes > min) out.push({ from: new Date(f).toISOString(), until: new Date(u).toISOString(), minutes });
  };
  for (const [f, u] of covered) {
    if (f > t) push(t, f);
    if (u > t) t = u;
  }
  if (z > t) push(t, z);
  return out;
}

/** A block asked for, held to the day: a kind it knows (words alone are Something else), times in order, inside the
    day (a minute's give either end), and over no other block. */
export function blockOf(
  raw: { kind?: unknown; note?: unknown; from?: unknown; until?: unknown },
  day: { onAt: string; until: string },
  others: readonly { from: string; until: string }[],
): { from: string; until: string; kind: BlockKind; note: string | null } | { error: string } {
  const note = typeof raw.note === "string" ? raw.note.replace(/\s+/g, " ").trim().slice(0, NOTE_MAX) || null : null;
  const kind = typeof raw.kind === "string" && (BLOCK_KINDS as readonly string[]).includes(raw.kind) ? (raw.kind as BlockKind) : note ? "other" : null;
  if (!kind || (kind === "other" && !note)) return { error: BLOCK_WORDS.noKind };
  const f = typeof raw.from === "string" ? Date.parse(raw.from) : NaN;
  const u = typeof raw.until === "string" ? Date.parse(raw.until) : NaN;
  if (Number.isNaN(f) || Number.isNaN(u)) return { error: BLOCK_WORDS.noTime };
  const on = Date.parse(day.onAt);
  const end = Date.parse(day.until);
  if (f < on - 60_000 || u > end + 60_000) return { error: BLOCK_WORDS.outside };
  const from = Math.max(f, on);
  const until = Math.min(u, end);
  if (until <= from) return { error: BLOCK_WORDS.backwards };
  if (others.some((o) => Date.parse(o.from) < until && Date.parse(o.until) > from)) return { error: BLOCK_WORDS.overlaps };
  return { from: new Date(from).toISOString(), until: new Date(until).toISOString(), kind, note };
}

/* WHAT COMES OFF THE PAID HOURS. Lunch is the day's break: the workspace's
   own break stands for it, and lunch longer than that break isn't paid
   either; where the workspace pays its break, only lunch past it comes off.
   Unpaid comes off whole. Only what falls inside the paid day (from when pay
   began to the finish) counts: time before pay began was never paid. The
   rest (admin, travel, a supplier run, the office, something else) is paid
   as the day is. */
export function offThePay(
  blocks: readonly { from: string; until: string; kind: BlockKind }[],
  paid: { from: string; until: string },
  rules: { breakPaid: boolean; breakMinutes: number },
): number {
  const a = Date.parse(paid.from);
  const z = Date.parse(paid.until);
  const inPaid = (k: BlockKind) =>
    blocks
      .filter((b) => b.kind === k)
      .reduce((n, b) => n + Math.max(0, Math.round((Math.min(z, Date.parse(b.until)) - Math.max(a, Date.parse(b.from))) / 60_000)), 0);
  const lunch = inPaid("lunch");
  const unpaid = inPaid("unpaid");
  const breakMinutes = Math.max(0, rules.breakMinutes);
  const asBreak = rules.breakPaid ? Math.max(0, lunch - breakMinutes) : Math.max(breakMinutes, lunch);
  return asBreak + unpaid;
}
