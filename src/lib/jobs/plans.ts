/* PLANS ON THE JOB (Isaac, 9 November 2026, on the mock
   https://claude.ai/artifact/3gzx9mP747FgTX7qxsH9fe: "Go that" to a plan
   read once, the moment it is pressed into Plans; "Yes, a plans group at the
   top of documents that can be easily read"; then "Build it").

   A PLAN IS A POINTER to one of the job's own files, a PDF of the set or a
   picture of a page, with Tiff's reading of it kept beside the pointer. The
   reading is the Studio's own (lib/studio/reading.ts), keyed by PAGE rather
   than by a design's floors, so every design started from the plan, the heat
   load, Revise the 3D and the quote use the one read and nobody pays for it
   twice. A design made from a plan takes the floors and the reading from
   here (designFromPlan) and reads nothing again.

   Pure: no I/O. The server side is plans-server.ts. */

import type { Floor, PlanImport, PlanImportSource } from "@/lib/studio/document";
import { newId } from "@/lib/studio/document";
import { defaultFloorName, placeSheets, type UploadedSheet } from "@/lib/studio/plans";
import type { TrimRect } from "@/lib/studio/plan-trim";
import type { MeasuredScale, PlanReading, PlanWord, SheetReading } from "@/lib/studio/reading";
import { suggestedRooms } from "@/lib/studio/reading";
import { andList } from "@/lib/swms/library";
import { fmtAuWeekdayDayMonth } from "@/lib/au-dates";
import { pagesWords } from "./take-in";

/** What a page of the set is: a floor's plan is what gets read for rooms;
    the rest is kept by kind so the roof and the site reads know where to look
    and the row can say what it left out. */
export type PlanPageKind = "floor" | "site" | "roof" | "elevation" | "section" | "other";

export type JobPlanPage = {
  /** 1-based, in the set's order */
  n: number;
  kind: PlanPageKind;
  /** a floor's name as the set names it: "Ground floor", "Level 1"; "" otherwise */
  name: string;
  /** a floor's level in the stack, the ground 0; null for a page that isn't a floor */
  level: number | null;
  /** the full raster, in the studio-plans bucket: floor pages only */
  ref: string | null;
  /** the small raster for its thumbnail: floor pages only */
  preview: string | null;
  /** the full raster's size, in pixels */
  width: number;
  height: number;
  /** the drawing inside its margins (plan-trim.ts): a floor's starting crop */
  trim?: TrimRect;
  /** the page's own words, where they sit on the raster: floor pages only */
  words?: PlanWord[];
  /** building millimetres per raster pixel, off the printed scale; null when the title block doesn't say */
  mmPerPx: number | null;
  /** the scale as printed, "1:100 @ A3", for saying where a scale came from */
  scale: string | null;
  /** the scale off the lengths printed along its dimension lines, for a page
      whose title block prints none (a photographed sketch): read once with
      the plan. Null: looked, and it prints none. Absent: not looked yet.
      Kept apart from mmPerPx, so a design's floor is still calibrated by hand. */
  measured?: MeasuredScale | null;
};

export type JobPlanState = "reading" | "read" | "check" | "failed";

/** A set of drawings, read for its floors, or a specification, read by its
    words for the air (take-in.ts). */
export type JobPlanKind = "drawings" | "spec";

/** A specification's read: its pages on the air, and their words. */
export type SpecWords = { pages: number[]; words: string };

export type JobPlan = {
  id: string;
  jobUuid: string;
  /** the job's file it points to: one of ours (documents.id) or ServiceM8's (sm8_attachments.uuid) */
  documentId: string | null;
  attachmentId: string | null;
  name: string;
  /** the original file's copy in the studio-plans bucket, which the roof and site reads take whole */
  sourceRef: string | null;
  sourceKind: "pdf" | "image";
  /** drawings when absent: every plan before specifications were read */
  kind?: JobPlanKind;
  /** a specification's pages on the air, once read */
  spec?: SpecWords | null;
  pageCount: number;
  pages: JobPlanPage[];
  /** keyed by page: `floors[pageKey(n)]` is what she read off page n, its points in that page's pixels */
  reading: PlanReading | null;
  state: JobPlanState;
  /** why it needs a look, or why it couldn't be read */
  said: string | null;
  addedBy: string | null;
  addedAt: string;
  readAt: string | null;
};

