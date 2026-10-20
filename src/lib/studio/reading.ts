/* TIFF'S READING OF THE PLANS (v2, 20 October). What she read off each
   floor's plan, kept on the design once so the Studio, quoting and her box
   on any screen use it rather than read the set again (one engine: the
   reader is reading-server.ts, the registry's `design_reading` hands it out).

   Everything she read is a SUGGESTION. Rooms come in for you to tick,
   adjust and name; nothing here becomes a room, a load or a unit on its own
   (Isaac, 19 October). What the plan says that she didn't account for is
   said, not hidden: the checks below flag it.

   Points are in the sheet's own pixels (a sheet's world units are its
   raster's pixels), so a reading stays true when the sheet is moved or the
   floor is calibrated. Pure: no I/O. The bench that scores these reads is
   in the session scratchpad of 19 October (bench/), Opus 5.5 throughout. */

export type ReadPoint = { x: number; y: number };

export type SpaceKind = "room" | "wet" | "cupboard" | "circulation" | "stair" | "void" | "notch" | "outdoor" | "garage" | "other";

/** A space she found: a room, a cupboard, a stair, a void. */
export type ReadSpace = {
  name: string;
  /** false when the plan writes no name and she gave her best label */
  named: boolean;
  kind: SpaceKind;
  outline: ReadPoint[];
  /** its size as written on the plan, exactly ("4.1m x 2.7m"), or "" */
  written: string;
  existing: boolean;
  /** a void or notch: what it opens to ("below", "sky", "lower roof", "roof space") */
  openTo: string;
  /** a stair's numbering, "risers 19, treads 18, bottom Hall, top Landing" */
  stair: string;
};

export type ReadOpening = {
  kind: "door" | "window" | "skylight";
  tag: string;
  a: ReadPoint;
  b: ReadPoint;
  widthMm: number;
  room: string;
  external: boolean;
  /** N, NE, E... for an external opening, else "" */
  facing: string;
};

/** Built-ins, bulkheads, fans and what's written about the air conditioning. */
export type ReadMark = {
  item: "joinery" | "bulkhead" | "fan" | "ac_note" | "roof_space";
  text: string;
  room: string;
  outline: ReadPoint[];
};

/** Loose furniture: drawn faintly, never a room, never in a load. */
export type ReadFurniture = { kind: string; room: string; outline: ReadPoint[] };

export const CHECKLIST = ["rooms", "stairs", "voids_notches", "doors", "windows", "skylights", "joinery", "bulkheads", "fans", "ac_notes", "roof_space"] as const;
export type ChecklistItem = (typeof CHECKLIST)[number];

/** Every item she was asked for: found, or looked for and not there, and where she looked. */
export type ReadCheck = { item: ChecklistItem; found: boolean; count: number; note: string };

/** Something on the plan the reading doesn't account for. */
export type ReadFlag = { kind: "label_no_room" | "label_inside"; text: string; at: ReadPoint; room?: string };

/** A word written on the plan, where it sits (from the PDF's own text). */
export type PlanWord = { text: string; at: ReadPoint };

export type SheetReading = {
  sheetId: string;
  spaces: ReadSpace[];
  openings: ReadOpening[];
  marks: ReadMark[];
  furniture: ReadFurniture[];
  checklist: ReadCheck[];
  flags: ReadFlag[];
  /** which way plan-up faces, if the plan says, else "" */
  planUp: string;
};

/* THE ROOF AND THE HEIGHTS (Isaac, 20 October 2026: "Roof and framing
   should always be done"). Read off the whole drawing set, the elevations,
   sections and roof plan with each floor's plan beside them: how high each
   floor's ceiling is, the roof as rectangular parts set out on the plan of
   the floor whose walls carry them, and the rooms whose ceilings rake. A
   roof part's outline is its footprint at the wall line, in that floor's
   sheet pixels; the eaves overhang it. */
export type RoofForm = "gable" | "hip" | "skillion" | "flat";

