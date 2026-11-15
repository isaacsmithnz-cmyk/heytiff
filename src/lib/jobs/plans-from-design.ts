/* A DESIGN'S PLANS ONTO ITS JOB (Isaac, 14 November 2026: "you won't have
   two sets of plans by accident. It's either getting added into the job card
   from the Design Studio or getting added into the Design Studio from the
   job card, but never both"; the mock "Designs from a job",
   https://claude.ai/artifact/61nqwanqUAtQx4iG6AxoYs, "Linking moves its
   plans onto the job": "The plan goes into the job's Plans with the read the
   design already has, so Tiff doesn't read it twice").

   A design started with no job keeps its own plans: the files dropped in
   (`planImport.sources`) and the pages placed on its floors. Linking it to a
   job makes each file one of the job's plans, the inverse of designFromPlan:
   its pages are the design's sheets (the same pictures, so the design and
   the job show one copy), each at its floor, and her reading moves from the
   design's floors and sheets onto the plan's pages. A file the design never
   kept (a design from before files were stored) goes on as the page's own
   picture.

   Pure: no I/O. The server side is plans-server.ts linkDesignPlans. */

import type { DesignDocument, Floor, PlanImportSource, PlanSheet } from "@/lib/studio/document";
import { suggestedRooms, type PlanReading, type SheetReading } from "@/lib/studio/reading";
import { andList } from "@/lib/swms/library";
import { pageKey, type JobPlanPage, type SetScale } from "./plans";

/** One of the design's sheets, as a page of the file it came from. */
export type DesignPage = { n: number; floor: Floor; sheet: PlanSheet; index: number | null };

/** One file of the design's, going on as one of the job's plans. */
export type DesignPlanGroup = {
  /** the file in the studio-plans bucket: the source dropped in, or the page's own picture */
  sourceRef: string;
  sourceKind: "pdf" | "image";
  /** its name in the job's Documents and Plans */
  name: string;
  /** its pages in the set, where known: a PDF's own count, else its last page used */
  pageCount: number;
  pages: DesignPage[];
};

const extOf = (ref: string, kind: "pdf" | "image") => (kind === "pdf" ? "pdf" : (ref.match(/\.(png|jpe?g|webp)$/i)?.[1] ?? "png").toLowerCase());

/** Where each file's pages start in the design's page order (`placed`'s
    index), given each file's page count; without counts, off the pages
    placed, which says it exactly when every file has a page placed. Null
    when it can't be told. */
export function sourceStarts(doc: Pick<DesignDocument, "floors" | "planImport">, counts?: readonly number[]): number[] | null {
  const sources = doc.planImport?.sources ?? [];
  if (sources.length === 0) return [];
  if (counts && counts.length === sources.length) {
    const out: number[] = [];
    let at = 0;
    for (const c of counts) {
      out.push(at);
      at += Math.max(1, c);
    }
    return out;
  }
  if (sources.length === 1) return [0];
  const indexOf = indexByRef(doc);
  const starts = new Set<number>();
  for (const f of doc.floors)
    for (const s of f.plans) {
      const i = indexOf.get(s.imageRef);
      if (i == null) continue;
      starts.add(s.pageNumber ? i - s.pageNumber + 1 : i);
    }
  return starts.size === sources.length ? [...starts].sort((a, b) => a - b) : null;
}

/** The files whose page count is needed to tell where each file starts. */
export const needsCounts = (doc: Pick<DesignDocument, "floors" | "planImport">): boolean => sourceStarts(doc) === null;

function indexByRef(doc: Pick<DesignDocument, "planImport">): Map<string, number> {
  const out = new Map<string, number>();
  for (const [i, ref] of Object.entries(doc.planImport?.placed ?? {})) if (!out.has(ref)) out.set(ref, Number(i));
  return out;
}

/** The design's files as the job's plans would have them, each with the
    sheets placed from it. A sheet whose file can't be told goes on as its
    own picture. A file with no page on a floor isn't moved: nothing in the
    design uses it. */
