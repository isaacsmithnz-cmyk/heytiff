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

/* A short day-and-month label for an ISO DATE — "15 Jan", "15 July".

   Note the inconsistent width: en-AU's abbreviated months are three letters
   except June, July and Sept, which it writes out. That is correct Australian
   style, so it is left alone rather than forced to three letters with a foreign
   locale — but it does mean a chip holding one of those three months is wider,
   which is worth knowing before laying one out in a fixed space.

   The date is formatted in UTC deliberately: the input is a calendar date with
   no time, so it is pinned to midnight UTC and read back in the same zone. Any
   other zone would shift it a day. For a TIMESTAMP, resolve it with `auDayOf`
   first — see the note there. */
export function fmtAuDayMonth(iso: string | null | undefined): string {
  const day = String(iso ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return "";
  return new Intl.DateTimeFormat("en-AU", {
    timeZone: "UTC",
    day: "numeric",
    month: "short",
  }).format(new Date(`${day}T00:00:00Z`));
}

/* "Mon 25 Dec" — weekday + day + month for an ISO DATE. Same UTC pinning and
   en-AU month widths as fmtAuDayMonth (see the notes there). The comma en-AU
   puts after the weekday is dropped: chips and rows read cleaner without it. */
export function fmtAuWeekdayDayMonth(iso: string | null | undefined): string {
  const day = String(iso ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return "";
  return new Intl.DateTimeFormat("en-AU", {
    timeZone: "UTC",
    weekday: "short",
    day: "numeric",
    month: "short",
  })
    .format(new Date(`${day}T00:00:00Z`))
    .replace(",", "");
}

/** "Mon 25 Dec 2026" — fmtAuWeekdayDayMonth with the year, for lists that span years. */
export function fmtAuWeekdayDate(iso: string | null | undefined): string {
  const day = String(iso ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return "";
  return new Intl.DateTimeFormat("en-AU", {
    timeZone: "UTC",
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  })
    .format(new Date(`${day}T00:00:00Z`))
    .replace(",", "");
}

/** ISO yyyy-mm-dd -> dd/mm/yyyy for the design's text inputs. */
export function formatAuDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const m = String(iso).slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return "";
  return `${m[3]}/${m[2]}/${m[1]}`;
}
