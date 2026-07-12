/* Design Studio — plans pipeline (client side).
   PDFs are rasterised in the browser with pdf.js (npm dep, workers bundled);
   each selected page uploads to Supabase Storage via a signed URL and the
   design document stores only the ref + natural size. Pages come in named
   "Page 1", "Page 2"… — floor names are set by the installer in the naming
   step (an AI screening pass will pre-fill them later). Raster path is
   browser-only; the floor-mapping helpers are pure + unit-tested. */

import { newId, type Floor, type PlanSheet } from "./document";

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
    not on any floor fall through to the tray (via trayPageIdxs). */
export function builderRowsFromFloors(floors: Floor[], pages: PageImage[]): BuilderRow[] {
  const idxByRef = new Map<string, number>();
  pages.forEach((p, i) => {
    if (p.ref) idxByRef.set(p.ref, i);
  });
  return [...floors]
    .sort((a, b) => a.level - b.level)
    .map((f) => ({
      key: `ex_${f.id}`,
      floorId: f.id,
      level: f.level,
      name: f.name,
      pageIdxs: f.plans
        .map((s) => idxByRef.get(s.imageRef))
        .filter((i): i is number => i !== undefined),
    }));
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

export class RemotePlanImages implements PlanImages {
  private urls = new Map<string, { url: string; expires: number }>();

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
    this.urls.delete(ref);
  }
}
