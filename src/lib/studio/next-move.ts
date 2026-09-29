/* Design Studio — the Next chip's brain.

   One pure question: what is the design's first unmet step, and what would
   taking it look like? The walk that motivated the chip: a real design sat
   for hours with the outdoor unit placed and the indoor unit still in the
   panel, because nothing ever NAMED the next move. The chip names it; this
   derives it. */

import type { DataPack } from "./packs/schema";
import type { DesignDocument } from "./document";
import { allocationsOf, hasAllocations } from "./builder";
import { installState } from "./install";
import { zoneIdsOf } from "./zones";

/* the zones flow's rungs: a zone to draw, a system to add, zones for it, one
   to build, one to answer for */
export type NextMove =
  | { key: "draw-room"; label: string }
  | { key: "add-system"; label: string }
  | { key: "add-zones"; label: string; systemId: string }
  | { key: "build-system"; label: string; systemId: string }
  | { key: "install"; label: string; systemId: string };

/** THE ZONES FLOW'S LADDER (with the builder): draw the zones, add a system,
    give it its zones, build it, place its units (from its card, so the chip
    has nothing to say while any wait), answer its install questions. Each
    rung is the words the system's card says for the same step, so the two
    agree: a system with no zone yet has no Build system on its card, only
    Add zones (Isaac, 2026-09-23). */
export function nextMoveZones(doc: DesignDocument, pack: DataPack | null): NextMove | null {
  const rooms = doc.objects.filter((o) => o.type === "room");
  if (rooms.length === 0) return { key: "draw-room", label: "Draw a zone" };
  if (doc.systems.length === 0) return { key: "add-system", label: "Add a system" };
  const zoneless = doc.systems.find((s) => zoneIdsOf(s).length === 0);
  if (zoneless) return { key: "add-zones", label: "Add zones", systemId: zoneless.id };
  const unbuilt = doc.systems.find((s) => !hasAllocations(s) || !allocationsOf(s).some((a) => a.model));
  if (unbuilt) return { key: "build-system", label: "Build system", systemId: unbuilt.id };
  if (pack) {
    const placed = new Set(doc.objects.map((o) => o.id));
    const waiting = doc.systems.find(
      (s) => hasAllocations(s) && allocationsOf(s).some((a) => a.model && !placed.has(a.id))
    );
    if (waiting) return null;
    const asking = doc.systems.find((s) => installState(doc, pack, s) !== "complete");
    if (asking) return { key: "install", label: "Install details", systemId: asking.id };
  }
  return null;
}
