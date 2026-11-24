/* How far a hospital is, in words, for the screens: a straight line, so a whole km, and never "0 km". Kept apart
   from ./nearest so a screen that only says it doesn't carry the list. */
export function kmWords(km: number | null | undefined): string | null {
  if (km == null || !Number.isFinite(km)) return null;
  return km < 1 ? "under 1 km" : `${Math.round(km)} km`;
}
