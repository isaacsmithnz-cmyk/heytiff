/* Design Studio — how a unit's capacity sits against a room load.

   Capacity never REMOVES a unit from a picker; it ranks it, and the picker
   leads with what suits. This is the one place that rule lives, so the split
   selector (select.ts) and the multi picker (multi.ts) can't drift apart —
   and it holds no imports of its own, so neither of them gains an edge to
   the other by using it. */

/* ── covered, judged as shown ──────────────────────────────────────────
   Every kW in the studio and on the sheet is shown to one decimal, so a load
   is short only by a shortfall that SHOWS — 0.1 kW or more. Judged on the raw
   numbers, a 4.53 kW load against a 4.5 kW unit read "4.5 kW" against
   "4.5 kW" and was called short: the zone said "0.0 kW short", the card
   "Living short, 99%" (Isaac, 2026-10-07). Five places each made that call
   their own way (a raw `<`, a rounded percent at 100), so the same room could
   be short on the card and covered on the sheet. This is the one test.

   The shortfall is measured in kW rather than as a share on purpose: what
   shows is a kW figure, and a zone's word and the figures beside it must
   agree. The percent stays the raw share — rooms on one ducted unit each hold
   a proportional slice of it and must read one percent — clamped only so it
   can never contradict the verdict: covered never reads under 100, short
   never reads 100. */

/** What a capacity is short of a load by, to the 0.1 kW it is shown at. */
export const shortKw = (loadKw: number, capacityKw: number): number =>
  Math.max(0, Math.round((loadKw - capacityKw) * 10) / 10);

/** Does this capacity cover this load — is it short by nothing that shows? */
export const coversLoad = (capacityKw: number, loadKw: number): boolean =>
  shortKw(loadKw, capacityKw) === 0;

/** Cover as a whole percent of load, agreeing with `coversLoad`. */
export function coverPct(capacityKw: number, loadKw: number): number | null {
  if (!(loadKw > 0)) return null;
  const pct = Math.round((capacityKw / loadKw) * 100);
  return coversLoad(capacityKw, loadKw) ? Math.max(pct, 100) : Math.min(pct, 99);
}

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
  if (!coversLoad(capacityKw, loadKw)) return "undersized";
  return capacityKw <= loadKw * cap ? "fits" : "oversized";
}
