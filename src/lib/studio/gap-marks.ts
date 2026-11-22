import { markKey, type ScheduleItem } from "./schedule";
import type { ReadOpening, ReadPoint, ReadSpace, SheetReading, WallGap } from "./reading";

/* THE MARKS IN THE GAPS. Where a floor's drawing file draws its walls, every
   door and window is a gap in them, and the set prints each one's schedule
   mark beside it (GW.14, GD.08). Each printed mark goes to the gap it sits
   by, and the gap holds the door or the window the schedule lists under that
   mark, at its scheduled width, height and sill: a gap with three marks
   along it is three windows, side by side where their marks are. This is how
   the outside study of 3570 placed 106 of its 127 openings (its model.py,
   22 November 2026: printed tags matched to gaps by distance along and
   across them and by width); the picture read, which tags a window by eye
   and leaves most doors untagged, gave 3570's ground floor 38 of its 48
   printed marks, with three windows to a gap in one and doors' marks a metre
   off. Pure. */

type Pt = ReadPoint;
type Word = { text: string; at: Pt };

/** what a mark may sit off its gap, along it past an end counted 2.5 times: 2 m */
const REACH_MM = 2000;
/** a gap at least this share of a mark's width can hold it (a 1.5 m door in a 1.35 m gap) */
const FITS = 0.55;
/** a gap's marks' widths together within this share of its length */
const ROOM_FOR = 1.3;
/** one opening this share of its gap or more fills it jamb to jamb */
const FILLS = 0.77;
/** a sliver of wall under this left at a gap's end is taken into the opening */
const SLIVER_MM = 250;

const INDOOR = new Set(["room", "wet", "cupboard", "garage", "circulation"]);
const FACES = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"] as const;

function inside(p: Pt, poly: readonly Pt[]): boolean {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) hit = !hit;
  }
  return hit;
}

/** a point's place against a gap: how far along it from a (in its length's share), across it, and past its ends */
function against(p: Pt, g: WallGap) {
  const dx = g.b.x - g.a.x;
  const dy = g.b.y - g.a.y;
  const len = Math.hypot(dx, dy) || 1;
  const along = ((p.x - g.a.x) * dx + (p.y - g.a.y) * dy) / len;
  const across = Math.abs((p.x - g.a.x) * dy - (p.y - g.a.y) * dx) / len;
  const past = along < 0 ? -along : along > len ? along - len : 0;
  return { t: along / len, across, past, len };
}

/** The compass way out of a wall, from the way out on the sheet and the way plan-up faces; "" when the plan doesn't say. */
export function facingFrom(out: Pt, planUp: string): string {
  const up = (FACES as readonly string[]).indexOf(planUp.toUpperCase().trim());
  if (up < 0 || !(Math.hypot(out.x, out.y) > 0)) return "";
  /* clockwise from the sheet's top */
  const deg = (Math.atan2(out.x, -out.y) * 180) / Math.PI;
  return FACES[(((Math.round((up * 45 + deg) / 45) % 8) + 8) % 8)];
}

/** The room a gap's opening belongs to, whether it opens to outside, and which way. */
function sidesOf(g: WallGap, mid: Pt, spaces: readonly ReadSpace[], planUp: string) {
  const dx = g.b.x - g.a.x;
  const dy = g.b.y - g.a.y;
  const len = Math.hypot(dx, dy) || 1;
  const n = { x: -dy / len, y: dx / len };
  const off = g.t / 2 + Math.max(6, g.t);
  const at = (s: number) => ({ x: mid.x + n.x * off * s, y: mid.y + n.y * off * s });
  const hold = (p: Pt) => spaces.filter((s) => (s.outline?.length ?? 0) >= 3 && inside(p, s.outline));
  const one = hold(at(1));
  const two = hold(at(-1));
  const inOne = one.find((s) => INDOOR.has(s.kind));
  const inTwo = two.find((s) => INDOOR.has(s.kind));
  const room = (inOne ?? inTwo ?? one[0] ?? two[0])?.name ?? "";
  const external = !(inOne && inTwo);
  const out = inOne && !inTwo ? { x: -n.x, y: -n.y } : n;
  return { room, external, facing: external ? facingFrom(out, planUp) : "" };
}

/** Each schedule mark printed on a walled floor put in the gap it sits by,
    as the door or the window the schedule lists for it. The picture read's
    openings that one stands for (by its mark, or by being in the same gap)
    give way to it and lend it their room; the rest stay as read. `mmPerPx`
    is the sheet's scale. */
