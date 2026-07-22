/* Design Studio — how a unit's capacity sits against a room load.

   Capacity never REMOVES a unit from a picker; it ranks it, and the picker
   leads with what suits. This is the one place that rule lives, so the split
   selector (select.ts) and the multi picker (multi.ts) can't drift apart —
   and it holds no imports of its own, so neither of them gains an edge to
   the other by using it. */

/** Where a capacity sits against the load:
    - `fits` — covers the load, within the oversize cap
    - `oversized` — covers the load, but past the cap
    - `undersized` — doesn't cover the load at all
    With no load to measure against, everything reads `fits`. */
export type UnitFit = "fits" | "oversized" | "undersized";

/** Presentation order — the section order every picker renders in. */
export const FIT_RANK: Record<UnitFit, number> = {
  fits: 0,
  oversized: 1,
  undersized: 2,
};

/** Rank one capacity against a load. `cap` is the oversize multiple past
    which covering the load stops counting as suiting it (1.5 either side of
    the split/multi split — they're separate constants on purpose). */
export function capacityFit(
  capacityKw: number,
  loadKw: number | null,
  cap: number
): UnitFit {
  if (loadKw == null) return "fits";
  if (capacityKw < loadKw) return "undersized";
  return capacityKw <= loadKw * cap ? "fits" : "oversized";
}