/** A plan as a screen reads it: its thumbnails signed, and how many designs took it. */
export type JobPlanRead = JobPlan & {
  thumbs: Record<number, string>;
  usedBy: number;
};

/** One of the job's files picked for Plans: ours, or ServiceM8's. */
export type PlanPick = { documentId: string } | { attachmentId: string };

/** The reading's key for a page: a plan's reading is by page, a design's by floor. */
export const pageKey = (n: number) => `p${n}`;

/* ── which pages are floor plans ─────────────────────────────────────────── */

type Word = { text: string };

const FLOOR_TITLE =
  /\b(?:(LOWER\s+GROUND|UPPER\s+GROUND|GROUND|FIRST|SECOND|THIRD|FOURTH|FIFTH|UPPER|LOWER|BASEMENT|MEZZANINE|ATTIC|LOFT|LEVEL\s*\d{1,2}|L\s?\d{1,2})\s+(?:FLOOR\s+)?PLAN\b|\bFLOOR\s+PLAN\b|\bPLAN\s*[-–:]?\s*(LOWER\s+GROUND|GROUND|FIRST|SECOND|BASEMENT|LEVEL\s*\d{1,2}))/;
/** a plan of something other than the rooms: never a floor to read */
const NOT_A_FLOOR = /\b(DEMOLITION|ELECTRICAL|LIGHTING|REFLECTED\s+CEILING|RCP|DRAINAGE|STORMWATER|SEWER|HYDRAULIC|LANDSCAPE|SEDIMENT|EROSION|SET[\s-]?OUT|SLAB|FOOTING|FRAMING|BRACING|TILING|FINISHES|FURNITURE|CEILING\s+PLAN|SHADOW|WASTE|BASIX|FIRE|SIGNAGE|MARKING)\b/;
const SITE_TITLE = /\b(SITE\s+(?:ANALYSIS\s+)?PLAN|LOCATION\s+PLAN|LOCALITY\s+PLAN|SITE\s+AND\s+ROOF\s+PLAN|SITE\/ROOF\s+PLAN|BLOCK\s+PLAN)\b/;
const ROOF_TITLE = /\bROOF\s+PLAN\b/;
const ELEVATION_TITLE = /\bELEVATIONS?\b/;
const SECTION_TITLE = /\bSECTIONS?\b/;

/** The level a floor's title names: Ground 0, Level 1 and First 1, Basement -1. */
export function levelOfTitle(title: string): { level: number; name: string } | null {
  const t = title.toUpperCase().replace(/\s+/g, " ");
  const num = t.match(/\b(?:LEVEL|L)\s?(\d{1,2})\b/);
  if (num) {
    const n = Number(num[1]);
    return { level: n, name: n === 0 ? "Ground floor" : `Level ${n}` };
  }
  if (/\bLOWER\s+GROUND\b/.test(t)) return { level: -1, name: "Lower ground" };
  if (/\bUPPER\s+GROUND\b/.test(t)) return { level: 1, name: "Upper ground" };
  if (/\bBASEMENT\b/.test(t)) return { level: -1, name: "Basement" };
  if (/\bGROUND\b/.test(t)) return { level: 0, name: "Ground floor" };
  if (/\bMEZZANINE\b/.test(t)) return { level: 1, name: "Mezzanine" };
  if (/\b(ATTIC|LOFT)\b/.test(t)) return { level: 2, name: "Attic" };
  if (/\bFIRST\b/.test(t)) return { level: 1, name: "Level 1" };
  if (/\bSECOND\b/.test(t)) return { level: 2, name: "Level 2" };
  if (/\bTHIRD\b/.test(t)) return { level: 3, name: "Level 3" };
  if (/\bFOURTH\b/.test(t)) return { level: 4, name: "Level 4" };
  if (/\bFIFTH\b/.test(t)) return { level: 5, name: "Level 5" };
  if (/\bUPPER\b/.test(t)) return { level: 1, name: "Level 1" };
  if (/\bLOWER\b/.test(t)) return { level: -1, name: "Lower floor" };
  return null;
}

