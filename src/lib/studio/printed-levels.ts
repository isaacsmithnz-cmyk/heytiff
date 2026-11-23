/* THE LEVELS A SET PRINTS (Isaac, 23 November 2026: "what about the building
   itself? its worlds away from tiffs build"). A set's sections and
   elevations print each floor's levels as a mark and its RL: 3570's "GF FFL"
   over "RL 194000 mm", "1F FCL" over "RL 200400 mm", "RIDGE" over
   "RL 203420 mm", on every section and elevation alike. Read off the file's
   words, they are the architect's figures, not a picture read's: a floor's
   ceiling is its FCL less its FFL, both printed.

   A mark is taken only when it names its floor plainly (GF, 1F, LG, Level 1,
   First floor…) and the value sits right under it, its edge in line with the
   mark's; a value printed differently for the same mark anywhere in the set
   leaves that mark out rather than choosing. A mark that names no floor
   (GUEST ENSUITE FFL, a bare FFL on a plan) is left out. Pure. */

/** A word of a page with where it is printed: its baseline's left end and its width, in the page's points, y down. */
export type BoxedWord = { text: string; x: number; y: number; w: number };

export type PrintedMark = "ffl" | "fcl";

/** The levels a set prints, in metres: each floor by its place in the stack (the ground 0, the one above 1, a lower ground −1). */
export type PrintedLevels = {
  floors: { level: number; ffl?: number; fcl?: number; pages: number[] }[];
  /** the ridge RLs printed, each once, highest first */
  ridges: number[];
};

/** How far under its mark, points, a value's baseline may sit: 3570 prints it 7.8 pt under. */
const UNDER_PT = 12;
/** How far a value's edge may stand from its mark's, points, for the two to be in line. */
const IN_LINE_PT = 2.5;
/** Two printings of one mark agree within this, metres. */
const AGREE_M = 0.005;

const FLOOR_WORDS: [RegExp, number][] = [
  [/^(?:LG|LGF|LOWER\s+GROUND(?:\s+FLOOR)?)$/, -1],
  [/^(?:GF|G|GROUND(?:\s+FLOOR)?)$/, 0],
  [/^(?:1F|FF|L1|LEVEL\s*1|FIRST(?:\s+FLOOR)?)$/, 1],
  [/^(?:2F|L2|LEVEL\s*2|SECOND(?:\s+FLOOR)?)$/, 2],
  [/^(?:3F|L3|LEVEL\s*3|THIRD(?:\s+FLOOR)?)$/, 3],
];

/** A floor's place in the stack by its name, as a set names it or a read named it; null for a name that doesn't say. */
export function levelOfName(name: string): number | null {
  const t = name.trim().toUpperCase().replace(/\s+/g, " ").replace(/\s+PLAN$/, "");
  for (const [re, level] of FLOOR_WORDS) if (re.test(t)) return level;
  return null;
}

const MARK = /^(.+?)\s+(FFL|FCL)(?:\s+(.+))?$/;
const RIDGE = /^RIDGE(?:\s+(.+))?$/;

/** An RL as printed, in metres: "RL 194000 mm", "RL 193.950", "194.000"; null for anything else (a dimension, a note). */
export function rlOf(text: string): number | null {
  const t = text.trim().toUpperCase();
  const mm = /^(?:RL\s*)?(\d{5,6})\s*MM$/.exec(t) ?? /^RL\s*(\d{5,6})$/.exec(t);
  if (mm) return Number(mm[1]) / 1000;
  const m = /^(?:RL\s*)?(\d{1,4}\.\d{2,3})\s*M?$/.exec(t);
  if (m && (t.startsWith("RL") || /\.\d{3}$/.test(m[1]))) return Number(m[1]);
  return null;
}

type Found = { kind: "floor"; level: number; mark: PrintedMark; rl: number; page: number } | { kind: "ridge"; rl: number; page: number };

