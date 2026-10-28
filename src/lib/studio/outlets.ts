/* Design Studio — what each supply outlet on a ducted unit is (Isaac,
   2026-10-28: "We just want circular … linear … grills", and on the
   linears, "1500 long and 150 high"). Three kinds:

   - SQUARE (where every outlet starts) and ROUND diffusers: placed at a
     spot, their neck the size the room's air needs per outlet
     (airflow.ts), or one the person picks from the list;
   - LINEAR grilles: a line along the ceiling, its length what the person
     draws, snapped to stock lengths, and its height picked from a stock
     list. Width is never drawn; it is the height.

   An outlet carrying more air than its size takes at the design speed is
   marked: a neck over the supply speed, a linear's face over its face
   speed. The pick is kept on the system by the outlet's key
   (`settings.ductOutlet`), so moving the unit or the outlet keeps it.
   Pure — no React. */

import type { DesignDocument, DesignSystem, Point } from "./document";
import { ductCapacityLs, SUPPLY_MS } from "./airflow";

export type OutletKind = "square" | "round" | "linear";

/** the necks a square or round diffuser comes in, mm */
export const OUTLET_NECKS_MM = [150, 200, 250, 300] as const;
/** the lengths a linear grille comes in, mm */
export const LINEAR_LENGTHS_MM = [600, 900, 1200, 1500, 1800, 2100, 2400, 3000] as const;
/** the heights a linear grille comes in, mm */
export const LINEAR_HEIGHTS_MM = [100, 150, 200, 250, 300] as const;
/** a new linear */
export const LINEAR_DEFAULT = { lengthMm: 1200, heightMm: 150 } as const;
/** the most air across a linear's face, m/s */
export const LINEAR_FACE_MS = 2.0;

/** what the person picked for one outlet; anything left out is the default */
export interface OutletPick {
  kind?: OutletKind;
  neckMm?: number;
  lengthMm?: number;
  heightMm?: number;
  /** a linear's way along the ceiling, a unit vector */
  along?: Point;
}

/** one outlet, as made */
export interface OutletSpec {
  kind: OutletKind;
  /** the neck the run meets, mm */
  neckMm: number;
  /** a linear's face, mm; null for a square or round */
  lengthMm: number | null;
  heightMm: number | null;
  along: Point | null;
  /** carrying more than its size takes at the design speed */
  over: boolean;
}

const KINDS: readonly OutletKind[] = ["square", "round", "linear"];

/** the picks on a system, by outlet key */
export function outletPicks(sys: DesignSystem): Record<string, OutletPick> {
  const v = sys.settings.ductOutlet;
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  const out: Record<string, OutletPick> = {};
  for (const [k, raw] of Object.entries(v as Record<string, unknown>)) {
    if (!raw || typeof raw !== "object") continue;
    const p = raw as Record<string, unknown>;
    const pick: OutletPick = {};
    if (typeof p.kind === "string" && (KINDS as readonly string[]).includes(p.kind)) pick.kind = p.kind as OutletKind;
    for (const f of ["neckMm", "lengthMm", "heightMm"] as const) {
      if (typeof p[f] === "number" && Number.isFinite(p[f]) && (p[f] as number) > 0) pick[f] = p[f] as number;
    }
    const a = p.along as Point | undefined;
    if (a && Number.isFinite(a.x) && Number.isFinite(a.y) && Math.hypot(a.x, a.y) > 0) {
      const n = Math.hypot(a.x, a.y);
      pick.along = { x: a.x / n, y: a.y / n };
    }
    out[k] = pick;
  }
  return out;
}

/** the system with one outlet's pick changed; fields set to undefined go
    back to the default */
export function setOutletPick(doc: DesignDocument, systemId: string, key: string, change: OutletPick): DesignDocument {
  return {
    ...doc,
    systems: doc.systems.map((s) => {
      if (s.id !== systemId) return s;
      const picks = outletPicks(s);
      const next: OutletPick = { ...picks[key], ...change };
      for (const f of Object.keys(next) as (keyof OutletPick)[]) if (next[f] === undefined) delete next[f];
      return { ...s, settings: { ...s.settings, ductOutlet: { ...picks, [key]: next } } };
    }),
  };
}

/** the stock length nearest a drawn one */
export function snapLength(mm: number): number {
  return LINEAR_LENGTHS_MM.reduce((a, b) => (Math.abs(b - mm) < Math.abs(a - mm) ? b : a));
}

/** one outlet as made, from the air it carries, the neck the room's air
    gives it, the way its room runs, and the person's pick */
export function outletSpec(pick: OutletPick | undefined, ls: number, neckMm: number, roomAlong: Point): OutletSpec {
  const kind = pick?.kind ?? "square";
  if (kind === "linear") {
    const lengthMm = pick?.lengthMm ?? LINEAR_DEFAULT.lengthMm;
    const heightMm = pick?.heightMm ?? LINEAR_DEFAULT.heightMm;
    const face = (lengthMm / 1000) * (heightMm / 1000);
    return { kind, neckMm, lengthMm, heightMm, along: pick?.along ?? roomAlong, over: ls / 1000 / face > LINEAR_FACE_MS + 1e-9 };
  }
  const neck = pick?.neckMm ?? neckMm;
  return { kind, neckMm: neck, lengthMm: null, heightMm: null, along: null, over: ductCapacityLs(neck, SUPPLY_MS) < ls - 1e-9 };
}

/** what an outlet is called on the sheet and to Tiff: the price book's
    common install items name them "Square diffuser", "Round diffuser" and
    "Bar grille" (quotes/install-groups.ts), a size each */
export function outletName(o: Pick<OutletSpec, "kind" | "neckMm" | "lengthMm" | "heightMm">): string {
  if (o.kind === "linear") return `Linear bar grille ${o.lengthMm} × ${o.heightMm}`;
  return `${o.kind === "round" ? "Round" : "Square"} diffuser, ${o.neckMm} neck`;
}