export type PageGuess = { kind: PlanPageKind; name: string; level: number | null };

/** What a page is, by the words printed on it. The title block names the
    sheet ("GROUND FLOOR PLAN" beside "A-103"), and the words are read in
    print order, so the joined text carries the title whole. Null when the
    words say nothing a classifier could trust: a scan with no text, or a
    page whose words name no kind of drawing. */
export function guessPageByWords(words: readonly Word[] | null | undefined): PageGuess | null {
  if (!words?.length) return null;
  const text = words
    .map((w) => w.text.trim())
    .filter(Boolean)
    .join(" ")
    .toUpperCase()
    .replace(/\s+/g, " ");
  if (!text) return null;
  /* a title that says what kind of plan it is, from the title block first */
  const floor = text.match(FLOOR_TITLE);
  if (floor) {
    const around = text.slice(Math.max(0, floor.index! - 24), floor.index! + floor[0].length + 24);
    if (!NOT_A_FLOOR.test(around)) {
      const lv = levelOfTitle(floor[0]);
      return { kind: "floor", name: lv?.name ?? "Floor plan", level: lv?.level ?? 0 };
    }
  }
  /* a plan of something other than the rooms, named as one: not a floor to read, and not for a look either */
  if (!floor && NOT_A_FLOOR.test(text) && /\bPLAN\b/.test(text)) return { kind: "other", name: "", level: null };
  if (SITE_TITLE.test(text)) return { kind: "site", name: "", level: null };
  if (ROOF_TITLE.test(text)) return { kind: "roof", name: "", level: null };
  if (ELEVATION_TITLE.test(text) && !/\bPLAN\b/.test(text)) return { kind: "elevation", name: "", level: null };
  if (SECTION_TITLE.test(text) && !/\bPLAN\b/.test(text)) return { kind: "section", name: "", level: null };
  if (floor) return { kind: "other", name: "", level: null };
  return null;
}

/** Two floors can't share a level in a stack: the second "Ground floor" of a
    set (a west half, a stage two) goes up one, and keeps its name. */
export function stackLevels<T extends { level: number | null; kind: PlanPageKind }>(pages: T[]): T[] {
  const used = new Set<number>();
  return pages.map((p) => {
    if (p.kind !== "floor" || p.level === null) return p;
    let level = p.level;
    while (used.has(level)) level += 1;
    used.add(level);
    return level === p.level ? p : { ...p, level };
  });
}

/** The floor pages, the lowest first. */
export const floorPagesOf = (plan: { pages: readonly JobPlanPage[] }): JobPlanPage[] =>
  plan.pages.filter((p) => p.kind === "floor" && p.ref).sort((a, b) => (a.level ?? 0) - (b.level ?? 0) || a.n - b.n);

/* ── what the read came to ───────────────────────────────────────────────── */

/** How many rooms she found on a page. */
export const roomsOnPage = (reading: PlanReading | null, n: number): number =>
  (reading?.floors[pageKey(n)] ?? []).reduce((sum, s) => sum + suggestedRooms(s).length, 0);

/** "Pages 3 and 4", "Page 7": 1-based page numbers. */
export function pagesWordOf(ns: readonly number[]): string {
  const n = [...ns].sort((a, b) => a - b).map(String);
  if (n.length === 0) return "No pages";
  if (n.length === 1) return `Page ${n[0]}`;
  return `Pages ${n.slice(0, -1).join(", ")} and ${n[n.length - 1]}`;
}

