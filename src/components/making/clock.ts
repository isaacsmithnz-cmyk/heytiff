import { parseClock } from "@/components/timepay/logic";

/* A FORM'S CLOCK TIME, both ways. The wheel (parts/time-field) speaks "7:05
   AM"; the actions under the event and notice forms take "HH:MM", as the
   native time input they replace sent it. Converted here, at the field, and
   never snapped: a time stored as 6:47 shows as 6:47 and goes back as it
   came unless the wheel is moved. */

const pad = (n: number) => String(n).padStart(2, "0");

/** "06:45" → "6:45 AM"; null for nothing or a time it can't read. */
export function wheelOf(hhmm: string | null | undefined): string | null {
  const mins = parseClock(hhmm ?? "");
  if (mins == null) return null;
  const h = Math.floor(mins / 60);
  return `${((h + 11) % 12) + 1}:${pad(mins % 60)} ${h < 12 ? "AM" : "PM"}`;
}

/** "6:45 AM" → "06:45"; "" for a time it can't read. */
export function hhmmOf(wheel: string | null | undefined): string {
  const mins = parseClock(wheel ?? "");
  return mins == null ? "" : `${pad(Math.floor(mins / 60))}:${pad(mins % 60)}`;
}
