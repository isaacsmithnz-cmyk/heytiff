/* Display formatting for HQ (pure, timezone-pinned so it's deterministic on
   the server and in tests). Numbers/dates only — no business logic.

   Pinned to the same AU anchor as lib/au-dates: HQ's change log groups edits
   by day, and that day has to be the day every customer-facing screen would
   call it. It was Pacific/Auckland for a while — 2-3h ahead — which filed a
   late-evening AU edit under tomorrow. */

const HQ_TZ = "Australia/Sydney";

const dateFmt = new Intl.DateTimeFormat("en-AU", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: HQ_TZ,
});

const dateTimeFmt = new Intl.DateTimeFormat("en-AU", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: HQ_TZ,
});

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : dateFmt.format(d);
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : dateTimeFmt.format(d);
}

/** "today" / "6 days" / "3 months" / "1 yr 2 mo" — tenure since a date. */
export function formatTenure(fromIso: string | null | undefined, now: Date = new Date()): string {
  if (!fromIso) return "—";
  const ms = now.getTime() - new Date(fromIso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "—";
  const days = Math.floor(ms / 86_400_000);
  if (days < 1) return "today";
  if (days < 31) return days === 1 ? "1 day" : `${days} days`;
  const months = Math.floor(days / 30.44);
  if (months < 12) return months === 1 ? "1 month" : `${months} months`;
  const years = Math.floor(months / 12);
  const rem = months % 12;
  if (rem) return `${years} yr ${rem} mo`;
  return years === 1 ? "1 year" : `${years} years`;
}
