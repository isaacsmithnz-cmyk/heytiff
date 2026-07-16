/* Design Studio — AI plan extraction: contract, validation and the pipeline
   that turns a raw Claude-vision extraction into the simple-view render model.

   The MODEL never draws walls. It reports spaces / openings / fixtures /
   labels in IMAGE-PIXEL coordinates; walls are derived deterministically by
   welding space-polygon edges (simple-plan.ts core), and openings snap onto
   those derived walls afterwards. Everything here is pure — safe to import
   from client components, the server action and jest alike. The persisted
   types (RawExtraction & kinds) live in document.ts (they are document
   schema); this module owns the JSON schema, the prompt, validation and
   geometry post-processing.

   Future work (not v1): a crop-and-refine second pass — re-send low-confidence
   spaces as zoomed crops for tighter geometry. */

import type { DesignDocument, Point, RawExtraction } from "./document";
import {
  boundsOfPoints,
  clamp,
  dist,
  pointInPolygon,
  polygonArea,
  polygonCentroid,
} from "./geometry";
import {
  buildSimplePlanCore,
  SIMPLE_PLAN,
  type CoreSpace,
  type SimplePlanModel,
  type SimplePlanOpening,
} from "./simple-plan";

/* AI geometry jitters more than a human trace — weld with a looser tolerance,
   and give openings a generous leash to their host wall. */
export const AI_WELD_TOL_MM = 350;
export const OPENING_SNAP_MM = 600;
/** spaces smaller than this are treated as extraction noise */
export const MIN_SPACE_M2 = 1;
/** near-axis edges within this many degrees snap to horizontal/vertical */
export const ORTHO_TOL_DEG = 7;

/* ── structured-output JSON schema ──
   Constraints honoured (Anthropic structured outputs): every object carries
   additionalProperties:false + full required; enums for kinds; NO
   minimum/maximum/minLength/minItems — ranges are enforced in code by
   validateExtraction. Nullables are avoided via sentinels (hinge == center
   means "no hinged leaf"). */

const POINT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["x", "y"],
  properties: { x: { type: "number" }, y: { type: "number" } },
} as const;

export const EXTRACTION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["imageWidth", "imageHeight", "spaces", "openings", "fixtures", "notes"],
  properties: {
    imageWidth: { type: "number" },
    imageHeight: { type: "number" },
    spaces: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "kind", "polygon"],
        properties: {
          name: { type: "string" },
          kind: {
            type: "string",
            enum: [
              "room",
              "hallway",
              "stairs",
              "garage",
              "balcony",
              "porch",
              "alfresco",
              "wc",
              "other",
            ],
          },
          polygon: { type: "array", items: POINT_SCHEMA },
        },
      },
    },
    openings: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["kind", "center", "widthPx", "orientation", "hinge", "swingToward"],
        properties: {
          kind: {
            type: "string",
            enum: ["door", "double-door", "slider", "cased-opening", "window", "garage-door"],
          },
          center: POINT_SCHEMA,
          widthPx: { type: "number" },
          orientation: { type: "string", enum: ["h", "v"] },
          hinge: POINT_SCHEMA,
          swingToward: POINT_SCHEMA,
        },
      },
    },
    fixtures: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["kind", "x", "y", "w", "h", "rotationDeg"],
        properties: {
          kind: {
            type: "string",
            enum: [
              "bed",
              "robe",
              "wc",
              "shower",
              "bath",
              "vanity",
              "sink",
              "kitchen-bench",
              "island",
              "fridge",
              "stove",
              "dishwasher",
              "laundry-unit",
              "stairs",
              "sofa",
              "table",
              "desk",
              "car",
              "water-heater",
              "other",
            ],
          },
          x: { type: "number" },
          y: { type: "number" },
          w: { type: "number" },
          h: { type: "number" },
          rotationDeg: { type: "number" },
        },
      },
    },
    notes: {
      type: "object",
      additionalProperties: false,
      required: ["hasNorthArrow", "northDeg", "uncertainties"],
      properties: {
        hasNorthArrow: { type: "boolean" },
        northDeg: { type: "number" },
        uncertainties: { type: "array", items: { type: "string" } },
      },
    },
  },
} as const;

/* ── extraction prompt ── */

