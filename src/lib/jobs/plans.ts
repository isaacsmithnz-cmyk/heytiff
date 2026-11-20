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
import type { MeasuredScale, PlanReading, PlanWord, ReadLook, ReadPoint, ReadSpace, SheetReading } from "@/lib/studio/reading";
import { area, scaleFromWritten, suggestedRooms } from "@/lib/studio/reading";
export { scaleFromWritten };
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
  /** a floor read by measure (measured-server.ts): its rooms on its own walls,
      or why it couldn't be (no wall fill to measure). Absent: not tried.
      (`measured`, further down, is another thing: a scale off printed dimensions.) */
  walled?: PageWalled;
  /** the scale as printed, "1:100 @ A3", for saying where a scale came from */
  scale: string | null;
  /** the scale off the lengths printed along its dimension lines, for a page
      whose title block prints none (a photographed sketch): read once with
      the plan. Null: looked, and it prints none. Absent: not looked yet.
      Kept apart from mmPerPx: the design carries it, Scale and north says
      it is hers and what it rests on (Isaac, 13 November 2026, on 3517's
      plan, which had to be measured though she'd read its 5 m scale bar),
      and a design made from the plan opens with it on its floor (the mock
      of 14 November 2026: "the scale is already set from the plan's
      printed dimensions"). */
  measured?: MeasuredScale | null;
  /** the scale somebody set on the page (Set scale): from then on it is the
      page's scale, over what's printed and what Tiff measured */
  set?: SetScale | null;
  /** somebody chose this page's floor, or that it isn't a floor plan, in
      the Plans dialog: from then on what it is is theirs, not a guess to
      check (Isaac, 14 November 2026, on the mock's "Changing a floor") */
  picked?: { by: string | null; at: string } | null;
};

/** A scale set by hand: the length between two points pressed on the page
    (`a`, `b`, in the page's pixels), or the scale a design measured on its
    floor, which has no points to keep. `by` is the name of who set it. */
export type SetScale = { mmPerPx: number; mm: number | null; a?: ReadPoint; b?: ReadPoint; by: string | null; at: string };

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
  /** how far a read has got, written as it goes; null before one starts */
  progress?: PlanProgress | null;
};

/** A floor's rooms measured off its drawing's walls, in the raster's pixels; or `none`, with why. */
export type PageWalled = { spaces: ReadSpace[]; look: ReadLook[]; grid: { x: number[]; y: number[] }; rounds: number } | { none: string };

/** A read's place: the pages drawn small, the floors found among them,
    the floors drawn in full, then each floor read with the roof and the site. */
export type PlanProgress = { step: "drawing" | "finding" | "floors" | "measuring" | "reading"; done: number; total: number };

/** The bar under a plan being read: how far along, and in words. Each step
    has its share of the bar, the reading the most since it takes longest.
    Null before the read has said anything. Pure. */
export function planProgressOf(p: PlanProgress | null | undefined): { percent: number; words: string } | null {
  if (!p) return null;
  const part = p.total > 0 ? Math.min(1, Math.max(0, p.done / p.total)) : 0;
  const of = p.total > 0 ? `${Math.min(p.done + 1, p.total)} of ${p.total}` : "";
  switch (p.step) {
    case "drawing":
      return { percent: Math.round(2 + 33 * part), words: p.total > 0 ? `Drawing page ${of}` : "Opening the set" };
    case "finding":
      return { percent: 38, words: "Finding the floors" };
    case "floors":
      return { percent: Math.round(40 + 10 * part), words: p.total > 0 ? `Drawing the floors in full, ${of}` : "Drawing the floors in full" };
    case "measuring":
      return { percent: Math.round(50 + 14 * part), words: p.done >= p.total ? "Rooms set on the walls" : `Measuring the walls and naming the rooms, ${p.done} of ${p.total} floors done` };
    case "reading":
      return { percent: Math.round(64 + 34 * part), words: p.done >= p.total ? "Putting the read together" : `Reading the floors, roof and site, ${p.done} of ${p.total} done` };
  }
}

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