/** The value printed right under a mark, its left or right edge in line with the mark's. */
function valueUnder(mark: BoxedWord, words: readonly BoxedWord[], used: Set<BoxedWord>): { word: BoxedWord; rl: number } | null {
  let best: { word: BoxedWord; rl: number; dy: number } | null = null;
  for (const w of words) {
    if (w === mark || used.has(w)) continue;
    const dy = w.y - mark.y;
    if (dy <= 0 || dy > UNDER_PT) continue;
    const inLine = Math.abs(w.x - mark.x) <= IN_LINE_PT || Math.abs(w.x + w.w - (mark.x + mark.w)) <= IN_LINE_PT;
    if (!inLine) continue;
    const rl = rlOf(w.text);
    if (rl == null) continue;
    if (!best || dy < best.dy) best = { word: w, rl, dy };
  }
  return best;
}

/** Every plainly named level printed on one page. */
export function marksOnPage(page: number, words: readonly BoxedWord[]): Found[] {
  const out: Found[] = [];
  const used = new Set<BoxedWord>();
  for (const w of words) {
    const t = w.text.trim().toUpperCase().replace(/\s+/g, " ");
    const m = MARK.exec(t);
    const r = m ? null : RIDGE.exec(t);
    if (!m && !r) continue;
    const level = m ? levelOfName(m[1]) : null;
    if (m && level == null) continue;
    /* its value in the same word ("GF FFL RL 194.000"), else printed under it */
    const inWord = (m ? m[3] : r![1]) ?? "";
    let rl = inWord ? rlOf(inWord) : null;
    if (inWord && rl == null) continue;
    if (rl == null) {
      const v = valueUnder(w, words, used);
      if (!v) continue;
      used.add(v.word);
      rl = v.rl;
    }
    out.push(m ? { kind: "floor", level: level!, mark: m[2].toLowerCase() as PrintedMark, rl, page } : { kind: "ridge", rl, page });
  }
  return out;
}

/** The levels the set's pages print, each mark once: one printed two ways is left out. */
export function printedLevels(pages: readonly { n: number; words: readonly BoxedWord[] }[]): PrintedLevels {
  const found = pages.flatMap((p) => marksOnPage(p.n, p.words));
  const agreed = (rls: number[]) => (rls.length && Math.max(...rls) - Math.min(...rls) <= AGREE_M ? rls[0] : undefined);
  const levels = [...new Set(found.flatMap((f) => (f.kind === "floor" ? [f.level] : [])))].sort((a, b) => a - b);
  const floors = levels.flatMap((level) => {
    const of = (mark: PrintedMark) => found.filter((f): f is Extract<Found, { kind: "floor" }> => f.kind === "floor" && f.level === level && f.mark === mark);
    const ffl = agreed(of("ffl").map((f) => f.rl));
    const fcl = agreed(of("fcl").map((f) => f.rl));
    if (ffl === undefined && fcl === undefined) return [];
    const pages = [...new Set([...of("ffl"), ...of("fcl")].map((f) => f.page))].sort((a, b) => a - b);
    return [{ level, ...(ffl !== undefined ? { ffl } : {}), ...(fcl !== undefined ? { fcl } : {}), pages }];
  });
  const ridges = [...new Set(found.flatMap((f) => (f.kind === "ridge" ? [Math.round(f.rl * 1000)] : [])))].sort((a, b) => b - a).map((mm) => mm / 1000);
  return { floors, ridges };
}

/** How many levels a page prints, each a named mark with its value: the pages a roof's heights are read off are the ones that print most (a schedule's column of "GF FFL" with no RL under it counts none). */
export function marksCount(words: readonly BoxedWord[]): number {
  return marksOnPage(0, words).length;
}

const fmt = (rl: number) => rl.toFixed(3);

/** A floor's ceiling and floor zone as the set prints them, mm, with where; null when its FFL and FCL aren't both printed. */
export function printedCeiling(p: PrintedLevels, level: number): { ceilingMm: number; floorZoneMm: number; source: string } | null {
  const f = p.floors.find((x) => x.level === level);
  if (!f || f.ffl === undefined || f.fcl === undefined || f.fcl <= f.ffl) return null;
  const ceilingMm = Math.round((f.fcl - f.ffl) * 1000);
  const up = p.floors.find((x) => x.level === level + 1)?.ffl;
  const floorZoneMm = up !== undefined && up >= f.fcl ? Math.round((up - f.fcl) * 1000) : 0;
  return { ceilingMm, floorZoneMm, source: `printed: FFL RL ${fmt(f.ffl)}, FCL RL ${fmt(f.fcl)} (page${f.pages.length > 1 ? "s" : ""} ${f.pages.join(", ")})` };
}
