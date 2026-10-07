/* Design Studio — plans pipeline (client side).
   PDFs are rasterised in the browser with pdf.js (npm dep, workers bundled);
   each selected page uploads to Supabase Storage via a signed URL and the
   design document stores only the ref + natural size. Pages come in named
   "Page 1", "Page 2"… — floor names are set by the installer in the naming
   step (an AI screening pass will pre-fill them later). Raster path is
   browser-only; the floor-mapping helpers are pure + unit-tested. */

import { newId, type DesignDocument, type Floor, type PlanSheet, type Point } from "./document";
import { trimBorders, type TrimRect } from "./plan-trim";

/** A rasterised candidate floor plan (one PDF page or one uploaded image).
    `blob`/`ext` are present for freshly rendered pages (they feed the upload);
    a page rehydrated from a stored session has neither — it is already uploaded,
    so it carries only its `ref`. `ref` is set once a page has been stored. */
export interface PageImage {
  pageNumber: number | null; // null when it came from a plain image file
  label: string;
  blob?: Blob;
  ext?: "png" | "jpeg";
  thumbUrl: string; // object URL (fresh) or signed storage URL (rehydrated)
  width: number;
  height: number;
  ref?: string; // storage ref, once uploaded / when restored
  /** the raster inside its one-colour margins (plan-trim.ts), when it has
      any worth cutting — becomes the sheet's crop */
  trim?: TrimRect;
}

/** Number every candidate page "Page 1", "Page 2"… by combined order, so a
    mixed / multi-file upload reads sequentially with no collisions. */
export function labelPagesSequentially(pages: PageImage[]): void {
  pages.forEach((p, i) => {
    p.label = `Page ${i + 1}`;
  });
}

/* ── Pure: uploaded pages → sheets on floors ──
   A floor is one world space that can hold several plan sheets (a big level
   split across east/west drawings). Allocation is by floor NAME: pages given
   the same name land on the same floor; a name matching an existing floor
   adds sheets to it; anything else becomes a new floor. */

export interface UploadedSheet {
  label: string;
  ref: string;
  pageNumber: number | null;
  width: number;
  height: number;
  /** the page's trimmed margins, as the sheet's starting crop */
  crop?: TrimRect;
}

const SHEET_GAP = 60; // world units between auto-placed sheets

/** Place new sheets to the right of whatever the floor already holds; the
    user drags them into true alignment with the arrange tool afterwards. */
export function placeSheets(
  existing: PlanSheet[],
  sheets: UploadedSheet[]
): PlanSheet[] {
  let cursor = existing.reduce((m, s) => Math.max(m, s.x + s.width), 0);
  return sheets.map((s) => {
    const x = cursor === 0 ? 0 : cursor + SHEET_GAP;
    cursor = x + s.width;
    return {
      id: newId("sht"),
      imageRef: s.ref,
      pageNumber: s.pageNumber,
      name: s.label,
      width: s.width,
      height: s.height,
      x,
      y: 0,
      /* a page arrives cropped to its drawing: the empty margins round it —
         a screenshot's viewer bars above all — would otherwise frame the
         sheet on paper and size every word on it */
      ...(s.crop ? { crop: { ...s.crop } } : {}),
    };
  });
}

/* ── The floor-stack builder ──
   Allocation is spatial, not textual: rows read like the building, and
   LEVELS DERIVE FROM STACK POSITION — never typed. The first plan placed on
   a fresh design becomes the ANCHOR: its level is chosen from a dropdown
   (ground floor by default) and every other plan numbers relative to its
   position around it. Designs with existing floors anchor on their lowest
   floor instead. Pure functions here; the panel is a thin renderer. */

export interface BuilderRow {
  key: string;
  /** existing floor receiving sheets, or null for a new floor */
  floorId: string | null;
  /** stored level of the existing floor (anchors renumbering) */
  level?: number;
  /** fresh designs: the first-placed row carries the user-chosen level */
  anchorLevel?: number;
  name: string;
  pageIdxs: number[];
}