/** The state a read plan is in, and what to say about it. Read, when every
    floor page read as a floor; Check the read when a page she read has no
    rooms on it, a page couldn't be read, or the set had no floor plan in it.
    What's said goes in the row's grey line after the facts. */
export function stateOfRead(pages: readonly JobPlanPage[], reading: PlanReading | null): { state: JobPlanState; said: string | null } {
  if (!reading) return { state: "failed", said: "The plans couldn't be read" };
  const floors = pages.filter((p) => p.kind === "floor" && p.ref);
  if (floors.length === 0) {
    const n = pages.length;
    return { state: "check", said: n === 1 ? "No floor plan found on its page" : `No floor plan found in its ${n} pages` };
  }
  const said: string[] = [];
  for (const f of reading.failed) {
    const n = Number(f.floorId.replace(/^p/, ""));
    said.push(`Page ${Number.isFinite(n) ? n : f.floorId} couldn't be read: ${f.reason}`);
  }
  for (const p of floors) {
    const sheets = reading.floors[pageKey(p.n)];
    if (!sheets?.length) continue;
    if (roomsOnPage(reading, p.n) < 2) said.push(`Page ${p.n} has no rooms on it, so it may not be a floor plan`);
  }
  return said.length ? { state: "check", said: said.join(". ") } : { state: "read", said: null };
}

/* ── the words a row says ─────────────────────────────────────────────────── */

/** The floors by name, "Ground floor and Level 1", in stack order. */
export const floorNamesOf = (plan: { pages: readonly JobPlanPage[] }): string => andList(floorPagesOf(plan).map((p) => p.name || defaultFloorName(p.level ?? 0)));

const dayOf = (iso: string | null): string | null => (iso ? fmtAuWeekdayDayMonth(iso.slice(0, 10)) : null);

/** The plan's part of its row's grey line, after the file's own facts:
    what was read and when, what needs a look, or who is adding it. */
export function planLine(plan: JobPlanRead, today?: string): string {
  if (plan.state === "reading") {
    const day = plan.addedAt.slice(0, 10);
    const when = today && day === today ? "today" : (dayOf(plan.addedAt) ?? "");
    return [`Added to Plans${plan.addedBy ? ` by ${plan.addedBy}` : ""}`, when].filter(Boolean).join(" ");
  }
  if (plan.state === "failed") return plan.said ? `Couldn't be read: ${plan.said.replace(/^The plans couldn't be read:?\s*/i, "") || "try again"}` : "Couldn't be read";
  if (plan.kind === "spec") {
    const day = dayOf(plan.readAt);
    if (plan.state === "check") return plan.said ?? "Check the read";
    const air = plan.spec?.pages.length ? `The specification's ${pagesWords(plan.spec.pages)} read for air, ventilation and exhaust` : "The specification";
    return `${air}${day ? `, on ${day}` : ""}`;
  }
  const floors = floorPagesOf(plan);
  const parts: string[] = [];
  if (floors.length) {
    const what = [floorNamesOf(plan), plan.reading?.roof ? "the roof" : null, plan.reading?.site ? "the site" : null].filter((s): s is string => !!s);
    const list = andList(what);
    const day = dayOf(plan.readAt);
    parts.push(plan.state === "check" ? `${pagesWordOf(floors.map((p) => p.n))} read: ${list}` : `${list}${day ? `, read on ${day}` : ""}`);
  }
  if (plan.state === "check" && plan.said) parts.push(plan.said);
  if (plan.usedBy > 0) parts.push(plan.usedBy === 1 ? "Used by 1 design" : `Used by ${plan.usedBy} designs`);
  return parts.join(". ");
}