/* the levels as sets print them, words or the architect's shorthand: LGF,
   GF and FF are 3570's lower ground, ground and first floor plans (Luke's
   CDC set, 20 November 2026), which went unread while the garage's and the
   cabana's "ground floor plans" were taken for the house */
const LEVEL_WORDS =
  "LOWER\\s+GROUND|UPPER\\s+GROUND|GROUND|FIRST|SECOND|THIRD|FOURTH|FIFTH|UPPER|LOWER|BASEMENT|MEZZANINE|ATTIC|LOFT|LEVEL\\s*\\d{1,2}|L\\s?\\d{1,2}|1ST|2ND|3RD|LGF|UGF|LG|UG|GF|FF";
const FLOOR_TITLE = new RegExp(`\\b(?:(${LEVEL_WORDS})\\s+(?:FLOOR\\s+)?PLAN\\b|\\bFLOOR\\s+PLAN\\b|\\bPLAN\\s*[-–:]?\\s*(LOWER\\s+GROUND|GROUND|FIRST|SECOND|BASEMENT|LEVEL\\s*\\d{1,2}|LGF|GF|FF))`);
/** a building of its own on the site: its floors aren't the house's */
/** ...named just before the title, as "GARAGE GROUND FLOOR PLAN" names it:
    a room called Pool beside a house's plan is not one */
const OUTBUILDING_BEFORE = /\b(GARAGE|GARGE|CARPORT|CABANA|POOL\s+HOUSE|SHED|GRANNY\s+FLAT|SECONDARY\s+DWELLING|WORKSHOP|BARN)\b[\s&A-Z]{0,12}$/;
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
  if (/\b(LOWER\s+GROUND|LGF|LG)\b/.test(t)) return { level: -1, name: "Lower ground" };
  if (/\b(UPPER\s+GROUND|UGF|UG)\b/.test(t)) return { level: 1, name: "Upper ground" };
  if (/\bGF\b/.test(t)) return { level: 0, name: "Ground floor" };
  if (/\b(FF|1ST)\b/.test(t)) return { level: 1, name: "Level 1" };
  if (/\b2ND\b/.test(t)) return { level: 2, name: "Level 2" };
  if (/\b3RD\b/.test(t)) return { level: 3, name: "Level 3" };
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
      /* a garage's or a cabana's floor is that building's, not the house's:
         stacked with the house it would stand on its top floor in the 3D
         (3570: the garage as level 2 over the first floor). Not a floor of
         the house; Choose floors can still take it. */
      if (OUTBUILDING_BEFORE.test(text.slice(Math.max(0, floor.index! - 20), floor.index!))) return { kind: "other", name: "", level: null };
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

/* ── a page's scale ───────────────────────────────────────────────────────── */

/** A page's scale and what it rests on: the one somebody set, else the one
    the title block prints, else the lengths printed along its dimension
    lines, else the sizes written in its rooms. Null: none to be had. */
export function pageScale(page: JobPlanPage, spaces: readonly ReadSpace[]): { mmPerPx: number; from: string; sure: boolean } | null {
  if (page.set && page.set.mmPerPx > 0) {
    const who = page.set.by ?? "someone";
    return { mmPerPx: page.set.mmPerPx, from: page.set.mm ? `the ${Math.round(page.set.mm)} mm ${who} measured on it` : `the scale ${who} measured in a design`, sure: true };
  }
  if (page.mmPerPx) return { mmPerPx: page.mmPerPx, from: page.scale ? `the plan's printed scale, ${page.scale}` : "the plan's scale", sure: true };
  if (page.measured) return { mmPerPx: page.measured.mmPerPx, from: page.measured.sure ? page.measured.from : `${page.measured.from}, one figure alone`, sure: page.measured.sure };
  const w = scaleFromWritten(spaces);
  if (w) return { mmPerPx: w.mmPerPx, from: `the sizes written in ${w.rooms} of its rooms`, sure: true };
  return null;
}

