/* THE AIR VIEW (the next flow; board "Air view" of the Studio rework mocks):
   for a system that sends air down ducts, what each room needs against the
   grilles actually on its plan. The air is airflow.ts's own share of the
   unit; the speeds are that air over the faces drawn, against the same
   velocity rule. A combined grille counts its supply side as supply and the
   rest as return. Grille throw isn't here: the packs hold no grille tables,
   so any figure would be made up. Pure, no React. */

import type { DesignDocument, DesignObject, DesignSystem, Point } from "./document";
import type { DataPack } from "./packs/schema";
import { RETURN_FACE_MS, SUPPLY_MS, systemAir } from "./airflow";
import { pointInPolygon } from "./geometry";
import { grilleMount, grilleSize, grilleSplit, grilleStream, grilleStyle, isGrille, type Grille, type GrilleMount } from "./grilles";

export type AirVerdict = "good" | "fast" | "none";

export interface AirRoomRow {
  roomId: string;
  name: string;
  ls: number;
  grilles: Grille[];
  /** m/s over the supply faces, or null with none */
  supplyMs: number | null;
  /** m/s over the return faces in the room, when the room's air returns through them */
  returnMs: number | null;
  verdict: AirVerdict;
  /** how the grilles read: "1 kicker grille" */
  grilleWords: string;
}

const SIDE_MM = 300;

/** a point's room on a floor: inside it, else the nearest within 300 mm, since
    a joinery or a wall grille sits on the room's edge (with no scale to
    measure by, inside it only). The one test: the Air screen, the sheet and the
    check before sending all ask here */
export function roomOfPoint(doc: DesignDocument, floorId: string, at: Point, mmPerUnit: number | null | undefined): DesignObject | null {
  const rooms = doc.objects.filter((o) => o.type === "room" && o.floorId === floorId && o.geometry.kind === "polygon");
  const pts = (o: DesignObject) => (o.geometry as { points: Point[] }).points;
  const inside = rooms.find((r) => pointInPolygon(at, pts(r)));
  if (inside || !mmPerUnit) return inside ?? null;
  const reach = SIDE_MM / mmPerUnit;
  let best: { room: DesignObject; d: number } | null = null;
  for (const r of rooms) {
    const p = pts(r);
    for (let i = 0; i < p.length; i++) {
      const a = p[i];
      const b = p[(i + 1) % p.length];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const t = Math.max(0, Math.min(1, ((at.x - a.x) * dx + (at.y - a.y) * dy) / Math.max(dx * dx + dy * dy, 1e-9)));
      const d = Math.hypot(at.x - (a.x + t * dx), at.y - (a.y + t * dy));
      if (d <= reach && (!best || d < best.d)) best = { room: r, d };
    }
  }
  return best?.room ?? null;
}

/** a face's open area, m² */
const faceM2 = (wMm: number, hMm: number, round: boolean) =>
  round ? (Math.PI * wMm * wMm) / 4 / 1e6 : (wMm * hMm) / 1e6;

const MOUNT_WORD: Record<GrilleMount, string> = { ceiling: "ceiling", wall: "wall", floor: "floor", kicker: "kicker" };

function grilleWords(gs: Grille[]): string {
  if (!gs.length) return "No grille";
  const mounts = [...new Set(gs.map((g) => grilleMount(g)).filter((m): m is GrilleMount => !!m))];
  const where = mounts.length === 1 ? `${MOUNT_WORD[mounts[0]]} ` : "";
  return `${gs.length} ${where}${gs.length === 1 ? "grille" : "grilles"}`;
}

/** every room a system sends air to, against what's on the plan */
export function airRows(doc: DesignDocument, pack: DataPack, sys: DesignSystem): AirRoomRow[] {
  const floorOf = (id: string) => doc.floors.find((f) => f.id === id);
  const mine = doc.objects.filter((o): o is Grille => isGrille(o) && o.systemId === sys.id);
  return systemAir(doc, pack, sys).flatMap((u) =>
    u.rooms.map((r): AirRoomRow => {
      const room = doc.objects.find((o) => o.id === r.roomId);
      const grilles = room
        ? mine.filter((g) => g.floorId === room.floorId && roomOfPoint(doc, g.floorId, g.geometry.at, floorOf(g.floorId)?.scaleMmPerUnit)?.id === room.id)
        : [];
      let supply = 0;
      let ret = 0;
      for (const g of grilles) {
        const s = grilleSize(g);
        const split = grilleSplit(g);
        if (split) {
          supply += faceM2(split.supplyMm, s.hMm, false);
          ret += faceM2(split.returnMm, s.hMm, false);
        } else if (grilleStream(g) === "return") ret += faceM2(s.wMm, s.hMm, false);
        else supply += faceM2(s.wMm, s.hMm, grilleStyle(g) === "round");
      }
      const ls = r.ls;
      const supplyMs = supply > 0 ? ls / 1000 / supply : null;
      const returnMs = ret > 0 ? ls / 1000 / ret : null;
      const verdict: AirVerdict =
        supplyMs == null ? "none" : supplyMs > SUPPLY_MS || (returnMs != null && returnMs > RETURN_FACE_MS) ? "fast" : "good";
      return { roomId: r.roomId, name: r.name, ls, grilles, supplyMs, returnMs, verdict, grilleWords: grilleWords(grilles) };
    })
  );
}

/** the words for a row's speeds */
export function speedWords(row: AirRoomRow): string {
  return [
    row.supplyMs != null ? `Supply ${row.supplyMs.toFixed(1)} m/s` : "",
    row.returnMs != null ? `return ${row.returnMs.toFixed(1)} m/s` : "",
  ]
    .filter(Boolean)
    .join(", ");
}

/** the air over the plan: one tag at each room's first grille */
export function airTags(rows: AirRoomRow[], floorId: string, show: "air" | "speed"): { id: string; at: Point; text: string; fast: boolean }[] {
  return rows.flatMap((r) => {
    const g = r.grilles.find((x) => x.floorId === floorId);
    if (!g) return [];
    return [
      {
        id: r.roomId,
        at: g.geometry.at,
        text: show === "air" ? `${Math.round(r.ls)} L/s` : speedWords(r),
        fast: r.verdict === "fast",
      },
    ];
  });
}
