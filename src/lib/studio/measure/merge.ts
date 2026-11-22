import type { ReadLook, ReadOpening, ReadPoint, ReadSpace, SheetReading, SpaceJoin, WallGap } from "../reading";
import { agreement, inside } from "./rooms";

/* THE MEASURED ROOMS INTO THE SHEET'S READING. A floor is still read by
   picture for what measuring doesn't give: its doors and windows, joinery,
   fans, notes and furniture. Its ROOMS are the measured ones, which stand on
   the walls. The picture read's own rooms aren't thrown away unlooked-at:
   they are a second reader (Isaac, 21 November 2026: "multiple checks?").
   A walled room only it found is said, for a person to look at; and when
   the measured read plainly came out worse than the picture's (far fewer
   rooms, or a pile of rooms that overlap or sit on no wall), the picture's
   rooms stay and the measured ones are set aside, said so. Pure. */

export type MeasuredRooms = { /** "file": read from the drawing file (lib/studio/vector), whose unnamed spaces may be yards */ from?: "file"; spaces: ReadSpace[]; look: ReadLook[]; grid: { x: number[]; y: number[] }; rounds: number; frame?: { left: number; top: number; width: number; height: number }; /** the file's own walls and the gaps in them */ walls?: ReadPoint[][][]; gaps?: WallGap[]; /** a named room and the unnamed spaces it may be one room with (vector/read.ts) */ joins?: SpaceJoin[] };

const WALLED = new Set(["room", "wet", "cupboard", "garage"]);
/* a measured room and a picture room are one when they share this much of their area (overlapOf) */
const SHARED = 0.5;
const walledIn = (spaces: readonly ReadSpace[]) => spaces.filter((s) => WALLED.has(s.kind) && (s.outline?.length ?? 0) >= 3);

/** Why a measured read isn't to be trusted over the picture's, or null when it is. */
export function setAside(picture: SheetReading | null, m: MeasuredRooms): string | null {
  const mine = walledIn(m.spaces).length;
  const bad = m.look.filter((l) => l.kind === "overlap" || l.kind === "off_wall" || l.kind === "shape" || l.kind === "small").length;
  if (bad > Math.max(2, m.spaces.length * 0.25)) return `${bad} of its ${m.spaces.length} rooms overlapped or sat on no wall`;
  if (picture) {
    const theirs = walledIn(picture.spaces).length;
    if (theirs >= 4 && mine < theirs * 0.6) return `it found ${mine} walled rooms where the read by picture found ${theirs}`;
  }
  return null;
}

/** A sheet's reading with its rooms measured. `picture` is the read by
    picture, or null when that one failed: the rooms then stand alone. */
