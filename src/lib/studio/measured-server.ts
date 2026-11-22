import "server-only";
import sharp from "sharp";
import type { PlanWord, ReadPoint, ReadSpace, SpaceKind } from "./reading";
import { findWalls, scaleWalls, wallSizes, type Walls, type WallSizes } from "./measure/walls";
import { agreement, snapRooms, type NamedRoom, type Problem } from "./measure/rooms";
import { strokeText } from "./measure/glyphs";

/* A FLOOR READ BY MEASURE (Isaac, 21 November 2026: "include all of that,
   build it"). The walls come off the drawing's own fill (measure/walls.ts),
   drawn finer than the sheet's raster so a wall is more than a few pixels.
   Tiff is shown the plan with the walls' lines numbered over it and names
   each room by the lines it stands between; the answer is set on the walls
   and checked (measure/rooms.ts). Then she is shown her own rooms drawn
   over the plan, with whatever the checks found, and puts right what she
   sees: the look a person gives their own work before handing it on.

   What comes back is in the sheet's own pixels, like every reading. Null
   when the drawing has no wall fill to measure (a scan, a sketch, walls
   drawn as two lines): the caller reads that sheet by picture instead. */

export type Json = Record<string, unknown>;
type Raw = Record<string, unknown>;
/** One question to the model with pictures: reading-server's askWith, or a test's own. */
export type AskMeasured = (
  pictures: Buffer[],
  text: string,
  schema: Json,
  maxTokens: number,
) => Promise<Raw>;

/** A third look is only taken when the read has this much of its time left:
    the stage it runs in (plans-server.ts) has the route's five minutes less
    a head start, and a look is a minute or more on a big floor. */
const LOOK_AGAIN_MS = 140_000;

export type FinePage = {
  rgba: Uint8Array | Uint8ClampedArray;
  width: number;
  height: number;
  words: readonly PlanWord[];
};

export type MeasuredSheet = {
  spaces: ReadSpace[];
  /** what the checks still find after her second look: for a person to look at */
  problems: Problem[];
  walls: Walls;
  /** 1 when her first answer stood, one more each time she changed it on looking again */
  rounds: number;
  /** the part of the sheet she was shown: a room outside it was never hers to name */
  frame: { left: number; top: number; width: number; height: number };
};

/** A floor's walls measured and its picture cut, ready for her to name its
    rooms. It holds none of the sheet's pixels: a floor drawn to measure is
    65 MB, and the questions that follow take minutes, so the pixels are
    let go before the first is asked (the engine's review, 21 November 2026:
    a dozen floors held at once ran a function out of memory). */
export type Measuring = { walls: Walls; z: WallSizes; f: Frame; base: Buffer; words: readonly PlanWord[]; mm: number | null; times: number };

/* a question raced against the time left: LATE when the time runs out first */
const LATE = Symbol("late");
const within = <T,>(p: Promise<T>, ms: number): Promise<T | typeof LATE> =>
  ms === Infinity
    ? p
    : new Promise((done, fail) => {
        const t = setTimeout(() => done(LATE), Math.max(0, ms));
        p.then(
          (v) => (clearTimeout(t), done(v)),
          (e) => (clearTimeout(t), fail(e)),
        );
      });

const KINDS: SpaceKind[] = [
  "room",
  "wet",
  "cupboard",
  "circulation",
  "stair",
  "void",
  "notch",
  "outdoor",
  "garage",
  "other",
];
const S = (o: Json): Json => ({
  type: "object",
  additionalProperties: false,
  required: Object.keys(o),
  properties: o,
});
const ROOM = S({
  name: {
    type: "string",
    description: "as written on the plan, or your best label",
  },
  name_written_on_plan: { type: "boolean" },
  kind: { type: "string", enum: KINDS },
  corners: {
    type: "string",
    description:
      'its corners in order round it, each "x,y": a line\'s number (x3,y4) or a bare pixel of this picture (812,440) where no line runs. A rectangle: "x3,y4 x5,y4 x5,y7 x3,y7"',
  },
  open_to: {
    type: "string",
    description:
      'for a void or notch: "below", "sky", "lower roof", "roof space"; else ""',
  },
  stair: {
    type: "string",
    description:
      'for a stair: "risers N, treads N, bottom <room>, top <room>" from its numbering; else ""',
  },
});
export const MEASURED_SCHEMA = S({
  rooms: {
    type: "array",
    items: ROOM,
    description:
      "every room, small space, stair, void and attached outdoor space on this floor",
  },
});
export const REVIEW_SCHEMA = S({
  right_as_drawn: {
    type: "boolean",
    description:
      "true only when every room drawn is on its walls, none is missing and nothing listed needs fixing",
  },
  rooms: {
    type: "array",
    items: ROOM,
    description:
      "when not right as drawn: the WHOLE list again, corrected. When right: empty",
  },
});

