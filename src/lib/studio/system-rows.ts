/* A SYSTEM, AS ITS SCREEN LISTS IT (the bar and panel mock, Isaac, "Yes,
   build it", 21 November 2026). The outdoor first, a ducted system's unit
   next, then a row for each zone: the zone, its unit, and the one thing it
   is still missing, in order, so the row says the next thing and nothing
   else. A zone with two heads is two rows, told apart by "1 of 2".

     To place   the unit is on the system but not on the plan
     No pipe    it's on the plan with no refrigerant run on it
     No unit    the zone is on the system with no head in it
     No grille  a ducted system's zone with no grille on the plan

   Drains are not counted: no design draws one, and Install details asks how
   the condensate goes (the review of seven jobs, 20 November 2026). Pure. */

import type { DesignDocument, DesignSystem } from "./document";
import type { DataPack } from "./packs/schema";
import type { SizingBasis } from "./loads";
import { allocationsOf, hasAllocations, roomsServed, type Allocation } from "./allocations";
import { roomVerdict, trayItems, type TrayItem } from "./builder";
import { systemZones } from "./zones";
import { attachOf } from "./graph";
import { airRows } from "./air-view";

export type Missing = "To place" | "No pipe" | "No unit" | "No grille";

export interface UnitRow {
  allocationId: string;
  model: string;
  missing: Missing | null;
  /** the unit to pick up, while it's still to place */
  tray: TrayItem | null;
}

export interface ZoneRow {
  zoneId: string;
  name: string;
  /** its head, when it has one */
  unit: UnitRow | null;
  missing: Missing | null;
  /** "1 of 2" when the zone has more than one head */
  of: { index: number; count: number } | null;
  fit: "Oversized" | "Undersized" | null;
}

export interface SystemRows {
  outdoor: UnitRow | null;
  /** a ducted system's unit, serving the whole system */
  ducted: UnitRow | null;
  zones: ZoneRow[];
}

/** the ids every refrigerant run of the system touches */
function pipedIds(doc: DesignDocument, sys: DesignSystem): Set<string> {
  const ids = new Set<string>();
  for (const o of doc.objects) {
    if (o.type !== "pipe-run" || o.systemId !== sys.id) continue;
    const a = attachOf(o.props.startAttach);
    const b = attachOf(o.props.endAttach);
    if (a) ids.add(a.id);
    if (b) ids.add(b.id);
  }
  return ids;
}

export function systemRows(doc: DesignDocument, pack: DataPack | null, basis: SizingBasis, sys: DesignSystem): SystemRows {
  const zones = systemZones(doc, sys.id);
  const allocs: Allocation[] = hasAllocations(sys) ? allocationsOf(sys).filter((a) => a.model) : [];
  const onPlan = new Set(doc.objects.map((o) => o.id));
  const piped = pipedIds(doc, sys);
  const tray = new Map((pack ? trayItems(doc, pack) : []).filter((t) => t.systemId === sys.id).map((t) => [t.allocationId, t]));
  const unitRow = (a: Allocation, pipes: boolean): UnitRow => {
    const placed = onPlan.has(a.id);
    return {
      allocationId: a.id,
      model: a.model,
      missing: !placed ? "To place" : pipes && !piped.has(a.id) ? "No pipe" : null,
      tray: placed ? null : (tray.get(a.id) ?? null),
    };
  };

  const odu = allocs.find((a) => a.role === "odu") ?? null;
  const ahu = allocs.find((a) => a.role === "idu" && a.serves === "system") ?? null;
  /* the outdoor's own pipes are the heads' runs; it says only whether it's down */
  const outdoor = odu ? unitRow(odu, false) : null;
  const ducted = ahu ? unitRow(ahu, true) : null;
  const noGrille = new Set(
    ahu && pack ? airRows(doc, pack, sys).filter((r) => r.verdict === "none").map((r) => r.roomId) : []
  );

  const rows: ZoneRow[] = [];
  for (const zone of zones) {
    const name = String(zone.props.name ?? "Zone");
    const heads = allocs.filter((a) => a.role === "idu" && a.serves !== "system" && roomsServed(a).includes(zone.id));
    const verdict = pack && heads.length ? roomVerdict(doc, pack, basis, zone).word : null;
    const fit = verdict === "Oversized" || verdict === "Undersized" ? verdict : null;
    if (!heads.length) {
      const missing: Missing | null = ahu ? (noGrille.has(zone.id) ? "No grille" : null) : "No unit";
      rows.push({ zoneId: zone.id, name, unit: null, missing, of: null, fit: null });
      continue;
    }
    heads.forEach((h, i) => {
      const unit = unitRow(h, true);
      rows.push({
        zoneId: zone.id,
        name,
        unit,
        missing: unit.missing,
        of: heads.length > 1 ? { index: i + 1, count: heads.length } : null,
        fit,
      });
    });
  }
  return { outdoor, ducted, zones: rows };
}

/** a system's heat load: the zones' own loads, summed; null when none is measured */
/** a load in kW to a tenth; a zone too small to show a tenth says so,
    never "0.0 kW" (the live walk, 21 November 2026: a pantry read 0.0 kW) */
export function kwWords(kw: number | null | undefined): string {
  if (kw == null) return "";
  return kw < 0.05 ? "Under 0.1 kW" : `${kw.toFixed(1)} kW`;
}

export function zonesLoadKw(loads: readonly (number | null)[]): number | null {
  const known = loads.filter((v): v is number => v != null);
  return known.length ? known.reduce((t, v) => t + v, 0) : null;
}
