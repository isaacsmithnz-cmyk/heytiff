/* The project's site diary — ServiceM8's bookings read as OUR visits.

   ServiceM8 keeps ONE job card with every booking on it, and that is the
   model the project card follows (Isaac, 2026-08-29): each booking day on
   the linked job reads as a visit on the project, and a visit can carry its
   own notes — which live on OUR trip row, created the moment somebody
   writes on a day (the mirror is read-only by charter, so the words could
   never live over there).

   Pure on purpose: the server action feeds it activity rows and staff
   names; the tests feed it job 279's real shapes. Client-safe — nothing
   here may import a query module (the supabase-in-jsdom trap).

   THE LAWS, inherited from the job card's own derivation:
   - scheduled (activity_was_scheduled=1) is the PLAN; a check-in (=0) is
     what happened. One day can carry both, and usually does.
   - crew dedupes BY STAFF ID, never by name — namesakes must not collapse.
   - a check-in without a clock-off contributes presence but no minutes.
   - minutes are what ServiceM8 recorded, stated without clamping — the
     card repeats the mirror, it does not editorialise it. */

export type DiaryActivityRow = {
  start_date: string | null;
  end_date: string | null;
  staff_uuid: string | null;
  activity_was_scheduled: number | null;
};

export type DiaryPerson = { id: string; name: string; title: string | null };

export type ProjectDiaryDay = {
  /** ISO date. */
  day: string;
  /** Who is BOOKED that day, from the linked job's diary. */
  booked: DiaryPerson[];
  /** The booking's window — earliest start, latest end, naive local. */
  bookedStart: string | null;
  bookedEnd: string | null;
  /** What happened: check-in minutes summed across the crew. */
  sessionMinutes: number;
  /** Who actually clocked on. */
  sessionCrew: DiaryPerson[];
};

const dayOf = (naive: string | null): string | null =>
  naive && naive.length >= 10 ? naive.slice(0, 10) : null;

/** Minutes between two naive local stamps — same zone both sides, so the
    parse needs no zone at all. Null when either side won't parse. */
function minutesBetween(start: string, end: string): number | null {
  const a = Date.parse(start.replace(" ", "T"));
  const b = Date.parse(end.replace(" ", "T"));
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  const m = Math.round((b - a) / 60_000);
  return m > 0 ? m : null;
}

export function buildProjectDiary(
  activities: readonly DiaryActivityRow[],
  staff: ReadonlyMap<string, { name: string; title: string | null }>
): ProjectDiaryDay[] {
  const days = new Map<string, ProjectDiaryDay>();
  const at = (day: string): ProjectDiaryDay => {
    const got = days.get(day);
    if (got) return got;
    const made: ProjectDiaryDay = {
      day,
      booked: [],
      bookedStart: null,
      bookedEnd: null,
      sessionMinutes: 0,
      sessionCrew: [],
    };
    days.set(day, made);
    return made;
  };

  const personOf = (id: string): DiaryPerson => {
    const s = staff.get(id);
    return { id, name: s?.name ?? "Somebody", title: s?.title ?? null };
  };

  for (const a of activities) {
    const day = dayOf(a.start_date);
    if (!day) continue;
    const entry = at(day);
    if (a.activity_was_scheduled === 1) {
      if (a.staff_uuid && !entry.booked.some((p) => p.id === a.staff_uuid)) {
        entry.booked.push(personOf(a.staff_uuid));
      }
      if (a.start_date && (!entry.bookedStart || a.start_date < entry.bookedStart)) {
        entry.bookedStart = a.start_date;
      }
      if (a.end_date && (!entry.bookedEnd || a.end_date > entry.bookedEnd)) {
        entry.bookedEnd = a.end_date;
      }
    } else if (a.activity_was_scheduled === 0) {
      if (a.staff_uuid && !entry.sessionCrew.some((p) => p.id === a.staff_uuid)) {
        entry.sessionCrew.push(personOf(a.staff_uuid));
      }
      if (a.start_date && a.end_date) {
        const m = minutesBetween(a.start_date, a.end_date);
        if (m !== null) entry.sessionMinutes += m;
      }
    }
  }

  return [...days.values()].sort((a, b) => a.day.localeCompare(b.day));
}

/* ── the merge: our trips and the job's diary, one list ─────────────────── */

/** The slice of a trip the merge needs — the card hands the full row on. */
export type MergeTrip = {
  id: string;
  status: string;
  bookedDate: string | null;
  completedAt: string | null;
  dueDate: string;
};

export type ProjectVisitRow<T extends MergeTrip> = {
  /** Null only for an open trip with no day yet. */
  day: string | null;
  trip: T | null;
  diary: ProjectDiaryDay | null;
};

export type MergedProjectDiary<T extends MergeTrip> = {
  /** Today and later, soonest first. */
  upcoming: ProjectVisitRow<T>[];
  /** Open trips that have no day — the plan that isn't placed yet. */
  unplaced: ProjectVisitRow<T>[];
  /** Before today, newest first. */
  past: ProjectVisitRow<T>[];
};

/** The day a trip belongs to: a closed trip ran when it ran; an open one
    sits on its booked day. Due-only trips are the unplaced group's business. */
export function tripDay(t: MergeTrip): string | null {
  if (t.status === "done" || t.status === "skipped") {
    return t.completedAt ?? t.bookedDate ?? t.dueDate;
  }
  return t.bookedDate;
}

export function mergeProjectDiary<T extends MergeTrip>(
  trips: readonly T[],
  diary: readonly ProjectDiaryDay[],
  today: string
): MergedProjectDiary<T> {
  const daysLeft = new Map(diary.map((d) => [d.day, d]));
  const dated: ProjectVisitRow<T>[] = [];
  const unplaced: ProjectVisitRow<T>[] = [];

  for (const t of trips) {
    const day = tripDay(t);
    if (!day) {
      unplaced.push({ day: null, trip: t, diary: null });
      continue;
    }
    /* First trip on a day takes the diary's reading of it; a second trip on
       the same day is its own row rather than a repeat of the crew list. */
    const d = daysLeft.get(day) ?? null;
    if (d) daysLeft.delete(day);
    dated.push({ day, trip: t, diary: d });
  }
  for (const d of daysLeft.values()) {
    dated.push({ day: d.day, trip: null, diary: d });
  }

  const upcoming = dated
    .filter((r) => (r.day as string) >= today)
    .sort((a, b) => (a.day as string).localeCompare(b.day as string));
  const past = dated
    .filter((r) => (r.day as string) < today)
    .sort((a, b) => (b.day as string).localeCompare(a.day as string));
  unplaced.sort((a, b) => a.trip!.dueDate.localeCompare(b.trip!.dueDate));

  return { upcoming, unplaced, past };
}
