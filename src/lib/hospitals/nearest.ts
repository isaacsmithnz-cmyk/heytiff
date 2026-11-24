import EDS from "./emergency-departments.json";

/* THE NEAREST EMERGENCY DEPARTMENT TO A JOB (Isaac, 24 November 2026: "should each job find the nearest hospital",
   then "Build it" to the boards on https://claude.ai/artifact/WN4fW9vkQhVW4ZGFQ1knq3).

   From a list kept here, public hospitals with an emergency department, built from AIHW's MyHospitals and
   Geoscience Australia's HealthDirect facilities (both CC BY; scripts/hospitals/build-emergency-departments.py
   says how and where from). Never a map search for "hospital": that finds private hospitals and day clinics with
   no emergency department, and being sent to one is worse than no answer. Distance is in a straight line from the
   job's pin, so it reads "6 km away", never a drive time. Worked out when it's asked for, so a job moved on the
   map has its own. */

export type EmergencyDepartment = { name: string; lat: number; lng: number; state: string | null };
export type NearbyEd = EmergencyDepartment & { km: number };

const LIST = EDS as EmergencyDepartment[];

/** Kilometres between two points on the earth, in a straight line. */
export function kmBetween(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const r = (d: number) => (d * Math.PI) / 180;
  const x = Math.sin(r(b.lat - a.lat) / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lng - a.lng) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(x)));
}

/** A job's pin, when it has one: ServiceM8 leaves 0,0 on a job it couldn't place. */
export function pinOf(lat: unknown, lng: unknown): { lat: number; lng: number } | null {
  const a = typeof lat === "string" ? Number(lat) : lat;
  const b = typeof lng === "string" ? Number(lng) : lng;
  if (typeof a !== "number" || typeof b !== "number" || !Number.isFinite(a) || !Number.isFinite(b)) return null;
  if (a === 0 && b === 0) return null;
  return Math.abs(a) <= 90 && Math.abs(b) <= 180 ? { lat: a, lng: b } : null;
}

const round1 = (km: number) => Math.round(km * 10) / 10;

/** The `count` nearest emergency departments to a pin, nearest first, each with its distance. */
export function nearestEmergency(pin: { lat: number; lng: number } | null, count = 3, list: readonly EmergencyDepartment[] = LIST): NearbyEd[] {
  if (!pin) return [];
  return list
    .map((ed) => ({ ...ed, km: round1(kmBetween(pin, ed)) }))
    .sort((a, b) => a.km - b.km || a.name.localeCompare(b.name))
    .slice(0, count);
}

const key = (name: string) =>
  name
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\[[^\]]*\]|\([^)]*\)/g, " ")
    .replace(/\b(the|hospital|public)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** A hospital somebody named, found on the list when it's the same one: the nearest of that name to the pin. */
export function edNamed(
  name: string | null | undefined,
  pin: { lat: number; lng: number } | null,
  list: readonly EmergencyDepartment[] = LIST
): (EmergencyDepartment & { km: number | null }) | null {
  const k = key(name ?? "");
  if (!k) return null;
  const same = list.filter((ed) => key(ed.name) === k);
  if (!same.length) return null;
  if (!pin) return same.length === 1 ? { ...same[0], km: null } : null;
  return same.map((ed) => ({ ...ed, km: round1(kmBetween(pin, ed)) })).sort((a, b) => a.km - b.km)[0];
}
