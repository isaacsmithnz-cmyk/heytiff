import type { ReadLook, ReadPoint, ReadSpace, SheetReading } from "../reading";
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

export type MeasuredRooms = { spaces: ReadSpace[]; look: ReadLook[]; grid: { x: number[]; y: number[] }; rounds: number };

const WALLED = new Set(["room", "wet", "cupboard", "garage"]);
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
  const why = setAside(picture, m);
  if (why && picture) return { ...picture, walled: { grid: m.grid, rounds: m.rounds, look: [{ kind: "readers", room: "", said: `The rooms were also measured off the walls, and that read was set aside: ${why}.` }] } };
  const look = [...m.look];
  if (picture) {
    const a = agreement(m.spaces, picture.spaces);
    const missed = walledIn(picture.spaces).filter((s) => a.onlyB.includes(s.name));
    /* said once each: a house has several ensuites, and a list of six is one thing to look at */
    for (const name of [...new Set(missed.map((s) => s.name))])
      look.push({ kind: "readers", room: name, said: `${name}: a second read of the plan found this room and the measured one didn't. Check it isn't missing.` });
  }
  if (picture) {
    /* one space, two names: a walled room the second read calls something
       else, when the plan writes both names (a reader's own label for an
       unnamed cupboard is no disagreement) */
    for (const d of agreement(m.spaces, picture.spaces).differ)
      if (WALLED.has(d.a.kind) && WALLED.has(d.b.kind) && d.a.named && d.b.named)
        look.push({ kind: "readers", room: d.a.name, said: `${d.a.name}: a second read of the plan calls this room ${d.b.name}. Check which it is.` });
  }
  const base: SheetReading = picture ?? { sheetId, spaces: [], openings: [], marks: [], furniture: [], checklist: [], flags: [], planUp: "" };
  return { ...base, ...(picture ? rehomed(picture, m.spaces) : {}), spaces: m.spaces, walled: { grid: m.grid, rounds: m.rounds, look } };
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

