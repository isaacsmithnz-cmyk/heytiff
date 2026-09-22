/* Design Studio — allocations: every unit a system HAS, placed or not.

   The system builder decides which units a system has and which room each one
   serves. Those decisions live here, on the system, as allocations. Putting a
   unit on the plan creates a canvas object that REUSES the allocation's id, so:

   - a unit exists from the moment it's allocated; placing only gives it a
     position (an allocation with no object of its id is in the tray)
   - the room a unit serves is the allocation's, never where it was dropped
   - a swap changes the model on the same id, so attached runs stay attached
   - deleting the object on the plan sends the unit back to the tray

   Pure data reads only — no engines, so coverage.ts and multi.ts can import it
   without a cycle. A system that has never been through the builder has no
   `allocations` key, and every reader keeps its old path for it. */

import type { DesignSystem } from "./document";

export type AllocationRole = "idu" | "odu";

export interface Allocation {
  /** also the id of the unit's canvas object once it is placed */
  id: string;
  role: AllocationRole;
  /** "" only for a multi's outdoor while no outdoor lists the set */
  model: string;
  /** the room an indoor unit serves; always null for an outdoor, and null for
      an indoor unit that serves the WHOLE system (see `serves`) */
  roomId: string | null;
  /** what an indoor unit serves: one zone (the default, with `roomId` set) or
      the whole system — a ducted air handler, dropped above the zones, with
      the air branched to every zone the system claims */
  serves?: "zone" | "system";
}

/** has this system been through the builder? */
export function hasAllocations(sys: DesignSystem): boolean {
  return Array.isArray(sys.settings.allocations);
}

/** the system's allocations, tolerating any stored shape */
export function allocationsOf(sys: DesignSystem): Allocation[] {
  const v = sys.settings.allocations;
  if (!Array.isArray(v)) return [];
  const out: Allocation[] = [];
  for (const raw of v) {
    if (!raw || typeof raw !== "object") continue;
    const a = raw as Record<string, unknown>;
    if (typeof a.id !== "string" || !a.id) continue;
    if (a.role !== "idu" && a.role !== "odu") continue;
    const serves = a.role === "idu" && a.serves === "system" ? "system" : "zone";
    out.push({
      id: a.id,
      role: a.role,
      model: typeof a.model === "string" ? a.model : "",
      roomId:
        a.role === "idu" && serves === "zone" && typeof a.roomId === "string" && a.roomId
          ? a.roomId
          : null,
      ...(a.role === "idu" ? { serves } : {}),
    });
  }
  return out;
}
