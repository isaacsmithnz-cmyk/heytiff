/* Display formatting for HQ (pure, timezone-pinned to NZ so it's deterministic
   on the server and in tests). Numbers/dates only — no business logic. */

const dateFmt = new Intl.DateTimeFormat("en-NZ", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "Pacific/Auckland",
});

const dateTimeFmt = new Intl.DateTimeFormat("en-NZ", {
  day: "numeric",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: "Pacific/Auckland",
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
