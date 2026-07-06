/* Design Studio — plans pipeline (client side).
   PDFs are rasterised in the browser with pdf.js (npm dep, workers bundled);
   each selected page uploads to Supabase Storage via a signed URL and the
   design document stores only the ref + natural size. Pages come in named
   "Page 1", "Page 2"… — floor names are set by the installer in the naming
   step (an AI screening pass will pre-fill them later). Raster path is
   browser-only; the floor-mapping helpers are pure + unit-tested. */

import { newId, type Floor, type PlanSheet } from "./document";

/** A rasterised candidate floor plan (one PDF page or one uploaded image). */
export interface PageImage {
  pageNumber: number | null; // null when it came from a plain image file
  label: string;
  blob: Blob;
  ext: "png" | "jpeg";
  thumbUrl: string; // object URL for the picker grid
  width: number;
  height: number;
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
   Allocation is spatial, not textual: rows read like the building, and the
   LEVELS DERIVE FROM STACK POSITION — never typed. Empty designs get a
   ground-line marker: rows above it are L0, L1…, rows dragged below it are
   subfloors (B1 nearest the line). Designs with floors anchor on their
   lowest existing floor instead, and the whole stack renumbers on commit,
   so basements below and mezzanines between existing floors both work.
   Pure functions here; the panel is a thin renderer. */

export interface BuilderRow {
  key: string;
  /** "ground" = the ground-line marker row (empty designs only) */
  kind: "floor" | "ground";
  /** existing floor receiving sheets, or null for a new floor */
  floorId: string | null;
  /** stored level of the existing floor (anchors renumbering) */
  level?: number;
  name: string;
  pageIdxs: number[];
}

export const formatLevel = (n: number): string =>
  n < 0 ? `B${-n}` : n === 0 ? "GF" : `L${n}`;

/** The initial stack: existing floors as fixed rows (or just the ground-line
    marker for a fresh design). Selected pages start unplaced in the tray. */
export function builderStackFromFloors(floors: Floor[]): BuilderRow[] {
  const existing = [...floors]
    .sort((a, b) => a.level - b.level)
    .map((f) => ({
      key: `ex_${f.id}`,
      kind: "floor" as const,
      floorId: f.id,
      level: f.level,
      name: f.name,
      pageIdxs: [],
    }));
  // Pages start UNPLACED (in the tray); the installer drags them into the
  // building yard, and stack position — not the name — sets each level.
  // A fresh design needs the ground-line marker so the first drop = ground
  // floor; a design with existing floors anchors on its lowest floor.
  return existing.length > 0
    ? existing
    : [{ key: "ground", kind: "ground" as const, floorId: null, name: "", pageIdxs: [] }];
}

/** Selected page indices not yet placed on any floor — i.e. the tray. */
export function trayPageIdxs(rows: BuilderRow[], chosen: number[]): number[] {
  const placed = new Set(rows.flatMap((r) => r.pageIdxs));
  return chosen.filter((i) => !placed.has(i));
}

/** Insert a page as a NEW floor directly above/below an anchor row. "above"
    means a higher level (later in the bottom-up array); "below" a lower one.
    Dropping above the ground marker makes the ground floor; below it, a
    subfloor. The page is first pulled from wherever it was (tray or a row). */
export function insertPageRow(
  rows: BuilderRow[],
  pageIdx: number,
  name: string,
  anchorKey: string,
  side: "above" | "below"
): BuilderRow[] {
  const cleared = pruneRows(
    rows.map((r) => ({ ...r, pageIdxs: r.pageIdxs.filter((i) => i !== pageIdx) }))
  );
  const anchorIdx = cleared.findIndex((r) => r.key === anchorKey);
  if (anchorIdx < 0) return rows;
  const next = [...cleared];
  next.splice(side === "above" ? anchorIdx + 1 : anchorIdx, 0, {
    key: `new_${pageIdx}_${rows.length}`,
    kind: "floor",
    floorId: null,
    name,
    pageIdxs: [pageIdx],
  });
  return next;
}

/** Position → level for every floor row (bottom-up input). */
export function computeRowLevels(rows: BuilderRow[]): Map<string, number> {
  const floorsOnly = rows.filter((r) => r.kind === "floor");
  const markerIdx = rows.findIndex((r) => r.kind === "ground");
  let anchorPos: number;
  let anchorLevel: number;
  if (markerIdx >= 0) {
    // rows below the marker are basements; first row above it is L0
    anchorPos = rows.slice(0, markerIdx).filter((r) => r.kind === "floor").length;
    anchorLevel = 0;
  } else {
    // lowest existing floor keeps its stored level; everything renumbers around it
    let best = -1;
    for (let i = 0; i < floorsOnly.length; i++) {
      const r = floorsOnly[i];
      if (r.floorId !== null && (best < 0 || (r.level ?? 0) < (floorsOnly[best].level ?? 0)))
        best = i;
    }
    anchorPos = Math.max(best, 0);
    anchorLevel = best >= 0 ? (floorsOnly[best].level ?? 0) : 0;
  }
  const levels = new Map<string, number>();
  floorsOnly.forEach((r, p) => levels.set(r.key, anchorLevel + (p - anchorPos)));
  return levels;
}

/** Empty NEW rows vanish; existing floors and the marker always stay. */
function pruneRows(rows: BuilderRow[]): BuilderRow[] {
  return rows.filter(
    (r) => r.kind === "ground" || r.floorId !== null || r.pageIdxs.length > 0
  );
}

const isMovable = (r: BuilderRow | undefined) =>
  r !== undefined && r.kind === "floor" && r.floorId === null;

/** Drop row `key` onto `targetKey`: it lands directly above the target —
    except the ground marker, where it lands directly below (top subfloor). */
export function dropRowOnRow(
  rows: BuilderRow[],
  key: string,
  targetKey: string
): BuilderRow[] {
  if (key === targetKey) return rows;
  const row = rows.find((r) => r.key === key);
  if (!isMovable(row)) return rows;
  const without = rows.filter((r) => r.key !== key);
  const t = without.findIndex((r) => r.key === targetKey);
  if (t < 0) return rows;
  const insertAt = without[t].kind === "ground" ? t : t + 1;
  const next = [...without];
  next.splice(insertAt, 0, row!);
  return next;
}

/** Drop a row on the top zone: it becomes the highest floor. */
export function dropRowOnTop(rows: BuilderRow[], key: string): BuilderRow[] {
  const row = rows.find((r) => r.key === key);
  if (!isMovable(row)) return rows;
  return [...rows.filter((r) => r.key !== key), row!];
}

/** Merge a page onto an existing floor row as a second sheet (east/west
    split). Ground / position drops go through insertPageRow instead. */
export function dropPageOnRow(
  rows: BuilderRow[],
  pageIdx: number,
  targetKey: string
): BuilderRow[] {
  const target = rows.find((r) => r.key === targetKey);
  if (!target || target.kind !== "floor") return rows;
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
    (r) =>
      r.kind === "ground" ||
      r.floorId !== null ||
      r.pageIdxs.some((i) => uploads.has(i))
  );
  const levels = computeRowLevels(pruned);
  const result: Floor[] = [];
  for (const row of pruned) {
    if (row.kind !== "floor") continue;
    const level = levels.get(row.key) ?? 0;
    const sheets = row.pageIdxs
      .map((i) => uploads.get(i))
      .filter((s): s is UploadedSheet => s !== undefined);
    if (row.floorId) {
      const f = floors.find((x) => x.id === row.floorId);
      if (!f) continue;
      result.push({
        ...f,
        level,
        plans: sheets.length ? [...f.plans, ...placeSheets(f.plans, sheets)] : f.plans,
      });
    } else {
      if (sheets.length === 0) continue;
      result.push({
        id: newId("flr"),
        name: row.name.trim() || sheets[0].label,
        level,
        scaleMmPerUnit: null, // plans must be calibrated before sizes are real
        northDeg: null,
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
  upload(page: PageImage): Promise<string>; // → ref stored in the document
  url(ref: string): Promise<string>;
  remove(ref: string): Promise<void>;
}

export class RemotePlanImages implements PlanImages {
  private urls = new Map<string, { url: string; expires: number }>();

  async upload(page: PageImage): Promise<string> {
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