export function marksInGaps(sheet: SheetReading, words: readonly Word[], items: readonly ScheduleItem[], mmPerPx: number): { sheet: SheetReading; placed: number } {
  const gaps = sheet.walled?.gaps ?? [];
  if (!gaps.length || !(mmPerPx > 0)) return { sheet, placed: 0 };
  const byMark = new Map(items.filter((i) => i.widthMm > 0 && i.mark).map((i) => [markKey(i.mark), i]));
  const marks = words.filter((w) => byMark.has(markKey(w.text)));
  if (!marks.length) return { sheet, placed: 0 };
  const px = (mm: number) => mm / mmPerPx;

  /* every mark against every gap it could be in, nearest first */
  const pairs: { m: number; g: number; cost: number; t: number }[] = [];
  marks.forEach((w, m) => {
    const it = byMark.get(markKey(w.text))!;
    if (it.kind === "skylight") return;
    gaps.forEach((g, j) => {
      const s = against(w.at, g);
      if (s.len < FITS * px(it.widthMm)) return;
      const cost = Math.hypot(s.across, 2.5 * s.past);
      if (cost <= px(REACH_MM)) pairs.push({ m, g: j, cost, t: Math.max(0, Math.min(1, s.t)) });
    });
  });
  pairs.sort((a, b) => a.cost - b.cost);
  const placedMark = new Set<string>();
  const usedWord = new Set<number>();
  const held = new Map<number, { it: ScheduleItem; t: number }[]>();
  for (const p of pairs) {
    const it = byMark.get(markKey(marks[p.m].text))!;
    const k = markKey(it.mark);
    if (usedWord.has(p.m) || placedMark.has(k)) continue;
    const g = gaps[p.g];
    const len = Math.hypot(g.b.x - g.a.x, g.b.y - g.a.y);
    const mine = held.get(p.g) ?? [];
    if (mine.reduce((t, h) => t + px(h.it.widthMm), 0) + px(it.widthMm) > ROOM_FOR * len) continue;
    mine.push({ it, t: p.t });
    held.set(p.g, mine);
    usedWord.add(p.m);
    placedMark.add(k);
  }
  if (!held.size) return { sheet, placed: 0 };

  /* the picture read's openings these stand for */
  const picture = sheet.openings ?? [];
  const partsOf = (tag: string) => {
    const w = tag.split(/[\s/,]+/).filter(Boolean);
    return [...w.slice(0, -1).map((x, i) => markKey(x + w[i + 1])), ...w.map(markKey)];
  };
  const markOf = (o: ReadOpening) => partsOf(o.tag).find((p) => byMark.has(p));
  const inGapOf = (o: ReadOpening): number | undefined => {
    const mid = { x: (o.a.x + o.b.x) / 2, y: (o.a.y + o.b.y) / 2 };
    for (const j of held.keys()) {
      const s = against(mid, gaps[j]);
      if (s.past === 0 && s.across <= Math.max(4 * gaps[j].t, 8)) return j;
    }
    return undefined;
  };
  const gone = new Set<number>();
  const lender = new Map<string, ReadOpening>();
  const lenderIn = new Map<number, ReadOpening[]>();
  picture.forEach((o, i) => {
    const k = markOf(o);
    if (k && placedMark.has(k)) {
      gone.add(i);
      if (!lender.has(k)) lender.set(k, o);
      return;
    }
    if (k && byMark.has(k) && !placedMark.has(k)) return; /* its mark is printed but found no gap: it stays as read */
    const j = inGapOf(o);
    if (j === undefined) return;
    gone.add(i);
    lenderIn.set(j, [...(lenderIn.get(j) ?? []), o]);
  });

  const made: ReadOpening[] = [];
  for (const [j, list] of held) {
    const g = gaps[j];
    const dx = g.b.x - g.a.x;
    const dy = g.b.y - g.a.y;
    const L = Math.hypot(dx, dy);
    const u = { x: dx / L, y: dy / L };
    list.sort((a, b) => a.t - b.t);
    const want = list.map((h) => px(h.it.widthMm));
    const total = want.reduce((t, w) => t + w, 0);
    const k = Math.min(1, L / total);
    const w = want.map((x) => x * k);
    let spans: [number, number][];
    if (list.length === 1 && w[0] >= FILLS * L) spans = [[0, L]];
    else {
      const c = list.map((h, i) => Math.max(w[i] / 2, Math.min(L - w[i] / 2, h.t * L)));
      for (let i = 1; i < c.length; i++) c[i] = Math.max(c[i], c[i - 1] + (w[i - 1] + w[i]) / 2);
      for (let i = c.length - 1; i >= 0; i--) c[i] = Math.min(c[i], (i === c.length - 1 ? L : c[i + 1] - w[i + 1] / 2) - w[i] / 2);
      spans = c.map((x, i) => [x - w[i] / 2, x + w[i] / 2]);
      if (spans[0][0] < px(SLIVER_MM)) spans[0][0] = 0;
      if (L - spans[spans.length - 1][1] < px(SLIVER_MM)) spans[spans.length - 1][1] = L;
    }
    const by = lenderIn.get(j) ?? [];
    list.forEach((h, i) => {
      const [s0, s1] = spans[i];
      const a = { x: g.a.x + u.x * s0, y: g.a.y + u.y * s0 };
      const b = { x: g.a.x + u.x * s1, y: g.a.y + u.y * s1 };
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const listed = h.it.kind === "door" ? "door" : "window";
      const from = lender.get(markKey(h.it.mark)) ?? by.find((o) => o.kind === listed) ?? by[0];
      /* the read's own word for it where it read this mark: a schedule lists a
         full-height pane with no sill among its doors as often as its windows
         (3570's GW.26, 1000 by 3000), and the glass is the room's either way */
      const kind = from && markOf(from) === markKey(h.it.mark) && from.kind !== "skylight" ? from.kind : listed;
      const side = from && from.room ? { room: from.room, external: from.external, facing: from.facing } : sidesOf(g, mid, sheet.spaces ?? [], sheet.planUp ?? "");
      made.push({
        kind,
        tag: h.it.mark,
        a,
        b,
        widthMm: h.it.widthMm,
        ...side,
        ...(h.it.heightMm > 0 ? { heightMm: h.it.heightMm } : {}),
        ...(h.it.sillMm > 0 ? { sillMm: h.it.sillMm } : {}),
        inGap: true,
      });
    });
  }
  return { sheet: { ...sheet, openings: [...picture.filter((_, i) => !gone.has(i)), ...made] }, placed: made.length };
}