export const formatLevel = (n: number): string =>
  n < 0 ? `B${-n}` : n === 0 ? "GF" : `L${n}`;

/** A floor's default NAME from its stack position (level) — matches the blank-
    floor naming in studio.tsx. Used when the installer didn't type a custom
    name, so an un-named floor reads as its position ("Ground floor"), never the
    source plan's page label ("Page 6"). */
export const defaultFloorName = (level: number): string =>
  level < 0 ? `Basement ${-level}` : level === 0 ? "Ground floor" : `Level ${level}`;

/** Display label for a floor. A floor is a stack position, not a drawing, so a
    floor still carrying a raw page label ("Page 6") — from designs built before
    floors defaulted to their stack name — reads as its position instead. Custom
    names the installer typed are left untouched. Used by the canvas floor
    switcher and anywhere a floor is *shown* (not edited). */
export const floorDisplayName = (floor: { name: string; level: number }): string => {
  const name = floor.name.trim();
  return !name || /^page \d+$/i.test(name) ? defaultFloorName(floor.level) : name;
};

/** Re-open-the-stacker reorder: reassign the EXISTING set of levels to floors
    in a new top-to-bottom order. The level set is preserved (e.g. {-1,0,1}); only
    which floor sits at which level changes. `orderTopFirst` = floor ids from the
    top (highest level) down to the bottom. */
export function restackLevels(floors: Floor[], orderTopFirst: string[]): Floor[] {
  const byId = new Map(floors.map((f) => [f.id, f]));
  const ordered = orderTopFirst
    .map((id) => byId.get(id))
    .filter((f): f is Floor => f !== undefined);
  const levelsAsc = ordered.map((f) => f.level).sort((a, b) => a - b);
  // the bottom floor (last in top-first order) takes the lowest level
  const bottomUp = [...ordered].reverse();
  const levelFor = new Map(bottomUp.map((f, i) => [f.id, levelsAsc[i]]));
  return floors.map((f) =>
    levelFor.has(f.id) ? { ...f, level: levelFor.get(f.id)! } : f
  );
}

/** The initial stack: existing floors as fixed rows; a fresh design starts
    empty. Selected pages start unplaced in the tray. */
export function builderStackFromFloors(floors: Floor[]): BuilderRow[] {
  return [...floors]
    .sort((a, b) => a.level - b.level)
    .map((f) => ({
      key: `ex_${f.id}`,
      floorId: f.id,
      level: f.level,
      name: f.name,
      pageIdxs: [],
    }));
}

/** Rebuild the stacker from committed floors when re-entering a saved import.
    Same as builderStackFromFloors, but each floor row is re-populated with the
    page indices of the sheets it holds — matched by storage ref — so the yard
    shows every floor with its plan card(s) exactly where they were left. Pages
    not on any floor fall through to the tray (via trayPageIdxs).
    A page sits in ONE row (every row operation and card key assumes it), so a
    page that two floors share — a split plan — shows on the first floor that
    holds it; the sibling's row is empty, which re-committing leaves alone. */
export function builderRowsFromFloors(floors: Floor[], pages: PageImage[]): BuilderRow[] {
  const idxByRef = new Map<string, number>();
  pages.forEach((p, i) => {
    if (p.ref) idxByRef.set(p.ref, i);
  });
  const claimed = new Set<number>();
  return [...floors]
    .sort((a, b) => a.level - b.level)
    .map((f) => {
      const pageIdxs: number[] = [];
      for (const s of f.plans) {
        const i = idxByRef.get(s.imageRef);
        if (i === undefined || claimed.has(i)) continue;
        claimed.add(i);
        pageIdxs.push(i);
      }
      return { key: `ex_${f.id}`, floorId: f.id, level: f.level, name: f.name, pageIdxs };
    });
}

/** Storage refs that deleting `floorId` leaves with no sheet anywhere. A split
    plan puts one image on two floors, so a floor's refs are only safe to delete
    when no OTHER floor still shows them. */