export type ReadRoofPart = {
  floorId: string;
  sheetId: string;
  form: RoofForm;
  outline: ReadPoint[];
  /** which way the ridge runs on the plan: along x ("across") or along y ("down"); a skillion's slope runs across it */
  ridge: "across" | "down";
  /** a skillion's low side on the plan */
  fallsTo: "left" | "right" | "up" | "down" | "";
  pitchDeg: number;
  /** the top of the walls it sits on, above that floor's floor level, mm */
  eaveMm: number;
  overhangMm: number;
  existing: boolean;
  source: string;
};

export type ReadLevel = { floorId: string; ceilingMm: number; floorZoneMm: number; source: string };

export type ReadRake = { floorId: string; room: string; lowMm: number; highMm: number };

export type RoofReading = {
  levels: ReadLevel[];
  parts: ReadRoofPart[];
  raked: ReadRake[];
  material: string;
  /** what the set says about the roof space, for the installer */
  roofSpace: string;
};

export type PlanReading = {
  /** when it was read */
  at: string;
  model: string;
  /** floor id → what she read off each of its sheets */
  floors: Record<string, SheetReading[]>;
  /** the roof and heights off the whole set; absent until read (a design read before 20 October has none) */
  roof?: RoofReading | null;
  /** a sheet she couldn't read, and why, said rather than dropped */
  failed: { floorId: string; sheetId: string; reason: string }[];
};

/* ── the checks ─────────────────────────────────────────────────────────── */

export function inside(p: ReadPoint, poly: ReadPoint[]): boolean {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) c = !c;
  }
  return c;
}

export function area(poly: ReadPoint[]): number {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    s += a.x * b.y - b.x * a.y;
  }
  return Math.abs(s) / 2;
}

/* The words a plan names a space with. A label is one of these, alone or
   with a number ("Bed 4", "WC", "W.I.R."), not a note that mentions one. */
const ROOM_WORD =
  /^(bed(room)?|master|robe|wir|w\.?i\.?r\.?|ensuite|en-?suite|ens|bath(room)?|wc|w\.?c\.?|powder|pdr|toilet|linen|lin|broom|pantry|butlers?|laundry|ldry|store|storage|study|office|lounge|living|dining|kitchen|family|rumpus|media|theatre|games|gym|garage|hall|entry|foyer|landing|stair|mud|fridge|cellar|retreat|nursery|guest|sitting|meals)(\s*\d+)?$/i;

export const isRoomWord = (text: string) => ROOM_WORD.test(text.trim().replace(/\s+/g, " "));

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * The plan's own room labels that her spaces don't account for: a label in
 * no space ("WC is written here but no room was drawn round it"), or inside
 * a space of another name ("WC is inside Bathroom"). That is how a powder
 * room drawn inside a bathroom's outline is caught, whether or not she saw it.
 */
