import { naiveInZone } from "./job-story";

/* CHECK-INS PRESSED ON THE JOB CARD, read as ServiceM8 sessions.

   HeyTiff's own check-in is turned into the shape of a ServiceM8 recorded
   session (account-local "YYYY-MM-DD HH:MM" strings and a staff id), so the
   card's one loop counts both: the same day grouping, and the same left-open
   rule — a stint that crosses midnight or runs past a working day puts its
   person on site with no hours.

   ON A DAY A PERSON CHECKED IN WITH HEYTIFF, THEIR SERVICEM8 SESSIONS ON
   THAT JOB THAT DAY ARE LEFT OUT (Isaac, 2026-10-02: ServiceM8's hours "do
   miss most things"; the button is the record now). The person is the
   ServiceM8 staff member they are linked to, or the one with the same full
   name; someone with neither appears under their own name.

   Still open and within the day, a stint runs to now, and says so. Pure. */

export type CheckInRow = { id: string; userId: string; inAt: string; outAt: string | null };

/** Who a HeyTiff user is on the card: their name, and the ServiceM8 staff
    member they are, when that is known. */
export type CheckInPerson = { name: string; sm8StaffUuid: string | null };

export type OurSession = {
  uuid: string;
  /** the ServiceM8 staff uuid, or `hey:<user id>` for someone not in it */
  staffId: string;
  start: string;
  end: string;
  /** still checked in, and counted to now */
  live: boolean;
};

export const heyStaffId = (userId: string) => `hey:${userId}`;

export function ourSessions(
  rows: CheckInRow[],
  people: Map<string, CheckInPerson>,
  timezone: string | null,
  now: Date
): OurSession[] {
  const out: OurSession[] = [];
  for (const r of rows) {
    const start = naiveInZone(r.inAt, timezone);
    const end = naiveInZone(r.outAt ?? now.toISOString(), timezone);
    if (!start || !end) continue;
    const who = people.get(r.userId);
    out.push({ uuid: `hey:${r.id}`, staffId: who?.sm8StaffUuid ?? heyStaffId(r.userId), start, end, live: r.outAt === null });
  }
  return out;
}

/** The person-days HeyTiff has, as "day|staff id": ServiceM8's sessions for
    these are left out. */
export function overriddenDays(sessions: OurSession[]): Set<string> {
  return new Set(sessions.map((s) => `${s.start.slice(0, 10)}|${s.staffId}`));
}

/** A name as two people would agree on it: case, spacing and stray dots aside. */
export const sameName = (a: string, b: string) => {
  const k = (s: string) => s.toLowerCase().replace(/[.]/g, "").replace(/\s+/g, " ").trim();
  return k(a) !== "" && k(a) === k(b);
};