export function orphanedRefs(floors: Floor[], floorId: string): string[] {
  const held = new Set(
    floors.filter((f) => f.id !== floorId).flatMap((f) => f.plans.map((s) => s.imageRef))
  );
  const gone = floors.find((f) => f.id === floorId)?.plans ?? [];
  return [...new Set(gone.map((s) => s.imageRef))].filter((ref) => !held.has(ref));
}

/* ── Splitting one page into two floors ──
   A plan page that holds two levels becomes two floors that show the SAME
   image (same ref, position and size) through different areas, so world
   coordinates and the scale stay valid on both and nothing is re-uploaded. The
   installer draws BOTH areas — guessing "the rest of the page" is wrong the
   moment the other floor isn't a clean strip. An area is a rectangle or a
   freeform outline; the sheet's `crop` is its bounding box and `shape` (when
   freeform) is the outline the image is clipped to. */

export interface SheetRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** An area drawn on a sheet, in the sheet's own coordinates. */
export interface SheetRegion {
  rect: SheetRect;
  /** the outline, when the area is freeform; `rect` is then its bounding box */
  shape?: Point[];
}

/** Smaller than this (world units) is a stray click, not an area. */
const MIN_AREA_SIDE = 4;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** A dragged rectangle as an area, clamped to the page. */
export function regionFromRect(
  rect: SheetRect,
  page: { w: number; h: number }
): SheetRegion | null {
  const x0 = clamp(rect.x, 0, page.w);
  const y0 = clamp(rect.y, 0, page.h);
  const x1 = clamp(rect.x + rect.w, 0, page.w);
  const y1 = clamp(rect.y + rect.h, 0, page.h);
  return x1 - x0 > MIN_AREA_SIDE && y1 - y0 > MIN_AREA_SIDE
    ? { rect: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } }
    : null;
}

/** Clicked corners as an area, clamped to the page. Needs three corners that
    enclose something — a line of points is not an area. */
export function regionFromPoints(
  points: Point[],
  page: { w: number; h: number }
): SheetRegion | null {
  if (points.length < 3) return null;
  const shape = points.map((p) => ({ x: clamp(p.x, 0, page.w), y: clamp(p.y, 0, page.h) }));
  const xs = shape.map((p) => p.x);
  const ys = shape.map((p) => p.y);
  const x0 = Math.min(...xs);
  const y0 = Math.min(...ys);
  const w = Math.max(...xs) - x0;
  const h = Math.max(...ys) - y0;
  if (w <= MIN_AREA_SIDE || h <= MIN_AREA_SIDE) return null;
  let twice = 0; // shoelace: twice the enclosed area
  for (let i = 0; i < shape.length; i++) {
    const a = shape[i];
    const b = shape[(i + 1) % shape.length];
    twice += a.x * b.y - b.x * a.y;
  }
  if (Math.abs(twice) / 2 <= MIN_AREA_SIDE * MIN_AREA_SIDE) return null;
  return { rect: { x: x0, y: y0, w, h }, shape };
}

/** The corners of an area: its outline, or its rectangle's four corners. */
export function regionOutline(region: SheetRegion): Point[] {
  const { x, y, w, h } = region.rect;
  return (
    region.shape ?? [
      { x, y },
      { x: x + w, y },
      { x: x + w, y: y + h },
      { x, y: y + h },
    ]
  );
}

/** The sheet showing only this area. A rectangle clears any earlier outline. */
export function withRegion(sheet: PlanSheet, region: SheetRegion): PlanSheet {
  const next: PlanSheet = { ...sheet, crop: region.rect };
  if (region.shape) next.shape = region.shape;
  else delete next.shape;
  return next;
}

/** Refs on `floor` that another floor also shows — the page was split. The
    canvas fades the part of such a page that belongs to the other floor. */
export function sharedPlanRefs(floors: Floor[], floorId: string): Set<string> {
  const others = new Set(
    floors.filter((f) => f.id !== floorId).flatMap((f) => f.plans.map((s) => s.imageRef))
  );
  const mine = floors.find((f) => f.id === floorId)?.plans ?? [];
  return new Set(mine.map((s) => s.imageRef).filter((r) => others.has(r)));
}