export function labelFlags(spaces: ReadSpace[], words: PlanWord[]): ReadFlag[] {
  const flags: ReadFlag[] = [];
  const seen = new Set<string>();
  for (const w of words) {
    if (!isRoomWord(w.text)) continue;
    const key = `${norm(w.text)}@${Math.round(w.at.x / 50)},${Math.round(w.at.y / 50)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const holders = spaces.filter((s) => s.outline.length >= 3 && inside(w.at, s.outline));
    if (holders.length === 0) {
      flags.push({ kind: "label_no_room", text: w.text.trim(), at: w.at });
      continue;
    }
    /* the smallest space round it is the one it names */
    const holder = holders.reduce((a, b) => (area(b.outline) < area(a.outline) ? b : a));
    const word = norm(w.text).replace(/\d+$/, "");
    if (word && !norm(holder.name).includes(word) && !SAME[word]?.some((alt) => norm(holder.name).includes(alt))) {
      flags.push({ kind: "label_inside", text: w.text.trim(), at: w.at, room: holder.name });
    }
  }
  return flags;
}

/* the same space under another word */
const SAME: Record<string, string[]> = {
  wir: ["robe", "walkin"],
  robe: ["wir"],
  ens: ["ensuite"],
  ensuite: ["ens", "bath"],
  pdr: ["powder", "wc"],
  powder: ["pdr", "wc"],
  wc: ["powder", "toilet"],
  lin: ["linen"],
  ldry: ["laundry"],
  master: ["bed"],
  bed: ["master", "bedroom"],
  bedroom: ["bed"],
  living: ["lounge", "family"],
  lounge: ["living"],
  kitchen: ["living", "dining", "meals"],
  dining: ["living", "kitchen", "meals"],
  hall: ["entry", "landing"],
  entry: ["hall", "foyer"],
  foyer: ["entry", "hall"],
  landing: ["hall", "stair"],
};

/** A size as written on a plan, in metres, longer side first: "4.1m x 2.7m", "4100 x 4500", "4.1 x 2.7". */
export function parseWritten(text: string): [number, number] | null {
  const m = text.replace(/,/g, ".").match(/(\d+(?:\.\d+)?)\s*(mm|m)?\s*[x×]\s*(\d+(?:\.\d+)?)\s*(mm|m)?/i);
  if (!m) return null;
  const toM = (v: number, unit?: string) => (unit?.toLowerCase() === "mm" || (!unit && v > 100) ? v / 1000 : v);
  const a = toM(Number(m[1]), m[2] ?? m[4]);
  const b = toM(Number(m[3]), m[4] ?? m[2]);
  if (!(a > 0.3 && b > 0.3 && a < 60 && b < 60)) return null;
  return a >= b ? [a, b] : [b, a];
}

/**
 * Does a size written in a room agree with the room as drawn? A written
 * size counts only when it does: "2.4 x 0.9m" in a 43 m² living room is the
 * dining table, not the room. True when both sides are within 20% of the
 * outline's box, false when they aren't, null when there's nothing to judge
 * (no size written, or no scale yet).
 */
export function writtenAgrees(written: string, outline: ReadPoint[], mmPerPx: number | null): boolean | null {
  const w = parseWritten(written);
  if (!w || !mmPerPx || outline.length < 3) return null;
  const xs = outline.map((p) => p.x);
  const ys = outline.map((p) => p.y);
  const sides = [(Math.max(...xs) - Math.min(...xs)) * mmPerPx, (Math.max(...ys) - Math.min(...ys)) * mmPerPx]
    .map((v) => v / 1000)
    .sort((a, b) => b - a);
  return Math.abs(sides[0] - w[0]) <= w[0] * 0.2 && Math.abs(sides[1] - w[1]) <= w[1] * 0.2;
}

/** The rooms she suggests: what an air conditioner might serve, not cupboards, stairs, voids or outside. */
export const suggestedRooms = (r: SheetReading) => r.spaces.filter((s) => s.kind === "room" || s.kind === "wet" || s.kind === "garage");

/** "No stairs found: looked along the hall and both ends" — what she didn't find, said. */
export const notFound = (r: SheetReading) => r.checklist.filter((c) => !c.found);

/** The reading with its checks done against the plan's own words: each
    sheet's words (kept from the PDF at upload, planImport.words) inside its
    crop, against the spaces she drew on it. */
export function withChecks(reading: PlanReading, doc: { floors: { id: string; plans: { id: string; imageRef: string; crop?: { x: number; y: number; w: number; h: number } }[] }[]; planImport: { placed: Record<number, string>; words?: Record<number, PlanWord[]> } | null }): PlanReading {
  const pageOf = new Map<string, number>();
  for (const [i, ref] of Object.entries(doc.planImport?.placed ?? {})) pageOf.set(ref, Number(i));
  const floors: PlanReading["floors"] = {};
  for (const [floorId, sheets] of Object.entries(reading.floors)) {
    const floor = doc.floors.find((f) => f.id === floorId);
    floors[floorId] = sheets.map((r) => {
      const sheet = floor?.plans.find((p) => p.id === r.sheetId);
      const page = sheet ? pageOf.get(sheet.imageRef) : undefined;
      const words = page === undefined ? [] : (doc.planImport?.words?.[page] ?? []);
      const c = sheet?.crop;
      const mine = c ? words.filter((w) => w.at.x >= c.x && w.at.x <= c.x + c.w && w.at.y >= c.y && w.at.y <= c.y + c.h) : words;
      return { ...r, flags: labelFlags(r.spaces, mine) };
    });
  }
  return { ...reading, floors };
}

/* ── what Tiff is handed (the registry's studio_design) ── */

type FloorLike = { id: string; name: string; level: number; heightM?: number; scaleMmPerUnit: number | null };

/**
 * The reading as Tiff reads it back: per floor, the spaces with their areas
 * once the floor has a scale, the openings, the stairs and voids, the A/C
 * notes, what she looked for and didn't find, and what the plan says that
 * the reading doesn't account for. A size written in a room is given only
 * when it agrees with the room as drawn.
 */
export function readingSummary(floors: FloorLike[], reading: PlanReading | null | undefined) {
  if (!reading) return { read: false as const, said: "Tiff hasn't read this design's plans." };
  return {
    read: true as const,
    read_at: reading.at.slice(0, 10),
    floors: [...floors]
      .sort((a, b) => a.level - b.level)
      .map((f) => {
        const sheets = reading.floors[f.id] ?? [];
        const mm = f.scaleMmPerUnit;
        const m2 = (o: ReadPoint[]) => (mm ? Math.round((area(o) * mm * mm) / 1e5) / 10 : null);
        const spaces = sheets.flatMap((r) => r.spaces);
        const openings = sheets.flatMap((r) => r.openings);
        const marks = sheets.flatMap((r) => r.marks);
        return {
          floor: f.name,
          level: f.level,
          scale_set: mm != null,
          storey_height_m: f.heightM ?? null,
          rooms: spaces
            .filter((s) => !["stair", "void", "notch"].includes(s.kind))
            .map((s) => ({
              name: s.name,
              kind: s.kind,
              area_m2: m2(s.outline),
              ...(s.written && writtenAgrees(s.written, s.outline, mm) === true ? { size_written: s.written } : {}),
              ...(s.existing ? { existing_to_remain: true } : {}),
            })),
          stairs: spaces.filter((s) => s.kind === "stair").map((s) => s.stair || s.name),
          voids: spaces.filter((s) => s.kind === "void" || s.kind === "notch").map((s) => `${s.name}${s.openTo ? `, open to ${s.openTo}` : ""}`),
          windows: openings.filter((o) => o.kind === "window").map((o) => ({ tag: o.tag, room: o.room, facing: o.facing, width_mm: o.widthMm })),
          doors: openings.filter((o) => o.kind === "door").length,
          skylights: openings.filter((o) => o.kind === "skylight").map((o) => o.room),
          ac_notes: marks.filter((m) => m.item === "ac_note" || m.item === "bulkhead" || m.item === "roof_space").map((m) => `${m.text}${m.room ? ` (${m.room})` : ""}`),
          joinery: marks.filter((m) => m.item === "joinery").length,
          fans: marks.filter((m) => m.item === "fan").map((m) => m.room),
          furniture: sheets.flatMap((r) => r.furniture).map((x) => `${x.kind}${x.room ? ` (${x.room})` : ""}`),
          looked_for_not_found: sheets.flatMap(notFound).map((c) => `${c.item}: ${c.note}`),
          the_plan_also_says: sheets.flatMap((r) => r.flags).map((fl) => (fl.kind === "label_inside" ? `"${fl.text}" is written inside ${fl.room}` : `"${fl.text}" is written where no room was read`)),
        };
      }),
    could_not_read: reading.failed.map((x) => x.reason),
  };
}

/* A SET TOO BIG TO SEND WHOLE (Isaac, 21 October 2026, 7 Cutler Rd: a 25
   page tender set at 16 MB). Past the reader's ceiling it is sent from the
   first floor plan on, which is where the plans, sections and elevations
   sit in an architect's set; the cover, notes and demolition plan come
   before it, the joinery and wet areas after. */

/** The set's page to read from: the first floor plan chosen, when the set
    is the first file uploaded (page indices count across the files in
    upload order); else its first page. */
export function firstPlanPage(planImport: { sources: readonly { kind: string }[]; chosen: readonly number[] } | null | undefined): number {
  if (!planImport || planImport.sources[0]?.kind !== "pdf" || planImport.chosen.length === 0) return 0;
  return Math.max(0, Math.min(...planImport.chosen));
}

/** The pages to send: from `from`, at most `most` of them. */
export function pagesToSend(total: number, from: number, most: number): number[] {
  const start = Math.min(Math.max(0, from), Math.max(0, total - 1));
  return Array.from({ length: Math.max(0, Math.min(most, total - start)) }, (_, i) => start + i);
}