/** The spaces she read on a page. */
const spacesOn = (reading: PlanReading | null, n: number): ReadSpace[] => (reading?.floors[pageKey(n)] ?? []).flatMap((s) => s.spaces);

type ScaledPlan = Pick<JobPlan, "pages" | "reading" | "state"> & { kind?: JobPlanKind };

/** The floor pages she read, each with its scale. */
const scalesOf = (plan: ScaledPlan) =>
  plan.kind === "spec" || (plan.state !== "read" && plan.state !== "check")
    ? []
    : floorPagesOf(plan)
        .filter((p) => plan.reading?.floors[pageKey(p.n)]?.length)
        .map((p) => ({ page: p, scale: pageScale(p, spacesOn(plan.reading, p.n)) }));

/** What a read plan asks of a person about its scale, page by page
    (Isaac, 14 November 2026: "Like plans uploaded, tiff read but scale is
    incomplete?", "Yep"): `set` where the page has no scale to be had, so
    its rooms have no sizes; `check` where the scale rests on one printed
    figure alone, which is usable and worth a look. */
export function scaleAsks(plan: ScaledPlan): { n: number; ask: "set" | "check" }[] {
  return scalesOf(plan).flatMap(({ page, scale }): { n: number; ask: "set" | "check" }[] => (!scale ? [{ n: page.n, ask: "set" }] : !scale.sure ? [{ n: page.n, ask: "check" }] : []));
}

/** The line's sentence on the scale: what's missing, or what the sizes rest on. */
export function scaleSaid(plan: ScaledPlan): string | null {
  const each = scalesOf(plan);
  if (!each.length) return null;
  const many = each.length > 1;
  const none = each.filter((e) => !e.scale).map((e) => e.page.n);
  if (none.length) {
    if (!many || none.length === each.length) return "No scale on the plan, so the rooms have no sizes";
    return `No scale on ${pagesWordOf(none).toLowerCase()}, so ${none.length === 1 ? "its" : "their"} rooms have no sizes`;
  }
  const one = each.find((e) => !e.scale!.sure);
  if (one) {
    const figure = one.page.measured?.from.match(/\d+/)?.[0];
    return `${many ? `Page ${one.page.n} scaled` : "Scaled"} off one printed figure${figure ? `, the ${figure} mm` : ""}`;
  }
  /* in the plan's own row, "the plan's printed scale" is its printed scale */
  return `Scaled off ${each[0].scale!.from.replace(/^the plan's /, "its ")}`;
}

/** The floor area she read, in m², once every page she read has a scale. */
export function areaM2Of(plan: ScaledPlan): number | null {
  const each = scalesOf(plan);
  if (!each.length || each.some((e) => !e.scale)) return null;
  let m2 = 0;
  for (const { page, scale } of each) {
    for (const sheet of plan.reading?.floors[pageKey(page.n)] ?? []) {
      for (const s of suggestedRooms(sheet)) if (s.outline.length >= 3) m2 += area(s.outline) * scale!.mmPerPx * scale!.mmPerPx * 1e-6;
    }
  }
  return m2 > 0 ? Math.round(m2) : null;
}

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
    /* a page somebody said isn't a floor plan was never one to read */
    if (Number.isFinite(n) && pages.some((p) => p.n === n && p.kind !== "floor")) continue;
    said.push(`Page ${Number.isFinite(n) ? n : f.floorId} couldn't be read: ${f.reason}`);
  }
  for (const p of floors) {
    const sheets = reading.floors[pageKey(p.n)];
    if (!sheets?.length || p.picked) continue;
    if (roomsOnPage(reading, p.n) < 2) said.push(`Page ${p.n} has no rooms on it, so it may not be a floor plan`);
  }
  return said.length ? { state: "check", said: said.join(". ") } : { state: "read", said: null };
}

/* ── choosing a page's floor ──────────────────────────────────────────────── */