export interface SplitSheetOpts {
  floorId: string;
  sheetId: string;
  /** the area this floor keeps */
  keep: SheetRegion;
  /** the area that becomes the new floor, stacked above or below this one */
  other: SheetRegion;
  place: "above" | "below";
  newFloorId: string;
  newSheetId: string;
}

/** Keep `keep` on this floor and give `other` to a new floor. One document
    change, so it is one undo step. Rooms, units and pipework already drawn stay
    where they are. */
export function splitFloorOffSheet(doc: DesignDocument, o: SplitSheetOpts): DesignDocument {
  const floor = doc.floors.find((f) => f.id === o.floorId);
  const sheet = floor?.plans.find((s) => s.id === o.sheetId);
  if (!floor || !sheet) return doc;

  const newLevel = o.place === "above" ? floor.level + 1 : floor.level;
  // open the slot: this floor (when going below) and everything above it moves
  // up one. A floor still wearing its position's default name follows it, so
  // "Ground floor" never ends up sitting at level 1.
  const floors = doc.floors.map((f) => {
    if (f.level < newLevel) return f;
    const level = f.level + 1;
    return {
      ...f,
      level,
      name: f.name === defaultFloorName(f.level) ? defaultFloorName(level) : f.name,
    };
  });

  // the north arrow goes with the floor whose area it sits in
  const np = floor.northPos;
  const r = o.other.rect;
  const northInOther =
    np !== null &&
    np.x >= sheet.x + r.x &&
    np.x <= sheet.x + r.x + r.w &&
    np.y >= sheet.y + r.y &&
    np.y <= sheet.y + r.y + r.h;

  const newFloor: Floor = {
    id: o.newFloorId,
    name: defaultFloorName(newLevel),
    level: newLevel,
    ...(floor.heightM !== undefined ? { heightM: floor.heightM } : {}),
    scaleMmPerUnit: floor.scaleMmPerUnit,
    northDeg: floor.northDeg,
    northPos: northInOther ? np : null,
    plans: [withRegion({ ...sheet, id: o.newSheetId }, o.other)],
  };

  return {
    ...doc,
    floors: [
      ...floors.map((f) =>
        f.id === floor.id
          ? { ...f, plans: f.plans.map((s) => (s.id === sheet.id ? withRegion(s, o.keep) : s)) }
          : f
      ),
      newFloor,
    ],
  };
}

/** Selected page indices not yet placed on any floor — i.e. the tray. */
export function trayPageIdxs(rows: BuilderRow[], chosen: number[]): number[] {
  const placed = new Set(rows.flatMap((r) => r.pageIdxs));
  return chosen.filter((i) => !placed.has(i));
}

/** Position → level for every row (bottom-up input). The anchor is the
    lowest existing floor, or the row carrying anchorLevel on fresh designs. */
export function computeRowLevels(rows: BuilderRow[]): Map<string, number> {
  let anchorPos = 0;
  let anchorLevel = 0;
  let best = -1;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (r.floorId !== null && (best < 0 || (r.level ?? 0) < (rows[best].level ?? 0))) best = i;
  }
  if (best >= 0) {
    anchorPos = best;
    anchorLevel = rows[best].level ?? 0;
  } else {
    const a = rows.findIndex((r) => r.anchorLevel !== undefined);
    if (a >= 0) {
      anchorPos = a;
      anchorLevel = rows[a].anchorLevel!;
    }
  }
  const levels = new Map<string, number>();
  rows.forEach((r, p) => levels.set(r.key, anchorLevel + (p - anchorPos)));
  return levels;
}

/** Empty NEW rows vanish; existing floors always stay. If the anchor row
    vanished, the lowest surviving new row inherits its computed level so the
    rest of the stack doesn't jump. */