/** The state word on the row's right. */
export function planStateWord(plan: { state: JobPlanState }): { word: string; tone: "info" | "good" | "look" | "wrong" } {
  switch (plan.state) {
    case "reading":
      return { word: "Reading the plans", tone: "info" };
    case "read":
      return { word: "Read", tone: "good" };
    case "check":
      return { word: "Check the read", tone: "look" };
    default:
      return { word: "Not read", tone: "wrong" };
  }
}

/** A floor page's caption under its thumbnail: "Ground floor, page 3". */
export const pageCaption = (p: JobPlanPage) => `${p.name || defaultFloorName(p.level ?? 0)}, page ${p.n}`;

/** The line under a plan in the Studio's New design: what she read and when. */
export function planReadLine(plan: JobPlanRead): string {
  if (plan.state === "reading") return "Tiff is reading the plans";
  if (plan.state === "failed") return planLine(plan);
  const floors = floorPagesOf(plan);
  if (!floors.length) return plan.said ?? "No floor plan found";
  const rooms = floors.map((p) => roomsOnPage(plan.reading, p.n));
  const same = rooms.every((r) => r === rooms[0]);
  const roomsWord = same ? `${rooms[0]} rooms${floors.length > 1 ? " each" : ""}` : `${rooms.reduce((a, b) => a + b, 0)} rooms`;
  const what = [`${floorNamesOf(plan)}, ${roomsWord}`, plan.reading?.roof ? "the roof" : null, plan.reading?.site ? "the site" : null].filter((s): s is string => !!s);
  const day = dayOf(plan.readAt);
  return `${day ? `Read on ${day}: ` : ""}${andList(what)}${plan.state === "check" && plan.said ? `. ${plan.said}` : ""}`;
}

/* ── a design from a plan ────────────────────────────────────────────────── */

export type DesignFromPlan = {
  floors: Floor[];
  planImport: PlanImport;
  reading: PlanReading | null;
};

/** The floors a design opens with from a job's plan, one per floor page at
    its level, the sheet the page's own raster, the scale the title block's
    where it printed one; the import record the Studio's Edit plans reads;
    and her reading of the plan, moved onto the design's floors and sheets
    (its points stay where they are: a sheet's pixels are its page's). */