/** The pages of a set that can be given a floor: the ones she drew, which
    are the ones she read as floor plans, whatever they've been called since. */
export const choosablePages = (plan: { pages: readonly JobPlanPage[] }): JobPlanPage[] => plan.pages.filter((p) => !!p.ref);

/** "Not a floor plan" in a page's floor menu. */
export const NOT_A_FLOOR_PLAN = "none";

/** A page's floor menu: from a basement up to one above the set's top
    floor, each by the name the set gives it where it has one, then Not a
    floor plan (the mock of 14 November 2026: Basement 1, Ground floor,
    Level 1, Level 2, Not a floor plan). */
export function floorOptions(plan: { pages: readonly JobPlanPage[] }): { value: string; label: string }[] {
  const floors = plan.pages.filter((p) => p.kind === "floor" && p.level !== null);
  const levels = floors.map((p) => p.level as number);
  const low = Math.min(-1, ...levels);
  const high = Math.max(1, ...levels.map((l) => l + 1));
  const out: { value: string; label: string }[] = [];
  for (let level = low; level <= high; level++) out.push({ value: String(level), label: floorNameAt(plan, level) });
  out.push({ value: NOT_A_FLOOR_PLAN, label: "Not a floor plan" });
  return out;
}

/** A level's name in a set: what its floor page there is called, else the
    plain name for the level. */
function floorNameAt(plan: { pages: readonly JobPlanPage[] }, level: number): string {
  return plan.pages.find((p) => p.kind === "floor" && p.level === level && p.name)?.name || defaultFloorName(level);
}

/** A page's place in its floor menu. */
export const floorValueOf = (p: JobPlanPage): string => (p.kind === "floor" && p.level !== null ? String(p.level) : NOT_A_FLOOR_PLAN);

/** The set's pages with the floors somebody chose: a page given a level is
    a floor plan at it, named as the set names that level; Not a floor plan
    takes it out of the floors, its picture kept so it can be put back.
    Every page that can be chosen is marked picked, since whoever saved
    them looked at each. */
export function chooseFloors(pages: readonly JobPlanPage[], chosen: Readonly<Record<number, string>>, by: string | null, at: string): JobPlanPage[] {
  const picked = { by, at };
  const next = pages.map((p): JobPlanPage => {
    if (!p.ref) return p;
    const value = chosen[p.n] ?? floorValueOf(p);
    if (value === NOT_A_FLOOR_PLAN) return { ...p, kind: "other", level: null, picked };
    const level = Number(value);
    if (!Number.isInteger(level)) return { ...p, picked };
    if (p.kind === "floor" && p.level === level) return { ...p, picked };
    return { ...p, kind: "floor", level, picked };
  });
  /* a page moved to a level is called what the set calls that level */
  return next.map((p) => {
    const was = pages.find((q) => q.n === p.n)!;
    if (p.kind !== "floor" || p.level === null || (was.kind === "floor" && was.level === p.level)) return p;
    const named = next.find((q) => q.n !== p.n && q.kind === "floor" && q.level === p.level && q.name)?.name;
    return { ...p, name: named || defaultFloorName(p.level) };
  });
}

/* ── the words a row says ─────────────────────────────────────────────────── */

/** The floors by name, "Ground floor and Level 1", in stack order. */
export const floorNamesOf = (plan: { pages: readonly JobPlanPage[] }): string => andList(floorPagesOf(plan).map((p) => p.name || defaultFloorName(p.level ?? 0)));

const dayOf = (iso: string | null): string | null => (iso ? fmtAuWeekdayDayMonth(iso.slice(0, 10)) : null);

/* ── a set replaced by a later one ──────────────────────────────────────── */

const isReadSet = (p: JobPlan) => p.kind !== "spec" && (p.state === "read" || p.state === "check") && floorPagesOf(p).length > 0;