function pruneRows(rows: BuilderRow[]): BuilderRow[] {
  const levels = computeRowLevels(rows);
  const kept = rows.filter((r) => r.floorId !== null || r.pageIdxs.length > 0);
  const hasAnchor =
    kept.some((r) => r.floorId !== null) ||
    kept.some((r) => r.anchorLevel !== undefined);
  if (!hasAnchor && kept.length > 0) {
    return kept.map((r, i) =>
      i === 0 ? { ...r, anchorLevel: levels.get(r.key) ?? 0 } : r
    );
  }
  return kept;
}

const isMovable = (r: BuilderRow | undefined) =>
  r !== undefined && r.floorId === null;

/** Fresh designs: re-pin the anchor row's level (the dropdown). */
export function setAnchorLevel(rows: BuilderRow[], key: string, level: number): BuilderRow[] {
  return rows.map((r) =>
    r.key === key
      ? { ...r, anchorLevel: level }
      : r.anchorLevel !== undefined
        ? { ...r, anchorLevel: undefined }
        : r
  );
}

/** Insert a page as a NEW floor. anchorKey null = the first drop on an empty
    stack (becomes the anchor at ground level). Otherwise the page lands
    directly above/below the anchor row; the page is first pulled from
    wherever it was (tray or another floor). */
export function insertPageRow(
  rows: BuilderRow[],
  pageIdx: number,
  name: string,
  anchorKey: string | null,
  side: "above" | "below"
): BuilderRow[] {
  const fresh: BuilderRow = {
    key: `new_${pageIdx}_${rows.length}`,
    floorId: null,
    name,
    pageIdxs: [pageIdx],
  };
  if (anchorKey === null) {
    if (rows.some((r) => r.floorId !== null || r.pageIdxs.length > 0)) return rows;
    return [{ ...fresh, anchorLevel: 0 }];
  }
  const cleared = pruneRows(
    rows.map((r) => ({ ...r, pageIdxs: r.pageIdxs.filter((i) => i !== pageIdx) }))
  );
  const anchorIdx = cleared.findIndex((r) => r.key === anchorKey);
  if (anchorIdx < 0) return rows;
  const next = [...cleared];
  next.splice(side === "above" ? anchorIdx + 1 : anchorIdx, 0, fresh);
  return next;
}

/** What level would a drop at this slot produce? Drives the live drop-zone
    chips while dragging. */
export function previewInsertLevel(
  rows: BuilderRow[],
  anchorKey: string | null,
  side: "above" | "below"
): number {
  const sim = insertPageRow(rows, -1, "", anchorKey, side);
  const row = sim.find((r) => r.pageIdxs.includes(-1));
  if (!row) return 0;
  return computeRowLevels(sim).get(row.key) ?? 0;
}

/** Move a placed row so it lands directly above/below the anchor row. */
export function dropRowAt(
  rows: BuilderRow[],
  key: string,
  anchorKey: string,
  side: "above" | "below"
): BuilderRow[] {
  if (key === anchorKey) return rows;
  const row = rows.find((r) => r.key === key);
  if (!isMovable(row)) return rows;
  const without = rows.filter((r) => r.key !== key);
  const t = without.findIndex((r) => r.key === anchorKey);
  if (t < 0) return rows;
  const next = [...without];
  next.splice(side === "above" ? t + 1 : t, 0, row!);
  return next;
}

/** Merge a page onto a floor row as a second sheet (east/west split). */
export function dropPageOnRow(
  rows: BuilderRow[],
  pageIdx: number,
  targetKey: string
): BuilderRow[] {
  const target = rows.find((r) => r.key === targetKey);
  if (!target) return rows;
  return pruneRows(
    rows.map((r) => ({
      ...r,
      pageIdxs:
        r.key === targetKey
          ? [...r.pageIdxs.filter((i) => i !== pageIdx), pageIdx]
          : r.pageIdxs.filter((i) => i !== pageIdx),
    }))
  );
}

/** Pull a page back off the stack (into the tray) / out of the import. */
export function removePageFromRows(rows: BuilderRow[], pageIdx: number): BuilderRow[] {
  return pruneRows(
    rows.map((r) => ({ ...r, pageIdxs: r.pageIdxs.filter((i) => i !== pageIdx) }))
  );
}