export const EXTRACTION_SYSTEM = `You extract structured floor-plan geometry from a residential architect's drawing raster so it can be redrawn as a clean simplified plan.

Coordinate system: IMAGE PIXELS, origin at the top-left of the raster, x to the right, y down. Every coordinate must lie within the stated image size. Report positions as accurately as you can read them — your output is overlaid 1:1 on the original drawing.

SPACES — report every enclosed space of the main floor plan, including unlabeled ones (assign the best kind: hallway, garage, balcony, porch, alfresco, stairs, wc, room, other). Trace each space's polygon along the CENTRELINES of its bounding walls. Strongly prefer orthogonal (axis-aligned) polygons wherever the walls are orthogonal. Three hard rules:
1. Spaces must NOT overlap — no two polygons may cover the same floor area. For open-plan combined areas (living/dining/kitchen sharing one volume) divide the area into ADJACENT non-overlapping zones along a sensible boundary; never report two spaces on top of each other.
2. Each building's spaces must tile a CONTIGUOUS footprint: neighbouring spaces share their common wall centreline exactly — no slivers and no gaps between them.
3. Extract ONE floor level only — the single dominant floor plan on the sheet. Never combine rooms from different levels or from separate plan views into one output.
Read each space's name label VERBATIM from the drawing ("Master Bed 1", "Living / Dining"); use "" when there is no label.

OPENINGS — every doorway, sliding door, cased opening (doorless gap), window and garage door. The center sits ON the wall line it penetrates; widthPx is the clear opening width; orientation is "h" when the wall run is horizontal, "v" when vertical. For hinged doors where the swing arc is drawn, set hinge to the hinge-side jamb and swingToward to roughly where the open leaf's free end sits; otherwise set hinge and swingToward EQUAL to center.

FIXTURES — only symbols clearly drawn on the plan: beds, robes/wardrobes, WCs, showers, baths, vanities, sinks, kitchen benches/islands, appliances, stairs, sofas, tables, desks, cars, water heaters. Give the axis-aligned bounding box (x, y = top-left) plus rotationDeg for rotated symbols.

IGNORE — dimension strings and chains, grid bubbles, hatching, electrical/plumbing annotation, the title block, legends, site-plan surroundings (boundaries, lawns, streets, trees), and any elevations/sections sharing the sheet. If more than one floor plan appears on the sheet, extract the dominant one and note the others in uncertainties.

Note the north arrow if one is visible (hasNorthArrow, northDeg = degrees clockwise from image-up; 0 when absent). List anything you were unsure about in notes.uncertainties — unreadable labels, ambiguous walls, spaces you may have merged or missed.`;

/* ── validation ── */

export type ValidationResult =
  | { ok: true; extraction: RawExtraction; issues: string[] }
  | { ok: false; errors: string[] };

/** Enforce what the JSON schema can't: coordinate ranges, polygon arity,
    degenerate geometry. Clamps recoverable problems (out-of-bounds points),
    drops noise (sub-1 m² spaces) with an issue, rejects only coordinate-space
    failures. `scaleMmPerUnit` (when known) powers the area floor. */
export function validateExtraction(
  raw: RawExtraction,
  imgW: number,
  imgH: number,
  scaleMmPerUnit?: number | null
): ValidationResult {
  const errors: string[] = [];
  const issues: string[] = [];

  // echoed-dims gate: a badly wrong echo means the model worked in some other
  // coordinate space — nothing downstream can be trusted
  const wOff = Math.abs(raw.imageWidth - imgW) / imgW;
  const hOff = Math.abs(raw.imageHeight - imgH) / imgH;
  if (wOff > 0.05 || hOff > 0.05) {
    errors.push(
      `The extraction reported a ${raw.imageWidth}×${raw.imageHeight} image but the sheet is ${imgW}×${imgH} — coordinates can't be trusted`
    );
    return { ok: false, errors };
  }

  const clampPt = (p: Point): Point => ({
    x: clamp(p.x, 0, imgW),
    y: clamp(p.y, 0, imgH),
  });
  const mm = scaleMmPerUnit ?? null;
  const minAreaU2 = mm ? (MIN_SPACE_M2 * 1e6) / (mm * mm) : 0;

  const spaces = raw.spaces
    .filter((s) => {
      if (s.polygon.length < 3) {
        issues.push(`Dropped "${s.name || s.kind}" — polygon has fewer than 3 points`);
        return false;
      }
      return true;
    })
    .map((s) => ({ ...s, polygon: s.polygon.map(clampPt) }))
    .filter((s) => {
      if (minAreaU2 > 0 && polygonArea(s.polygon) < minAreaU2) {
        issues.push(`Dropped "${s.name || s.kind}" — under ${MIN_SPACE_M2} m²`);
        return false;
      }
      return true;
    });

  if (spaces.length === 0) {
    errors.push("No usable spaces were extracted from the drawing");
    return { ok: false, errors };
  }

  const openings = raw.openings
    .filter((o) => {
      if (!(o.widthPx > 0)) {
        issues.push(`Dropped a ${o.kind} — non-positive width`);
        return false;
      }
      return true;
    })
    .map((o) => ({
      ...o,
      center: clampPt(o.center),
      hinge: clampPt(o.hinge),
      swingToward: clampPt(o.swingToward),
    }));

  const fixtures = raw.fixtures
    .filter((f) => {
      if (!(f.w > 0) || !(f.h > 0)) {
        issues.push(`Dropped a ${f.kind} fixture — non-positive size`);
        return false;
      }
      return true;
    })
    .map((f) => {
      const x = clamp(f.x, 0, imgW);
      const y = clamp(f.y, 0, imgH);
      return {
        ...f,
        x,
        y,
        w: Math.min(f.w, imgW - x),
        h: Math.min(f.h, imgH - y),
      };
    });

  return {
    ok: true,
    extraction: { ...raw, spaces, openings, fixtures },
    issues,
  };
}

