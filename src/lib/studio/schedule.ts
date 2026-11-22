import type { ReadOpening, SheetReading } from "./reading";

/* THE DOOR AND WINDOW SCHEDULE. A set gives every window and door a mark on
   its plans (GW.21, W1.3, D04) and its size on a schedule sheet: a table of
   marks, a legend of types with the marks of each listed under it (3570's
   A901), or elevations with their sizes drawn on (Ipsum). The floor read
   finds each opening's mark and guesses its width; the schedule gives its
   width, its height and its sill, so its glass and its place in the wall are
   the architect's, not a 1.2 m guess (the outside study of 3570, 22 November
   2026, matched 106 of 127 plan marks to schedule rows this way). Pure. */

export type ScheduleItem = {
  mark: string;
  /** the type it is listed under, "" when the schedule has none */
  type: string;
  kind: "window" | "door" | "skylight";
  widthMm: number;
  heightMm: number;
  /** above the floor; 0 when not shown */
  sillMm: number;
  /** the page it is on */
  page: number;
};

/** A mark as a key: "GW.21", "gw 21" and "GW-21" are one. */
export const markKey = (s: string) => s.toUpperCase().replace(/[\s.\-_]/g, "");

/* a word that is a window's or a door's mark: letters then a figure, as plans write them */
const MARK = /^[A-Z]{1,3}[.\-]?\d{1,3}(\.\d{1,2})?[A-Z]?$/i;
const TITLE = /\b(window|door|glazing)s?\s*(schedule|types?|legend)\b/i;

/** Whether a page is a door or window schedule, by its words: its title, or a
    width and a height over a dozen marks. */
export function isSchedulePage(words: readonly { text: string }[]): boolean {
  const all = words.map((w) => w.text).join(" ");
  if (TITLE.test(all)) return true;
  const marks = words.filter((w) => MARK.test(w.text.trim())).length;
  return /\bwidth\b/i.test(all) && /\bheight\b/i.test(all) && marks >= 12;
}

/** A tag's words as keys, and each two together: a plan writes a mark, a
    type, or both ("GW.21 W.05"), a mark sometimes split by a space as read
    ("FW 03 W.06"). */
export function partsOf(tag: string): string[] {
  const w = tag.split(/[\s/,]+/).filter(Boolean);
  return [...w.slice(0, -1).map((x, i) => markKey(x + w[i + 1])), ...w.map(markKey)];
}

/* each key's size where every listing of it gives the one size: a mark
   listed twice (on two of the three pages read, or a note read as a
   listing) at 600 and at 2400 is neither, not whichever came last. A height
   or a sill one listing doesn't show is the other's; two sills shown
   differently are left out (a type's marks sit at their own heights) */
function sizedBy(items: readonly ScheduleItem[], keyOf: (it: ScheduleItem) => string): Map<string, ScheduleItem> {
  const out = new Map<string, ScheduleItem>();
  const two = new Set<string>();
  const noSill = new Set<string>();
  for (const it of items) {
    const k = keyOf(it);
    if (!k || !(it.widthMm > 0) || two.has(k)) continue;
    const had = out.get(k);
    if (!had) out.set(k, it);
    else if (had.widthMm !== it.widthMm || (had.heightMm > 0 && it.heightMm > 0 && had.heightMm !== it.heightMm)) {
      out.delete(k);
      two.add(k);
    } else {
      if (had.sillMm > 0 && it.sillMm > 0 && had.sillMm !== it.sillMm) noSill.add(k);
      out.set(k, { ...had, heightMm: had.heightMm || it.heightMm, sillMm: noSill.has(k) ? 0 : had.sillMm || it.sillMm });
    }
  }
  return out;
}

/** The schedule by mark, a mark listed at two sizes left out. */
export const byMarkOf = (items: readonly ScheduleItem[]) => sizedBy(items, (it) => (it.mark ? markKey(it.mark) : ""));

/** Each opening given its schedule's size, by its mark, else by its type when
    the plan writes the type. An opening the schedule doesn't list keeps its read width. */
export function withSchedule(sheet: SheetReading, items: readonly ScheduleItem[]): { sheet: SheetReading; matched: number } {
  const byMark = byMarkOf(items);
  const byType = sizedBy(items, (it) => (it.type ? markKey(it.type) : ""));
  let matched = 0;
  const openings = (sheet.openings ?? []).map((o): ReadOpening => {
    if (!o.tag) return o;
    const parts = partsOf(o.tag);
    const it = parts.map((p) => byMark.get(p)).find(Boolean) ?? parts.map((p) => byType.get(p)).find(Boolean);
    if (!it) return o;
    matched++;
    return {
      ...o,
      widthMm: it.widthMm,
      ...(it.heightMm > 0 ? { heightMm: it.heightMm } : {}),
      ...(it.sillMm > 0 ? { sillMm: it.sillMm } : {}),
    };
  });
  return { sheet: { ...sheet, openings }, matched };
}

/** The schedule's answer, checked: a size outside what a door or a window can
    be is dropped. Given the page's own words, a width the page doesn't print
    drops its mark, and a height or a sill it doesn't print is left out: the
    read is told to take its figures from the words, and one it worked out
    or misread is no size of the architect's. */
