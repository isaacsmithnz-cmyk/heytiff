import type { ReadLook, ReadSpace, SpaceKind } from "../reading";
import type { Fill, Line } from "./fills";
import { wallsOf, type Walls } from "./walls";
import { lineWalls } from "./lines";
import { enclose, outlined, parted, rasterise } from "./enclose";

/* A FLOOR'S ROOMS READ FROM THE DRAWING FILE ITSELF (Isaac, 22 November 2026:
   "I need the plans accurate to design it"; "build the new way"). The walls
   are the architect's own filled shapes (walls.ts); the rooms are the spaces
   they close off (enclose.ts), each named by the words the plan writes inside
   it. Nothing is traced by eye, so a room's sides are the walls' own faces.

   It is trusted only when it plainly worked: the walls found, and most of the
   room names the plan writes inside the building landing in a closed room.
   Otherwise the floor is read by picture as before, and why is said. Pure. */

export type VectorWord = { text: string; at: { x: number; y: number } };

export type VectorInput = {
  fills: readonly Fill[];
  /** its straight stroked lines, for walls drawn in lines */
  lines?: readonly Line[];
  /** the page in points */
  width: number;
  height: number;
  /** the words, in pixels `k` to a point */
  words: readonly VectorWord[];
  /** the building's millimetres a page point, when known */
  mmPerPt: number | null;
  /** the sheet's own raster: its pixels a point (plans.ts fullScale) */
  rasterScale: number;
};

export type VectorRooms = {
  spaces: ReadSpace[];
  look: ReadLook[];
  grid: { x: number[]; y: number[] };
  rounds: number;
  frame: { left: number; top: number; width: number; height: number };
  /** what the read found, for the kept test and the log */
  found: { colours: string[]; rooms: number; named: number; labels: number; landed: number };
};

/** The grid the walls are laid on: two pixels a point, finer than any wall. */
export const K = 2;

/* WORDS THAT NAME A ROOM. A plan writes far more than room names: tags (W.05,
   D3), sizes, levels (FFL 194.000), notes ("SMOKE ALARMS TO COMPLY WITH").
   A word names a room when it is one of a room's words, or is short and in
   capitals with no figure but a room's number ("BED 4"). */
