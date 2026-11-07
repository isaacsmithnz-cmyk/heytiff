/* Design Studio — grilles: a supply diffuser or a return grille the person
   puts on the plan from the component palette (Isaac, 28 October 2026: "Drop
   the unit, then add pipe duct drain cables, whatever you want to put on …
   Do not attach things to it"). Nothing makes one for them: a grille is on
   the plan because somebody placed it, at the size they picked.

   A grille belongs to the system it was placed for, so the sheet and Tiff
   count it with that system's air side. Its shape is pure geometry here,
   called by the canvas and the sheet alike. */

import type { DesignObject, Point } from "./document";
import { newId } from "./document";
import type { AirStream } from "./airflow-marks";

export const GRILLE_TYPE = "grille";

export interface GrilleSize {
  wMm: number;
  hMm: number;
}

/** the sizes the palette offers, face width × height, mm. Squares are
    ceiling diffusers; the long thin ones are linear and kicker grilles */
export const GRILLE_SIZES: Record<AirStream, GrilleSize[]> = {
  supply: [
    { wMm: 300, hMm: 300 },
    { wMm: 450, hMm: 450 },
    { wMm: 600, hMm: 100 },
    { wMm: 1200, hMm: 100 },
  ],
  return: [
    { wMm: 600, hMm: 400 },
    { wMm: 750, hMm: 400 },
    { wMm: 600, hMm: 100 },
    { wMm: 1200, hMm: 150 },
  ],
};

export const sizeText = (s: GrilleSize): string => `${s.wMm} × ${s.hMm}`;

/* WHAT A SUPPLY GRILLE IS AND WHERE IT SITS (the next flow; board 7 of the
   Studio rework mocks): a square or round diffuser or a linear bar grille,
   in the ceiling, a wall or the floor. A grille placed before these were
   offered has neither: it reads as it always did, square when its face is
   square, else linear, and says nothing of where it sits. */
export type GrilleStyle = "square" | "round" | "linear";
export type GrilleMount = "ceiling" | "wall" | "floor" | "kicker";
export const GRILLE_STYLES: GrilleStyle[] = ["square", "round", "linear"];
export const GRILLE_MOUNTS: GrilleMount[] = ["ceiling", "wall", "floor", "kicker"];

/** the sizes offered for each kind of supply face; a round one is its neck,
    width and height both */
export const STYLE_SIZES: Record<GrilleStyle, GrilleSize[]> = {
  square: [
    { wMm: 300, hMm: 300 },
    { wMm: 450, hMm: 450 },
    { wMm: 600, hMm: 600 },
  ],
  round: [
    { wMm: 150, hMm: 150 },
    { wMm: 200, hMm: 200 },
    { wMm: 250, hMm: 250 },
    { wMm: 300, hMm: 300 },
  ],
  linear: [
    { wMm: 600, hMm: 100 },
    { wMm: 900, hMm: 100 },
    { wMm: 1200, hMm: 100 },
    { wMm: 1500, hMm: 150 },
  ],
};

/** the sizes a grille of this stream and style is offered in */
export const sizesFor = (stream: AirStream, style: GrilleStyle | null): GrilleSize[] =>
  stream === "return" || !style ? GRILLE_SIZES[stream] : STYLE_SIZES[style];

/** a face is never smaller or larger than these, mm; a dragged edge lands on
    the step, so a grille pulled out by hand reads 650, never 647 */
export const GRILLE_MIN_MM = 100;
export const GRILLE_MAX_MM = 3000;
export const GRILLE_STEP_MM = 25;

/** a face size typed into the bar, mm: a whole number in range, or nothing */
export function typedGrilleMm(raw: string): number | null {
  const t = raw.trim().replace(/[\s,]/g, "");
  if (!/^\d+$/.test(t)) return null;
  const n = Number(t);
  return n >= GRILLE_MIN_MM && n <= GRILLE_MAX_MM ? n : null;
}

const stepMm = (mm: number) =>
  Math.min(GRILLE_MAX_MM, Math.max(GRILLE_MIN_MM, Math.round(mm / GRILLE_STEP_MM) * GRILLE_STEP_MM));

/** an edge of the face: along its width (e, w) or across it (n, s), in the
    grille's own frame, so a turned grille is pulled by its own ends */
export type GrilleEdge = "n" | "e" | "s" | "w";

/** the face with `edge` dragged to world point `w`: the opposite edge stays
    where it is, the size lands on the step, and the centre moves with it */
