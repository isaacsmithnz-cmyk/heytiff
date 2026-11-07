/* Design Studio — what a system's air side puts on the job: the ducts,
   plenums and grilles the person DREW for it, named the way the price
   book's common install items name them (quotes/install-groups.ts:
   "Flexible duct" a size each, "Supply plenum", "Return plenum", "Square
   diffuser", "Linear bar grille", "Return air grille"), so a line on the
   sheet, the picklist and what Tiff reads is a part a business already
   prices.

   Nothing here is laid out for the person (Isaac, 28 October 2026: "Drop
   the unit, then add pipe duct drain cables, whatever you want to put on
   … Do not attach things to it"): a duct is counted because it was drawn,
   a grille because it was placed. A duct on a plan with no scale is not
   measured, and says so rather than guessing. The zoning kit is the one
   part that is not drawn: it is what Edit system was told. Pure. */

import type { DesignDocument, DesignSystem, Point } from "./document";
import type { DataPack } from "./packs/schema";
import { isUnderFloor } from "./unit-where";
import { unitsToMeters } from "./geometry";
import { fittingName } from "./duct-fitting";
import { ductJunctions, runLengthUnits } from "./run-legs";
import { systemAir } from "./airflow";
import { roomOfPoint } from "./air-view";
import { attachOf, riserGapOf } from "./graph";
import { unitFaces } from "./unit-plenum";
import { grilleMount, grilleName, grilleSize, grilleSplit, grilleStream, grilleStyle, isGrille, type Grille, type GrilleMount } from "./grilles";
import { damperCableSub, zoneKit, zoningOf, zonesOf } from "./zoning";

export type DuctShelf = "ductwork" | "grilles" | "controls";

export interface DuctLine {
  shelf: DuctShelf;
  name: string;
  sub: string;
  /** "5.5 m", "3", or "—" for a duct not measured yet */
  qty: string;
}

/** a face the data book prints as a size, so a plenum is made for it */
const faceOf = (o: unknown): { w: number; h: number } | null => {
  if (!o || typeof o !== "object") return null;
  const f = o as { w_mm?: unknown; h_mm?: unknown };
  return typeof f.w_mm === "number" && typeof f.h_mm === "number" ? { w: f.w_mm, h: f.h_mm } : null;
};

const streamWord = (s: unknown): "Supply" | "Return" => (s === "return" ? "Return" : "Supply");

/** what one placed grille is on the sheet: the same words on its materials
    line and in the room it sits in, whatever kind of grille it is */
export function grilleLine(o: Grille): { key: string; name: string; sub: string; mount: GrilleMount | null } {
  const stream = grilleStream(o);
  const split = grilleSplit(o);
  const name = grilleName(stream, grilleSize(o), grilleStyle(o), split?.supplyMm ?? null);
  const mount = grilleMount(o);
  const sub = `${split ? "Supply and return, divider behind" : stream === "return" ? "Return" : "Supply outlet"}${mount ? `, ${mount}` : ""}`;
  return { key: `${name}/${mount ?? ""}`, name, sub, mount };
}

/** the room a grille is in: the one test, air-view.ts's */
export function grilleRoomId(doc: DesignDocument, o: Grille): string | null {
  return roomOfPoint(doc, o.floorId, o.geometry.at, doc.floors.find((f) => f.id === o.floorId)?.scaleMmPerUnit)?.id ?? null;
}

/** the rooms each of a system's grille lines goes in, by that line's name
    and qualifier: what the sheet's For column says beside ductLines' line */
export function grilleLineRooms(doc: DesignDocument, sys: DesignSystem): Map<string, string[]> {
  const nameOf = new Map(doc.objects.filter((o) => o.type === "room").map((o) => [o.id, String(o.props.name ?? "Room")]));
  const out = new Map<string, string[]>();
  for (const o of doc.objects) {
    if (o.systemId !== sys.id || !isGrille(o)) continue;
    const { name, sub } = grilleLine(o);
    const id = grilleRoomId(doc, o);
    const room = id ? nameOf.get(id) : null;
    const rooms = out.get(`${name}/${sub}`) ?? [];
    if (room && !rooms.includes(room)) rooms.push(room);
    out.set(`${name}/${sub}`, rooms);
  }
  return out;
}

