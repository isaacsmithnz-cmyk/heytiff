/* HABITS, FROM WHAT A PERSON CHANGES (the engine rebuild, slice 13.2, the
   first of it) — a swap made again and again becomes a question, never a
   rule on its own (Isaac, 2026-10-06: "a habit only with your yes"). When
   the same item has been swapped for the same other item on three
   different quotes, Quoting asks whether to make the other one preferred;
   one press says yes, and the book offers it first from then on.

   Read from the quote lines' own history (quote_line_changes): only swaps
   a person made, never Tiff's. Pure. */

export type SwapChange = {
  job: string;
  madeBy: string;
  before: { code?: string | null; name?: string | null; supplierKey?: string | null } | null;
  after: { code?: string | null; name?: string | null; supplierKey?: string | null } | null;
};

export type Habit = {
  from: { code: string; name: string };
  to: { code: string; name: string; supplierKey: string };
  /** the quotes it was swapped on */
  quotes: number;
};

/** How many quotes a swap has to happen on before it's asked about. */
export const HABIT_AFTER = 3;

export function habitsFrom(changes: SwapChange[], preferred: ReadonlySet<string> = new Set()): Habit[] {
  const seen = new Map<string, { from: Habit["from"]; to: Habit["to"]; jobs: Set<string> }>();
  for (const c of changes) {
    if (c.madeBy === "tiff") continue;
    const from = c.before?.code;
    const to = c.after?.code;
    const supplier = c.after?.supplierKey;
    if (!from || !to || !supplier || from === to) continue;
    const key = `${from}>${supplier}|${to}`;
    const h = seen.get(key) ?? { from: { code: from, name: c.before?.name ?? from }, to: { code: to, name: c.after?.name ?? to, supplierKey: supplier }, jobs: new Set<string>() };
    h.jobs.add(c.job);
    seen.set(key, h);
  }
  return [...seen.values()]
    .filter((h) => h.jobs.size >= HABIT_AFTER && !preferred.has(`${h.to.supplierKey}|${h.to.code}`))
    .map((h) => ({ from: h.from, to: h.to, quotes: h.jobs.size }))
    .sort((a, b) => b.quotes - a.quotes || a.to.code.localeCompare(b.to.code));
}