const RULES = `- Every enclosed room, and the small ones too: robes, linen and pantry cupboards, WCs and powder rooms, stores, a lift, a cool room. A space with its own walls is its own entry, even with no name written (give your best label and say the name isn't written).
- Halls, corridors and landings are rooms of kind circulation. A stair is kind stair, set round its treads. A void, a double-height space or a floor cut-out is kind void.
- Open-plan spaces with no wall between their parts are ONE room, named for every label in it ("Kitchen, Family, Dining").
- A space attached to the building but outside it is kind outdoor: a verandah, colonnade, porch, terrace, balcony, deck. Tell it by the drawing: posts where a room would have walls, a paving or decking hatch, and above all windows or window tags on the wall between it and the rooms, which make that wall an outside wall. A floor level written lower there than in the rooms (FFL 193.850 beside rooms at FFL 194.000) is a step down to outside.
- A garage or carport is kind garage.
- Corners go on the WALL LINES, the numbered lines down the middle of the walls, not on the inside face. Where a wall stops short of any line, or a room has a bay, a splay or a curve, give that corner as a bare pixel of this picture; a curve is a few such corners.
- Use the same line for two rooms that share a wall.
- Not furniture or joinery, not the title block, legend, dimensions or the site round the house.`;

export const measuredPrompt = (
  floor: string,
  w: number,
  h: number,
  nx: number,
  ny: number,
) =>
  `This is the ${floor} plan of a building, ${w}×${h} pixels (origin top-left, x right, y down). Its walls have been measured off the drawing, and the long ones lie on the numbered lines drawn over it: the magenta lines x0 to x${nx - 1} run up and down (numbered along the top and bottom), the green lines y0 to y${ny - 1} run across (numbered at the left and right).

You are reading it for an air conditioning installer. Name every room and space on this floor by the lines it stands between, its corners in order round it.

${RULES}`;

export const reviewPrompt = (
  floor: string,
  w: number,
  h: number,
  problems: readonly Problem[],
  names: readonly string[] = [],
) =>
  `This is the same ${floor} plan, ${w}×${h} pixels, with the rooms you named drawn over it: each one tinted, outlined on the inside of its walls, with its number in black:
${names.map((n, i) => `${i + 1} ${n}`).join("\n")}
The numbered wall lines are still there.

Look at your own work as the installer will. For each room: does its outline sit on the walls of that room as drawn, does its name match the label inside it, is it the right kind? Is any room, cupboard, hall, stair or outdoor space on the plan left with no tint? Is any tint lying across a wall or over two rooms?
${problems.length ? `\nChecks on the answer found these, which need putting right:\n${problems.map((p) => `- ${p.said}`).join("\n")}\n` : ""}
If everything is right as drawn, say so and give no rooms. Otherwise give the WHOLE list again, corrected, by the same rules:

${RULES}`;

const s = (v: unknown) => (typeof v === "string" ? v : "");
const roomsOf = (raw: Raw): NamedRoom[] =>
  (Array.isArray(raw.rooms) ? (raw.rooms as Raw[]) : []).map((r) => ({
    name: s(r.name),
    named: r.name_written_on_plan === true,
    kind: (KINDS as string[]).includes(s(r.kind))
      ? (s(r.kind) as SpaceKind)
      : "other",
    corners: s(r.corners),
    openTo: s(r.open_to),
    stair: s(r.stair),
  }));

/* what a picture is shrunk to for her to read: reading-server's own limits */
const MAX_EDGE = 2576;
const MAX_PIXELS = 3.6e6;
const fit = (w: number, h: number) =>
  Math.min(1, MAX_EDGE / Math.max(w, h), Math.sqrt(MAX_PIXELS / (w * h)));

type Frame = {
  left: number;
  top: number;
  width: number;
  height: number;
  k: number;
  ow: number;
  oh: number;
};