export function withMeasured(picture: SheetReading | null, m: MeasuredRooms, sheetId: string): SheetReading {
  /* rooms read from the drawing file, with a picture read to lead */
  if (m.from === "file" && picture) {
    const { spaces, opened } = pictureLed(picture.spaces, m.spaces, m.joins);
    /* a gap inside a room the picture read shows whole is no door's or window's place */
    const gaps = (m.gaps ?? []).filter((_, i) => !opened.includes(i));
    const homed = rehomed(picture, spaces);
    const walls = m.walls?.length ? { walls: m.walls, gaps } : {};
    return { ...picture, ...homed, openings: gaps.length ? onGaps(homed.openings, gaps) : homed.openings, spaces, walled: { grid: m.grid, rounds: m.rounds, look: [...m.look], ...walls } };
  }
  const why = setAside(picture, m);
  if (why && picture) return { ...picture, walled: { grid: m.grid, rounds: m.rounds, look: [{ kind: "readers", room: "", said: `The rooms were also measured off the walls, and that read was set aside: ${why}.` }] } };
  const look = [...m.look];
  /* nothing to fall back on: the measured rooms stand, and why they are doubted is said */
  if (why) look.push({ kind: "readers", room: "", said: `The measured rooms are doubtful (${why}), and the read by picture failed, so there was nothing to check them against.` });
  /* a named room that opens wider than a doorway onto a space with no name
     may be one room with it, and only the read by picture could say: with
     none, it is the part the plan names, and that is said */
  if (!picture)
    for (const j of m.joins ?? []) {
      const name = m.spaces[j.into]?.name;
      if (name) look.push({ kind: "label", room: name, said: `${name}: it opens wider than a doorway onto a space the plan gives no name, which may be part of it. There was no read by picture to tell, so it is only the part the plan names.` });
    }
  /* SHE NAMES ONLY WHAT SHE IS SHOWN. Her picture is the part of the sheet
     the found walls stand on, so where only some of a building's walls were
     found (new walls in colour, a garage in outline across the yard) the
     rest lay outside it, and those rooms dropped off the floor with nothing
     said (the engine's review, 21 November 2026: Pariatur's Bed 4 and
     Lounge, Mythos's garage). A room the picture read drew outside her
     picture is kept as it drew it. */
  const fr = m.frame;
  const out = (s: ReadSpace) => {
    const c = mean(s.outline ?? []);
    return !!fr && !!c && (s.outline?.length ?? 0) >= 3 && (c.x < fr.left || c.x > fr.left + fr.width || c.y < fr.top || c.y > fr.top + fr.height);
  };
  const beyond = picture ? picture.spaces.filter(out) : [];
  if (beyond.length) look.push({ kind: "readers", room: "", said: `${[...new Set(beyond.map((s) => s.name))].join(", ")}: outside the part of the sheet that was measured, so ${beyond.length === 1 ? "it is" : "they are"} as the read by picture drew ${beyond.length === 1 ? "it" : "them"}.` });
  /* A ROOM MEASURED WITH NO NAME takes the name the picture read gives the
     room that is plainly it, the two sharing at least half their area: a
     plan whose names aren't text (Pariatur draws them), a hall, a robe or a
     WC the plan leaves unlabelled (22 November 2026: 3570's entry hall and
     hall were dropped, unnamed, where the picture read had them). Not one
     whose middle merely lies in the other: a robe inside the bedroom the
     picture drew round it isn't the bedroom. Two such rooms, and it is
     left unnamed. */
  const NAMES = new Set([...WALLED, "circulation"]);
  const has = (s: ReadSpace) => (s.outline?.length ?? 0) >= 3;
  const taken = new Set<ReadSpace>();
  const measured = m.spaces
    .map((s) => {
      if (s.named || !picture || !has(s)) return s;
      const hits = picture.spaces.filter((p) => !taken.has(p) && NAMES.has(p.kind) && has(p) && boxed(p.outline, s.outline) && overlapOf(p.outline, s.outline) >= SHARED);
      if (hits.length !== 1) return s;
      taken.add(hits[0]);
      return { ...s, name: hits[0].name, named: hits[0].named, kind: hits[0].kind };
    })
    .filter((s) => s.named || s.kind === "cupboard" || !m.from);
  /* what walls don't close off is the picture's to give: a terrace, a void,
     a stair in a hall, where the measured rooms have none of their own there */
  const OPEN = new Set(["outdoor", "void", "notch", "stair"]);
  const open = picture
    ? picture.spaces.filter(
        (p) => OPEN.has(p.kind) && !beyond.includes(p) && (p.outline?.length ?? 0) >= 3 && !measured.some((s) => s.kind === p.kind && (s.outline?.length ?? 0) >= 3 && inside(mean(s.outline)!, p.outline)),
      )
    : [];
  const spaces = [...measured, ...beyond, ...open];
  if (picture) {
    const a = agreement(spaces, picture.spaces);
    const missed = walledIn(picture.spaces).filter((s) => a.onlyB.includes(s.name) && !beyond.includes(s));
    /* said once each: a house has several ensuites, and a list of six is one thing to look at */
    for (const name of [...new Set(missed.map((s) => s.name))])
      look.push({ kind: "readers", room: name, said: `${name}: a second read of the plan found this room and the measured one didn't. Check it isn't missing.` });
    /* one space, two names: a walled room the second read calls something
       else, when the plan writes both names (a reader's own label for an
       unnamed cupboard is no disagreement) */
    for (const d of a.differ)
      if (WALLED.has(d.a.kind) && WALLED.has(d.b.kind) && d.a.named && d.b.named)
        look.push({ kind: "readers", room: d.a.name, said: `${d.a.name}: a second read of the plan calls this room ${d.b.name}. Check which it is.` });
  }
  const base: SheetReading = picture ?? { sheetId, spaces: [], openings: [], marks: [], furniture: [], checklist: [], flags: [], planUp: "" };
  return { ...base, ...(picture ? rehomed(picture, spaces) : {}), spaces, walled: { grid: m.grid, rounds: m.rounds, look } };
}

