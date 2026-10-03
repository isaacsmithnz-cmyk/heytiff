/* Design Studio — plans pipeline (client side).
   PDFs are rasterised in the browser with pdf.js (npm dep, workers bundled);
   each selected page uploads to Supabase Storage via a signed URL and the
   design document stores only the ref + natural size. Pages come in named
   "Page 1", "Page 2"… — floor names are set by the installer in the naming
   step (an AI screening pass will pre-fill them later). Raster path is
   browser-only; the floor-mapping helpers are pure + unit-tested. */

import { newId, type DesignDocument, type Floor, type PlanSheet } from "./document";

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
   image (same ref, position and size) through different crops, so world
   coordinates and the scale stay valid on both and nothing is re-uploaded. */

export interface SheetRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Smaller than this (world units) is a stray click, not an area. */
const MIN_SPLIT_SIDE = 4;

/** What a sheet currently shows, relative to the sheet's own origin. `size` is
    for a legacy sheet that stores no natural size (the canvas measures it). */
export function sheetVisible(
  sheet: PlanSheet,
  size?: { w: number; h: number } | null
): SheetRect {
  return sheet.crop ?? { x: 0, y: 0, w: size?.w ?? sheet.width, h: size?.h ?? sheet.height };
}

export function intersectRect(a: SheetRect, b: SheetRect): SheetRect | null {
  const x0 = Math.max(a.x, b.x);
  const y0 = Math.max(a.y, b.y);
  const x1 = Math.min(a.x + a.w, b.x + b.w);
  const y1 = Math.min(a.y + a.h, b.y + b.h);
  return x1 - x0 > MIN_SPLIT_SIDE && y1 - y0 > MIN_SPLIT_SIDE
    ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
    : null;
}

/** The part of `visible` outside `keep`, as ONE rectangle: the largest of the
    four full-width / full-height strips around it. Two floors side by side or
    stacked on a page resolve exactly; an L-shaped remainder keeps its biggest
    arm and the new floor's margins are trimmed with Crop afterwards. */
export function restOfSheet(visible: SheetRect, keepIn: SheetRect): SheetRect | null {
  const keep = intersectRect(visible, keepIn);
  if (!keep) return null;
  const strips: SheetRect[] = [
    { x: visible.x, y: visible.y, w: keep.x - visible.x, h: visible.h }, // left
    { x: keep.x + keep.w, y: visible.y, w: visible.x + visible.w - (keep.x + keep.w), h: visible.h }, // right
    { x: visible.x, y: visible.y, w: visible.w, h: keep.y - visible.y }, // above
    { x: visible.x, y: keep.y + keep.h, w: visible.w, h: visible.y + visible.h - (keep.y + keep.h) }, // below
  ];
  let best: SheetRect | null = null;
  for (const s of strips) {
    if (s.w <= MIN_SPLIT_SIDE || s.h <= MIN_SPLIT_SIDE) continue;
    if (!best || s.w * s.h > best.w * best.h) best = s;
  }
  return best;
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
  /** the area to keep on this floor, relative to the sheet's origin */
  keep: SheetRect;
  /** the rest becomes a floor stacked above or below this one */
  place: "above" | "below";
  newFloorId: string;
  newSheetId: string;
  /** what the sheet shows now, when the caller measured a legacy sheet */
  visible?: SheetRect;
}

/** Keep `keep` on this floor and move the rest of the sheet to a new floor.
    One document change, so it is one undo step. Rooms, units and pipework
    already drawn stay where they are. Returns `doc` itself when nothing would
    be left over (the caller shows that). */
export function splitFloorOffSheet(doc: DesignDocument, o: SplitSheetOpts): DesignDocument {
  const floor = doc.floors.find((f) => f.id === o.floorId);
  const sheet = floor?.plans.find((s) => s.id === o.sheetId);
  if (!floor || !sheet) return doc;
  const visible = o.visible ?? sheetVisible(sheet);
  const keep = intersectRect(visible, o.keep);
  const rest = restOfSheet(visible, o.keep);
  if (!keep || !rest) return doc;

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

  // the north arrow belongs to whichever floor's part of the page it sits on
  const np = floor.northPos;
  const northInRest =
    np !== null &&
    np.x >= sheet.x + rest.x &&
    np.x <= sheet.x + rest.x + rest.w &&
    np.y >= sheet.y + rest.y &&
    np.y <= sheet.y + rest.y + rest.h;

  const newFloor: Floor = {
    id: o.newFloorId,
    name: defaultFloorName(newLevel),
    level: newLevel,
    ...(floor.heightM !== undefined ? { heightM: floor.heightM } : {}),
    scaleMmPerUnit: floor.scaleMmPerUnit,
    northDeg: floor.northDeg,
    northPos: northInRest ? np : null,
    plans: [{ ...sheet, id: o.newSheetId, crop: rest }],
  };

  return {
    ...doc,
    floors: [
      ...floors.map((f) =>
        f.id === floor.id
          ? { ...f, plans: f.plans.map((s) => (s.id === sheet.id ? { ...s, crop: keep } : s)) }
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
    pages.push({
      pageNumber: n,
      label: `Page ${n}`, // real floor names are set in the naming step
      blob,
      ext: "png",
      thumbUrl: URL.createObjectURL(blob),
      width: canvas.width,
      height: canvas.height,
    });
    onProgress?.(n, doc.numPages);
  }
  return pages;
}

export async function imageToPage(file: File): Promise<PageImage> {
  const bmp = await createImageBitmap(file);
  const ext = file.type === "image/jpeg" ? "jpeg" : "png";
  return {
    pageNumber: null,
    label: "Page 1", // relabelled by combined order when several files land
    blob: file,
    ext,
    thumbUrl: URL.createObjectURL(file),
    width: bmp.width,
    height: bmp.height,
  };
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
