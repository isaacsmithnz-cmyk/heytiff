import type { ReadLook, ReadSpace, SheetReading } from "../reading";
import { agreement } from "./rooms";

/* THE MEASURED ROOMS INTO THE SHEET'S READING. A floor is still read by
   picture for what measuring doesn't give: its doors and windows, joinery,
   fans, notes and furniture. Its ROOMS are the measured ones, which stand on
   the walls. The picture read's own rooms aren't thrown away unlooked-at:
   they are a second reader, and a walled room only it found is said, for a
   person to look at (Isaac, 21 November 2026: "multiple checks?"). Pure. */

export type MeasuredRooms = { spaces: ReadSpace[]; look: ReadLook[]; grid: { x: number[]; y: number[] }; rounds: number };

const WALLED = new Set(["room", "wet", "cupboard", "garage"]);

/** A sheet's reading with its rooms measured. `picture` is the read by
    picture, or null when that one failed: the rooms then stand alone. */
export function withMeasured(picture: SheetReading | null, m: MeasuredRooms, sheetId: string): SheetReading {
  const look = [...m.look];
  if (picture) {
    const a = agreement(m.spaces, picture.spaces);
    const missed = picture.spaces.filter((s) => WALLED.has(s.kind) && (s.outline?.length ?? 0) >= 3 && a.onlyB.includes(s.name));
    /* said once each: a house has several ensuites, and a list of six is one thing to look at */
    for (const name of [...new Set(missed.map((s) => s.name))])
      look.push({ kind: "readers", room: name, said: `${name}: a second read of the plan found this room and the measured one didn't. Check it isn't missing.` });
  }
  const base: SheetReading = picture ?? { sheetId, spaces: [], openings: [], marks: [], furniture: [], checklist: [], flags: [], planUp: "" };
  return { ...base, spaces: m.spaces, walled: { grid: m.grid, rounds: m.rounds, look } };
}