/** The part of the page the building is on, with room round it for the lines'
    numbers. Never a tight crop: a floor's stair, lift or porch can be drawn
    in line with no wall fill (3570's lower ground: its lift and stair sat
    just outside the filled walls and were cut off the first picture), so
    the frame is at least 45% of the page each way, about the walls' middle. */
export function frameOf(walls: Walls, width: number, height: number): Frame {
  const xs = walls.segs.flatMap((g) => (g.dir === "h" ? [g.a, g.b] : [g.c]));
  const ys = walls.segs.flatMap((g) => (g.dir === "v" ? [g.a, g.b] : [g.c]));
  /* room round the walls for the lines' numbers, so they are printed on
     margin and not on the building: at least the band they take (the
     engine's review: the third column of y numbers sat on 3570's east wall) */
  const shrinkOf = (pad: number) => fit(Math.min(width, Math.max(...xs) - Math.min(...xs) + 2 * pad), Math.min(height, Math.max(...ys) - Math.min(...ys) + 2 * pad));
  let pad = Math.max(width, height) * 0.04;
  for (let i = 0; i < 2; i++) {
    const k = shrinkOf(pad);
    const size = labelSize(Math.round((Math.max(...xs) - Math.min(...xs) + 2 * pad) * k));
    pad = Math.max(pad, (size * BAND) / k);
  }
  const span = (lo: number, hi: number, most: number) => {
    const need = Math.max(hi - lo + 2 * pad, most * 0.45);
    const a = Math.max(0, Math.min(most - need, (lo + hi) / 2 - need / 2));
    return {
      at: Math.floor(Math.max(0, a)),
      size: Math.ceil(Math.min(most, need)),
    };
  };
  const x = span(Math.min(...xs), Math.max(...xs), width);
  const y = span(Math.min(...ys), Math.max(...ys), height);
  const w = Math.min(width - x.at, x.size);
  const h = Math.min(height - y.at, y.size);
  const k = fit(w, h);
  return {
    left: x.at,
    top: y.at,
    width: w,
    height: h,
    k,
    ow: Math.round(w * k),
    oh: Math.round(h * k),
  };
}

const TINT: Record<SpaceKind, string> = {
  room: "#3b82f6",
  wet: "#06b6d4",
  cupboard: "#a78bfa",
  circulation: "#f59e0b",
  stair: "#ef4444",
  void: "#94a3b8",
  notch: "#94a3b8",
  outdoor: "#22c55e",
  garage: "#78716c",
  other: "#64748b",
};

/* a number's height on her picture, from the picture's width */
const labelSize = (ow: number) => Math.max(15, Math.round(ow / 110));
/* how far in from the picture's edge the numbers reach, in numbers' heights */
const BAND = 7;

/** Where each number goes along its edge: in the first row (counting in
    from the edge) where it clears the number before it, so numbers on close
    lines never print over each other however many there are. */
function rowsFor(at: readonly number[], width: number, gap: number): number[] {
  const ends: number[] = [];
  return at.map((v) => {
    let row = ends.findIndex((e) => e + gap <= v - width / 2);
    if (row < 0) row = ends.length < 3 ? ends.length : ends.indexOf(Math.min(...ends));
    ends[row] = v + width / 2;
    return row;
  });
}