export function resizeGrille(
  at: Point,
  deg: number,
  s: GrilleSize,
  edge: GrilleEdge,
  w: Point,
  mmPerUnit: number
): { at: Point; size: GrilleSize } {
  const rad = (deg * Math.PI) / 180;
  const u = { x: Math.cos(rad), y: Math.sin(rad) }; // along the width
  const v = { x: -Math.sin(rad), y: Math.cos(rad) }; // across it
  const d = { x: w.x - at.x, y: w.y - at.y };
  const along = edge === "e" || edge === "w";
  const axis = along ? u : v;
  const half = (along ? s.wMm : s.hMm) / 2 / mmPerUnit;
  const sign = edge === "e" || edge === "s" ? 1 : -1;
  const reach = (d.x * axis.x + d.y * axis.y) * sign; // past the centre, toward the edge
  const mm = stepMm((reach + half) * mmPerUnit);
  // the fixed edge sits at -half along the dragged direction
  const shift = (mm / 2 / mmPerUnit - half) * sign;
  return {
    at: { x: at.x + axis.x * shift, y: at.y + axis.y * shift },
    size: along ? { wMm: mm, hMm: s.hMm } : { wMm: s.wMm, hMm: mm },
  };
}

/** the middle of each edge, world units, for the handles that drag it */
export function grilleEdges(at: Point, deg: number, s: GrilleSize, mmPerUnit: number): Record<GrilleEdge, Point> {
  const rad = (deg * Math.PI) / 180;
  const hw = s.wMm / 2 / mmPerUnit;
  const hh = s.hMm / 2 / mmPerUnit;
  const p = (x: number, y: number): Point => ({
    x: at.x + x * Math.cos(rad) - y * Math.sin(rad),
    y: at.y + x * Math.sin(rad) + y * Math.cos(rad),
  });
  return { n: p(0, -hh), e: p(hw, 0), s: p(0, hh), w: p(-hw, 0) };
}

export type Grille = DesignObject & {
  type: typeof GRILLE_TYPE;
  geometry: { kind: "point"; at: Point; rotation?: number };
  props: { stream: AirStream; wMm: number; hMm: number; style?: GrilleStyle; mount?: GrilleMount; supplyMm?: number };
};

export function isGrille(o: DesignObject): o is Grille {
  return o.type === GRILLE_TYPE && o.geometry.kind === "point";
}

export const grilleStream = (o: Grille): AirStream => (o.props.stream === "return" ? "return" : "supply");

export function grilleSize(o: Grille): GrilleSize {
  const w = Number(o.props.wMm);
  const h = Number(o.props.hMm);
  return { wMm: w > 0 ? w : 300, hMm: h > 0 ? h : 300 };
}

/** a supply grille's kind as picked, or null for a return or one placed
    before kinds were offered */
export function grilleStyle(o: Grille): GrilleStyle | null {
  const st = o.props.style;
  return grilleStream(o) === "supply" && (st === "square" || st === "round" || st === "linear") ? st : null;
}

/** where a grille sits, or null if nobody said */
export function grilleMount(o: Grille): GrilleMount | null {
  const m = o.props.mount;
  return m === "ceiling" || m === "wall" || m === "floor" || m === "kicker" ? m : null;
}

/* ONE GRILLE, SUPPLY AND RETURN (Isaac, 31 October 2026, 7 Cutler: "a single
   grille in each joinery. It has to be full width and do supply and return in
   same grille. I initially placed 2 x 1200mm grilles to make it look like
   1"). One long linear face with a divider behind it: the supply side runs
   from the grille's own left end for `supplyMm`, the return is the rest. It
   stays a supply grille to everything that counts supply; a duct lands on the
   side its stream belongs to. Turn it 180° to swap the sides on the plan. */

/** a side is never narrower than this, mm */
export const SPLIT_MIN_MM = 100;

const stepTo = (mm: number) => Math.round(mm / GRILLE_STEP_MM) * GRILLE_STEP_MM;

/** half and half, on the step */
export const halfOf = (wMm: number): number => clampSupply(stepTo(wMm / 2), wMm);

export const clampSupply = (supplyMm: number, wMm: number): number =>
  Math.max(SPLIT_MIN_MM, Math.min(wMm - SPLIT_MIN_MM, supplyMm));

/** a combined grille's two sides, or null for a grille that does one thing */
export function grilleSplit(o: Grille): { supplyMm: number; returnMm: number } | null {
  const raw = Number(o.props.supplyMm);
  if (!(raw > 0)) return null;
  const { wMm } = grilleSize(o);
  const supplyMm = clampSupply(raw, wMm);
  return { supplyMm, returnMm: wMm - supplyMm };
}

