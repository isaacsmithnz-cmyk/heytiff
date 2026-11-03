/* SOMEONE'S DAYS PLACED, pure: the gaps in a normal day around bookings and
   time off, and the gaps close by. lib/mobile/free-days reads what goes in. */

export type FreeBooking = {
  activity: string;
  jobUuid: string;
  number: string;
  suburb: string;
  colour: string | null;
  status: string | null;
  start: string;
  end: string;
};
export type FreeGap = { start: string; end: string };
export type FreeDay = {
  day: string;
  /** one of their rostered days */
  work: boolean;
  /** their normal day on it */
  normal: FreeGap;
  bookings: FreeBooking[];
  /** the gaps in the normal day, `GAP_MIN` or more */
  free: FreeGap[];
  freeMin: number;
  /** what takes the whole day: their time off's word, or the holiday's */
  off: string | null;
  suburbs: string[];
};
export type CloseBy = FreeGap & { day: string; next: "after" | "before"; number: string; suburb: string };
export type FreeDays = { days: FreeDay[]; near: CloseBy[] };

/** The least gap that counts as free. */
export const GAP_MIN = 30;
/** How far apart a booking and a gap can be and still be "right after". */
const NEXT_TO_MIN = 15;
const DAY_MIN = 24 * 60;

const STAMP = /^(\d{4}-\d{2}-\d{2}) (\d{2}):(\d{2})/;
const low = (v: string | null | undefined) => (v ?? "").trim().toLowerCase();
const minOf = (stamp: string) => {
  const m = STAMP.exec(stamp);
  return m ? Number(m[2]) * 60 + Number(m[3]) : 0;
};
const stampOf = (day: string, min: number) => `${day} ${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}:00`;
/** Monday 0 … Sunday 6, the roster's convention. */
const weekdayOf = (iso: string) => (new Date(`${iso}T00:00:00Z`).getUTCDay() + 6) % 7;

export type Job = { number: string; suburb: string; colour: string | null; status: string | null };
type Span = { startMin: number; endMin: number };

/** The days placed: pure, for the read below and its tests. */
export function placeDays(input: {
  days: readonly string[];
  normal: Span;
  workDays: readonly number[];
  bookings: readonly { activity: string; jobUuid: string; start: string; end: string }[];
  jobs: ReadonlyMap<string, Job>;
  /** per day: their time off and the shut times on it */
  away: (day: string) => { spans: (Span & { whole: boolean; word: string })[] };
  /** "YYYY-MM-DD HH:MM:SS" on the account's clock; null where it isn't known */
  now: string | null;
  /** the visit being moved: its length and its job */
  minutes: number | null;
  job: string | null;
}): FreeDays {
  const today = input.now?.slice(0, 10) ?? null;
  const nowMin = input.now ? Math.ceil(minOf(input.now) / 15) * 15 : 0;
  const home = input.job ? input.jobs.get(low(input.job))?.suburb ?? "" : "";
  const days: FreeDay[] = [];
  const near: CloseBy[] = [];

  for (const day of input.days) {
    if (today && day < today) continue;
    const bookings: FreeBooking[] = input.bookings
      .filter((b) => b.start.slice(0, 10) === day)
      .map((b) => {
        const j = input.jobs.get(low(b.jobUuid));
        return { ...b, number: j?.number ?? "", suburb: j?.suburb ?? "", colour: j?.colour ?? null, status: j?.status ?? null };
      })
      .sort((a, b) => a.start.localeCompare(b.start));
    const taken: Span[] = bookings.map((b) => ({ startMin: minOf(b.start), endMin: b.end.slice(0, 10) > day ? DAY_MIN : minOf(b.end) }));
    const off = input.away(day).spans;
    taken.push(...off);
    const lo = day === today ? Math.max(input.normal.startMin, nowMin) : input.normal.startMin;
    const hi = input.normal.endMin;

    const free: FreeGap[] = [];
    let at = lo;
    for (const t of [...taken].sort((a, b) => a.startMin - b.startMin)) {
      if (t.startMin > at) {
        const end = Math.min(t.startMin, hi);
        if (end - at >= GAP_MIN) free.push({ start: stampOf(day, at), end: stampOf(day, end) });
      }
      at = Math.max(at, t.endMin);
      if (at >= hi) break;
    }
    if (hi - at >= GAP_MIN) free.push({ start: stampOf(day, at), end: stampOf(day, hi) });

    const whole = off.find((o) => o.whole || (o.startMin <= input.normal.startMin && o.endMin >= input.normal.endMin));
    days.push({
      day,
      work: input.workDays.includes(weekdayOf(day)),
      normal: { start: stampOf(day, input.normal.startMin), end: stampOf(day, input.normal.endMin) },
      bookings,
      free,
      freeMin: free.reduce((n, g) => n + minOf(g.end) - minOf(g.start), 0),
      off: whole?.word ?? null,
      suburbs: [...new Set(bookings.map((b) => b.suburb).filter(Boolean))],
    });

    /* close by: a gap that fits it, next to a booking in the job's suburb */
    const len = input.minutes;
    if (!len || !home || near.length >= 2) continue;
    for (const g of free) {
      const [a, z] = [minOf(g.start), minOf(g.end)];
      if (z - a < len) continue;
      const here = (b: FreeBooking) => low(b.suburb) === low(home) && low(b.jobUuid) !== low(input.job);
      const before = bookings.find((b) => here(b) && minOf(b.end) <= a && a - minOf(b.end) <= NEXT_TO_MIN);
      const after = before ? null : bookings.find((b) => here(b) && minOf(b.start) >= z && minOf(b.start) - z <= NEXT_TO_MIN);
      if (before) near.push({ day, start: g.start, end: stampOf(day, a + len), next: "after", number: before.number, suburb: before.suburb });
      else if (after) near.push({ day, start: stampOf(day, z - len), end: g.end, next: "before", number: after.number, suburb: after.suburb });
      if (near.length >= 2) break;
    }
  }
  return { days, near };
}
