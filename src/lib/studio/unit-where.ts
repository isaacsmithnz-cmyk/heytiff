/* WHERE AN INDOOR UNIT SITS (the next flow; Isaac, 29 October 2026: a unit can
   sit under the floor it serves: 7 Cutler's PEA, with no lower-ground plan to
   put it on). It is the unit's plane: drawn dashed on the floor it serves,
   said in its callout, low in 3D, with an access hatch on the job. */

import type { DesignObject, Plane } from "./document";
import { hasDuctAirway } from "./form-factors";

export type UnitWhere = "ceiling" | "room" | "under-floor";

export const UNIT_WHERE: readonly [UnitWhere, string][] = [
  ["ceiling", "Ceiling"],
  ["room", "Room"],
  ["under-floor", "Under floor"],
];

const PLANES = { ceiling: "ceiling-cavity", room: "room", "under-floor": "floor-cavity" } satisfies Record<UnitWhere, Plane>;

export const planeOfWhere = (w: UnitWhere): Plane => PLANES[w];

export const isUnderFloor = (o: DesignObject): boolean => o.type === "unit" && o.plane === "floor-cavity";

/** said by the plane, or by the kind of unit where nobody has said */
export function unitWhere(o: DesignObject, form: string | null | undefined): UnitWhere {
  if (o.plane === "floor-cavity") return "under-floor";
  if (o.plane === "ceiling-cavity") return "ceiling";
  return hasDuctAirway(form) ? "ceiling" : "room";
}

/* what a unit needs round it to be hung under a floor, as Mitsubishi's hanger
   drawings leave it */
export const HANGERS_MM = 70;

/** the words for the space there against the space it needs */
export function underFloorFit(unitHeightMm: number, spaceMm: number): { needMm: number; fits: boolean } {
  const needMm = unitHeightMm + HANGERS_MM;
  return { needMm, fits: spaceMm >= needMm };
}
