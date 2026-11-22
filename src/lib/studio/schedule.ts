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

/** Each opening given its schedule's size, by its mark, else by its type when
    the plan writes the type. An opening the schedule doesn't list keeps its read width. */
export function withSchedule(sheet: SheetReading, items: readonly ScheduleItem[]): { sheet: SheetReading; matched: number } {
  const byMark = new Map<string, ScheduleItem>();
  const byType = new Map<string, ScheduleItem>();
  for (const it of items) {
    if (!(it.widthMm > 0)) continue;
    if (it.mark) byMark.set(markKey(it.mark), it);
    if (it.type && !byType.has(markKey(it.type))) byType.set(markKey(it.type), it);
  }
  let matched = 0;
  const openings = (sheet.openings ?? []).map((o): ReadOpening => {
    if (!o.tag) return o;
    /* a plan writes a mark, a type, or both ("GW.21 W.05"), a mark sometimes
       split by a space as read ("FW 03 W.06"): each word, and each two together */
    const words = o.tag.split(/[\s/,]+/).filter(Boolean);
    const parts = [...words.slice(0, -1).map((w, i) => w + words[i + 1]), ...words];
    const it = parts.map((p) => byMark.get(markKey(p))).find(Boolean) ?? parts.map((p) => byType.get(markKey(p))).find(Boolean);
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

/** The schedule's answer, checked: a size outside what a door or a window can be is dropped. */
export function itemsOf(raw: unknown, page: number): ScheduleItem[] {
  const list = Array.isArray((raw as { items?: unknown })?.items) ? (raw as { items: Record<string, unknown>[] }).items : [];
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v) : 0);
  const s = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  const out: ScheduleItem[] = [];
  for (const r of list) {
    const kind = r.kind === "door" || r.kind === "skylight" ? r.kind : "window";
    const widthMm = n(r.width_mm);
    const heightMm = n(r.height_mm);
    if (!s(r.mark) || widthMm < 200 || widthMm > 12000 || (heightMm && (heightMm < 200 || heightMm > 6000))) continue;
    const sill = n(r.sill_mm);
    out.push({ mark: s(r.mark), type: s(r.type), kind, widthMm, heightMm, sillMm: sill > 0 && sill < 3000 ? sill : 0, page });
  }
  return out;
}

/** An opening the read left untagged (most doors) given the schedule mark the
    plan prints nearest it, within `reach` of its middle, in the sheet's pixels:
    3570's door marks, LD.01 and GD.10, sit in boxes beside each door. */
export function taggedFromWords(sheet: SheetReading, words: readonly { text: string; at: { x: number; y: number } }[], items: readonly ScheduleItem[], reach: number): SheetReading {
  const known = new Set(items.flatMap((i) => [markKey(i.mark), ...(i.type ? [markKey(i.type)] : [])]));
  /* a mark an opening already carries isn't another's */
  const carried = new Set((sheet.openings ?? []).flatMap((o) => {
    const w = o.tag.split(/[\s/,]+/).filter(Boolean);
    return [...w.slice(0, -1).map((x, i) => markKey(x + w[i + 1])), ...w.map(markKey)];
  }));
  const marks = words.filter((w) => known.has(markKey(w.text)) && !carried.has(markKey(w.text)));
  if (!marks.length) return sheet;
  const used = new Set<(typeof marks)[number]>();
  const openings = (sheet.openings ?? []).map((o): ReadOpening => {
    if (o.tag) return o;
    const mid = { x: (o.a.x + o.b.x) / 2, y: (o.a.y + o.b.y) / 2 };
    let best: (typeof marks)[number] | null = null;
    let far = reach;
    for (const w of marks) {
      if (used.has(w)) continue;
      const d = Math.hypot(w.at.x - mid.x, w.at.y - mid.y);
      if (d <= far) {
        best = w;
        far = d;
      }
    }
    if (!best) return o;
    used.add(best);
    return { ...o, tag: best.text.trim() };
  });
  return { ...sheet, openings };
}