/** Commit the stack: prune empty new rows, derive levels from the final
    order (existing floors renumber too — mezzanines/basements included),
    create/extend floors bottom-up. */
export function applyBuilderRows(
  rows: BuilderRow[],
  uploads: Map<number, UploadedSheet>,
  floors: Floor[]
): Floor[] {
  const pruned = rows.filter(
    (r) => r.floorId !== null || r.pageIdxs.some((i) => uploads.has(i))
  );
  const levels = computeRowLevels(pruned);
  const result: Floor[] = [];
  for (const row of pruned) {
    const level = levels.get(row.key) ?? 0;
    const sheets = row.pageIdxs
      .map((i) => uploads.get(i))
      .filter((s): s is UploadedSheet => s !== undefined);
    if (row.floorId) {
      const f = floors.find((x) => x.id === row.floorId);
      if (!f) continue;
      // only add sheets the floor doesn't already hold — re-committing a
      // rehydrated stack (whose existing-floor rows list their current sheets)
      // must be idempotent, not duplicate every sheet each time
      const have = new Set(f.plans.map((s) => s.imageRef));
      const fresh = sheets.filter((s) => !have.has(s.ref));
      result.push({
        ...f,
        level,
        plans: fresh.length ? [...f.plans, ...placeSheets(f.plans, fresh)] : f.plans,
      });
    } else {
      if (sheets.length === 0) continue;
      result.push({
        id: newId("flr"),
        // stack position by default — NOT the plan's page label
        name: row.name.trim() || defaultFloorName(level),
        level,
        scaleMmPerUnit: null, // plans must be calibrated before sizes are real
        northDeg: null,
        northPos: null,
        plans: placeSheets([], sheets),
      });
    }
  }
  return result;
}

/* ── Browser-only: rasterisation ── */

const MAX_RENDER_WIDTH = 2400;

/** a drawn page's empty margins, or nothing — never a failed import: a canvas
    that can't be read back (a test DOM, a tainted or oversized one) simply
    leaves the page uncropped */
function trimOf(ctx: CanvasRenderingContext2D | null, w: number, h: number): TrimRect | undefined {
  if (!ctx) return undefined;
  try {
    return trimBorders(ctx.getImageData(0, 0, w, h).data, w, h) ?? undefined;
  } catch {
    return undefined;
  }
}

export async function pdfToPages(
  file: File,
  onProgress?: (done: number, total: number) => void
): Promise<PageImage[]> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/build/pdf.worker.min.mjs",
    import.meta.url
  ).toString();

  const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  const pages: PageImage[] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const base = page.getViewport({ scale: 1 });
    const scale = Math.min(Math.max(MAX_RENDER_WIDTH / base.width, 1), 3);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    const ctx = canvas.getContext("2d")!;
    await page.render({ canvas, canvasContext: ctx, viewport }).promise;
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("render failed"))), "image/png")
    );
    const trim = trimOf(ctx, canvas.width, canvas.height);
    pages.push({
      pageNumber: n,
      label: `Page ${n}`, // real floor names are set in the naming step
      blob,
      ext: "png",
      thumbUrl: URL.createObjectURL(blob),
      width: canvas.width,
      height: canvas.height,
      ...(trim ? { trim } : {}),
    });
    onProgress?.(n, doc.numPages);
  }
  return pages;
}

export async function imageToPage(file: File): Promise<PageImage> {
  const bmp = await createImageBitmap(file);
  const ext = file.type === "image/jpeg" ? "jpeg" : "png";
  const canvas = document.createElement("canvas");
  canvas.width = bmp.width;
  canvas.height = bmp.height;
  const ctx = canvas.getContext("2d");
  ctx?.drawImage(bmp, 0, 0);
  const trim = trimOf(ctx, bmp.width, bmp.height);
  return {
    pageNumber: null,
    label: "Page 1", // relabelled by combined order when several files land
    blob: file,
    ext,
    thumbUrl: URL.createObjectURL(file),
    width: bmp.width,
    height: bmp.height,
    ...(trim ? { trim } : {}),
  };
}