/** The later set on the job that replaces a set of drawings: the newest
    read since it that draws one of its floors. A replaced set is kept, its
    row grey (the builder's package mock, https://claude.ai/artifact/6FP52g4ropVpfAqqzNLk2c,
    board 4: "Issue G stays, marked Replaced"; Isaac, 15 November 2026:
    "Build the Replaced word on the job's Plans"). Null when nothing has. */
export function replacedBy(plan: JobPlan, plans: readonly JobPlan[]): JobPlan | null {
  if (!isReadSet(plan)) return null;
  const at = Date.parse(plan.addedAt) || 0;
  const levels = new Set(floorPagesOf(plan).map((p) => p.level ?? 0));
  return (
    plans
      .filter((p) => p.id !== plan.id && isReadSet(p) && (Date.parse(p.addedAt) || 0) > at && floorPagesOf(p).some((pg) => levels.has(pg.level ?? 0)))
      .sort((a, b) => (Date.parse(b.addedAt) || 0) - (Date.parse(a.addedAt) || 0))[0] ?? null
  );
}

/** A replaced set's line: by which set and when, and kept while a design uses it. */
export function replacedLine(plan: Pick<JobPlanRead, "usedBy">, by: Pick<JobPlan, "name" | "addedAt">): string {
  const day = dayOf(by.addedAt);
  const kept = plan.usedBy > 0 ? `, and kept: ${plan.usedBy === 1 ? "a design still uses it" : `${plan.usedBy} designs still use it`}` : "";
  return `Replaced by ${by.name}${day ? ` on ${day}` : ""}${kept}`;
}

/** The plan's part of its row's grey line, after the file's own facts:
    what was read and when, what needs a look, or who is adding it; for a
    set a later one replaced, that. */
export function planLine(plan: JobPlanRead, today?: string, replaced?: JobPlan | null): string {
  if (replaced) return replacedLine(plan, replaced);
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
  const scale = scaleSaid(plan);
  if (scale) parts.push(scale);
  if (plan.usedBy > 0) parts.push(plan.usedBy === 1 ? "Used by 1 design" : `Used by ${plan.usedBy} designs`);
  return parts.join(". ");
}

/** The plan's line on its subfloor, under its read (the mock
    https://claude.ai/artifact/B2Cr5YiUkZG7eSrsLd8Uum): where it runs and
    how high, the height typed in a design once there is one; or where the
    set only names one. Nothing when the set has none. */
