/* WHERE A PHONE IS, as it says it (the pure half of lib/mobile/where): a
   latitude and longitude in range, how sure it is in metres, and when, no
   more than half an hour old and not in the future beyond a phone's clock
   drift. Anything else is no fix at all. */

export type Fix = { lat: number; lng: number; accuracy: number | null; at: string };

const OLDEST_MS = 30 * 60_000;
const AHEAD_MS = 2 * 60_000;

export function readFix(body: unknown, now: number): Fix | null {
  if (!body || typeof body !== "object") return null;
  const b = body as { lat?: unknown; lng?: unknown; accuracy?: unknown; at?: unknown };
  const lat = typeof b.lat === "number" ? b.lat : NaN;
  const lng = typeof b.lng === "number" ? b.lng : NaN;
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180 || (lat === 0 && lng === 0)) return null;
  const accuracy = typeof b.accuracy === "number" && Number.isFinite(b.accuracy) && b.accuracy >= 0 ? Math.round(b.accuracy) : null;
  const t = typeof b.at === "string" ? Date.parse(b.at) : NaN;
  if (!Number.isFinite(t) || t < now - OLDEST_MS || t > now + AHEAD_MS) return null;
  return { lat, lng, accuracy, at: new Date(Math.min(t, now)).toISOString() };
}