export function designPlanGroups(doc: Pick<DesignDocument, "floors" | "planImport" | "meta">, counts?: readonly number[]): DesignPlanGroup[] {
  const sources: PlanImportSource[] = doc.planImport?.sources ?? [];
  const starts = sourceStarts(doc, counts) ?? sources.map((_, k) => k);
  const indexOf = indexByRef(doc);
  const bySource = new Map<number, DesignPage[]>();
  const loose: DesignPlanGroup[] = [];
  const seen = new Set<string>();
  const floors = [...doc.floors].sort((a, b) => a.level - b.level);
  for (const floor of floors) {
    for (const sheet of floor.plans) {
      if (!sheet.imageRef) continue;
      const i = indexOf.get(sheet.imageRef);
      let k = -1;
      if (i != null) for (let j = 0; j < starts.length; j++) if (starts[j] <= i) k = j;
      if (i == null || k < 0 || !sources[k]) {
        /* no file to go by: the page's own picture is the plan */
        if (seen.has(sheet.imageRef)) continue;
        seen.add(sheet.imageRef);
        loose.push({
          sourceRef: sheet.imageRef,
          sourceKind: "image",
          name: `${doc.meta.name || "Design"}, ${floor.name}.${extOf(sheet.imageRef, "image")}`,
          pageCount: 1,
          pages: [{ n: 1, floor, sheet, index: null }],
        });
        continue;
      }
      const n = sources[k].kind === "pdf" ? (sheet.pageNumber ?? i - starts[k] + 1) : 1;
      bySource.set(k, [...(bySource.get(k) ?? []), { n, floor, sheet, index: i }]);
    }
  }
  const many = bySource.size + loose.length > 1;
  const groups: DesignPlanGroup[] = [...bySource.entries()]
    .sort(([a], [b]) => a - b)
    .map(([k, pages]) => {
      const s = sources[k];
      const last = Math.max(...pages.map((p) => p.n));
      const counted = counts?.[k];
      return {
        sourceRef: s.ref,
        sourceKind: s.kind,
        name: s.name?.trim() || `${doc.meta.name || "Design"} plans${many ? ` ${k + 1}` : ""}.${extOf(s.ref, s.kind)}`,
        pageCount: Math.max(last, counted ?? 0),
        pages: pages.sort((a, b) => a.n - b.n),
      };
    });
  return [...groups, ...loose];
}

/** "Ground floor, page 1" under a page's picture. */
export const designPageCaption = (p: DesignPage) => `${p.floor.name}, page ${p.n}`;

/** The sheets of a group, by id. */
const sheetIds = (g: DesignPlanGroup) => new Set(g.pages.map((p) => p.sheet.id));

/** The rooms she read off a group's sheets. */
function roomsRead(reading: PlanReading | null | undefined, g: DesignPlanGroup): number | null {
  if (!reading) return null;
  const ids = sheetIds(g);
  const sheets = Object.values(reading.floors)
    .flat()
    .filter((s) => ids.has(s.sheetId));
  if (sheets.length === 0) return null;
  return sheets.reduce((n, s) => n + suggestedRooms(s).length, 0);
}

/** A group's line in Link job: its floors, what she read, and whether it's read again. */
export function designPlanLine(doc: Pick<DesignDocument, "reading">, g: DesignPlanGroup): string {
  const floors = andList([...new Set(g.pages.map((p) => p.floor.name))]);
  const rooms = roomsRead(doc.reading, g);
  if (rooms == null) return `${floors}. Tiff reads it on the job`;
  return `${floors}, ${rooms} ${rooms === 1 ? "room" : "rooms"}, as read in this design. Not read again`;
}

/** Whether her reading of the design covers a group: then it goes on read. */
export const groupIsRead = (doc: Pick<DesignDocument, "reading">, g: DesignPlanGroup): boolean => roomsRead(doc.reading, g) != null;

/** The job's plan's pages and reading for a group: each page its sheet's
    picture and size, its words and Tiff's measured scale from the design,
    and the design's scale on its floor kept as set in a design where it
    isn't the one she measured. `previews` are the small pictures made for
    the job's thumbnails, by page. */
