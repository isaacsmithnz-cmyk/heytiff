import { fmtAuWeekdayDate, fmtAuWeekdayDayMonth } from "@/lib/au-dates";
import { fmtTime } from "@/lib/dashboard/events";
import type { Jurisdiction } from "./library";

/* THE SITE'S CLOCK, IN THE APP'S WORDS.

   A SWMS is read against its site — when it was issued, when each person
   signed on — and Queensland keeps no daylight saving while New South Wales
   does, so a moment is told in the site's own zone. Formatting in the
   runtime's zone wrote the server's UTC into the first paint and the phone's
   zone into hydration: two strings for one moment.

   And it is told the way the rest of the app tells it: "Wed 16 Sept" as the
   job card writes a day, "7:42am" as the calendar writes a time. The screens
   had a third way ("Wed, 16 Sept, 7:42 am") and paper a fourth. */

const ZONE: Record<Jurisdiction, string> = { NSW: "Australia/Sydney", QLD: "Australia/Brisbane" };

/** The calendar day and the 24-hour time a moment fell on at the site. */
function atSite(iso: string, j: Jurisdiction): { day: string; time: string } | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: ZONE[j],
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(d);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return { day: `${get("year")}-${get("month")}-${get("day")}`, time: `${get("hour")}:${get("minute")}` };
}

/** "Wed 16 Sept" — or "Wed 16 Sept 2026" on paper, which outlives the year. */
export function siteDay(iso: string, j: Jurisdiction, opts: { year?: boolean } = {}): string {
  const at = atSite(iso, j);
  if (!at) return "";
  return opts.year ? fmtAuWeekdayDate(at.day) : fmtAuWeekdayDayMonth(at.day);
}

/** "Wed 16 Sept, 7:42am" — or with the year, on paper. */
export function siteWhen(iso: string, j: Jurisdiction, opts: { year?: boolean } = {}): string {
  const at = atSite(iso, j);
  if (!at) return "";
  return `${siteDay(iso, j, opts)}, ${fmtTime(at.time) ?? at.time}`;
}