/** the supply side once the face changes width: the same share, on the step */
export const supplyAtWidth = (supplyMm: number, fromW: number, toW: number): number =>
  clampSupply(stepTo((supplyMm * toW) / Math.max(fromW, 1)), toW);

/** the middle of a side, in the grille's own frame, world units */
export function splitSideOff(s: GrilleSize, supplyMm: number, stream: AirStream, mmPerUnit: number): Point {
  const mid = stream === "supply" ? -s.wMm / 2 + supplyMm / 2 : s.wMm / 2 - (s.wMm - supplyMm) / 2;
  return { x: mid / mmPerUnit, y: 0 };
}

/** a combined face: its one outline, the divider, and each side's own lines */
export function splitShape(
  at: Point,
  deg: number,
  s: GrilleSize,
  supplyMm: number,
  mmPerUnit: number
): { outline: Point[]; divider: [Point, Point]; supply: [Point, Point][]; ret: [Point, Point][] } {
  const hw = s.wMm / 2 / mmPerUnit;
  const hh = s.hMm / 2 / mmPerUnit;
  const rad = (deg * Math.PI) / 180;
  const c = Math.cos(rad);
  const n = Math.sin(rad);
  const p = (x: number, y: number): Point => ({ x: at.x + x * c - y * n, y: at.y + x * n + y * c });
  const cut = -hw + supplyMm / mmPerUnit;
  const supply: [Point, Point][] = [-1 / 3, 1 / 3].map((f) => [p(-hw, hh * f * 2), p(cut, hh * f * 2)]);
  const k = Math.max(2, Math.round((s.wMm - supplyMm) / 150));
  const ret: [Point, Point][] = [];
  for (let i = 1; i < k; i++) {
    const x = cut + ((hw - cut) * i) / k;
    ret.push([p(x, -hh), p(x, hh)]);
  }
  return { outline: [p(-hw, -hh), p(hw, -hh), p(hw, hh), p(-hw, hh)], divider: [p(cut, -hh), p(cut, hh)], supply, ret };
}

/** a duct that lands on a combined grille keeps to its side when the face
    changes: its spot is re-read for every run that ends on one of `ids` */
export function respotSplitRuns(objects: DesignObject[], ids: ReadonlySet<string>, mmPerUnit: number): DesignObject[] {
  const byId = new Map(objects.map((o) => [o.id, o]));
  const spot = (raw: unknown, stream: AirStream): { kind: "grille"; id: string; off: Point } | null => {
    const a = raw as { kind?: string; id?: string } | undefined;
    if (a?.kind !== "grille" || !a.id || !ids.has(a.id)) return null;
    const g = byId.get(a.id);
    if (!g || !isGrille(g)) return null;
    const split = grilleSplit(g);
    return split ? { kind: "grille", id: a.id, off: splitSideOff(grilleSize(g), split.supplyMm, stream, mmPerUnit) } : null;
  };
  return objects.map((o) => {
    if (o.type !== "duct-run") return o;
    const stream: AirStream = o.props.stream === "return" ? "return" : "supply";
    const start = spot(o.props.startAttach, stream);
    const end = spot(o.props.endAttach, stream);
    if (!start && !end) return o;
    return { ...o, props: { ...o.props, ...(start ? { startAttach: start } : {}), ...(end ? { endAttach: end } : {}) } };
  });
}

/** a linear grille pulled across something: from one end to the other, the
    width on the step, square to the plan unless it was pulled well off it */
export function pulledGrille(a: Point, b: Point, hMm: number, mmPerUnit: number): { at: Point; deg: number; size: GrilleSize } {
  const raw = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
  const square = Math.round(raw / 90) * 90;
  const deg = Math.abs(raw - square) <= 10 ? square : Math.round(raw);
  const rad = (deg * Math.PI) / 180;
  const along = (b.x - a.x) * Math.cos(rad) + (b.y - a.y) * Math.sin(rad);
  const wMm = stepMm(along * mmPerUnit);
  const half = wMm / 2 / mmPerUnit;
  return {
    at: { x: a.x + Math.cos(rad) * half, y: a.y + Math.sin(rad) * half },
    /* its own left is where the pull began, so a combined grille's supply
       side is at that end */
    deg: ((deg % 360) + 360) % 360,
    size: { wMm, hMm },
  };
}

