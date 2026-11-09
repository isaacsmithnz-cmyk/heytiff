/* DAYS OWED A WRAP-UP, KEPT IN HEYTIFF (Isaac, 9 November 2026: "Build it",
   to keep them in HeyTiff, mark each day wrapped up and put Friday back as
   owed, after a reinstall lost Friday 6 November's from the phone).

   The phone's list (heytiff-mobile src/lib/wrapup.ts) is a cache: each
   change it makes is sent here as an op, in order, and the list it keeps is
   the one this answers with. The ops are its own four, made safe to send
   twice:

     owe      a Clock off: the day owed, with its jobs. A day already owed
              keeps what's wrapped up; a day settled before is owed afresh.
     noted    a job's note is in: coming back starts at what was used.
     wrapped  a job wrapped up; the day settles with the last of its jobs.
     settle   the day wrapped up, or nothing to wrap up on it.

   Pure: the store (wrapups-store.ts) reads the rows and writes back what
   this changes. */

export type Owed = { on: string; jobs: string[]; done: string[]; noted: string[] };

export type WrapRow = Owed & { settled: boolean };

export type WrapOp =
  | { do: "owe"; on: string; jobs: string[]; done?: string[]; noted?: string[] }
  | { do: "noted"; on: string; job: string }
  | { do: "wrapped"; on: string; job: string; jobs: string[] }
  | { do: "settle"; on: string };

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const MAX_OPS = 200;
const MAX_LIST = 40;

const words = (v: unknown, max: number): string[] | null => {
  if (!Array.isArray(v) || v.length > MAX_LIST) return null;
  const out: string[] = [];
  for (const w of v) {
    if (typeof w !== "string") return null;
    const t = w.trim();
    if (t && t.length <= max) out.push(t);
  }
  return out;
};
const ids = (v: unknown) => words(v, 64)?.map((s) => s.toLowerCase()) ?? null;
const id = (v: unknown) => (typeof v === "string" && v.trim() && v.trim().length <= 64 ? v.trim().toLowerCase() : null);

/** The ops as the phone sent them, or null when any is not one. */
export function readOps(body: unknown): WrapOp[] | null {
  const list = (body as { ops?: unknown } | null)?.ops;
  if (!Array.isArray(list) || list.length > MAX_OPS) return null;
  const out: WrapOp[] = [];
  for (const raw of list) {
    const o = raw as Record<string, unknown> | null;
    const on = typeof o?.on === "string" && DAY.test(o.on) && !Number.isNaN(Date.parse(`${o.on}T12:00:00Z`)) ? o.on : null;
    if (!o || !on) return null;
    if (o.do === "owe") {
      const jobs = words(o.jobs, 60);
      const done = o.done === undefined ? [] : ids(o.done);
      const noted = o.noted === undefined ? [] : ids(o.noted);
      if (!jobs || !done || !noted) return null;
      out.push({ do: "owe", on, jobs, done, noted });
    } else if (o.do === "noted") {
      const job = id(o.job);
      if (!job) return null;
      out.push({ do: "noted", on, job });
    } else if (o.do === "wrapped") {
      const job = id(o.job);
      const jobs = ids(o.jobs);
      if (!job || !jobs) return null;
      out.push({ do: "wrapped", on, job, jobs });
    } else if (o.do === "settle") {
      out.push({ do: "settle", on });
    } else return null;
  }
  return out;
}

const union = (a: readonly string[], b: readonly string[]) => [...new Set([...a, ...b])];

/** The rows after the ops, in order: only the days the ops touched, each as it now stands. */
export function applyOps(rows: ReadonlyMap<string, WrapRow>, ops: readonly WrapOp[]): Map<string, WrapRow> {
  const now = new Map<string, WrapRow>();
  const at = (on: string) => now.get(on) ?? rows.get(on) ?? null;
  for (const op of ops) {
    const was = at(op.on);
    if (op.do === "owe") {
      const keep = was && !was.settled ? was : null;
      now.set(op.on, {
        on: op.on,
        jobs: op.jobs,
        done: union(keep?.done ?? [], op.done ?? []),
        noted: union(keep?.noted ?? [], op.noted ?? []),
        settled: false,
      });
      continue;
    }
    /* a day not owed (never, or settled) has nothing more to mark */
    if (!was || was.settled) continue;
    if (op.do === "noted") now.set(op.on, { ...was, noted: union(was.noted, [op.job]) });
    else if (op.do === "wrapped") {
      const done = union(was.done, [op.job]);
      now.set(op.on, { ...was, done, settled: op.jobs.length > 0 && op.jobs.every((j) => done.includes(j)) });
    } else now.set(op.on, { ...was, settled: true });
  }
  return now;
}

/** Every day still owed, oldest first. */
export const owedOf = (rows: Iterable<WrapRow>): Owed[] =>
  [...rows]
    .filter((r) => !r.settled)
    .map(({ on, jobs, done, noted }) => ({ on, jobs, done, noted }))
    .sort((a, b) => a.on.localeCompare(b.on));
