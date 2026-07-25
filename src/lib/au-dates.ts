/* dd/mm/yyyy <-> ISO — the bridge between the design's text date inputs and
   real `date` columns. Shared by the staff card and the organisation profile;
   lib/staff/profile.ts re-exports these so its existing importers are
   untouched. */

/** dd/mm/yyyy (any separator, optional spaces) -> ISO yyyy-mm-dd. */
export function parseAuDate(input: string): string | null {
  const s = input.trim();
  if (!s) return null;
  const m = s.match(/^(\d{1,2})\s*[/\-. ]\s*(\d{1,2})\s*[/\-. ]\s*(\d{4})$/);
  if (!m) return null;
  const day = Number(m[1]);
  const month = Number(m[2]);
  const year = Number(m[3]);
  if (month < 1 || month > 12 || day < 1) return null;
  // reject 31 Feb etc. rather than letting Date roll it forward
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (day > daysInMonth) return null;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${year}-${pad(month)}-${pad(day)}`;
}

/* Every AU state is ahead of UTC, so "today" on a UTC server is yesterday in
   the yard for most of the working day. Anything that counts days to an expiry
   has to anchor on an AU calendar date or the chips read one day out. The
   eastern zone is the anchor: the states differ by at most 2h among
   themselves, which never moves the date during business hours. */
const AU_ANCHOR_TZ = "Australia/Sydney";

/** Today's calendar date in AU, as ISO yyyy-mm-dd. */
export function todayInAu(now: Date = new Date()): string {
  // en-CA formats as yyyy-mm-dd, which is exactly the ISO date we want
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: AU_ANCHOR_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/* The AU calendar day a TIMESTAMP fell on, as ISO yyyy-mm-dd.

   `todayInAu` answers "what day is it now"; this answers "what day was that",
   and the two have to be derived the same way or they can't be compared. A
   `done_at` of 22:00 UTC is 8am the NEXT morning in the yard, so deriving the
   day with toISOString() and comparing it against todayInAu() reads a task
   finished at breakfast as having been done yesterday — for the whole of the
   working morning, every day. */
export function auDayOf(when: string | Date): string {
  const d = when instanceof Date ? when : new Date(when);
  return Number.isNaN(d.getTime()) ? "" : todayInAu(d);
}

/** ISO yyyy-mm-dd -> dd/mm/yyyy for the design's text inputs. */
export function formatAuDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const m = String(iso).slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return "";
  return `${m[3]}/${m[2]}/${m[1]}`;
}
