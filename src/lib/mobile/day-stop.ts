/* THE SHIFT'S END, A DAY LEFT ON, AND THE 14-HOUR STOP (Isaac, 20 November
   2026: his Thursday stayed on all night and Friday showed 30 h; "What if you
   do a night shift and go past midnight", "There needs to be a safety for
   like a maximum working time ... 14 hours. It should automatically stop the
   clock if no other method has worked", then "Approved, build it" to
   https://claude.ai/artifact/MNfi9mZUQ5kkuBvRUkv5LC).

   EVERYTHING COUNTS FROM THE SHIFT'S OWN END, NEVER THE DATE, so a night
   shift past midnight is one shift:
   - the end is the last end of the bookings that started in the shift (from
     two hours before Clock on to eight after), wherever their date falls, or
     eight hours after Clock on with none; Still here moves it on (`held`);
   - the reminders come at the end plus 30 minutes, 3 hours, and 6 hours
     where that's before the stop;
   - a day is today's until three hours past its end; after that it's LEFT
     ON, and its time stands at the last thing the phone saw;
   - fourteen hours after Clock on (the team's setting), or once Still here's
     hold runs out after that, a day nobody has answered for STOPS, at the
     last thing seen, never at the fourteen hours.

   Pure: the times in, the times out. */

const H = 3_600_000;

/** A shift with no booking to end it ends this long after Clock on. */
export const DAY_MS = 8 * H;
/** A day is left on this long past its end (as location goes off). */
export const LEFT_ON_MS = 3 * H;
/** Still here holds the end, and the stop, this long. */
export const HOLD_MS = 2 * H;
/** A stopped day can be restarted for this long, and is sent on after it. */
export const RESTART_MS = 2 * H;
/** The stop, unless the team says otherwise. */
export const STOP_HOURS = 14;
/** The team's stop, in whole hours, within reason. */
export const stopHoursOf = (raw: unknown): number =>
  typeof raw === "number" && Number.isInteger(raw) && raw >= 10 && raw <= 24 ? raw : STOP_HOURS;

/** Bookings start in the shift from this long before Clock on to this long after. */
export const SHIFT_BEFORE_MS = 2 * H;
export const SHIFT_AFTER_MS = 8 * H;

const iso = (ms: number) => new Date(ms).toISOString();
const ms = (s: string | null | undefined) => (s ? Date.parse(s) : NaN);

/** The shift's end: its bookings' last end, or eight hours on, moved on by Still here. */
export function shiftEnd(p: { onAt: string; bookingEnds: readonly (string | null)[]; heldUntil: string | null }): string {
  const on = ms(p.onAt);
  const ends = p.bookingEnds.map(ms).filter((t) => Number.isFinite(t) && t > on);
  const end = ends.length ? Math.max(...ends) : on + DAY_MS;
  const held = ms(p.heldUntil);
  return iso(Number.isFinite(held) && held > end ? held : end);
}

/** When the clock stops itself: the team's hours after Clock on, or later while Still here holds it. */
export function stopsAt(p: { onAt: string; hours: number; heldUntil: string | null }): string {
  const cap = ms(p.onAt) + p.hours * H;
  const held = ms(p.heldUntil);
  return iso(Number.isFinite(held) && held > cap ? held : cap);
}

/** Left on: three hours past the end, and nobody has clocked off. */
export const isLeftOn = (end: string, now: number) => now >= ms(end) + LEFT_ON_MS;

export type Seen = { at: string; what: "home" | "checkout" | "end" };

/** THE LAST THING THE PHONE SAW: getting home, else the last job or office left, else the end (or where you still
    were at it). Never before Clock on, never after the stop or now. */
export function lastSeen(p: {
  onAt: string;
  end: string;
  stop: string;
  now: number;
  homeAt: string | null;
  stints: readonly { inAt: string; outAt: string | null }[];
  office: readonly { from: string; until: string | null }[];
}): Seen {
  const on = ms(p.onAt);
  const ceiling = Math.min(p.now, ms(p.stop));
  const clamp = (t: number) => iso(Math.max(on, Math.min(ceiling, t)));
  const left = [...p.stints.map((s) => ms(s.outAt)), ...p.office.map((o) => ms(o.until))].filter((t) => Number.isFinite(t) && t >= on);
  const lastLeft = left.length ? Math.max(...left) : NaN;
  /* still somewhere when the phone stopped looking: there until the end, at least */
  const stillAt = [...p.stints.filter((s) => !s.outAt).map((s) => ms(s.inAt)), ...p.office.filter((o) => !o.until).map((o) => ms(o.from))].filter(Number.isFinite);
  const home = ms(p.homeAt);
  if (Number.isFinite(home) && home >= on && !(lastLeft > home) && !stillAt.some((t) => t > home)) return { at: clamp(home), what: "home" };
  if (stillAt.length) return { at: clamp(Math.max(ms(p.end), ...stillAt)), what: "end" };
  if (Number.isFinite(lastLeft)) return { at: clamp(lastLeft), what: "checkout" };
  return { at: clamp(ms(p.end)), what: "end" };
}

/** Whether a stopped day can still be restarted: within two hours of the stop, before it's been sent on. */
export const mayRestart = (stoppedAt: string | null, settledAt: string | null, now: number) =>
  !!stoppedAt && !settledAt && now - ms(stoppedAt) <= RESTART_MS;

/** Whether a stopped day's time goes to ServiceM8 and the timesheet now: once it's been looked at, or Restart has
    had its two hours. */
export const settlesNow = (p: { stoppedAt: string | null; settledAt: string | null; seenAt: string | null; now: number }) =>
  !!p.stoppedAt && !p.settledAt && (!!p.seenAt || p.now - ms(p.stoppedAt) > RESTART_MS);

/** The wall clock's "YYYY-MM-DD HH:MM:SS", as ServiceM8's start_date is kept, from wallMinute's "YYYY-MM-DDTHH:MM:00". */
export const sm8Wall = (wall: string) => wall.replace("T", " ").slice(0, 19);
