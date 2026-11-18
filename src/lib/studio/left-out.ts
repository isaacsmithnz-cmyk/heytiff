/* LEFT OUT (Isaac, 17 November 2026: "no way to remove or hide rooms that
   you don't want on the design. Look at summary on that design. It has a
   heap of rooms on the summary that are not needed", then "Better" to
   https://claude.ai/artifact/NMdhC8ddJfPQKAZoGdsJLJ).

   A room nobody will air condition (a robe, the laundry, a fridge recess)
   is left out of the design, not deleted: it moves off `objects` onto
   `leftOut`, so the plan, the lists, the heat load and the summary never
   see it, and Put back moves it home as it was. Only a room no system has:
   one on a system comes off it first. */

import type { DesignDocument, DesignObject } from "./document";
import { systemsForZone } from "./zones";

/** The rooms left out, the newest last. */
export const leftOutRooms = (doc: DesignDocument): DesignObject[] => (doc.leftOut ?? []).filter((o) => o.type === "room");

/** Can this room be left out: a room, on the plan, on no system, with no unit in it. */
export function canLeaveOut(doc: DesignDocument, id: string): boolean {
  const o = doc.objects.find((x) => x.id === id);
  if (!o || o.type !== "room") return false;
  if (systemsForZone(doc, id).length > 0) return false;
  return !doc.objects.some((u) => u.type === "unit" && u.props.roomId === id);
}

/** These rooms off the design, kept to put back. Any that can't be (on a system, a unit in it) stay. */
export function leaveOut(doc: DesignDocument, ids: readonly string[]): DesignDocument {
  const going = new Set(ids.filter((id) => canLeaveOut(doc, id)));
  if (!going.size) return doc;
  return {
    ...doc,
    objects: doc.objects.filter((o) => !going.has(o.id)),
    leftOut: [...(doc.leftOut ?? []), ...doc.objects.filter((o) => going.has(o.id))],
  };
}

/** These rooms back on the design, as they were; a room whose floor has gone since stays out. */
export function putBack(doc: DesignDocument, ids: readonly string[]): DesignDocument {
  const floors = new Set(doc.floors.map((f) => f.id));
  const coming = (doc.leftOut ?? []).filter((o) => ids.includes(o.id) && floors.has(o.floorId));
  if (!coming.length) return doc;
  const back = new Set(coming.map((o) => o.id));
  const rest = (doc.leftOut ?? []).filter((o) => !back.has(o.id));
  return { ...doc, objects: [...doc.objects, ...coming], leftOut: rest };
}