/** The numbered lines, and her rooms when there are any, as a drawing to lay over the plan. */
export function overlaySvg(
  f: Frame,
  walls: Walls,
  spaces: readonly ReadSpace[] = [],
): string {
  const X = (v: number) => ((v - f.left) * f.k).toFixed(1);
  const Y = (v: number) => ((v - f.top) * f.k).toFixed(1);
  const size = labelSize(f.ow);
  /* drawn as strokes, not <text>: a server with no fonts (a Vercel function)
     draws text as empty boxes, and she'd be naming rooms by lines she can't
     read (glyphs.ts) */
  const tag = (x: number, y: number, text: string, colour: string) =>
    strokeText(text, x, y, size * 0.8, colour);
  const out: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${f.ow}" height="${f.oh}">`,
  ];
  /* a room carries its number in the list; its name goes to her in words
     (reviewPrompt), so drawing it needs no font either */
  for (const [i, sp] of spaces.entries()) {
    if (sp.outline.length < 3) continue;
    const pts = sp.outline.map((p) => `${X(p.x)},${Y(p.y)}`).join(" ");
    const mx = sp.outline.reduce((n, p) => n + p.x, 0) / sp.outline.length;
    const my = sp.outline.reduce((n, p) => n + p.y, 0) / sp.outline.length;
    out.push(
      `<polygon points="${pts}" fill="${TINT[sp.kind]}" fill-opacity="0.28" stroke="${TINT[sp.kind]}" stroke-width="3"/>`,
    );
    out.push(
      tag(Number(X(mx)), Number(Y(my)) + size * 0.4, String(i + 1), "#111827"),
    );
  }
  /* each number in the first row in from the edge where it clears its
     neighbour (rowsFor); a number is about 0.6 of its height wide a figure */
  const wide = (t: string) => size * 0.8 * (0.8 * t.length - 0.2);
  const xr = rowsFor(walls.grid.x.map((v) => Number(X(v))), wide(`x${walls.grid.x.length}`), size * 0.3);
  walls.grid.x.forEach((v, i) => {
    out.push(
      `<line x1="${X(v)}" y1="0" x2="${X(v)}" y2="${f.oh}" stroke="#d946ef" stroke-width="1.5" stroke-opacity="0.75"/>`,
    );
    out.push(tag(Number(X(v)), size * (1.1 + xr[i] * 1.15), `x${i}`, "#a21caf"));
    out.push(tag(Number(X(v)), f.oh - size * (0.4 + xr[i] * 1.15), `x${i}`, "#a21caf"));
  });
  const yr = rowsFor(walls.grid.y.map((v) => Number(Y(v))), size, size * 0.2);
  walls.grid.y.forEach((v, j) => {
    out.push(
      `<line x1="0" y1="${Y(v)}" x2="${f.ow}" y2="${Y(v)}" stroke="#16a34a" stroke-width="1.5" stroke-opacity="0.75"/>`,
    );
    out.push(tag(size * (1.3 + yr[j] * 2.2), Number(Y(v)) + size * 0.35, `y${j}`, "#15803d"));
    out.push(tag(f.ow - size * (1.3 + yr[j] * 2.2), Number(Y(v)) + size * 0.35, `y${j}`, "#15803d"));
  });
  out.push("</svg>");
  return out.join("");
}

/** The plan as she is shown it: the building's part of the page, the numbered lines over it, and any rooms given. */
export async function picture(
  page: FinePage,
  f: Frame,
  walls: Walls,
  spaces: readonly ReadSpace[] = [],
): Promise<Buffer> {
  return drawn(await baseOf(page, f), f, walls, spaces);
}

/* the frame's part of the page, shrunk to what she is shown: cut once a floor */
function baseOf(page: FinePage, f: Frame): Promise<Buffer> {
  return sharp(
    Buffer.from(page.rgba.buffer, page.rgba.byteOffset, page.rgba.byteLength),
    { raw: { width: page.width, height: page.height, channels: 4 } },
  )
    .extract({ left: f.left, top: f.top, width: f.width, height: f.height })
    .resize(f.ow, f.oh)
    .flatten({ background: "#ffffff" })
    .png()
    .toBuffer();
}

function drawn(base: Buffer, f: Frame, walls: Walls, spaces: readonly ReadSpace[] = []): Promise<Buffer> {
  return sharp(base)
    .composite([
      { input: Buffer.from(overlaySvg(f, walls, spaces)), left: 0, top: 0 },
    ])
    .png()
    .toBuffer();
}

/** Whether a look again left out a room the answer before it had, that no
    check found fault with. No check sees a room that isn't there, so a room
    dropped reads as fewer problems, and the look would be kept. A room
    still stands when one stands where it stood (renamed, that's a
    correction), or one carries its name, alone or among an open plan's
    ("Kitchen, Family"). One a check found fault with (a robe over the
    lounge) may go. */
function leftOut(before: { spaces: readonly ReadSpace[]; problems: readonly Problem[] }, after: { spaces: readonly ReadSpace[] }): boolean {
  const key = (s: string) => s.trim().toLowerCase();
  const names = new Set(after.spaces.flatMap((s) => [s.name, ...s.name.split(/[,/&]/)].map(key)));
  /* a problem names its room, and a second only as rooms.ts words it ("A and B overlap.", "which is B's name."):
     whole names, so a problem on "Bed 2" doesn't count against "Bed" */
  const faulted = (name: string) =>
    before.problems.some((p) => {
      const said = key(p.said);
      return key(p.room) === key(name) || said.startsWith(`${key(p.room)} and ${key(name)} overlap.`) || said.includes(`which is ${key(name)}'s name.`);
    });
  return agreement(after.spaces, before.spaces).onlyB.some((n) => !names.has(key(n)) && !faulted(n));
}