/* ── geometry post-processing ── */

/** Snap near-axis edges to exactly horizontal/vertical and re-intersect
    consecutive edges, then merge vertices that collapsed together. AI polygon
    jitter (a "rectangle" whose sides are 1–3° off) becomes crisp orthogonal
    geometry; genuinely angled walls (beyond tolDeg) are left alone. */
export function orthogonalize(points: Point[], tolDeg = ORTHO_TOL_DEG): Point[] {
  const n = points.length;
  if (n < 3) return points;
  const tol = (tolDeg * Math.PI) / 180;

  type Edge =
    | { kind: "h"; y: number }
    | { kind: "v"; x: number }
    | { kind: "free"; a: Point; b: Point };
  const edges: Edge[] = [];
  for (let i = 0; i < n; i++) {
    const a = points[i];
    const b = points[(i + 1) % n];
    const ang = Math.atan2(b.y - a.y, b.x - a.x);
    const mod = Math.abs(ang) % (Math.PI / 2);
    const offAxis = Math.min(mod, Math.PI / 2 - mod);
    if (offAxis > tol) {
      edges.push({ kind: "free", a, b });
    } else if (
      Math.abs(Math.cos(ang)) > Math.abs(Math.sin(ang))
    ) {
      edges.push({ kind: "h", y: (a.y + b.y) / 2 });
    } else {
      edges.push({ kind: "v", x: (a.x + b.x) / 2 });
    }
  }

  // vertex i = intersection of edge (i-1) and edge i
  const out: Point[] = [];
  for (let i = 0; i < n; i++) {
    const prev = edges[(i + n - 1) % n];
    const cur = edges[i];
    const orig = points[i];
    let p = orig;
    if (prev.kind === "h" && cur.kind === "v") p = { x: cur.x, y: prev.y };
    else if (prev.kind === "v" && cur.kind === "h") p = { x: prev.x, y: cur.y };
    else if (prev.kind === "h") p = { x: orig.x, y: prev.y };
    else if (prev.kind === "v") p = { x: prev.x, y: orig.y };
    else if (cur.kind === "h") p = { x: orig.x, y: cur.y };
    else if (cur.kind === "v") p = { x: cur.x, y: orig.y };
    out.push(p);
  }

  // merge vertices that collapsed together (duplicate corners from the snap)
  const merged: Point[] = [];
  for (const p of out) {
    const last = merged[merged.length - 1];
    if (last && dist(last, p) < 1e-6) continue;
    merged.push(p);
  }
  while (
    merged.length > 1 &&
    dist(merged[0], merged[merged.length - 1]) < 1e-6
  ) {
    merged.pop();
  }
  return merged.length >= 3 ? merged : points;
}

/** Pull each space's vertices onto nearby edges of OTHER spaces (within the
    weld tolerance), so near-touching neighbours become exactly touching and
    the derived envelope is contiguous — no daylight seams between rooms the
    model traced a few hundred mm apart. Vertices only ever move by ≤ tol. */