/** the ductwork, plenums and grilles drawn for one system, and its zoning kit */
export function ductLines(doc: DesignDocument, pack: DataPack, sys: DesignSystem): DuctLine[] {
  const mine = doc.objects.filter((o) => o.systemId === sys.id);
  const scaleOf = new Map(doc.floors.map((f) => [f.id, f.scaleMmPerUnit ?? null]));

  /* ducts: by kind, size and stream, metres where the plan is scaled. A
     rigid one is drawn straight; a flex one is drawn as a curve and measured
     along it. One drawn before the two were offered is flex, as it always
     was, measured as drawn. */
  const ducts = new Map<string, { rigid: boolean; dia: number; stream: "Supply" | "Return"; m: number; unmeasured: boolean }>();
  for (const o of mine) {
    if (o.type !== "duct-run" || o.geometry.kind !== "polyline") continue;
    const dia = Number(o.props.diaMm) || 250;
    const stream = streamWord(o.props.stream);
    const rigid = o.props.form === "rigid";
    const key = `${rigid ? "rigid" : "flex"}/${stream}/${dia}`;
    const cur = ducts.get(key) ?? { rigid, dia, stream, m: 0, unmeasured: false };
    const mm = scaleOf.get(o.floorId) ?? null;
    const pts = o.geometry.points as Point[];
    if (mm) cur.m += unitsToMeters(runLengthUnits(o, pts), mm);
    else cur.unmeasured = true;
    /* a duct up a riser: the rise, counted once, on the run that leaves its foot */
    for (const a of [attachOf(o.props.startAttach), attachOf(o.props.endAttach)]) {
      if (a?.kind !== "riser") continue;
      const gap = riserGapOf(doc.objects, doc.floors, a.id);
      if (gap?.lowerId === a.id) cur.m += gap.manualM ?? gap.planM;
    }
    ducts.set(key, cur);
  }
  const ductLines: DuctLine[] = [...ducts.values()]
    .sort((a, b) => Number(b.rigid) - Number(a.rigid) || b.stream.localeCompare(a.stream) || b.dia - a.dia)
    .map((d) => ({
      shelf: "ductwork",
      name: `${d.rigid ? "Rigid" : "Flexible"} duct Ø${d.dia}`,
      sub: d.unmeasured ? `${d.stream}, set the plan's scale to measure` : `${d.stream}, as drawn`,
      /* up to the next 10 cm, past float noise: 6.30 m is 6.3, not 6.4 */
      qty: d.unmeasured && d.m === 0 ? "—" : `${Math.ceil(d.m * 10 - 1e-6) / 10} m`,
    }));

  /* plenums: one each as placed on its unit's face, made for that face */
  const plenumLines: DuctLine[] = [];
  for (const o of mine) {
    if (o.type !== "plenum") continue;
    const unit = doc.objects.find((u) => u.id === o.props.unitId);
    const model = unit ? String(unit.props.model ?? "") : "";
    const row = pack.indoor_units.find((u) => u.model === model);
    const stream = streamWord(o.props.stream);
    const face = faceOf(stream === "Return" ? row?.return_opening : row?.supply_opening);
    plenumLines.push({
      shelf: "ductwork",
      /* the size is in the NAME: the picklist sums a part by name, and
         plenums made for two faces are two parts */
      name: face ? `${stream} plenum ${face.w} × ${face.h}` : `${stream} plenum`,
      sub: model ? `Made for ${model}` : "",
      qty: "1",
    });
  }

  /* the plenums the ducts on a unit made, each with a spigot for each duct */
  const spigots = new Map<string, { dia: number; stream: string; n: number }>();
  for (const unit of mine) {
    if (unit.type !== "unit") continue;
    const model = String(unit.props.model ?? "");
    const row = pack.indoor_units.find((u) => u.model === model);
    for (const f of unitFaces(doc.objects, unit, row, scaleOf.get(unit.floorId))) {
      if (f.kind !== "plenum") continue;
      const stream = streamWord(f.end);
      const face = faceOf(f.end === "return" ? row?.return_opening : row?.supply_opening);
      plenumLines.push({
        shelf: "ductwork",
        name: face ? `${stream} plenum ${face.w} × ${face.h}` : `${stream} plenum`,
        sub: model ? `Made for ${model}` : "",
        qty: "1",
      });
      for (const sp of f.spigots) {
        const key = `${stream}/${sp.diaMm}`;
        spigots.set(key, { dia: sp.diaMm, stream, n: (spigots.get(key)?.n ?? 0) + 1 });
      }
    }
  }
  for (const sp of [...spigots.values()].sort((a, b) => b.stream.localeCompare(a.stream) || b.dia - a.dia)) {
    plenumLines.push({ shelf: "ductwork", name: `Spigot Ø${sp.dia}`, sub: `${sp.stream}, on the plenum`, qty: String(sp.n) });
  }

  /* grilles: by name, as placed, and by where they sit when somebody said */
  /* fittings: where ducts meet, by their sizes */
  const fittings = new Map<string, DuctLine>();
  for (const j of ductJunctions(mine.flatMap((o) => (o.geometry.kind === "polyline" ? [o] : [])))) {
    const name = fittingName(j);
    const key = `${name}/${j.stream}`;
    const n = Number(fittings.get(key)?.qty ?? 0) + 1;
    fittings.set(key, { shelf: "ductwork", name, sub: streamWord(j.stream), qty: String(n) });
  }
  plenumLines.push(...fittings.values());

  const grilles = new Map<string, { name: string; sub: string; n: number }>();
  for (const o of mine) {
    if (!isGrille(o)) continue;
    const { key, name, sub } = grilleLine(o);
    grilles.set(key, { name, sub, n: (grilles.get(key)?.n ?? 0) + 1 });
  }
  const grilleLines: DuctLine[] = [...grilles.values()]
    .sort((a, b) => a.name.localeCompare(b.name) || a.sub.localeCompare(b.sub))
    .map((g) => ({ shelf: "grilles", name: g.name, sub: g.sub, qty: String(g.n) }));

  /* zoning: the kit Edit system was told, a damper a zone */
  const controls: DuctLine[] = [];
  let dampers = 0;
  for (const air of systemAir(doc, pack, sys)) {
    const z = zoningOf(sys, air.unit.id);
    const zones = zonesOf(air, z);
    if (!zones.length) continue;
    dampers += zones.length;
    controls.push(...zoneKit(pack, z, zones).lines);
  }
  const damperLines: DuctLine[] = dampers
    ? [{ shelf: "ductwork", name: "Zone damper", sub: "Motorised, one on each zone's run", qty: String(dampers) }]
    : [];
  if (dampers) controls.push({ shelf: "controls", name: "Zone damper cable", sub: damperCableSub(pack), qty: String(dampers) });

  /* a unit under the floor: a hatch to get to it */
  const hatches = mine.filter(isUnderFloor).length;
  const hatchLines: DuctLine[] = hatches
    ? [{ shelf: "ductwork", name: "Floor access hatch 600 × 600", sub: "To the unit under the floor", qty: String(hatches) }]
    : [];

  return [...ductLines, ...damperLines, ...plenumLines, ...hatchLines, ...grilleLines, ...controls];
}
