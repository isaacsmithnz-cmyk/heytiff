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
import { lensRoom, roomsServedBy } from "./coverage";

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

/* ── the Units verb on the toolbar ──────────────────────────────────────
   One button, whose press means "work on the units": with nothing chosen it
   opens the browser on the lens room; with a pair chosen it arms whichever
   unit is still off the plan; with both placed it opens the browser again —
   the same press is now a swap. Module-gated exactly like the chip. */

export type UnitsVerb =
  /* pressable, but not yet — the reason is worn in place */
  | { kind: "off"; reason: string }
  /* open the unit browser ranked against (and attributing to) this room */
  | { kind: "browse"; roomId: string }
  /* arm the next unplaced unit on the cursor */
  | { kind: "arm"; placing: NextPlacing };

export function unitsVerb(
  doc: DesignDocument,
  pack: DataPack | null,
  systemId: string | null
): UnitsVerb | null {
  const sys = doc.systems.find((s) => s.id === systemId);
  if (!sys) return null;
  /* module-gated: only split's unit flow has moved to the bar */
  if (sys.type !== "split") return null;

  const rooms = roomsServedBy(doc, systemId);
  if (rooms.length === 0) return { kind: "off", reason: "draw a room first" };
  const lens = lensRoom(doc, systemId)!;

  const iduModel = String(sys.settings.pairIdu ?? "");
  const oduModel = String(sys.settings.pairOdu ?? "");
  if (!iduModel || !oduModel) return { kind: "browse", roomId: lens.id };

  const units = doc.objects.filter((o) => o.systemId === systemId && o.type === "unit");
  const idu = units.find((o) => o.props.role === "idu") ?? null;
  const odu = units.find((o) => o.props.role === "odu") ?? null;

  if (!idu) {
    const spec = pack?.indoor_units.find((u) => u.model === iduModel);
    if (!spec) return { kind: "off", reason: "catalogue still loading" };
    return {
      kind: "arm",
      placing: { role: "idu", model: iduModel, widthMm: spec.width_mm, depthMm: spec.depth_mm },
    };
  }
  if (!odu) {
    const spec = pack?.outdoor_units.find((u) => u.model === oduModel);
    if (!spec) return { kind: "off", reason: "catalogue still loading" };
    return {
      kind: "arm",
      placing: { role: "odu", model: oduModel, widthMm: spec.width_mm ?? 800, depthMm: spec.depth_mm ?? 300 },
    };
  }

  /* both on the plan — the press becomes a swap, ranked against the room the
     placed indoor unit actually serves (repair follows the unit, not the
     original choice) */
  const servedId = String(idu.props.roomId ?? "");
  return {
    kind: "browse",
    roomId: rooms.some((r) => r.id === servedId) ? servedId : lens.id,
  };
}

/* ── the cockpit's two sizes ────────────────────────────────────────────
   The panel only reports, so the FLOW picks its size: it rests as a 46px
   status tab through the canvas-heavy room phase, opens the moment a pair
   is chosen and units want placing, and rests again once everything is
   down. This is the pure half of that question — the editor composes it
   with the per-type pin and the selection (an inspector needs a panel). */

/** true when the flow would let the panel rest for this system */
export function panelRests(doc: DesignDocument, systemId: string | null): boolean {
  const sys = doc.systems.find((s) => s.id === systemId);
  /* no system: the type chooser IS the panel */
  if (!sys) return false;
  /* module-gated: only split's arming has fully moved to the bar; other
     types still work from the panel, so they never rest */
  if (sys.type !== "split") return false;
  const iduModel = String(sys.settings.pairIdu ?? "");
  const oduModel = String(sys.settings.pairOdu ?? "");
  /* room phase — the work is on the canvas, the roster ticks fit the tab */
  if (!iduModel || !oduModel) return true;
  const units = doc.objects.filter((o) => o.systemId === systemId && o.type === "unit");
  const idu = units.some((o) => o.props.role === "idu");
  const odu = units.some((o) => o.props.role === "odu");
  /* open while anything is unplaced; at rest again once both are down
     (the connect rung is the chip's story — the tab still reports fit) */
  return idu && odu;
}