export function stitchSpaces<T extends { points: Point[] }>(
  spaces: T[],
  tolU: number
): T[] {
  return spaces.map((s, i) => ({
    ...s,
    points: s.points.map((v) => {
      let best = v;
      let bestD = tolU;
      for (let j = 0; j < spaces.length; j++) {
        if (j === i) continue;
        const pts = spaces[j].points;
        for (let k = 0; k < pts.length; k++) {
          const a = pts[k];
          const b = pts[(k + 1) % pts.length];
          const abx = b.x - a.x;
          const aby = b.y - a.y;
          const l2 = abx * abx + aby * aby;
          const t =
            l2 === 0
              ? 0
              : clamp(((v.x - a.x) * abx + (v.y - a.y) * aby) / l2, 0, 1);
          const p = { x: a.x + t * abx, y: a.y + t * aby };
          const d = dist(v, p);
          if (d > 1e-9 && d < bestD) {
            bestD = d;
            best = p;
          }
        }
      }
      return best;
    }),
  }));
}

/** Drop spaces that substantially overlap a larger space — the "two plans on
    top of each other" failure mode (duplicate open-plan zones, or a second
    floor level read into the same output). Kept spaces win by area. */
export function dropOverlappingSpaces<T extends { points: Point[]; name?: string }>(
  spaces: T[],
  issues: string[],
  label: (s: T) => string
): T[] {
  const withArea = spaces
    .map((s) => ({ s, area: polygonArea(s.points), c: polygonCentroid(s.points) }))
    .sort((a, b) => b.area - a.area);
  const kept: typeof withArea = [];
  for (const cand of withArea) {
    const bb = boundsOfPoints(cand.s.points);
    let dropped = false;
    for (const k of kept) {
      const kb = boundsOfPoints(k.s.points);
      if (!bb || !kb) continue;
      const ix =
        Math.max(0, Math.min(bb.maxX, kb.maxX) - Math.max(bb.minX, kb.minX)) *
        Math.max(0, Math.min(bb.maxY, kb.maxY) - Math.max(bb.minY, kb.minY));
      const bbArea = (bb.maxX - bb.minX) * (bb.maxY - bb.minY);
      const centroidInside = pointInPolygon(cand.c, k.s.points);
      if (centroidInside && bbArea > 0 && ix / bbArea > 0.6) {
        issues.push(
          `Dropped "${label(cand.s)}" — it sits on top of "${label(k.s)}" (overlapping zones)`
        );
        dropped = true;
        break;
      }
    }
    if (!dropped) kept.push(cand);
  }
  // restore original order for stable ids/labels
  const keptSet = new Set(kept.map((k) => k.s));
  return spaces.filter((s) => keptSet.has(s));
}

const SPACE_KIND_LABEL: Record<string, string> = {
  hallway: "Hall",
  stairs: "Stairs",
  garage: "Garage",
  balcony: "Balcony",
  porch: "Porch",
  alfresco: "Alfresco",
  wc: "WC",
};

/** Build the simple-view render model for a floor from its stored extraction.
    Pixel coords map to world by the sheet's x/y placement (1 px = 1 world
    unit); sheets whose imageRef no longer matches are skipped as stale. */