export function itemsOf(raw: unknown, page: number, words: readonly { text: string }[] = []): ScheduleItem[] {
  const list = Array.isArray((raw as { items?: unknown })?.items) ? (raw as { items: Record<string, unknown>[] }).items : [];
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v) : 0);
  const s = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  /* every figure the page prints, "1,800" as 1800 too */
  const figures = new Set(words.flatMap((w) => [...w.text.matchAll(/\d+/g), ...w.text.replace(/(\d),(\d{3})/g, "$1$2").matchAll(/\d+/g)].map((m) => Number(m[0]))));
  const printed = (v: number) => !words.length || figures.has(v);
  const out: ScheduleItem[] = [];
  for (const r of list) {
    const kind = r.kind === "door" || r.kind === "skylight" ? r.kind : "window";
    const widthMm = n(r.width_mm);
    const heightMm = n(r.height_mm);
    if (!s(r.mark) || widthMm < 200 || widthMm > 12000 || !printed(widthMm) || (heightMm && (heightMm < 200 || heightMm > 6000))) continue;
    const sill = n(r.sill_mm);
    out.push({ mark: s(r.mark), type: s(r.type), kind, widthMm, heightMm: printed(heightMm) ? heightMm : 0, sillMm: sill > 0 && sill < 3000 && printed(sill) ? sill : 0, page });
  }
  return out;
}

type Word = { text: string; at: { x: number; y: number } };

/** How far a point is from an opening: to the nearest point along it. */
export function offOpening(p: { x: number; y: number }, o: Pick<ReadOpening, "a" | "b">): number {
  const dx = o.b.x - o.a.x;
  const dy = o.b.y - o.a.y;
  const t = dx || dy ? Math.max(0, Math.min(1, ((p.x - o.a.x) * dx + (p.y - o.a.y) * dy) / (dx * dx + dy * dy))) : 0;
  return Math.hypot(p.x - o.a.x - t * dx, p.y - o.a.y - t * dy);
}

/** An opening's read tag as far as the plan prints it by the opening, within
    `reach`. The read tags by eye: a GW.17 misread where the plan prints GW.12
    would take GW.17's size and lend it its room. The marks and types the tag
    names that are printed by it stay, as printed; the rest go, and a tag the
    plan prints none of is "". A tag naming nothing the schedule lists is
    left as read. `printed` is the plan's words that name a mark or a type in
    `known`. */
export function checkedTag(o: ReadOpening, printed: readonly Word[], known: ReadonlySet<string>, reach: number): string {
  const mine = [...new Set(partsOf(o.tag))].filter((p) => known.has(p));
  if (!mine.length) return o.tag;
  const by = printed.filter((w) => mine.includes(markKey(w.text)) && offOpening(w.at, o) <= reach);
  const seen = mine.filter((k) => by.some((w) => markKey(w.text) === k));
  if (seen.length === mine.length) return o.tag;
  return seen.map((k) => by.find((w) => markKey(w.text) === k)!.text.trim()).join(" ");
}

/** Each read tag checked against the marks the plan prints by it (checkedTag,
    within `reach`), and an opening left untagged (most doors, and a misread)
    given the mark the plan prints nearest its middle, within `reach`, in the
    sheet's pixels: 3570's door marks, LD.01 and GD.10, sit in boxes beside
    each door. Each mark goes to the opening nearest it. An opening set in
    its wall's gap was put there by its printed mark, or checked against the
    marks then (gap-marks.ts), and keeps its tag. A plan that prints none of
    the schedule's marks as words (drawn as lines) has nothing to check a tag
    by, and is left as read. */
export function taggedFromWords(sheet: SheetReading, words: readonly Word[], items: readonly ScheduleItem[], reach: number): SheetReading {
  const known = new Set(items.flatMap((i) => [markKey(i.mark), ...(i.type ? [markKey(i.type)] : [])]));
  const printed = words.filter((w) => known.has(markKey(w.text)));
  if (!printed.length) return sheet;
  const read = (sheet.openings ?? []).map((o): ReadOpening => {
    if (!o.tag || o.inGap) return o;
    const tag = checkedTag(o, printed, known, reach);
    return tag === o.tag ? o : { ...o, tag };
  });
  /* a mark an opening already carries isn't another's */
  const carried = new Set(read.flatMap((o) => partsOf(o.tag)));
  const marks = printed.filter((w) => !carried.has(markKey(w.text)));
  /* every untagged opening against every free mark in reach, nearest first */
  const pairs: { o: number; w: number; d: number }[] = [];
  read.forEach((o, i) => {
    if (o.tag) return;
    const mid = { x: (o.a.x + o.b.x) / 2, y: (o.a.y + o.b.y) / 2 };
    marks.forEach((w, j) => {
      const d = Math.hypot(w.at.x - mid.x, w.at.y - mid.y);
      if (d <= reach) pairs.push({ o: i, w: j, d });
    });
  });
  pairs.sort((a, b) => a.d - b.d);
  const tagOf = new Map<number, string>();
  const used = new Set<number>();
  for (const p of pairs) {
    if (tagOf.has(p.o) || used.has(p.w)) continue;
    tagOf.set(p.o, marks[p.w].text.trim());
    used.add(p.w);
  }
  const openings = read.map((o, i) => (tagOf.has(i) ? { ...o, tag: tagOf.get(i)! } : o));
  return { ...sheet, openings };
}