/** A raster's trim, in its own pixels, with the size it was measured at. */
export interface PixelTrim extends TrimRect {
  naturalW: number;
  naturalH: number;
}

/** A stored sheet's empty margins, read off its raster — for the sheets that
    were placed before a page was trimmed at import, so their paper frames the
    drawing too. Null whenever the pixels cannot be had (a raster served
    without CORS taints the canvas; a slow one times out), and the caller then
    prints the sheet exactly as it is. */
export function trimOfImageUrl(url: string, timeoutMs = 8000): Promise<PixelTrim | null> {
  return new Promise((resolve) => {
    let done = false;
    let timer = 0;
    const finish = (t: PixelTrim | null) => {
      if (done) return;
      done = true;
      window.clearTimeout(timer);
      resolve(t);
    };
    timer = window.setTimeout(() => finish(null), timeoutMs);
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const w = img.naturalWidth;
      const h = img.naturalHeight;
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      ctx?.drawImage(img, 0, 0);
      const t = trimOf(ctx, w, h);
      finish(t ? { ...t, naturalW: w, naturalH: h } : null);
    };
    img.onerror = () => finish(null);
    img.src = url;
  });
}

/** A floor as it PRINTS: every sheet nobody has cropped takes its raster's
    trim as its crop, scaled from raster pixels to the sheet's world units. A
    crop or a shape somebody set by hand always wins — the trim only stands in
    for one that was never made. */
export function withPrintTrims(floor: Floor, trims: Record<string, PixelTrim>): Floor {
  let changed = false;
  const plans = floor.plans.map((s) => {
    const t = trims[s.imageRef];
    if (!t || s.crop || s.shape || !s.width || !s.height) return s;
    changed = true;
    const kx = s.width / t.naturalW;
    const ky = s.height / t.naturalH;
    return { ...s, crop: { x: t.x * kx, y: t.y * ky, w: t.w * kx, h: t.h * ky } };
  });
  return changed ? { ...floor, plans } : floor;
}

/* ── Storage seam (injectable for tests, like DesignStore) ── */

export interface PlanImages {
  upload(page: PageImage): Promise<string>; // rendered page → ref (canvas image)
  uploadSource(file: File): Promise<string>; // original file → ref (re-rasterised)
  sourceFile(ref: string): Promise<File>; // fetch a stored source back for re-render
  url(ref: string): Promise<string>;
  remove(ref: string): Promise<void>;
}

/* ── plan raster cache ──────────────────────────────────────────────────────
   Opening a design re-downloaded every plan sheet in full — a 2400px-wide PNG
   per sheet — which is why the tool appeared first and the plan eased in after
   it. The browser's own cache could never help: each open SIGNS A NEW URL, so
   the raster arrived at a URL string it had never seen before.

   A ref's bytes never change (a re-upload mints a new ref), so they cache
   forever, keyed by ref rather than by the URL of the day. Second and later
   opens paint from disk with no network at all, offline included.

   Everything here degrades to today's behaviour: no Cache Storage (or an
   insecure context, or a quota refusal) simply means the signed URL is used
   directly. Cache misses do the same — the caller gets the signed URL straight
   away so the image starts streaming, and the cache warms behind it. */
const PLAN_CACHE = "heytiff-plan-rasters-v1";
/** synthetic key — never fetched, it just names the entry */
const cacheKey = (ref: string) => `/__plan-raster/${encodeURIComponent(ref)}`;

async function planCache(): Promise<Cache | null> {
  if (typeof caches === "undefined") return null;
  try {
    return await caches.open(PLAN_CACHE);
  } catch {
    return null; // private mode / storage disabled
  }
}

export class RemotePlanImages implements PlanImages {
  private urls = new Map<string, { url: string; expires: number }>();
  /** ref → object URL for a cached raster (one per ref, so it can be revoked) */
  private objectUrls = new Map<string, string>();
  private warming = new Set<string>();