export function designFromPlan(plan: JobPlan): DesignFromPlan {
  const floors = floorPagesOf(plan);
  const byLevel = new Map<number, JobPlanPage[]>();
  for (const p of floors) {
    const level = p.level ?? 0;
    byLevel.set(level, [...(byLevel.get(level) ?? []), p]);
  }
  const levels = [...byLevel.keys()].sort((a, b) => a - b);
  const sheetOf = new Map<number, { floorId: string; sheetId: string }>();
  const made: Floor[] = levels.map((level) => {
    const on = byLevel.get(level)!;
    const sheets: UploadedSheet[] = on.map((p) => ({
      label: p.name || defaultFloorName(level),
      ref: p.ref!,
      pageNumber: plan.sourceKind === "pdf" ? p.n : null,
      width: p.width,
      height: p.height,
      ...(p.trim ? { crop: { ...p.trim } } : {}),
    }));
    const plans = placeSheets([], sheets);
    const id = newId("flr");
    on.forEach((p, i) => sheetOf.set(p.n, { floorId: id, sheetId: plans[i].id }));
    const scaled = on.find((p) => p.mmPerPx);
    return {
      id,
      name: on[0].name || defaultFloorName(level),
      level,
      scaleMmPerUnit: scaled?.mmPerPx ?? null,
      northDeg: null,
      northPos: null,
      plans,
    };
  });

  const sources: PlanImportSource[] = plan.sourceRef ? [{ ref: plan.sourceRef, kind: plan.sourceKind }] : [];
  const placed: Record<number, string> = {};
  const words: NonNullable<PlanImport["words"]> = {};
  for (const p of floors) {
    placed[p.n - 1] = p.ref!;
    if (p.words?.length) words[p.n - 1] = p.words;
  }
  const planImport: PlanImport = {
    sources,
    placed,
    chosen: floors.map((p) => p.n - 1),
    names: {},
    ...(Object.keys(words).length ? { words } : {}),
    jobPlanId: plan.id,
  };

  let reading: PlanReading | null = null;
  if (plan.reading) {
    const r = plan.reading;
    const at = (key: string) => sheetOf.get(Number(key.replace(/^p/, ""))) ?? null;
    const moved: Record<string, SheetReading[]> = {};
    for (const [key, sheets] of Object.entries(r.floors)) {
      const to = at(key);
      if (!to) continue;
      moved[to.floorId] = [...(moved[to.floorId] ?? []), ...sheets.map((s) => ({ ...s, sheetId: to.sheetId }))];
    }
    const roof = r.roof
      ? {
          ...r.roof,
          levels: r.roof.levels.flatMap((l) => (at(l.floorId) ? [{ ...l, floorId: at(l.floorId)!.floorId }] : [])),
          parts: r.roof.parts.flatMap((p) => (at(p.floorId) ? [{ ...p, floorId: at(p.floorId)!.floorId, sheetId: at(p.floorId)!.sheetId }] : [])),
          raked: r.roof.raked.flatMap((k) => (at(k.floorId) ? [{ ...k, floorId: at(k.floorId)!.floorId }] : [])),
        }
      : r.roof;
    const site = r.site && at(r.site.floorId) ? { ...r.site, floorId: at(r.site.floorId)!.floorId, sheetId: at(r.site.floorId)!.sheetId } : r.site === null ? null : undefined;
    reading = {
      at: r.at,
      model: r.model,
      floors: moved,
      failed: r.failed.flatMap((f) => (at(f.floorId) ? [{ ...f, floorId: at(f.floorId)!.floorId, sheetId: at(f.floorId)!.sheetId }] : [])),
      ...(roof !== undefined ? { roof } : {}),
      ...(site !== undefined ? { site } : {}),
    };
  }
  return { floors: made, planImport, reading };
}

/** Several of the job's plans into one design: the first plan's floors at
    their levels, the next plan's above them where a level is taken, and the
    readings as one. The import record is the first plan's, since Edit plans
    reopens one set; the roof and the site are the first plan's too. */
export function designFromPlans(plans: readonly JobPlan[]): DesignFromPlan {
  const [first, ...rest] = plans;
  if (!first) return { floors: [], planImport: { sources: [], placed: {}, chosen: [], names: {} }, reading: null };
  const made = designFromPlan(first);
  const floors = [...made.floors];
  const used = new Set(floors.map((f) => f.level));
  let reading = made.reading;
  for (const plan of rest) {
    const more = designFromPlan(plan);
    for (const f of more.floors) {
      let level = f.level;
      while (used.has(level)) level += 1;
      used.add(level);
      floors.push(level === f.level ? f : { ...f, level });
    }
    if (more.reading) {
      reading = reading
        ? { ...reading, floors: { ...reading.floors, ...more.reading.floors }, failed: [...reading.failed, ...more.reading.failed] }
        : more.reading;
    }
  }
  floors.sort((a, b) => a.level - b.level);
  return { floors, planImport: made.planImport, reading };
}

/** The plans a design can start from: read, or read with something to check. */
export const startablePlans = (plans: readonly JobPlanRead[]): JobPlanRead[] => plans.filter((p) => (p.state === "read" || p.state === "check") && floorPagesOf(p).length > 0);

/** The job's file a plan points to, among the job's media: ours by its
    documents row, ServiceM8's by its attachment. */
export const planPointsAt = (plan: { documentId: string | null; attachmentId: string | null }, item: { remoteId: string; documentId?: string }): boolean =>
  (!!plan.documentId && item.documentId === plan.documentId) || (!!plan.attachmentId && item.remoteId === plan.attachmentId);
