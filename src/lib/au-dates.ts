/* dd/mm/yyyy <-> ISO — the bridge between the design's text date inputs and
   real `date` columns. Shared by the staff card and the organisation profile;
   lib/staff/profile.ts re-exports these so its existing importers are
   untouched. */

/** A real calendar date? Rejects 31 Feb rather than letting Date roll it on. */
function realDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1) return false;
  return day <= new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/* Form date -> ISO yyyy-mm-dd.

   Two shapes go in, because two kinds of client send dates:

   - yyyy-mm-dd, which is what a native <input type="date"> speaks. Every date
     the staff card edits is a calendar picker now, so this is the normal path
     and it is a validation-and-pass-through rather than a conversion.
   - dd/mm/yyyy (any separator), the format the design's text inputs used and
     the way an Australian writes a date. Still accepted: the organisation
     screen still types them, and a direct POST from an older client must not
     start failing because the UI moved on.

   Both are checked against the real calendar, so "2026-02-31" is refused from
   a picker exactly as "31/02/2026" is from a keyboard. */
export function parseAuDate(input: string): string | null {
  const s = input.trim();
  if (!s) return null;

  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) {
    const [, y, m, d] = iso;
    return realDate(Number(y), Number(m), Number(d)) ? s : null;
  }

  const m = s.match(/^(\d{1,2})\s*[/\-. ]\s*(\d{1,2})\s*[/\-. ]\s*(\d{4})$/);
  if (!m) return null;
  const day = Number(m[1]);
  const month = Number(m[2]);
  const year = Number(m[3]);
  if (!realDate(year, month, day)) return null;
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

/* Whole days from one calendar date to another (negative = already past).

   This lives here, next to `todayInAu`, because the two are a pair: the answer
   is only right if `todayISO` came from the AU anchor above. It used to sit in
   components/fleet/logic.ts, where half the app imported a fleet module purely
   to count days to a licence expiry; fleet re-exports it for its own callers.

   Both arguments are ISO yyyy-mm-dd and both are pinned to midnight UTC, so the
   subtraction is between two calendar days with no zone in it — the rounding is
   belt-and-braces against a leap second, not doing real work. */
export function daysUntil(dateISO: string, todayISO: string): number {
  const d = new Date(`${dateISO}T00:00:00Z`).getTime();
  const t = new Date(`${todayISO}T00:00:00Z`).getTime();
  return Math.round((d - t) / 86400000);
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

/* A stored date as an <input type="date"> value.

   The column is a `date`, but a driver may hand it back as a full timestamp,
   and the native input refuses anything that isn't exactly yyyy-mm-dd — it
   silently renders empty rather than complaining, which looks like data loss.
   So the value is trimmed to the calendar day and checked before it goes in. */
export function dateInputValue(iso: string | null | undefined): string {
  const day = String(iso ?? "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : "";
}

/** ISO yyyy-mm-dd -> dd/mm/yyyy, for READING a date back. */
export function formatAuDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const m = String(iso).slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return "";
  return `${m[3]}/${m[2]}/${m[1]}`;
}