const ROOM_WORD =
  /^(bed(room)?s?|master|guest|nursery|ens(uite)?|bath(room)?|wc|toilet|pwd|powder|shower|laundry|ldry|kitchen|kit|pantry|pantries|butler'?s?|scullery|living|lounge|family|dining|dinning|meals|study|office|media|theatre|theater|rumpus|games?|retreat|sitting|gym|cellar|wine|garage|carport|store|storage|stor|robe|wir|w\.i\.r\.?|wardrobe|linen|lin|hall|hallway|entry|foyer|gallery|corridor|landing|lobby|passage|stairs?|lift|void|mud|drying|plant|service|workshop|studio|library|play|playroom|music|terrace|deck|balcony|patio|alfresco|porch|verandah|veranda|courtyard|colonnade|pool|cabana|sauna|spa|cool|cool ?room|freezer|wet|bar|cloak|coats?|mahjong|banquet|washroom|room|area|walk-?in|activity|grand|oval|east|west|north|south|upper|lower|main|front|rear|covered|walk|bike|boot|room)$/i;
const NOISE = /(\d{3,}|\d+\.\d+|^[a-z]{1,3}[.\-]?\d+[a-z]?$|^\d+$|comply|provide|clause|min\b|max\b|mm\b|ffl|\brl\b|\bcl\b|ceiling|smoke|alarm|exhaust|mechanical|ventilation|housing|provisions|note|refer|see|existing|proposed|new|demolish|line|outline|setback|boundary|scale|level|\bup\b|\bdn\b)/i;

/** Whether a word on the plan names a room, and how strongly: 2 a room word, 1 a short capitalised label, 0 neither. */
export function roomWord(text: string): 0 | 1 | 2 {
  const t = text.trim();
  if (!/[a-z]{2,}/i.test(t) || t.length > 24) return 0;
  const words = t.split(/\s+/);
  if (words.length > 3) return 0;
  const bare = words.filter((w) => !/^\d{1,2}[a-z]?$/i.test(w));
  if (bare.length && bare.every((w) => ROOM_WORD.test(w.replace(/[(),.:]/g, "")))) return 2;
  if (NOISE.test(t)) return 0;
  return t === t.toUpperCase() && bare.length >= 1 && t.replace(/[^a-z]/gi, "").length >= 3 ? 1 : 0;
}

const KINDS: [RegExp, SpaceKind][] = [
  [/\b(ens(uite)?|bath(room)?|wc|toilet|pwd|powder|poeder|shower|laundry|ldry|washroom|sauna|spa)\b/i, "wet"],
  [/\b(robe|wir|w\.i\.r|wardrobe|linen|lin|store|storage|stor|pantry|pantries|cool|freezer|cloak|coats?|cupboard|cpd)\b/i, "cupboard"],
  [/\b(stairs?)\b/i, "stair"],
  [/\b(garage|carport)\b/i, "garage"],
  [/\b(terrace|deck|balcony|patio|alfresco|porch|verandah|veranda|courtyard|colonnade)\b/i, "outdoor"],
  [/\b(void)\b/i, "void"],
  [/\b(hall|hallway|entry|foyer|gallery|corridor|landing|lobby|passage|mud)\b/i, "circulation"],
  [/\b(lift|plant)\b/i, "other"],
];
/* a name made of several rooms ("Kitchen, Family Room") is a room before it is a hall */
const kindOf = (name: string): SpaceKind => {
  const parts = name.split(/,\s*/);
  for (const [re, kind] of KINDS) if (parts.every((p) => re.test(p))) return kind;
  for (const [re, kind] of KINDS) if (parts.length === 1 && re.test(name)) return kind;
  return "room";
};

/* "BED 4" reads "Bed 4"; a plan's abbreviations stay as written (WIR, PWD) */
const ABBREV = /^(wir|wc|pwd|wil|ldry|lin|cpd|av|ac|a\/c|gf|ff|l\d)$/i;
const tidy = (s: string) =>
  s
    .split(/\s+/)
    .map((w) => (ABBREV.test(w) || w !== w.toUpperCase() || !/[A-Z]/.test(w) ? w : w[0] + w.slice(1).toLowerCase()))
    .join(" ");

/** The labels inside one space: words close together are one label ("FAMILY" over "ROOM"), labels far apart are two names. */
function labelsOf(words: VectorWord[], gap: number): string[] {
  const left = [...words].sort((a, b) => a.at.y - b.at.y || a.at.x - b.at.x);
  const groups: VectorWord[][] = [];
  for (const w of left) {
    const g = groups.find((g) => g.some((o) => Math.abs(o.at.y - w.at.y) <= gap && Math.abs(o.at.x - w.at.x) <= gap * 3));
    if (g) g.push(w);
    else groups.push([w]);
  }
  const names = groups.map((g) =>
    tidy(
      g
        .sort((a, b) => a.at.y - b.at.y || a.at.x - b.at.x)
        .map((w) => w.text.trim())
        .join(" "),
    ),
  );
  /* the room first, its robe or ensuite after: "Bed 1, Robe" */
  const rank = (n: string) => (kindOf(n) === "room" ? 0 : 1);
  return [...new Set(names)].sort((a, b) => rank(a) - rank(b));
}

const sq = (mm: number, mmPerPx: number) => (mm / mmPerPx) ** 2;

/** A floor's rooms from its drawing file, or why not. Its walls are tried
    as the file fills them, as it draws them in pairs of lines, and as both
    (a renovation fills its new walls and draws its existing ones), and the
    reading that lands most of the plan's room names in rooms is kept. */
export function vectorRooms(input: VectorInput): VectorRooms | { none: string } {
  const filled = wallsOf(input.fills, input.mmPerPt);
  const drawn = input.lines?.length ? lineWalls(input.lines, input.mmPerPt) : null;
  if (!filled && !drawn) return { none: "Its walls aren't drawn in the file, filled or in lines" };
  const tries: Walls[] = [];
  if (filled) tries.push(filled);
  if (drawn) tries.push(drawn);
  if (filled && drawn) tries.push({ colours: [...filled.colours, ...drawn.colours], shapes: [...filled.shapes, ...drawn.shapes], thickness: filled.thickness });
  let best: VectorRooms | null = null;
  let why = "";
  for (const walls of tries) {
    const r = roomsBetween(walls, input);
    if ("none" in r) {
      why ||= r.none;
      continue;
    }
    const score = (x: VectorRooms) => x.found.landed * 2 + x.found.named;
    if (!best || score(r) > score(best)) best = r;
  }
  return best ?? { none: why };
}

function roomsBetween(walls: Walls, input: VectorInput): VectorRooms | { none: string } {
  /* an unknown scale is taken as 1:100 for the sizes below: a wall, a door, a cupboard */
  const mmPerPx = (input.mmPerPt ?? 35.28) / K;
  const W = Math.ceil(input.width * K);
  const H = Math.ceil(input.height * K);
  const grid = rasterise(walls.shapes, input.width, input.height, K);
  const thick = walls.thickness * K;
  /* widest gap closed: 6.5 m at a known scale, else forty walls' thickness; a wall end is thin up to 560 mm */
  const widest = input.mmPerPt ? 6500 / mmPerPx : thick * 37;
  const thin = input.mmPerPt ? 560 / mmPerPx : thick * 3;
  const e = enclose(grid, W, H, Math.round(widest), Math.round(thin));

  /* the building: the box round the walls */
  let [bx0, by0, bx1, by1] = [W, H, 0, 0];
  for (let i = 0; i < W * H; i++)
    if (grid[i]) {
      const x = i % W;
      const y = (i / W) | 0;
      if (x < bx0) bx0 = x;
      if (x > bx1) bx1 = x;
      if (y < by0) by0 = y;
      if (y > by1) by1 = y;
    }
  const buildingArea = Math.max(1, (bx1 - bx0) * (by1 - by0));

  /* each word that names a room, in the space it sits in */
  const inSpace = new Map<number, VectorWord[]>();
  let labels = 0;
  for (const w of input.words) {
    const strength = roomWord(w.text);
    if (!strength) continue;
    const x = Math.round(w.at.x);
    const y = Math.round(w.at.y);
    if (x < bx0 || x > bx1 || y < by0 || y > by1) continue;
    if (strength === 2) labels++;
    /* a label over a wall line or a bridged gap: the nearest floor a few pixels round it */
    let id = -1;
    for (let r = 0; r <= 6 && id < 0; r += 2)
      for (const [dx, dy] of [[0, 0], [r, 0], [-r, 0], [0, r], [0, -r]]) {
        const xx = x + dx;
        const yy = y + dy;
        if (xx >= 0 && yy >= 0 && xx < W && yy < H && e.label[yy * W + xx] >= 0) {
          id = e.label[yy * W + xx];
          break;
        }
      }
    if (id < 0) continue;
    const l = inSpace.get(id) ?? [];
    l.push(w);
    inSpace.set(id, l);
  }

  type Kept = { n: number; outline: () => [number, number][]; names: string[]; strong: number };
  const keep: Kept[] = [];
  for (const s of e.spaces) {
    if (s.open) continue;
    if (s.n > buildingArea * 0.35) continue;
    if (s.n < sq(700, mmPerPx) * 1.2) continue;
    const w = s.box[2] - s.box[0] + 1;
    const h = s.box[3] - s.box[1] + 1;
    const words = inSpace.get(s.id) ?? [];
    /* a room's own words name it; a short capitalised word only where there is none (a "SOUNDSCREEN BATTS" note is no room) */
    const room = words.filter((x) => roomWord(x.text) === 2);
    const names = labelsOf(room.length ? room : words, 14 * K);
    const strong = room.length;
    /* an unnamed sliver between two walls (a cavity, a bridged reveal) is no room */
    if (!names.length && (Math.min(w, h) < 450 / mmPerPx || s.n < sq(1000, mmPerPx))) continue;
    /* TWO ROOMS' NAMES IN ONE SPACE (a bedroom open to its robe): parted
       where a wall end faces a wall across it, up to 2.5 m, inside this space
       only; each part with a name is its own room */
    if (names.length > 1 && room.length > 1) {
      const parts = parted(e, grid, s, room.map((x) => x.at), Math.round(widest), Math.round(thin), Math.round(input.mmPerPt ? 2500 / mmPerPx : thick * 14));
      if (parts) {
        for (const p of parts) {
          const held = p.holds.map((k) => room[k]);
          keep.push({ n: p.n, outline: () => p.outline, names: labelsOf(held, 14 * K), strong: held.length });
        }
        continue;
      }
    }
    keep.push({ n: s.n, outline: () => outlined(e, s), names, strong });
  }
  const landed = keep.reduce((n, k) => n + k.strong, 0);
  const named = keep.filter((k) => k.names.length).length;
  const found = { colours: walls.colours, rooms: keep.length, named, labels, landed };
  /* a plan whose room names aren't text in the file (drawn as lines, as
     Pariatur's are) gives rooms the read by picture names in the merge;
     one whose names are text must have most of them land in a room */
  const big = keep.filter((k) => k.n >= sq(2000, mmPerPx)).length;
  if (labels === 0 && big < 4) return { none: `Only ${big} room${big === 1 ? "" : "s"} closed off between its walls, and it writes no room names as text` };
  if (labels > 0 && named < 3) return { none: `Only ${named} named room${named === 1 ? "" : "s"} closed off between its walls` };
  if (labels >= 4 && landed < labels * 0.6) return { none: `Only ${landed} of the ${labels} room names it writes fell in a room closed off between its walls` };

  /* into the sheet's own raster pixels */
  const to = input.rasterScale / K;
  const look: ReadLook[] = [];
  const spaces: ReadSpace[] = keep.map(({ n, outline, names }) => {
    const name = names.length ? names.join(", ") : "Unnamed space";
    if (names.length > 1)
      look.push({ kind: "label", room: name, said: `${name}: the plan writes ${names.length} names in one space with no wall between them. It may be ${names.length} rooms.` });
    const small = n < sq(1600, mmPerPx) * 1.5;
    return {
      name,
      named: names.length > 0,
      kind: names.length ? kindOf(name) : small ? "cupboard" : "room",
      outline: outline().map(([x, y]) => ({ x: Math.round(x * to), y: Math.round(y * to) })),
      written: "",
      existing: false,
      openTo: "",
      stair: "",
    };
  });
  const pad = Math.round(thick * 2);
  return {
    spaces,
    look,
    grid: { x: [], y: [] },
    rounds: 0,
    frame: {
      left: Math.round(Math.max(0, bx0 - pad) * to),
      top: Math.round(Math.max(0, by0 - pad) * to),
      width: Math.round((bx1 - bx0 + 2 * pad) * to),
      height: Math.round((by1 - by0 + 2 * pad) * to),
    },
    found,
  };
}
