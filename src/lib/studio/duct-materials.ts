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
import { polylineLength, unitsToMeters } from "./geometry";
import { systemAir } from "./airflow";
import { grilleName, grilleSize, grilleStream, isGrille } from "./grilles";
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

/** the ductwork, plenums and grilles drawn for one system, and its zoning kit */
export function ductLines(doc: DesignDocument, pack: DataPack, sys: DesignSystem): DuctLine[] {
  const mine = doc.objects.filter((o) => o.systemId === sys.id);
  const scaleOf = new Map(doc.floors.map((f) => [f.id, f.scaleMmPerUnit ?? null]));

  /* ducts: by size and stream, metres where the plan is scaled */
  const ducts = new Map<string, { dia: number; stream: "Supply" | "Return"; m: number; unmeasured: boolean }>();
  for (const o of mine) {
    if (o.type !== "duct-run" || o.geometry.kind !== "polyline") continue;
    const dia = Number(o.props.diaMm) || 250;
    const stream = streamWord(o.props.stream);
    const key = `${stream}/${dia}`;
    const cur = ducts.get(key) ?? { dia, stream, m: 0, unmeasured: false };
    const mm = scaleOf.get(o.floorId) ?? null;
    if (mm) cur.m += unitsToMeters(polylineLength(o.geometry.points as Point[]), mm);
    else cur.unmeasured = true;
    ducts.set(key, cur);
  }
  const ductLines: DuctLine[] = [...ducts.values()]
    .sort((a, b) => b.stream.localeCompare(a.stream) || b.dia - a.dia)
    .map((d) => ({
      shelf: "ductwork",
      name: `Flexible duct Ø${d.dia}`,
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

  /* grilles: by name, as placed */
  const grilles = new Map<string, { sub: string; n: number }>();
  for (const o of mine) {
    if (!isGrille(o)) continue;
    const stream = grilleStream(o);
    const name = grilleName(stream, grilleSize(o));
    grilles.set(name, { sub: stream === "return" ? "Return" : "Supply outlet", n: (grilles.get(name)?.n ?? 0) + 1 });
  }
  const grilleLines: DuctLine[] = [...grilles]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, g]) => ({ shelf: "grilles", name, sub: g.sub, qty: String(g.n) }));

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

  return [...ductLines, ...damperLines, ...plenumLines, ...grilleLines, ...controls];
}