/* WHAT THE PICTURE FOUND, ON THE MEASURED ROOMS. The picture read names the
   room each door, window, fan, note and piece of furniture belongs to, by its
   own room names; the measured rooms are named by another question, so
   "KITCHEN / FAMILY ROOM" there is "Kitchen, Wet Bar Area" and "Family Room"
   here. Everything after the read joins by name (a room's glass, its outside
   walls, its fans), so left as they were, 3570's ground floor lost a third of
   its windows to rooms that no longer exist, and its loads came out low with
   nothing said (the engine's review, 21 November 2026). So each one is moved
   onto the measured room it belongs to: the one it sits in or on, preferring
   one that stands where its picture room stood. Pure. */

type Pt = ReadPoint;
const mean = (pts: readonly Pt[]): Pt | null =>
  pts.length ? { x: pts.reduce((n, p) => n + p.x, 0) / pts.length, y: pts.reduce((n, p) => n + p.y, 0) / pts.length } : null;

/* how far a point is from a room: 0 inside, else to its nearest side */
function apart(p: Pt, poly: readonly Pt[]): number {
  if (inside(p, poly)) return 0;
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const t = dx || dy ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy))) : 0;
    best = Math.min(best, Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy)));
  }
  return best;
}

const key = (s: string) => s.trim().toLowerCase();

/** The picture read's openings, marks and furniture, each named for the measured room it belongs to. */
export function rehomed(picture: SheetReading, spaces: readonly ReadSpace[]): Pick<SheetReading, "openings" | "marks" | "furniture"> {
  const mine = spaces.filter((s) => (s.outline?.length ?? 0) >= 3);
  if (!mine.length) return { openings: picture.openings, marks: picture.marks, furniture: picture.furniture };
  const names = new Map(mine.map((s) => [key(s.name), s.name]));
  /* the measured rooms a picture room's name stands for: those whose middle
     lies in one of its outlines, or that hold one of its middles */
  const pairs = new Map<string, Set<ReadSpace>>();
  for (const p of picture.spaces) {
    if ((p.outline?.length ?? 0) < 3) continue;
    const pm = mean(p.outline)!;
    const set = pairs.get(key(p.name)) ?? new Set<ReadSpace>();
    for (const m of mine) if (inside(mean(m.outline)!, p.outline) || inside(pm, m.outline)) set.add(m);
    pairs.set(key(p.name), set);
  }
  /* near enough to be on a room's wall: a fortieth of the building's span */
  const xs = mine.flatMap((s) => s.outline.map((p) => p.x));
  const ys = mine.flatMap((s) => s.outline.map((p) => p.y));
  const near = Math.max(6, Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) / 40);
  const home = (room: string, at: Pt | null): string => {
    const same = names.get(key(room));
    if (same) return same;
    const paired = [...(pairs.get(key(room)) ?? [])];
    if (at) {
      const by = mine.map((s) => ({ s, d: apart(at, s.outline) })).filter((c) => c.d <= near);
      const best = (list: typeof by) => list.sort((a, b) => a.d - b.d)[0]?.s.name;
      return best(by.filter((c) => paired.includes(c.s))) ?? (paired.length === 1 ? paired[0].name : best(by)) ?? room;
    }
    return paired.length === 1 ? paired[0].name : room;
  };
  return {
    openings: (picture.openings ?? []).map((o) => ({ ...o, room: home(o.room, mean([o.a, o.b])) })),
    marks: (picture.marks ?? []).map((k) => ({ ...k, room: home(k.room, mean(k.outline ?? [])) })),
    furniture: (picture.furniture ?? []).map((f) => ({ ...f, room: home(f.room, mean(f.outline ?? [])) })),
  };
}