/** a new grille, centred where it was clicked, square to the plan; it is
    turned afterwards on its ring, like a unit */
export function grille(
  floorId: string,
  systemId: string | null,
  at: Point,
  stream: AirStream,
  size: GrilleSize,
  deg = 0,
  kind: { style?: GrilleStyle | null; mount?: GrilleMount | null; supplyMm?: number | null } = {}
): Grille {
  return {
    id: newId("obj"),
    type: GRILLE_TYPE,
    systemId,
    floorId,
    plane: "room",
    geometry: { kind: "point", at, ...(deg ? { rotation: deg } : {}) },
    props: {
      stream,
      wMm: size.wMm,
      hMm: size.hMm,
      ...(stream === "supply" && kind.style ? { style: kind.style } : {}),
      ...(kind.mount ? { mount: kind.mount } : {}),
      ...(stream === "supply" && kind.supplyMm ? { supplyMm: kind.supplyMm } : {}),
    },
  } as Grille;
}

/** what a grille is called on the sheet and to Tiff: a square supply is a
    diffuser, a long one a linear bar grille, a round one a round diffuser by
    its neck, any return a return air grille */
export function grilleName(stream: AirStream, s: GrilleSize, style: GrilleStyle | null = null, supplyMm: number | null = null): string {
  if (supplyMm) return `Linear grille ${sizeText(s)}, supply ${supplyMm} and return ${s.wMm - supplyMm}`;
  if (stream === "return") return `Return air grille ${sizeText(s)}`;
  if (style === "round") return `Round diffuser Ø${s.wMm}`;
  const square = style ? style === "square" : s.wMm === s.hMm;
  return square ? `Square diffuser ${sizeText(s)}` : `Linear bar grille ${sizeText(s)}`;
}

/** the face's corners and the lines across it, world units. A square
    diffuser wears its two diagonals; a linear one its bars along it; a
    return its egg-crate lines across */
export function grilleShape(
  at: Point,
  deg: number,
  stream: AirStream,
  s: GrilleSize,
  mmPerUnit: number,
  style: GrilleStyle | null = null
): { outline: Point[]; lines: [Point, Point][] } {
  const hw = s.wMm / 2 / mmPerUnit;
  const hh = s.hMm / 2 / mmPerUnit;
  const rad = (deg * Math.PI) / 180;
  const c = Math.cos(rad);
  const n = Math.sin(rad);
  const p = (x: number, y: number): Point => ({ x: at.x + x * c - y * n, y: at.y + x * n + y * c });
  const lines: [Point, Point][] = [];
  /* a round diffuser: its rim, and a ring inside it */
  if (stream === "supply" && style === "round") {
    const ring = (r: number, k: number) => Array.from({ length: k }, (_, i) => p(Math.cos((i / k) * Math.PI * 2) * r, Math.sin((i / k) * Math.PI * 2) * r));
    const inner = ring(hw * 0.55, 20);
    inner.forEach((q, i) => lines.push([q, inner[(i + 1) % inner.length]]));
    return { outline: ring(hw, 32), lines };
  }
  const outline = [p(-hw, -hh), p(hw, -hh), p(hw, hh), p(-hw, hh)];
  if (stream === "supply" && (style ? style === "square" : s.wMm === s.hMm)) {
    lines.push([outline[0], outline[2]], [outline[1], outline[3]]);
  } else if (stream === "supply") {
    for (const f of [-1 / 3, 1 / 3]) lines.push([p(-hw, hh * f * 2), p(hw, hh * f * 2)]);
  } else {
    const k = Math.max(2, Math.round(s.wMm / 150));
    for (let i = 1; i < k; i++) {
      const x = -hw + (2 * hw * i) / k;
      lines.push([p(x, -hh), p(x, hh)]);
    }
  }
  return { outline, lines };
}

/** is a point on a grille? within its face plus `tol` world units */
export function hitGrille(o: Grille, w: Point, mmPerUnit: number, tol: number): boolean {
  const s = grilleSize(o);
  const rad = ((o.geometry.rotation ?? 0) * Math.PI) / 180;
  const v = { x: w.x - o.geometry.at.x, y: w.y - o.geometry.at.y };
  const along = v.x * Math.cos(rad) + v.y * Math.sin(rad);
  const across = -v.x * Math.sin(rad) + v.y * Math.cos(rad);
  return Math.abs(along) <= s.wMm / 2 / mmPerUnit + tol && Math.abs(across) <= s.hMm / 2 / mmPerUnit + tol;
}
