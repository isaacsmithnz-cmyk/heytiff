/* Pure, and its own module so the schedule's Actual (./schedule-actual)
   reads it without the day's database and timesheet. */

/** A long time away before coming back to a job: keeping it stretches the
    stint before it, `stintId` from `stintFrom`, to `until`. */
export type Away = { from: string; until: string; stintId: string; stintFrom: string };

/** A piece of time on a job: the phone's stint, or ServiceM8's own check-in. */
export type JoinPiece = {
  jobUuid: string;
  from: string;
  until: string | null;
  how: "phone" | "servicem8";
  stintId?: string;
  reason?: string | null;
  joined?: string[];
  away?: Away | null;
};

/* THE DAY'S PIECES, JOINED (Isaac, 29 October 2026: "Job time should start
   from when you first got there and only has an issue if you don't go back
   there. Or maybe if you quickly pop up to another job…"; then "Build them"
   to the rules as written). The phone records honestly where you were and
   when; these are the rules for what that time is ON:

     out and back       leave a job and come back to it with no other job (or
                        the office) in between, and the time away stays on
                        that job: parking, coffee, a parts run, lunch
     a stop elsewhere   leave, stop at another job or the office, come back:
                        that stop keeps its own time, and the drive there and
                        the drive back stay on the first job
     away for long      more than AWAY_KEPT_MS away and back: the time away is
                        NOT put on the job, and the Clock off sheet shows it
                        ("Away 10:00–1:30") for one tap to keep it there
     never back         the job ends when you left, as it always has

   Only the phone's own stints are joined or stretched; ServiceM8's own
   check-ins stand as ServiceM8 has them. Pure, and applied wherever the
   day is read, so Today, the Clock off sheet and what goes to ServiceM8 all
   read the same day. */
export const AWAY_KEPT_MS = 2 * 3_600_000;

export function joinDay<T extends JoinPiece>(jobs: readonly T[], office: readonly { from: string; until: string | null }[]): T[] {
  const rows: (T | null)[] = [...jobs].sort((a, b) => (a.from < b.from ? -1 : 1)).map((j) => ({ ...j }));
  const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
  for (let i = 0; i < rows.length; i++) {
    const a = rows[i];
    if (!a || a.how !== "phone") continue;
    for (;;) {
      if (!a.until) break;
      const k = rows.findIndex((r, at) => at > i && !!r && same(r.jobUuid, a.jobUuid));
      const b = k < 0 ? null : rows[k];
      if (!b || b.how !== "phone") break;
      /* everywhere else you were in the gap: other jobs, and the office */
      const between = [
        ...rows.slice(i + 1, k).filter((r): r is T => !!r).map((r) => ({ from: r.from, until: r.until ?? r.from })),
        ...office.filter((o) => o.until && o.from >= a.until! && o.until <= b.from).map((o) => ({ from: o.from, until: o.until! })),
      ].sort((x, y) => (x.from < y.from ? -1 : 1));
      if (between.length) {
        /* a stop elsewhere: the drives there and back are the first job's */
        const first = between[0]!;
        const last = between.reduce((m, x) => (x.until > m ? x.until : m), first.until);
        if (first.from > a.until) a.until = first.from;
        if (last < b.from) b.from = last;
        break;
      }
      if (Date.parse(b.from) - Date.parse(a.until) > AWAY_KEPT_MS) {
        /* away long: kept off the job unless kept on the sheet */
        if (a.stintId) b.away = { from: a.until, until: b.from, stintId: a.stintId, stintFrom: a.from };
        break;
      }
      /* out and back: one stretch on the job */
      a.until = b.until;
      a.joined = [...(a.joined ?? []), ...(b.stintId ? [b.stintId] : []), ...(b.joined ?? [])];
      if (b.reason && !a.reason) a.reason = b.reason;
      rows[k] = null;
    }
  }
  return rows.filter((r): r is T => !!r);
}