  /** hand back a cached raster as an object URL, or null if it isn't cached */
  private async cached(ref: string): Promise<string | null> {
    const held = this.objectUrls.get(ref);
    if (held) return held;
    const cache = await planCache();
    if (!cache) return null;
    try {
      const hit = await cache.match(cacheKey(ref));
      if (!hit) return null;
      const url = URL.createObjectURL(await hit.blob());
      this.objectUrls.set(ref, url);
      return url;
    } catch {
      return null;
    }
  }

  /** pull the raster into the cache behind the image that is already loading */
  private warm(ref: string, signed: string): void {
    if (this.warming.has(ref)) return;
    this.warming.add(ref);
    void (async () => {
      try {
        const cache = await planCache();
        if (!cache) return;
        // same URL the <image> is fetching, so this usually costs nothing:
        // the browser serves it from its own cache
        const res = await fetch(signed);
        if (res.ok) await cache.put(cacheKey(ref), res);
      } catch {
        /* offline, quota, expired ref — the plan still draws from the URL */
      } finally {
        this.warming.delete(ref);
      }
    })();
  }

  /** drop a ref's cached bytes (its object is gone, or is being replaced) */
  private async evict(ref: string): Promise<void> {
    const held = this.objectUrls.get(ref);
    if (held) {
      URL.revokeObjectURL(held);
      this.objectUrls.delete(ref);
    }
    const cache = await planCache();
    await cache?.delete(cacheKey(ref)).catch(() => {});
  }

  async upload(page: PageImage): Promise<string> {
    if (!page.blob || !page.ext) {
      // a rehydrated page is already stored — it should never be re-uploaded
      throw new Error("cannot upload a page with no image data");
    }
    const [{ createPlanUpload }, { supabaseBrowser }] = await Promise.all([
      import("@/app/actions/studio-plans"),
      import("@/lib/supabase-browser"),
    ]);
    const { ref, token } = await createPlanUpload(page.ext);
    const { error } = await supabaseBrowser()
      .storage.from("studio-plans")
      .uploadToSignedUrl(ref, token, page.blob, {
        contentType: `image/${page.ext}`,
      });
    if (error) throw new Error(error.message);
    return ref;
  }

  async uploadSource(file: File): Promise<string> {
    const ext =
      file.type === "application/pdf"
        ? "pdf"
        : file.type === "image/jpeg"
          ? "jpeg"
          : "png";
    const [{ createPlanUpload }, { supabaseBrowser }] = await Promise.all([
      import("@/app/actions/studio-plans"),
      import("@/lib/supabase-browser"),
    ]);
    const { ref, token } = await createPlanUpload(ext);
    const { error } = await supabaseBrowser()
      .storage.from("studio-plans")
      .uploadToSignedUrl(ref, token, file, { contentType: file.type });
    if (error) throw new Error(error.message);
    return ref;
  }

  async sourceFile(ref: string): Promise<File> {
    const res = await fetch(await this.url(ref));
    if (!res.ok) throw new Error(`Could not fetch source ${ref}`);
    const blob = await res.blob();
    return new File([blob], ref, { type: blob.type });
  }

  async url(ref: string): Promise<string> {
    // cached bytes beat any URL: no signing round trip, no download
    const local = await this.cached(ref);
    if (local) return local;
    const signed = await this.signed(ref);
    this.warm(ref, signed);
    return signed;
  }

  /** a signed URL for the ref, reusing one until it is close to expiring */
  private async signed(ref: string): Promise<string> {
    const hit = this.urls.get(ref);
    if (hit && hit.expires > Date.now()) return hit.url;
    const { planImageUrl } = await import("@/app/actions/studio-plans");
    const url = await planImageUrl(ref);
    this.urls.set(ref, { url, expires: Date.now() + 50 * 60 * 1000 });
    return url;
  }

  async remove(ref: string): Promise<void> {
    const { deletePlanImage } = await import("@/app/actions/studio-plans");
    await deletePlanImage(ref);
    await this.evict(ref);
    this.urls.delete(ref);
  }
}
