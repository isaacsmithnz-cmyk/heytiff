/* A PAST BOOKING NOBODY CHECKED IN ON, COUNTED AS A VISIT WHEN IT WAS ONE
   (Isaac, 17 November 2026, on 3408's Built from: "1", a booking counts
   only when that person left photos or notes on the job during it). A phone
   that didn't track him leaves the visit uncounted; one he was only booked
   for as a reminder has nothing from him in it, and stays out.

     a booking   ServiceM8's scheduled block (activity_was_scheduled 1),
                 for one person, on a day before today
     counted     when that person left a photo or a note on the job
                 between its start and its end
     never       when that person checked in that day: a check-in is
                 the visit, and says its own time

   ServiceM8's stamps are naive local time ("2026-10-14 08:30:00"), so they
   compare as strings. Pure. */

export type Activity = { start_date: string | null; end_date: string | null; staff_uuid: string | null; activity_was_scheduled: number | null };
/** A photo or a note on the job: who, and when. */
export type Mark = { by: string | null; at: string | null };
export type BookedVisit = { day: string; staffId: string; minutes: number };

const minutesBetween = (a: string, b: string): number => {
  const t = (s: string) => Date.parse(`${s.slice(0, 10)}T${s.slice(11, 19)}Z`);
  const m = Math.round((t(b) - t(a)) / 60_000);
  return Number.isFinite(m) && m > 0 ? m : 0;
};

export function bookedVisits(acts: readonly Activity[], marks: readonly Mark[], today: string): BookedVisit[] {
  const checkedIn = new Set(acts.filter((a) => a.activity_was_scheduled === 0 && a.start_date && a.staff_uuid).map((a) => `${a.start_date!.slice(0, 10)}|${a.staff_uuid}`));
  const out = new Map<string, BookedVisit>();
  for (const a of acts) {
    if (a.activity_was_scheduled !== 1 || !a.start_date || !a.end_date || !a.staff_uuid) continue;
    const day = a.start_date.slice(0, 10);
    if (day >= today || checkedIn.has(`${day}|${a.staff_uuid}`)) continue;
    const there = marks.some((m) => m.by === a.staff_uuid && m.at !== null && m.at >= a.start_date! && m.at <= a.end_date!);
    if (!there) continue;
    const key = `${day}|${a.staff_uuid}`;
    const had = out.get(key);
    out.set(key, { day, staffId: a.staff_uuid, minutes: (had?.minutes ?? 0) + minutesBetween(a.start_date, a.end_date) });
  }
  return [...out.values()].sort((x, y) => x.day.localeCompare(y.day));
}
