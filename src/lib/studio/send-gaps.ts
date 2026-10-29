/* Design Studio — what the plan still lacks before the sheet goes out
   (walk of 29 October 2026). Nothing is drawn off a unit any more: ducts are
   drawn and grilles placed by hand. So a ducted system can read "covered"
   with nothing reaching a room, and a unit can be chosen and never put on
   the plan. The Summary's "to check before you send this" names both. */

import type { DesignDocument, DesignObject, Point } from "./document";
import type { DataPack } from "./packs/schema";
import type { SummaryModel } from "./summary";
import { trayItems } from "./builder";
import { grilleStream, isGrille } from "./grilles";
import { pointInPolygon } from "./geometry";

type Polygon = DesignObject & { geometry: { kind: "polygon"; points: Point[] } };

/** the rooms a ducted system serves that have no supply grille in them */
export function roomsWithoutSupply(doc: DesignDocument, model: SummaryModel): { system: string; room: string }[] {
  const supplies = doc.objects.filter(
    (o) => isGrille(o) && grilleStream(o) === "supply" && o.geometry.kind === "point"
  );
  const out: { system: string; room: string }[] = [];
  for (const s of model.systems) {
    if (s.type !== "ducted") continue;
    for (const r of s.rooms) {
      const room = doc.objects.find((o): o is Polygon => o.id === r.roomId && o.geometry.kind === "polygon");
      if (!room) continue;
      const fed = supplies.some(
        (g) => g.floorId === room.floorId && g.geometry.kind === "point" && pointInPolygon(g.geometry.at, room.geometry.points)
      );
      if (!fed) out.push({ system: s.name, room: r.name });
    }
  }
  return out;
}

/** units chosen for a system and not yet on the plan */
export function unitsNotPlaced(doc: DesignDocument, pack: DataPack | null): string[] {
  return pack ? trayItems(doc, pack).map((t) => t.model) : [];
}