export function subfloorLine(plan: Pick<JobPlan, "reading">): string | null {
  const sub = plan.reading?.roof?.subfloor;
  if (!sub) return null;
  if (sub.shown === "mentioned") {
    /* its own note, the first that names it */
    const words = sub.words.split(/;|\s\(/)[0].trim().replace(/[.\s]+$/, "");
    return `${sub.sheet || "The plans"} ${words ? `says “${words}”` : "names a subfloor"}, but no plan draws a subfloor`;
  }
  /* a short list of rooms, however she put it */
  const rooms = sub.rooms.replace(/^under\s+/i, "").split(/[.(;:]/)[0].trim();
  const where = rooms ? `Subfloor under ${rooms.replace(/^the\s+/i, "the ")}` : `Subfloor drawn${sub.sheet ? ` on ${sub.sheet}` : ""}`;
  if (sub.set) {
    const day = dayOf(sub.set.at);
    return `${where}, ${sub.set.heightMm} mm, set${sub.set.by ? ` by ${sub.set.by}` : ""}${sub.set.design ? ` in ${sub.set.design}` : ""}${day ? ` on ${day}` : ""}`;
  }
  if (sub.heightMm > 0) return `${where}, ${/^measured/i.test(sub.heightFrom) ? "about " : ""}${sub.heightMm} mm${sub.heightFrom ? `, ${sub.heightFrom}` : ""}`;
  return `${where}. Its height isn't on the plans`;
}

/** The state word on the row's right. A read plan with a page that has no
    scale says so in orange, Scale needed: what's missing, beside Read and
    Check the read. */
export function planStateWord(plan: ScaledPlan, replaced?: JobPlan | null): { word: string; tone: "info" | "good" | "look" | "wrong" } {
  /* a set a later one replaced is for your information: nothing to do to it */
  if (replaced) return { word: "Replaced", tone: "info" };
  switch (plan.state) {
    case "reading":
      return { word: "Reading the plans", tone: "info" };
    case "read":
      return scaleAsks(plan).some((a) => a.ask === "set") ? { word: "Scale needed", tone: "look" } : { word: "Read", tone: "good" };
    case "check":
      return { word: "Check the read", tone: "look" };
    default:
      return { word: "Not read", tone: "wrong" };
  }
}

/** A floor page's caption under its thumbnail: "Ground floor, page 3". */
export const pageCaption = (p: JobPlanPage) => `${p.name || defaultFloorName(p.level ?? 0)}, page ${p.n}`;

/** The line under a plan in the Studio's New design: what she read and when. */
export function planReadLine(plan: JobPlanRead, replaced?: JobPlan | null): string {
  if (replaced) return replacedLine(plan, replaced);
  if (plan.state === "reading") return "Tiff is reading the plans";
  if (plan.state === "failed") return planLine(plan);
  const floors = floorPagesOf(plan);
  if (!floors.length) return plan.said ?? "No floor plan found";
  const rooms = floors.map((p) => roomsOnPage(plan.reading, p.n));
  const same = rooms.every((r) => r === rooms[0]);
  const roomsWord = same ? `${rooms[0]} rooms${floors.length > 1 ? " each" : ""}` : `${rooms.reduce((a, b) => a + b, 0)} rooms`;
  const m2 = areaM2Of(plan);
  const what = [`${floorNamesOf(plan)}, ${roomsWord}${m2 ? `, ${m2} m²` : ""}`, plan.reading?.roof ? "the roof" : null, plan.reading?.site ? "the site" : null].filter((s): s is string => !!s);
  const day = dayOf(plan.readAt);
  const scale = scaleSaid(plan);
  return `${day ? `Read on ${day}: ` : ""}${andList(what)}${plan.state === "check" && plan.said ? `. ${plan.said}` : ""}${scale ? `. ${scale}` : ""}`;
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
    /* the scale somebody set first, then the printed one */
    const scaled = on.map((p) => (p.set && p.set.mmPerPx > 0 ? p.set.mmPerPx : p.mmPerPx)).find((mm) => !!mm);
    return {
      id,
      name: on[0].name || defaultFloorName(level),
      level,
      scaleMmPerUnit: scaled ?? null,
      northDeg: null,
      northPos: null,
      plans,
    };
  });

  const sources: PlanImportSource[] = plan.sourceRef ? [{ ref: plan.sourceRef, kind: plan.sourceKind }] : [];
  const placed: Record<number, string> = {};
  const words: NonNullable<PlanImport["words"]> = {};
  const measured: NonNullable<PlanImport["measured"]> = {};
  for (const p of floors) {
    placed[p.n - 1] = p.ref!;
    if (p.words?.length) words[p.n - 1] = p.words;
    if (p.measured) measured[p.n - 1] = { mmPerPx: p.measured.mmPerPx, from: p.measured.from, sure: p.measured.sure };
  }
  const planImport: PlanImport = {
    sources,
    placed,
    chosen: floors.map((p) => p.n - 1),
    names: {},
    ...(Object.keys(words).length ? { words } : {}),
    ...(Object.keys(measured).length ? { measured } : {}),
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
          /* the subfloor onto the floor it is under; one only named stays, said in the floor menu */
          subfloor: r.roof.subfloor && at(r.roof.subfloor.floorId) ? { ...r.roof.subfloor, floorId: at(r.roof.subfloor.floorId)!.floorId, sheetId: at(r.roof.subfloor.floorId)!.sheetId } : r.roof.subfloor?.shown === "mentioned" ? r.roof.subfloor : undefined,
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
