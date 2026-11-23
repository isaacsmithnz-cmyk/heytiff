import type { ReadLevel, ReadRoofPart, RoofHeights, RoofReading, RoofShape } from "./reading";
import { levelOfName, printedCeiling, type PrintedLevels } from "./printed-levels";

/* THE ROOF'S SLICES PUT TOGETHER (reading-server readRoofSlices): its shape
   off the roof plans, its heights off the sections and elevations, and the
   levels the set prints off its words. A floor's printed FFL and FCL are the
   architect's own figures and stand over what a picture read took for its
   ceiling. A roof part whose eave the roof plans don't write sits on its
   floor's ceiling, as a roof face does (vector/roof-place.ts); one whose
   pitch they don't write takes the sections' pitch only where the set
   writes one pitch alone. Else it is left out, as before. Pure. */

/** Each floor the roof is read over: its id, and the name it is read by. */
export type RoofFloor = { floorId: string; name: string };

export function joinRoof(shape: RoofShape | null, heights: RoofHeights | null, printed: PrintedLevels | null, floors: readonly RoofFloor[]): RoofReading {
  const levels: ReadLevel[] = [...(heights?.levels ?? [])];
  const stood: NonNullable<RoofReading["printed"]>["floors"] = [];
  /* two floors named for one level (a house's ground floor and its garage's) can't tell whose the printed levels are: neither takes them */
  const named = floors.map((f) => levelOfName(f.name));
  for (const [k, f] of floors.entries()) {
    const level = named[k];
    if (!printed || level == null || named.filter((l) => l === level).length > 1) continue;
    const at = printed.floors.find((p) => p.level === level);
    if (at) stood.push({ floorId: f.floorId, ...(at.ffl !== undefined ? { ffl: at.ffl } : {}), ...(at.fcl !== undefined ? { fcl: at.fcl } : {}) });
    const c = printedCeiling(printed, level);
    if (!c) continue;
    const i = levels.findIndex((l) => l.floorId === f.floorId);
    const mine: ReadLevel = { floorId: f.floorId, ceilingMm: c.ceilingMm, floorZoneMm: c.floorZoneMm || (i >= 0 ? levels[i].floorZoneMm : 0), source: c.source };
    if (i >= 0) levels[i] = mine;
    else levels.push(mine);
  }
  const ceiling = (floorId: string) => levels.find((l) => l.floorId === floorId)?.ceilingMm ?? 0;
  const onePitch = heights && heights.pitches.length === 1 ? heights.pitches[0] : 0;
  const parts = (shape?.parts ?? []).flatMap((p): ReadRoofPart[] => {
    const eave = p.eaveMm > 0 ? p.eaveMm : ceiling(p.floorId);
    const pitch = p.pitchDeg > 0 || p.form === "flat" ? p.pitchDeg : onePitch;
    if (eave <= 0 || pitch > 60 || (p.form === "flat" ? pitch < 0 : pitch <= 0)) return [];
    const said = [p.eaveMm > 0 ? "" : "its eave at its floor's ceiling", p.pitchDeg > 0 || p.form === "flat" ? "" : `the set's one pitch, ${pitch}°`].filter(Boolean).join("; ");
    return [{ ...p, eaveMm: eave, pitchDeg: pitch, source: said ? `${p.source}${p.source ? "; " : ""}${said}` : p.source }];
  });
  return {
    levels,
    parts,
    raked: heights?.raked ?? [],
    material: shape?.material ?? "",
    roofSpace: heights?.roofSpace ?? "",
    ...(heights?.subfloor ? { subfloor: heights.subfloor } : {}),
    ...(printed && (stood.length || printed.ridges.length) ? { printed: { floors: stood, ridges: printed.ridges } } : {}),
  };
}