/** A floor's walls measured off its pixels and its picture cut. Null when
    the drawing has no wall fill to measure. Nothing it hands back holds the
    pixels. */
export async function prepareMeasured(page: FinePage, times: number, mmPerPx: number | null): Promise<Measuring | null> {
  const mm = mmPerPx ? mmPerPx / times : null;
  const walls = findWalls(page.rgba, page.width, page.height, mm);
  if (!walls) return null;
  const f = frameOf(walls, page.width, page.height);
  return { walls, z: wallSizes(page.width, mm), f, base: await baseOf(page, f), words: page.words, mm, times };
}

/** A measured floor's rooms, named by her and set on its walls. `deadline`
    is when it must be done by, as Date.now() counts: the route it runs in is
    killed at five minutes with nothing saved, and 7 Ipsum Rd's level took
    87 s to name and 216 s to look at (the engine's review, 21 November
    2026). A naming that runs past it throws; a look that would is not
    taken, or is left, and the answer before it stands. */
export async function nameRooms(
  m: Measuring,
  opts: { floorName: string; ask: AskMeasured; budgetMs?: number; deadline?: number },
): Promise<MeasuredSheet | null> {
  const started = Date.now();
  const { walls, z, f, times } = m;
  const back = {
    backX: (v: number) => v / f.k + f.left,
    backY: (v: number) => v / f.k + f.top,
    words: m.words,
    mmPerPx: m.mm,
  };
  const left = () => (opts.deadline ?? Infinity) - Date.now();

  const first = await drawn(m.base, f, walls);
  /* the time left is read before she is asked, not after */
  const firstBy = left();
  const answer = await within(
    opts.ask([first], measuredPrompt(opts.floorName, f.ow, f.oh, walls.grid.x.length, walls.grid.y.length), MEASURED_SCHEMA, 16000),
    firstBy,
  );
  if (answer === LATE) throw new Error("Naming its rooms took too long");
  const took = Date.now() - started;
  let set = snapRooms(roomsOf(answer), walls, z, back);
  if (!set.spaces.length) return null;
  let rounds = 1;

  /* her own rooms drawn over the plan, and what the checks found: a second
     look, and a third when the second still leaves something the checks
     find and there is time. An answer is kept only when it checks no worse
     than the one before it, and leaves out none of its rooms that checked
     sound (leftOut) */
  for (let look = 1; look <= 2; look++) {
    if (look === 2 && (!set.problems.length || Date.now() - started > (opts.budgetMs ?? LOOK_AGAIN_MS))) break;
    /* a look takes about as long as the naming did, a little less */
    if (left() < took * 0.6) break;
    const picture = await drawn(m.base, f, walls, set.spaces);
    const by = left();
    const again = await within(
      opts.ask([picture], reviewPrompt(opts.floorName, f.ow, f.oh, set.problems, set.spaces.map((s) => s.name)), REVIEW_SCHEMA, 16000).catch(() => null),
      by,
    );
    if (!again || again === LATE || again.right_as_drawn === true) break;
    const fixed = snapRooms(roomsOf(again), walls, z, back);
    if (!fixed.spaces.length || fixed.problems.length > set.problems.length || leftOut(set, fixed)) break;
    set = fixed;
    rounds++;
  }

  const P = (p: ReadPoint): ReadPoint => ({
    x: Math.round(p.x / times),
    y: Math.round(p.y / times),
  });
  return {
    spaces: set.spaces.map((sp) => ({ ...sp, outline: sp.outline.map(P) })),
    problems: set.problems,
    walls: scaleWalls(walls, times),
    rounds,
    frame: { left: Math.round(f.left / times), top: Math.round(f.top / times), width: Math.round(f.width / times), height: Math.round(f.height / times) },
  };
}

/** One floor read by measure. `page` is the sheet drawn `times` its raster's
    size, with its words placed on that drawing; `mmPerPx` is the raster's.
    Everything handed back is in the raster's own pixels. */
export async function readMeasured(
  page: FinePage,
  times: number,
  opts: { floorName: string; mmPerPx: number | null; ask: AskMeasured; budgetMs?: number; deadline?: number },
): Promise<MeasuredSheet | null> {
  const m = await prepareMeasured(page, times, opts.mmPerPx);
  return m ? nameRooms(m, opts) : null;
}
