/* Design Studio — the Next chip's brain.

   One pure question: what is the first unmet requirement of this system,
   and what would arming it look like? The walk that motivated the chip: a
   real design sat for hours with the outdoor unit placed and the indoor
   unit still in the panel, because nothing ever NAMED the next move. The
   chip names it; this derives it.

   Split declares its ladder here. Other types return null until their
   modules land — a chip that guesses would be worse than no chip (the
   module registry is where each type will declare its own ladder, the same
   way it declares its panel and placement flow). */

import type { DataPack } from "./packs/schema";
import type { DesignDocument, DesignObject } from "./document";
import { roomsServedBy } from "./coverage";

/** what the place tool needs armed — mirrors canvas.tsx's PlacingUnit
    (not imported: this module stays free of React/canvas) */
export type NextPlacing = {
  role: "idu" | "odu";
  model: string;
  widthMm: number;
  depthMm: number;
};

export type NextMove =
  | { key: "draw-room"; label: string }
  | { key: "choose-pair"; label: string; roomId: string }
  | { key: "place-idu"; label: string; placing: NextPlacing }
  | { key: "place-odu"; label: string; placing: NextPlacing }
  | { key: "connect"; label: string }
  | { key: "complete"; label: string };

/** does this pipe-run attach to the given unit at either end?
    (same reading as the cockpit's recall logic) */
function runTouches(o: DesignObject, unitId: string): boolean {
  const attachId = (v: unknown): string =>
    v && typeof v === "object" ? String((v as { id?: unknown }).id ?? "") : "";
  return attachId(o.props.startAttach) === unitId || attachId(o.props.endAttach) === unitId;
}

export function nextMove(
  doc: DesignDocument,
  pack: DataPack | null,
  systemId: string | null
): NextMove | null {
  const sys = doc.systems.find((s) => s.id === systemId);
  if (!sys) return null;
  /* module-gated: only split has declared its ladder */
  if (sys.type !== "split") return null;

  const rooms = roomsServedBy(doc, systemId);
  if (rooms.length === 0) return { key: "draw-room", label: "Draw the first room" };

  const iduModel = String(sys.settings.pairIdu ?? "");
  const oduModel = String(sys.settings.pairOdu ?? "");
  /* the pair's room: the one it was chosen for, else the first served */
  const pairRoom =
    rooms.find((r) => r.id === String(sys.settings.roomId ?? "")) ?? rooms[0];
  const roomName = String(pairRoom.props.name ?? "the room");

  if (!iduModel || !oduModel)
    return { key: "choose-pair", label: `Choose a unit for ${roomName}`, roomId: pairRoom.id };

  const units = doc.objects.filter((o) => o.systemId === systemId && o.type === "unit");
  const idu = units.find((o) => o.props.role === "idu") ?? null;
  const odu = units.find((o) => o.props.role === "odu") ?? null;

  if (!idu) {
    const spec = pack?.indoor_units.find((u) => u.model === iduModel);
    /* pack still loading — say nothing rather than offer a dead button */
    if (!spec) return null;
    return {
      key: "place-idu",
      label: `Place the indoor unit in ${roomName}`,
      placing: { role: "idu", model: iduModel, widthMm: spec.width_mm, depthMm: spec.depth_mm },
    };
  }
  if (!odu) {
    const spec = pack?.outdoor_units.find((u) => u.model === oduModel);
    if (!spec) return null;
    return {
      key: "place-odu",
      label: "Place the outdoor unit",
      /* outdoor dims are optional in the pack schema — fall back to a common
         residential footprint so the ghost is never zero-sized */
      placing: { role: "odu", model: oduModel, widthMm: spec.width_mm ?? 800, depthMm: spec.depth_mm ?? 300 },
    };
  }

  const connected = doc.objects.some(
    (o) =>
      o.systemId === systemId &&
      o.type === "pipe-run" &&
      runTouches(o, idu.id) &&
      runTouches(o, odu.id)
  );
  if (!connected) return { key: "connect", label: "Connect the pair" };

  return { key: "complete", label: "System complete — review the summary" };
}
