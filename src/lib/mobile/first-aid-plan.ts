/* WHICH JOB IS TODAY'S, for First aid's "On today's job" card (lib/mobile/first-aid). Pure: the
   bookings are ServiceM8's wall-clock stamps in the account's zone ("2026-11-24 09:00:00"), and so
   is now, so they compare as strings. */

export type Booking = { jobUuid: string; start: string; end: string | null };

/** The booking you're on now; else the next one today; else the last one today, as you may still
    be on site after it was meant to end. The latest-started wins when two overlap. */
export function todaysBooking(bookings: readonly Booking[], now: string): Booking | null {
  const day = now.slice(0, 10);
  const today = bookings.filter((b) => b.start.slice(0, 10) === day).sort((a, b) => a.start.localeCompare(b.start));
  const on = today.filter((b) => b.start <= now && (b.end === null || b.end >= now));
  if (on.length) return on[on.length - 1];
  const next = today.find((b) => b.start > now);
  if (next) return next;
  return today.length ? today[today.length - 1] : null;
}

/** Who to call and where to go, for the card. Nothing that isn't written down or on the list. */
export type FirstAidJob = {
  jobUuid: string;
  number: string | null;
  /** The street and suburb, to name the job. */
  where: string;
  /** The SWMS it was read from, or null: no SWMS on the job yet. */
  swmsVersionId: string | null;
  /** `swms`: the one the SWMS names. `booked`: someone else booked on the job today with first aid on file. */
  firstAider: { name: string; phone: string | null; from: "swms" | "booked" } | null;
  /** `swms`: the one the SWMS names, with where it is when it's on the list. `nearest`: the nearest emergency
      department on the list to the job's pin. `km` is in a straight line; `near` the site's suburb, for the maps
      when there's no pin for the hospital. */
  hospital: { name: string; km: number | null; lat: number | null; lng: number | null; near: string | null; from: "swms" | "nearest" } | null;
  extinguisher: string | null;
};

export type FirstAidAnswer = { job: FirstAidJob | null };

/** Of the people booked on the job today with a first aid ticket, the one to name: never you (you know), and by name
    so it's the same each time. */
export function bookedFirstAider<T extends { staffProfileId: string; name: string }>(people: readonly T[], viewer: string | null): T | null {
  return [...people].filter((p) => p.staffProfileId !== viewer).sort((a, b) => a.name.localeCompare(b.name))[0] ?? null;
}

/** The SWMS's first aider, as its paper prints them; "Not named" and blanks are nobody. */
export function namedOrNull(s: unknown): string | null {
  const t = typeof s === "string" ? s.trim() : "";
  return t && t !== "—" && t !== "Not named" ? t : null;
}

/** A phone number a phone can call: digits and a leading +, or nothing. */
export function callable(phone: string | null | undefined): string | null {
  const raw = (phone ?? "").trim();
  const digits = raw.replace(/[^\d+]/g, "").replace(/(?!^)\+/g, "");
  return digits.replace(/\D/g, "").length >= 6 ? digits : null;
}