export function planFromGroup(
  doc: Pick<DesignDocument, "reading" | "planImport">,
  g: DesignPlanGroup,
  opts: { previews: ReadonlyMap<number, string>; by: string | null; at: string }
): { pages: JobPlanPage[]; reading: PlanReading | null } {
  const imp = doc.planImport;
  const byN = new Map<number, DesignPage[]>();
  for (const p of g.pages) byN.set(p.n, [...(byN.get(p.n) ?? []), p]);
  const pages: JobPlanPage[] = [...byN.entries()]
    .sort(([a], [b]) => a - b)
    .map(([n, on]) => {
      const { floor, sheet, index } = on[0];
      const words = index != null ? imp?.words?.[index] : undefined;
      const measured = index != null ? imp?.measured?.[index] : undefined;
      const mm = floor.scaleMmPerUnit;
      const theirs = !!mm && mm > 0 && !(measured && Math.abs(measured.mmPerPx - mm) <= mm * 0.01);
      const set: SetScale | null = theirs ? { mmPerPx: mm!, mm: null, by: opts.by, at: opts.at } : null;
      return {
        n,
        kind: "floor",
        name: floor.name,
        level: floor.level,
        ref: sheet.imageRef,
        preview: opts.previews.get(n) ?? null,
        width: sheet.width,
        height: sheet.height,
        /* one page split over two sheets (a west half, an east half) is the whole page on the job */
        ...(on.length === 1 && sheet.crop ? { trim: { ...sheet.crop } } : {}),
        ...(words?.length ? { words } : {}),
        mmPerPx: null,
        scale: null,
        ...(measured ? { measured: { mmPerPx: measured.mmPerPx, from: measured.from, sure: measured.sure } } : {}),
        ...(set ? { set } : {}),
      };
    });

  const r = doc.reading;
  if (!r || !groupIsRead(doc, g)) return { pages, reading: null };
  /* the design's sheet → the plan's page, and a floor → its first page in this file */
  const pageOfSheet = new Map(g.pages.map((p) => [p.sheet.id, pageKey(p.n)]));
  const pageOfFloor = new Map<string, string>();
  for (const p of g.pages) if (!pageOfFloor.has(p.floor.id)) pageOfFloor.set(p.floor.id, pageKey(p.n));
  const floors: Record<string, SheetReading[]> = {};
  for (const sheets of Object.values(r.floors))
    for (const s of sheets) {
      const key = pageOfSheet.get(s.sheetId);
      if (key) (floors[key] ??= []).push({ ...s, sheetId: key });
    }
  const sheetAt = (sheetId: string) => pageOfSheet.get(sheetId) ?? null;
  const roof = r.roof
    ? {
        ...r.roof,
        levels: r.roof.levels.flatMap((l) => (pageOfFloor.get(l.floorId) ? [{ ...l, floorId: pageOfFloor.get(l.floorId)! }] : [])),
        parts: r.roof.parts.flatMap((p) => {
          const key = sheetAt(p.sheetId);
          return key ? [{ ...p, floorId: key, sheetId: key }] : [];
        }),
        raked: r.roof.raked.flatMap((k) => (pageOfFloor.get(k.floorId) ? [{ ...k, floorId: pageOfFloor.get(k.floorId)! }] : [])),
        subfloor: (() => {
          const sf = r.roof!.subfloor;
          if (!sf) return undefined;
          const key = sheetAt(sf.sheetId) ?? pageOfFloor.get(sf.floorId);
          return key ? { ...sf, floorId: key, sheetId: key } : sf.shown === "mentioned" ? sf : undefined;
        })(),
      }
    : r.roof;
  /* the roof and the site go with the file whose pages they're set out on */
  const roofHere = roof && (roof.levels.length || roof.parts.length || roof.raked.length || roof.subfloor) ? roof : roof === null ? null : undefined;
  const siteKey = r.site ? sheetAt(r.site.sheetId) : null;
  const site = r.site && siteKey ? { ...r.site, floorId: siteKey, sheetId: siteKey } : r.site === null ? null : undefined;
  return {
    pages,
    reading: {
      at: r.at,
      model: r.model,
      floors,
      failed: r.failed.flatMap((f) => {
        const key = sheetAt(f.sheetId);
        return key ? [{ ...f, floorId: key, sheetId: key }] : [];
      }),
      ...(roofHere !== undefined ? { roof: roofHere } : {}),
      ...(site !== undefined ? { site } : {}),
    },
  };
}