/* ── the picture read leads, the file gives the outlines ── */

/** How much two outlines are one room: their shared area over the area of
    either, sampled on a grid of about 40 by 40 across them both. */
export function overlapOf(a: readonly Pt[], b: readonly Pt[]): number {
  const xs = [...a, ...b].map((p) => p.x);
  const ys = [...a, ...b].map((p) => p.y);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const step = Math.max(1, Math.max(x1 - x0, y1 - y0) / 40);
  let both = 0;
  let either = 0;
  for (let y = y0 + step / 2; y < y1; y += step)
    for (let x = x0 + step / 2; x < x1; x += step) {
      const p = { x, y };
      const ia = inside(p, a);
      const ib = inside(p, b);
      if (ia && ib) both++;
      if (ia || ib) either++;
    }
  return either ? both / either : 0;
}

const boxed = (a: readonly Pt[], b: readonly Pt[]) => {
  const ax = a.map((p) => p.x), ay = a.map((p) => p.y), bx = b.map((p) => p.x), by = b.map((p) => p.y);
  return Math.min(...ax) <= Math.max(...bx) && Math.min(...bx) <= Math.max(...ax) && Math.min(...ay) <= Math.max(...by) && Math.min(...by) <= Math.max(...ay);
};

/** THE PICTURE READ'S ROOMS, ON THE FILE'S WALLS WHERE THEY AGREE (the
    outside review, 22 November 2026: "a merge that starts with
    picture-discovered rooms and accepts measured boundaries per matched
    room"). The picture read splits a floor into rooms as a person does (a
    hall, a stair, an open kitchen and family room); the file's spaces sit
    exactly on the walls but part a floor by where its walls close, which a
    hall or a stair doesn't. So each room the picture read found takes the
    outline of the file's space that is plainly the same room (they share
    most of their area), keeping the picture's name where the file has
    none; a room with no such space stays as the picture drew it (it is put
    on the walls after, plans-server's onTheLines). A named space only the
    file found is added. On 3570, scored against the key brought in to the
    walls' faces, the ground floor's median room overlap went from 80% to
    84% (19 rooms at 80% or more, from 17), where the file's rooms leading
    had made it 68%. Pure. */
/* plainly one room: the file's space and the picture's room share this much of their area */
const SAME_ROOM = 0.8;