export function buildSimplePlanFromExtraction(
  doc: DesignDocument,
  floorId: string
): SimplePlanModel {
  const floor = doc.floors.find((f) => f.id === floorId);
  const fsp = floor?.simplePlan;
  if (!floor || !fsp) {
    return buildSimplePlanCore([], floor?.scaleMmPerUnit ?? null);
  }

  const issues: string[] = [];
  const spaces: CoreSpace[] = [];
  const rawOpenings: {
    kind: RawExtraction["openings"][number]["kind"];
    center: Point;
    widthU: number;
    hinge: Point;
    swingToward: Point;
  }[] = [];
  const fixtures: SimplePlanModel["fixtures"] = [];

  let spaceSeq = 0;
  for (const sheetX of fsp.sheets) {
    const sheet = floor.plans.find(
      (p) => p.id === sheetX.sheetId && p.imageRef === sheetX.imageRef
    );
    if (!sheet) {
      issues.push(
        `The plan sheet this extraction was read from has changed — regenerate the simple view`
      );
      continue;
    }
    const off = { x: sheet.x, y: sheet.y };
    const toWorld = (p: Point): Point => ({ x: p.x + off.x, y: p.y + off.y });

    for (const s of sheetX.extraction.spaces) {
      const pts = orthogonalize(s.polygon).map(toWorld);
      if (pts.length < 3) continue;
      spaces.push({
        id: `xsp_${spaceSeq++}`,
        name: s.name || SPACE_KIND_LABEL[s.kind] || "",
        points: pts,
        // every AI edge counts as marked-external: single-coverage stretches
        // (the hull) render external, shared stretches render internal
        external: pts.map(() => true),
      });
    }
    for (const o of sheetX.extraction.openings) {
      rawOpenings.push({
        kind: o.kind,
        center: toWorld(o.center),
        widthU: o.widthPx,
        hinge: toWorld(o.hinge),
        swingToward: toWorld(o.swingToward),
      });
    }
    for (const f of sheetX.extraction.fixtures) {
      fixtures.push({
        kind: f.kind,
        cx: f.x + f.w / 2 + off.x,
        cy: f.y + f.h / 2 + off.y,
        w: f.w,
        h: f.h,
        rotationDeg: f.rotationDeg,
      });
    }
  }

  /* de-duplicate stacked zones, then pull near-touching neighbours together
     so the welded envelope comes out contiguous */
  const mmPerUnit = floor.scaleMmPerUnit ?? SIMPLE_PLAN.FALLBACK_MM_PER_UNIT;
  const cleaned = stitchSpaces(
    dropOverlappingSpaces(spaces, issues, (s) => s.name || "unnamed space"),
    AI_WELD_TOL_MM / mmPerUnit
  );

  const model = buildSimplePlanCore(cleaned, floor.scaleMmPerUnit, {
    weldTolMm: AI_WELD_TOL_MM,
  });

  /* snap openings onto the derived walls */
  const snapU = OPENING_SNAP_MM / mmPerUnit;
  const openings: SimplePlanOpening[] = [];
  for (const o of rawOpenings) {
    let best: { wall: (typeof model.walls)[number]; at: Point; d: number } | null =
      null;
    for (const wall of model.walls) {
      const len = dist(wall.a, wall.b);
      if (len < 1e-6) continue;
      const dir = {
        x: (wall.b.x - wall.a.x) / len,
        y: (wall.b.y - wall.a.y) / len,
      };
      const t = clamp(
        (o.center.x - wall.a.x) * dir.x + (o.center.y - wall.a.y) * dir.y,
        0,
        len
      );
      const at = { x: wall.a.x + dir.x * t, y: wall.a.y + dir.y * t };
      const d = dist(o.center, at);
      if (!best || d < best.d) best = { wall, at, d };
    }
    if (!best || best.d > snapU) {
      issues.push(`Dropped a ${o.kind} — no wall within reach of it`);
      continue;
    }
    const wall = best.wall;
    const len = dist(wall.a, wall.b);
    const dir = { x: (wall.b.x - wall.a.x) / len, y: (wall.b.y - wall.a.y) / len };
    const tAt = (best.at.x - wall.a.x) * dir.x + (best.at.y - wall.a.y) * dir.y;
    const half = Math.min(o.widthU / 2, len / 2);
    const t0 = clamp(tAt - half, 0, len);
    const t1 = clamp(tAt + half, 0, len);
    if (t1 - t0 < 1e-3) {
      issues.push(`Dropped a ${o.kind} — zero-width after snapping`);
      continue;
    }
    const a = { x: wall.a.x + dir.x * t0, y: wall.a.y + dir.y * t0 };
    const b = { x: wall.a.x + dir.x * t1, y: wall.a.y + dir.y * t1 };

    let leaf: SimplePlanOpening["leaf"] = null;
    const hinged =
      (o.kind === "door" || o.kind === "double-door") &&
      dist(o.hinge, o.center) > 1e-6 &&
      dist(o.swingToward, o.center) > 1e-6;
    if (hinged) {
      // hinge sits on whichever gap end is closer to the reported hinge; the
      // leaf opens perpendicular to the wall, toward the reported swing side
      const hinge = dist(o.hinge, a) <= dist(o.hinge, b) ? a : b;
      const n = { x: -dir.y, y: dir.x };
      const side =
        (o.swingToward.x - hinge.x) * n.x + (o.swingToward.y - hinge.y) * n.y >= 0
          ? 1
          : -1;
      const w = t1 - t0;
      leaf = {
        hinge,
        free: { x: hinge.x + n.x * w * side, y: hinge.y + n.y * w * side },
      };
    }
    openings.push({ kind: o.kind, a, b, thicknessU: wall.thicknessU, leaf });
  }

  return {
    ...model,
    openings,
    fixtures,
    issues: [...issues, ...model.issues],
  };
}
