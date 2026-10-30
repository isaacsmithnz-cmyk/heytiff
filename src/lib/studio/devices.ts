/* Design Studio — zone sensors and wall controllers placed on the plan (the
   next flow; board 11 of the Studio rework mocks: "sensors and controllers
   placed"). Zoning says what the kit is (zoning.ts, from Edit system); these
   say where each piece goes, so the installer reads it off the plan.

   A placed one is only a spot: the kit on the job is still a sensor a zone
   and a controller a system, however many are put down, so placing never
   adds a part. It belongs to the system it was placed for and prints with
   it. Pure geometry here, for the canvas and the paper alike. */

import type { DesignObject, Point } from "./document";
import { newId } from "./document";

export type DeviceKind = "zone-sensor" | "wall-controller";
export const DEVICE_KINDS: ReadonlySet<string> = new Set<DeviceKind>(["zone-sensor", "wall-controller"]);

/** its face on the wall, mm: a sensor's plate and a controller's */
export const DEVICE_MM: Record<DeviceKind, number> = { "zone-sensor": 90, "wall-controller": 120 };

export type Device = DesignObject & { type: DeviceKind; geometry: { kind: "point"; at: Point } };

export function isDevice(o: DesignObject): o is Device {
  return DEVICE_KINDS.has(o.type) && o.geometry.kind === "point";
}

export function device(floorId: string, systemId: string | null, at: Point, kind: DeviceKind): Device {
  return {
    id: newId("obj"),
    type: kind,
    systemId,
    floorId,
    plane: "room",
    geometry: { kind: "point", at },
    props: {},
  } as Device;
}

/** the plate's half-size in world units; never smaller than `minUnits`, so
    one stays findable on a plan with no scale */
export function deviceHalf(kind: DeviceKind, mmPerUnit: number | null, minUnits: number): number {
  return Math.max(mmPerUnit ? DEVICE_MM[kind] / 2 / mmPerUnit : 0, minUnits);
}

/** the letter on its plate: T for the temperature sensor, C for the controller */
export const deviceLetter = (kind: DeviceKind): string => (kind === "zone-sensor" ? "T" : "C");