export function pictureLed(picture: readonly ReadSpace[], file: readonly ReadSpace[], joins: readonly SpaceJoin[] = []): { spaces: ReadSpace[]; opened: number[] } {
  const NAMES = new Set([...WALLED, "circulation", "other"]);
  const has = (s: ReadSpace) => (s.outline?.length ?? 0) >= 3;
  const used = new Set<ReadSpace>();
  /* the file's gaps a room taken whole runs through */
  const opened: number[] = [];
  const out: ReadSpace[] = picture.map((p) => {
    if (!NAMES.has(p.kind) || !has(p)) return p;
    let best: { outline: ReadPoint[]; o: number; takes: ReadSpace[]; gaps: number[] } | null = null;
    for (const f of file) {
      if (used.has(f) || !has(f) || !boxed(p.outline, f.outline)) continue;
      const o = overlapOf(p.outline, f.outline);
      if (o >= SAME_ROOM && (!best || o > best.o)) best = { outline: f.outline, o, takes: [f], gaps: [] };
    }
    /* A NAMED SPACE AND THE UNNAMED ONES IT OPENS ONTO WIDE (two nibs across
       one room, or a robe, a hall or a courtyard behind wide sliders) are one
       room only where this picture room says so: it is more nearly all of
       them than the named one alone, and no other room the picture read
       stands in the unnamed part. Else they stay apart, as the file read them */
    for (const j of joins) {
      const parts = [j.into, ...j.from].map((i) => file[i]);
      if (parts.some((f) => !f || used.has(f) || !has(f)) || !boxed(p.outline, j.outline)) continue;
      const o = overlapOf(p.outline, j.outline);
      if (o < SAME_ROOM || (best && o <= best.o) || o <= overlapOf(p.outline, parts[0].outline)) continue;
      if (picture.some((q) => q !== p && has(q) && parts.slice(1).some((f) => inside(mean(q.outline)!, f.outline)))) continue;
      best = { outline: j.outline, o, takes: parts, gaps: j.gaps };
    }
    if (!best) return p;
    for (const f of best.takes) used.add(f);
    opened.push(...best.gaps);
    return { ...p, outline: best.outline };
  });
  for (const f of file) if (!used.has(f) && f.named && has(f) && !out.some((p) => has(p) && overlapOf(p.outline, f.outline) >= 0.3)) out.push(f);
  return { spaces: out, opened };
}

/* ── doors and windows set in the walls' own gaps ── */

/* a gap is an opening's when the two are this share of each other's length or more */
const SAME_GAP = 0.7;

/** EACH DOOR AND WINDOW IN THE GAP ITS WALL LEAVES FOR IT. The picture read
    places an opening by eye; the file's wall has the gap itself, jamb to
    jamb. Each opening takes the nearest gap within reach of its middle
    (four wall thicknesses, about a metre) that is about as long as the
    read drew it jamb to jamb, within 30%, each gap once, the nearest
    opening first; its ends become the gap's jambs. The nearest gap to a
    600 mm window can be the 2.7 m one beside it, which would draw it 2.7 m
    wide. One with no such gap in reach stays as read. Pure. */
export function onGaps(openings: readonly ReadOpening[], gaps: readonly WallGap[]): ReadOpening[] {
  const mid = (a: Pt, b: Pt) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  const toSeg = (p: Pt, a: Pt, b: Pt) => {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const t = dx || dy ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy))) : 0;
    return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
  };
  const long = (a: Pt, b: Pt) => Math.hypot(b.x - a.x, b.y - a.y);
  const pairs: { o: number; g: number; d: number }[] = [];
  openings.forEach((o, i) => {
    const lo = long(o.a, o.b);
    if (o.kind === "skylight" || !(lo > 0)) return;
    const m = mid(o.a, o.b);
    gaps.forEach((g, j) => {
      const lg = long(g.a, g.b);
      if (Math.min(lo, lg) < SAME_GAP * Math.max(lo, lg)) return;
      const d = toSeg(m, g.a, g.b);
      if (d <= Math.max(4 * g.t, 8)) pairs.push({ o: i, g: j, d });
    });
  });
  pairs.sort((a, b) => a.d - b.d);
  const gapOf = new Map<number, number>();
  const taken = new Set<number>();
  for (const p of pairs) {
    if (gapOf.has(p.o) || taken.has(p.g)) continue;
    gapOf.set(p.o, p.g);
    taken.add(p.g);
  }
  return openings.map((o, i) => {
    const j = gapOf.get(i);
    if (j === undefined) return o;
    const g = gaps[j];
    return { ...o, a: g.a, b: g.b, inGap: true };
  });
}
