import type { ReadLook, ReadSpace, SheetReading } from "../reading";
import { agreement } from "./rooms";

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
  const base: SheetReading = picture ?? { sheetId, spaces: [], openings: [], marks: [], furniture: [], checklist: [], flags: [], planUp: "" };
  return { ...base, spaces: m.spaces, walled: { grid: m.grid, rounds: m.rounds, look } };
}
