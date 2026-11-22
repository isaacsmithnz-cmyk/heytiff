import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import sharp from "sharp";
import { supabaseAdmin } from "@/lib/supabase-server";
import {
  CHECKLIST,
  inside,
  isRoomWord,
  pagesToSend,
  parseWritten,
  type PlanWord,
  type ReadCheck,
  type ReadDimension,
  type ReadFurniture,
  type ReadMark,
  type ReadOpening,
  type ReadPoint,
  type ReadLevel,
  type ReadRake,
  type ReadSubfloor,
  type ReadRoofPart,
  type ReadSpace,
  type ReadSurface,
  type RoofReading,
  type SheetReading,
  type SiteReading,
  type SpaceKind,
} from "./reading";
import { distToSegment } from "./geometry";
import { MARK, markKey } from "./schedule";
import { facingFrom } from "./gap-marks";

/* TIFF READS A FLOOR PLAN (v2, 20 October). The bench's checklist read
   (Opus 5.5, scored on Isaac's five floors and the 44 Pariatur St set,
   https://claude.ai/artifact/NHXQRiUuDGA6X41E7sddqU): every room, small
   space, stair, void, door, window, skylight, built-in, fan and A/C note,
   and for each item on the list, what she found or that she looked and
   didn't. Furniture is a read of its own, asked for apart so it can never
   be taken for a room. Opus for all of it (Isaac, 19 October: "Yes"):
   Sonnet missed skylights written as notes and called untagged doors absent.

   The sheet's raster is fetched from the plan bucket, cut to the sheet's
   crop, and shrunk to what the model reads well; every point comes back in
   the sheet's own pixels. */

const MODEL = "claude-opus-5-5";
const BUCKET = "studio-plans";
const MAX_EDGE = 2576;
const MAX_PIXELS = 3.6e6;
/* A photo of a plan is read smaller, and given up on sooner. On 3465's
   4000-pixel photo (13 November 2026) the room read took 503 s at the full
   size and 105 s at 1568 across, finding the same rooms, and two requests
   sat 5 minutes with no answer before starting again (Isaac: "Something
   definitely wrong", then "Yes, do it"). A drawing set's sheet keeps the
   full size: its small print is what's read. */
const PHOTO_EDGE = 1568;
const PHOTO_PIXELS = 1.4e6;
/** How long a photo's request waits for the reply to start, and how many goes it gets. */
const PHOTO_WAIT = { timeout: 120_000, tries: 2 };
/** the most room an answer is ever given: what a cut-off one is asked again with, at most */
const MOST_TOKENS = 64_000;

/** How much a sheet is shrunk for the model: under both caps, never grown. */
export function readScale(width: number, height: number, photo = false): number {
  const edge = photo ? PHOTO_EDGE : MAX_EDGE;
  const pixels = photo ? PHOTO_PIXELS : MAX_PIXELS;
  return Math.min(1, edge / Math.max(width, height), Math.sqrt(pixels / (width * height)));
}

/* ── the schema: strict, every field required, nothing nullable ── */
type Json = Record<string, unknown>;
const S = (o: Json): Json => ({ type: "object", additionalProperties: false, required: Object.keys(o), properties: o });
const str = (d?: string): Json => (d ? { type: "string", description: d } : { type: "string" });
const num = (d?: string): Json => (d ? { type: "number", description: d } : { type: "number" });
const bool = (): Json => ({ type: "boolean" });
const en = (v: readonly string[]): Json => ({ type: "string", enum: [...v] });
const arr = (i: Json, d?: string): Json => (d ? { type: "array", items: i, description: d } : { type: "array", items: i });
const OUTLINE = (d?: string) => str(`${d ? `${d}; ` : ""}pixel outline as "x,y x,y x,y ..." clockwise, as few points as the shape needs`);
const KINDS: SpaceKind[] = ["room", "wet", "cupboard", "circulation", "stair", "void", "notch", "outdoor", "garage", "other"];

export const FLOOR_SCHEMA = S({
  plan_up_faces: str('compass direction plan-up faces (N, NE, ...), or "" if the plan does not say'),
  spaces: arr(
    S({
      name: str("as written on the plan, or your best label"),
      name_written_on_plan: bool(),
      kind: en(KINDS),
      polygon: OUTLINE("on the INSIDE face of its walls"),
      dimensions_written: str('the ROOM\'s dimensions exactly as written for it (e.g. "4.1m x 2.7m"), or "". Not a size written on furniture or a fitting in it'),
      existing_to_remain: bool(),
      open_to: str('for a void or notch: "below", "sky", "lower roof", "roof space"; else ""'),
      stair: str('for a stair: "risers N, treads N, bottom <room>, top <room>" from its numbering; else ""'),
    }),
    "every room, small space, stair, void, notch and attached outdoor space",
  ),
  openings: arr(
    S({
      kind: en(["door", "window", "skylight"]),
      tag: str('the code beside it (W1, D3, S2), or ""'),
      x1: num(),
      y1: num(),
      x2: num(),
      y2: num(),
      width_mm: num("as written for it on the plan; 0 when none is written"),
      room: str("the room it belongs to"),
      external: bool(),
    }),
  ),
  marks: arr(
    S({
      item: en(["joinery", "bulkhead", "fan", "ac_note", "roof_space"]),
      text: str("what it is, as written where written"),
      room: str(),
      polygon: OUTLINE('a joinery footprint (4 corners); for a fan, bulkhead or note just its point "x,y"'),
    }),
  ),
  checklist: arr(
    S({ item: en(CHECKLIST), status: en(["found", "looked_not_found"]), count: num(), note: str("what you found, or where you looked and what you saw instead") }),
    "exactly one entry for each of the 11 checklist items",
  ),
});

export const floorPrompt = (floor: string, w: number, h: number, mmPerPx: number | null, words?: Listed) =>
  `This is the ${floor} plan of a building, ${w}×${h} pixels (origin top-left, x right, y down).${
    mmPerPx ? ` One pixel is about ${mmPerPx.toFixed(1)} mm.` : ""
  } You are reading it for an air conditioning installer who has to design and quote the job.

Read it against this checklist. For every item, say what you found, or say that you looked and found none and where you looked. Never leave an item out.
1. rooms: every enclosed room, plus every outdoor space attached to the building (balcony, verandah, patio, deck). Include the small ones: robes, linen, broom and pantry cupboards, WC/powder rooms, stores, fridge recesses, under-stair stores. A space with its own walls is its own entry, even unnamed, and a WC or powder room inside a bathroom's walls is its own entry. Open-plan spaces with no wall between their parts are one room. Polygon on the INSIDE face of the walls. Note anything marked existing to remain.
2. stairs: every stair, its outline, risers and treads if they are numbered, and the rooms at its top and bottom.
3. voids and notches: double-height voids, stair voids, light wells, shafts, and any area inside the building with no floor on this level: "Roof Over", "Void", "Open to below", a notch over a lower roof. Say what it opens to.
4. doors, 5. windows, 6. skylights: every one, as a segment along its wall from jamb to jamb (a skylight: the long side of its outline), with its tag if written, its width where one is written for it, its room, and whether it is external. A door with no tag is still a door; a skylight shown only as a note or a dashed outline is still a skylight.
7. joinery: built-ins (kitchen benches, island, robes, vanities, laundry bench, TV/fire joinery, linen and pantry shelving, bench seats), with a 4-corner footprint. Not loose furniture.
8. bulkheads: any bulkhead, dropped ceiling, or a note such as "Joinery/Bulkhead?".
9. ceiling fans: every fan symbol.
10. A/C notes: anything written about air conditioning ("A/C Over", unit or duct locations, grilles).
11. roof space: any note about roof space, "Roof Over", "Ridge Over", or what is above the ceiling.
A size written on a table, a bed or a fitting is not the room's size: only give a room the dimensions written for the room itself.
Put rooms, stairs, voids, notches and outdoor spaces in spaces (with their kind); doors, windows and skylights in openings; joinery, bulkheads, fans, A/C notes and roof-space notes in marks. The checklist has one entry per item, and its counts match what you listed.

Ignore the title block, legend, site and landscaping, neighbouring buildings, and section or detail views. Put coordinates on the wall lines, not on the labels.${
    words?.lines
      ? `

The words printed on the plan follow, each with where it sits in the picture (x,y): copy a name, a size or a mark as it is printed there.${leftOut(words)}

Words:
${words.lines}`
      : ""
  }`;

export const FURNITURE_SCHEMA = S({
  furniture: arr(S({ kind: str("bed, sofa, dining table, desk, TV, fridge, washing machine..."), room: str(), polygon: OUTLINE("its footprint, 4 corners") })),
});
export const furniturePrompt = (w: number, h: number) =>
  `This is a floor plan, ${w}×${h} pixels (origin top-left). List the loose furniture and appliances drawn on it: beds, sofas, dining tables and chairs as one table, desks, TVs, fridges, washing machines, dryers. Not built-in joinery (benches, robes, vanities), not walls, doors or windows. For each: what it is, the room it's in, and its footprint as 4 corners in pixels.`;

/* ── the sheet's own words, for her to read by ── */

/** the most of a sheet's words she is handed, in characters */
const WORDS_MAX = 80_000;

/** A sheet's words for her: one a line, "text @x,y" in her picture's pixels,
    and how many were left out past the cap. */
type Listed = { lines: string; cut: number };

const leftOut = (w: Listed) => (w.cut ? ` The list stops short: ${w.cut} more words are printed on it that aren't listed.` : "");

/** The words inside the part of the sheet she is shown, in the sheet's own
    pixels, and the same listed for her in her picture's. The list is cut at
    a whole line, never through one (a "2400" cut to "240" still reads as a
    size), and what was left out is counted and said. */
export function wordsShown(
  words: readonly PlanWord[],
  at: { k: number; left: number; top: number; ow: number; oh: number },
  most = WORDS_MAX,
): { words: PlanWord[] } & Listed {
  const mine: PlanWord[] = [];
  const lines: string[] = [];
  let size = 0;
  let cut = 0;
  for (const w of words) {
    const x = Math.round((w.at.x - at.left) * at.k);
    const y = Math.round((w.at.y - at.top) * at.k);
    if (x < 0 || y < 0 || x > at.ow || y > at.oh) continue;
    mine.push(w);
    const line = `${w.text} @${x},${y}`;
    if (cut || size + line.length > most) {
      cut++;
      continue;
    }
    lines.push(line);
    size += line.length + 1;
  }
  return { words: mine, lines: lines.join("\n"), cut };
}

/* ── reading what comes back ── */

export function parseOutline(text: string): ReadPoint[] {
  return (text.match(/-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?/g) ?? []).map((pair) => {
    const [x, y] = pair.split(",").map((v) => Number(v.trim()));
    return { x, y };
  });
}

type Raw = Record<string, unknown> & { [k: string]: unknown };
const asArr = (v: unknown): Raw[] => (Array.isArray(v) ? (v as Raw[]) : []);
const s = (v: unknown) => (typeof v === "string" ? v : "");
const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/** Her answer, back in the sheet's own pixels: scaled up by `k` and moved by
    the crop's corner. `words` are the sheet's own (a PDF's), in its pixels,
    and `mmPerPx` its scale: where its names are words at all (a plan can
    draw them as shapes), what it prints is decided by them, not by her. */
export function toSheet(raw: Raw, furniture: Raw, sheetId: string, k: number, ox: number, oy: number, words: readonly PlanWord[] = [], mmPerPx: number | null = null): SheetReading {
  const P = (p: ReadPoint) => ({ x: Math.round(p.x / k + ox), y: Math.round(p.y / k + oy) });
  const outline = (v: unknown) => parseOutline(s(v)).map(P);
  const planUp = s(raw.plan_up_faces);
  const read = asArr(raw.spaces).map(
    (r): ReadSpace => ({
      name: s(r.name),
      named: r.name_written_on_plan === true,
      kind: (KINDS as string[]).includes(s(r.kind)) ? (s(r.kind) as SpaceKind) : "other",
      outline: outline(r.polygon),
      written: s(r.dimensions_written),
      existing: r.existing_to_remain === true,
      openTo: s(r.open_to),
      stair: s(r.stair),
    }),
  );
  /* its words name its rooms (two labels at least), so its marks and sizes are words too */
  const printed = words.filter((w) => isRoomWord(w.text)).length >= 2;
  const spaces = printed ? read.map((sp) => spaceAsPrinted(sp, words)) : read;
  /* what she put in a room she named otherwise goes with it to the label printed there */
  const renamed = new Map<string, string>();
  spaces.forEach((sp, i) => {
    const was = norm(read[i].name);
    if (sp.name && sp.name !== read[i].name && read.filter((r) => norm(r.name) === was).length === 1) renamed.set(was, sp.name);
  });
  const roomOf = (v: unknown) => renamed.get(norm(s(v))) ?? s(v);
  return {
    sheetId,
    planUp,
    spaces,
    openings: asArr(raw.openings).map((o): ReadOpening => {
      const op: Omit<ReadOpening, "facing"> = {
        kind: o.kind === "window" || o.kind === "skylight" ? o.kind : "door",
        tag: s(o.tag),
        a: P({ x: n(o.x1), y: n(o.y1) }),
        b: P({ x: n(o.x2), y: n(o.y2) }),
        widthMm: n(o.width_mm),
        room: roomOf(o.room),
        external: o.external === true,
      };
      /* the way it faces is the wall's it is on, never her word for it: a skylight faces the sky */
      const facing = op.external && op.kind !== "skylight" ? facingOf({ ...op, room: s(o.room) }, read, planUp) : "";
      return { ...op, facing, ...(printed ? openingAsPrinted(op, words, mmPerPx) : {}) };
    }),
    marks: asArr(raw.marks).map((m): ReadMark => ({ item: (s(m.item) || "ac_note") as ReadMark["item"], text: s(m.text), room: roomOf(m.room), outline: outline(m.polygon) })),
    furniture: asArr(furniture.furniture).map((f): ReadFurniture => ({ kind: s(f.kind), room: roomOf(f.room), outline: outline(f.polygon) })),
    checklist: asArr(raw.checklist)
      .filter((c) => (CHECKLIST as readonly string[]).includes(s(c.item)))
      .map((c): ReadCheck => ({ item: s(c.item) as ReadCheck["item"], found: c.status === "found", count: n(c.count), note: s(c.note) })),
    flags: [],
  };
}

/* ── what the plan prints, by its own words ── */

const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9]/g, "");
/** how far from an opening its mark and its width are printed */
const BESIDE_MM = 1500;
/* a size as a plan writes one, "4.1 x 2.7" or "4100 x 2700" (parseWritten reads it) */
const SIZES = /\d+(?:[.,]\d+)?\s*(?:mm|m)?\s*[x×]\s*\d+(?:[.,]\d+)?\s*(?:mm|m)?/gi;

/** A space as the plan prints it: named only where a name is printed in it,
    hers word for word or as one of its words ("BATH" in her "Bathroom"),
    else the one room label printed in it ("BED 2" where she said "Bedroom
    2"), and unnamed where none is; a size written for it only where that
    size is printed in it. */
export function spaceAsPrinted(sp: ReadSpace, words: readonly PlanWord[]): ReadSpace {
  const mine = sp.outline.length >= 3 ? words.filter((w) => inside(w.at, sp.outline)) : [];
  const text = mine.map((w) => w.text).join(" ");
  const said = norm(sp.name);
  const part = (w: PlanWord) => {
    const t = norm(w.text);
    return t.length >= 3 && /[a-z]/.test(t) && said.includes(t);
  };
  const labels = [...new Set(mine.filter((w) => isRoomWord(w.text)).map((w) => w.text.trim()))];
  const name = said && (norm(text).includes(said) || mine.some(part)) ? sp.name : labels.length === 1 ? labels[0] : "";
  const want = parseWritten(sp.written);
  const same = (a: number, b: number) => Math.abs(a - b) <= b * 0.01;
  const written = !!want && (text.match(SIZES) ?? []).some((t) => {
    const got = parseWritten(t);
    return !!got && same(got[0], want[0]) && same(got[1], want[1]);
  });
  return { ...sp, name, named: !!name, written: written ? sp.written : "" };
}

/** An opening as the plan prints it: the parts of her mark printed beside
    it (each word of it, or two together, "FW 03"), and her width only where
    a figure printed beside it is that width; `mmPerPx` is the sheet's. */
export function openingAsPrinted(o: Pick<ReadOpening, "a" | "b" | "tag" | "widthMm">, words: readonly PlanWord[], mmPerPx: number | null): Pick<ReadOpening, "tag" | "widthMm"> {
  const len = Math.hypot(o.b.x - o.a.x, o.b.y - o.a.y);
  /* with no scale, about its own width */
  const reach = mmPerPx ? BESIDE_MM / mmPerPx : 1.5 * len;
  const near = words.filter((w) => distToSegment(w.at, o.a, o.b) <= reach);
  const keys = new Set(near.flatMap((w, i) => [markKey(w.text), ...(i + 1 < near.length ? [markKey(w.text + near[i + 1].text)] : [])]));
  const parts = o.tag.split(/[\s/,]+/).filter(Boolean);
  const kept: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    if (i + 1 < parts.length && keys.has(markKey(parts[i] + parts[i + 1]))) {
      kept.push(`${parts[i]} ${parts[i + 1]}`);
      i += 1;
    } else if (/[a-z]/i.test(parts[i]) && /\d/.test(parts[i]) && keys.has(markKey(parts[i]))) kept.push(parts[i]);
  }
  /* a figure in metres has its point: "2.1" is 2100 */
  const figures = near
    .filter((w) => !MARK.test(w.text.trim()))
    .flatMap((w) => (w.text.match(/\d+(?:\.\d+)?/g) ?? []).map((t) => (t.includes(".") ? Number(t) * 1000 : Number(t))));
  return { tag: kept.join(" "), widthMm: o.widthMm > 0 && figures.some((f) => Math.abs(f - o.widthMm) < 1) ? o.widthMm : 0 };
}

/** The way an outside opening faces: out of its room through the wall it
    is on (its room's edge along it, within its own width of it), against
    the way plan-up faces. "" when the plan doesn't say which way is up, or
    the opening is on no wall of its room. */
export function facingOf(o: Pick<ReadOpening, "a" | "b" | "room">, spaces: readonly ReadSpace[], planUp: string): string {
  const len = Math.hypot(o.b.x - o.a.x, o.b.y - o.a.y);
  if (!(len > 0)) return "";
  const mid = { x: (o.a.x + o.b.x) / 2, y: (o.a.y + o.b.y) / 2 };
  let best: { d: number; out: ReadPoint } | null = null;
  for (const sp of spaces) {
    const pts = sp.outline;
    if (pts.length < 3 || !norm(o.room) || norm(sp.name) !== norm(o.room)) continue;
    let wind = 0;
    for (let i = 0; i < pts.length; i++) wind += pts[i].x * pts[(i + 1) % pts.length].y - pts[(i + 1) % pts.length].x * pts[i].y;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const q = pts[(i + 1) % pts.length];
      const ex = q.x - p.x;
      const ey = q.y - p.y;
      const el = Math.hypot(ex, ey);
      if (!(el > 0) || Math.abs(ex * (o.b.x - o.a.x) + ey * (o.b.y - o.a.y)) < 0.9 * el * len) continue;
      const d = distToSegment(mid, p, q);
      if (d > len || (best && d >= best.d)) continue;
      /* which side of an edge is out follows from which way the outline winds */
      best = { d, out: wind > 0 ? { x: ey, y: -ex } : { x: -ey, y: ex } };
    }
  }
  return best ? facingFrom(best.out, planUp) : "";
}

/* ── one sheet ── */

export type SheetToRead = {
  floorId: string;
  floorName: string;
  sheetId: string;
  ref: string;
  /** the sheet's crop in its own pixels; none = the whole raster */
  crop?: { x: number; y: number; w: number; h: number };
  mmPerPx: number | null;
  /** a photo or a sketch, not a drawing set's sheet: read smaller, given up on sooner */
  photo?: boolean;
  /** the sheet's own words where its file has them (a PDF's), in the sheet's
      pixels: she reads by them, and what the sheet prints is decided by them */
  words?: readonly PlanWord[];
};

let client: Anthropic | null = null;

export type Block = Anthropic.Messages.ContentBlockParam;
export const pngBlock = (image: Buffer): Block => ({ type: "image", source: { type: "base64", media_type: "image/png", data: image.toString("base64") } });

type Wait = { timeout: number; tries: number };

async function ask(image: Buffer, text: string, schema: Json, maxTokens: number, wait?: Wait): Promise<Raw> {
  return askWith([pngBlock(image)], text, schema, maxTokens, wait);
}

/** One read. With `wait`, the request is given up on when its reply hasn't
    started in that time, and goes again only up to its tries (the SDK's own
    retries off, so they don't multiply); without, as the SDK and three goes. */
export async function askWith(blocks: Block[], text: string, schema: Json, maxTokens: number, wait?: Wait, effort: "high" | "medium" = "high"): Promise<Raw> {
  client = client ?? new Anthropic();
  let tries = 0;
  let room = maxTokens;
  for (;;) {
    try {
      const msg = await client.messages
        .stream(
          {
            model: MODEL,
            max_tokens: room,
            output_config: { effort, format: { type: "json_schema", schema } },
            messages: [{ role: "user", content: [...blocks, { type: "text", text }] }],
          },
          wait ? { timeout: wait.timeout, maxRetries: 0 } : undefined,
        )
        .finalMessage();
      if (msg.stop_reason === "refusal") throw new Error("Tiff declined to read this plan");
      /* cut off before her answer was whole (a roof and a site were lost this
         way on 3570, 21 November 2026): once more with twice the room,
         instead of half an answer that reads as none */
      if (msg.stop_reason === "max_tokens") {
        if (room >= MOST_TOKENS) throw new Error("Tiff's answer was too long to finish");
        room = Math.min(MOST_TOKENS, room * 2);
        continue;
      }
      const block = [...msg.content].reverse().find((b) => b.type === "text");
      if (!block || block.type !== "text") throw new Error("Tiff found nothing to read");
      return JSON.parse(block.text) as Raw;
    } catch (e) {
      const retry = e instanceof Anthropic.RateLimitError || e instanceof Anthropic.InternalServerError || e instanceof Anthropic.APIConnectionError;
      tries += 1;
      if (!retry || tries >= (wait?.tries ?? 3)) throw e;
      await new Promise((r) => setTimeout(r, (wait ? 5000 : 15000) * tries));
    }
  }
}

async function fetchOwn(orgId: string, ref: string): Promise<Buffer> {
  if (!ref.startsWith(`org/${orgId}/`)) throw new Error("That plan isn't this workspace's");
  const { data, error } = await supabaseAdmin.storage.from(BUCKET).download(ref);
  if (error || !data) throw new Error("The plan couldn't be fetched");
  return Buffer.from(await data.arrayBuffer());
}

/** A sheet's raster cut to its crop and shrunk to what the model reads well, and how to get back. */
async function prepare(orgId: string, sheet: SheetToRead): Promise<{ image: Buffer; ow: number; oh: number; k: number; left: number; top: number }> {
  const src = await fetchOwn(orgId, sheet.ref);
  const meta = await sharp(src).metadata();
  const W = meta.width ?? 0;
  const H = meta.height ?? 0;
  const c = sheet.crop ?? { x: 0, y: 0, w: W, h: H };
  const left = Math.max(0, Math.round(c.x));
  const top = Math.max(0, Math.round(c.y));
  const width = Math.max(1, Math.min(W - left, Math.round(c.w)));
  const height = Math.max(1, Math.min(H - top, Math.round(c.h)));
  const k = readScale(width, height, sheet.photo);
  const ow = Math.round(width * k);
  const oh = Math.round(height * k);
  const image = await sharp(src).extract({ left, top, width, height }).resize(ow, oh).flatten({ background: "#ffffff" }).png().toBuffer();
  return { image, ow, oh, k, left, top };
}

/** Reads one sheet: the checklist read and the furniture read, side by side. */
export async function readSheet(orgId: string, sheet: SheetToRead): Promise<SheetReading> {
  const p = await prepare(orgId, sheet);
  const { image, ow, oh, k, left, top } = p;
  const mm = sheet.mmPerPx ? sheet.mmPerPx / k : null;
  const wait = sheet.photo ? PHOTO_WAIT : undefined;
  const shown = wordsShown(sheet.words ?? [], p);
  if (shown.cut) console.error(`[reading] ${sheet.sheetId}: ${shown.cut} of its words weren't listed for the floor read`);
  const [floor, furniture] = await Promise.all([
    ask(image, floorPrompt(sheet.floorName, ow, oh, mm, shown), FLOOR_SCHEMA, 48000, wait),
    ask(image, furniturePrompt(ow, oh), FURNITURE_SCHEMA, 16000, wait).catch(() => ({ furniture: [] }) as Raw),
  ]);
  return toSheet(floor, furniture, sheet.sheetId, k, left, top, shown.words, sheet.mmPerPx);
}

/* ── the door and window schedule (schedule.ts) ── */

export const SCHEDULE_SCHEMA = S({
  items: arr(
    S({
      mark: str("exactly as printed: GW.21, W1.3, D04"),
      type: str('the type it is listed under (W.05), else ""'),
      kind: en(["window", "door", "skylight"]),
      width_mm: num("overall, across the opening"),
      height_mm: num("overall, up the opening; 0 if not shown"),
      sill_mm: num("its sill above the floor, when shown; else 0"),
    }),
    "every mark the sheet gives a size for",
  ),
});

export const schedulePrompt = (w: number, h: number, words: Listed) =>
  `This is a sheet from a building's drawing set that schedules its windows and doors, ${w}×${h} pixels. The words printed on it follow, each with where it sits in the picture (x,y).${
    words.cut ? ` The list stops short: ${words.cut} more words are printed on it that aren't listed, so leave out a mark whose size isn't in the words listed.` : ""
  }

List every window, door and skylight mark the sheet gives a size for. For each: its mark exactly as printed (GW.21, W1.3, D04); the type it is listed under when the sheet groups marks by type (W.05), else ""; whether it is a window, a door or a skylight; its overall width and height in millimetres; and its sill's height above the floor in millimetres when the sheet shows one, else 0.

A legend of types gives each type's size once and lists the marks of that type under it: give every listed mark, each with its type's size. A width is measured across the opening and a height up it; on an elevation the width is the dimension along it and the height the one up it. Take the figures from the words where they are printed, and leave out a mark whose size you can't read for certain. Not a room's size, a level or a note.

Words:
${words.lines}`;

/** A schedule sheet read: its picture shrunk as a floor's is, and its words where they sit on it. */
export async function readSchedule(png: Buffer, words: readonly PlanWord[]): Promise<unknown> {
  const meta = await sharp(png).metadata();
  const W = meta.width ?? 1;
  const H = meta.height ?? 1;
  const k = readScale(W, H);
  const ow = Math.round(W * k);
  const oh = Math.round(H * k);
  const image = await sharp(png).resize(ow, oh).flatten({ background: "#ffffff" }).png().toBuffer();
  const listed = wordsShown(words, { k, left: 0, top: 0, ow, oh });
  if (listed.cut) console.error(`[reading] a schedule sheet: ${listed.cut} of its words weren't listed for its read`);
  return askWith([pngBlock(image)], schedulePrompt(ow, oh, listed), SCHEDULE_SCHEMA, 16000);
}

/* ── the dimensions printed on a sheet, for one with no printed scale ── */

export const DIMENSIONS_SCHEMA = S({
  dimensions: arr(
    S({
      mm: num("the figure as printed, in millimetres (7440; a plan in metres, 7.44, is 7440)"),
      what: str('where it is and what it spans, short: "along the bottom, the overall width of the house"'),
      x1: num(),
      y1: num(),
      x2: num(),
      y2: num(),
    }),
    "up to six, the longest first; none if the plan prints no dimension whose two ends are clear",
  ),
});

export const dimensionsPrompt = (w: number, h: number, figures?: Listed) =>
  `This is a floor plan, ${w}×${h} pixels (origin top-left, x right, y down). It is being scaled off its own printed dimensions.

List the dimensions printed on it: a length written as a figure along a dimension line, or a scale bar's length. For each, the figure in millimetres as printed, and the two ends of what it measures, in pixels: the tick marks, arrowheads or extension lines at each end of ITS dimension line, not the ends of a longer line it is part of. Where the figure sits between two walls with no ticks drawn, the two wall faces it spans.

Give the longest ones first, overall lengths before a single room's, six at most. Only a dimension whose figure you can read for certain and whose two ends you can place: leave out one you would be guessing at. Not a room's size written inside it ("4.1 x 2.7"), not a window or door size, not a level or a height. If the plan prints none, give none.${
    figures?.lines
      ? `

The figures printed on it follow, each with where it sits in the picture (x,y). Give only a dimension whose figure is one of these, printed by the middle of its line.${leftOut(figures)}

Figures:
${figures.lines}`
      : ""
  }`;

/** The millimetres a printed figure can be: "7440", "7 440", "7,440",
    "7440mm"; in metres, "7.44" or "7.44m". None for a word that isn't one. */
export function figureMm(text: string): number[] {
  const m = text
    .trim()
    .replace(/(\d)[\s,](?=\d{3}(?!\d))/g, "$1")
    .match(/^(\d+(?:\.\d+)?)\s*(mm|m)?$/i);
  if (!m) return [];
  const v = Number(m[1]);
  const unit = m[2]?.toLowerCase();
  return unit === "mm" ? [v] : unit === "m" ? [v * 1000] : m[1].includes(".") ? [v, v * 1000] : [v];
}

/* a figure long enough to scale a plan by (scaleFromDimensions takes 300 mm up) */
const isFigure = (w: PlanWord) => figureMm(w.text).some((mm) => mm >= 300);

/** The dimensions printed on a sheet, in the sheet's own pixels: one small read, for a sheet with no printed scale. */
export async function readDimensions(orgId: string, sheet: SheetToRead): Promise<ReadDimension[]> {
  const p = await prepare(orgId, sheet);
  const figures = wordsShown((sheet.words ?? []).filter(isFigure), p);
  const raw = await ask(p.image, dimensionsPrompt(p.ow, p.oh, figures), DIMENSIONS_SCHEMA, 8000, sheet.photo ? PHOTO_WAIT : undefined);
  return toDimensions(raw, p.k, p.left, p.top, figures.words);
}

/** Her dimensions, back in the sheet's own pixels, the longest six. Where
    the sheet prints its figures as words (`words`, in its pixels), one is
    kept only when a printed figure that is its length sits by its line's
    middle: a figure she misread, or ends she put on another line, is left
    out. */
export function toDimensions(raw: Raw, k: number, ox: number, oy: number, words: readonly PlanWord[] = []): ReadDimension[] {
  const P = (x: number, y: number) => ({ x: Math.round(x / k + ox), y: Math.round(y / k + oy) });
  const span = (d: ReadDimension) => Math.hypot(d.b.x - d.a.x, d.b.y - d.a.y);
  const figures = words.filter(isFigure);
  const printed = (d: ReadDimension) => {
    const mid = { x: (d.a.x + d.b.x) / 2, y: (d.a.y + d.b.y) / 2 };
    return figures.some((w) => Math.hypot(w.at.x - mid.x, w.at.y - mid.y) <= span(d) / 4 && figureMm(w.text).some((mm) => Math.abs(mm - d.mm) < 1));
  };
  return asArr(raw.dimensions)
    .map((d): ReadDimension => ({ mm: n(d.mm), what: s(d.what).slice(0, 120), a: P(n(d.x1), n(d.y1)), b: P(n(d.x2), n(d.y2)) }))
    /* a sheet with no figures as words (a photo, a plan that draws its text) is read by picture alone */
    .filter((d) => d.mm > 0 && (figures.length < 2 || printed(d)))
    .sort((p, q) => span(q) - span(p))
    .slice(0, 6);
}

/* ── the roof and the heights, off the whole set ── */

const FORMS = ["gable", "hip", "skillion", "flat"] as const;
/* where she says a height came from, the words that say how she got one
   that isn't written: not a sheet's own title ("A301 Typical Section"), nor
   heights worked out between written RLs */
const GUESSED = /\b(scaled|measured off|assumed|estimated|usual|approx|guess)/i;

export const roofSchema = (floors: string[]): Json =>
  S({
    levels: arr(
      S({
        floor: en(floors),
        ceiling_mm: num("floor level to the ceiling (to the top of the walls where the ceiling rakes), as the set writes it as a height or RLs; 0 when it doesn't"),
        floor_zone_mm: num("this floor's ceiling to the floor level above, as written; 0 for the top floor or when not written"),
        source: str("where it is written: the drawing number and the label or RL"),
      }),
      "one entry per floor named",
    ),
    roof_parts: arr(
      S({
        floor: en(floors),
        form: en(FORMS),
        footprint: OUTLINE("the rectangle the part covers AT THE WALL LINE on that floor's plan image, 4 corners"),
        ridge: en(["across", "down"]),
        falls_to: en(["left", "right", "up", "down", "none"]),
        pitch_deg: num("as written on a section, an elevation or the roof plan; 0 when not written"),
        eave_mm: num("top of the walls it sits on, above that floor's floor level, as written or from written RLs; 0 when not written"),
        overhang_mm: num("eaves overhang past the wall line, as written or dimensioned; 0 where there are none or it isn't"),
        existing: bool(),
        source: str("the sheets it was read from"),
      }),
    ),
    raked: arr(S({ floor: en(floors), room: str(), low_mm: num("as written"), high_mm: num("as written") }), "only rooms whose low and high heights are written"),
    material: str(),
    roof_space: str("what the set shows about the roof space and what could go in it"),
    subfloor: S({
      shown: en(["drawn", "mentioned", "none"]),
      floor: en(floors),
      outline: OUTLINE('drawn only: the part of that floor it runs under, on that floor\'s plan image; "" when only mentioned'),
      rooms: str('the rooms it runs under as a short list, as you would say it: "the kitchen, laundry and sitting rooms"; "" when only mentioned'),
      height_mm: num("the ground to the underside of the floor, written or measured off a section at its printed scale; 0 when neither"),
      height_from: str('a few words: "measured off section 1 on A401" or "written on section BB, CD202"; "" when 0'),
      sheet: str("the drawing number it is shown or named on, as printed: A401"),
      words: str("its own label or note as written, the one that names it, nothing more"),
    }),
  });

export const roofPrompt = (plans: { floor: string; w: number; h: number; mm: number | null }[]) =>
  `The PDF is a building's drawing set. After it come the floor plan images of ${plans.map((p) => `the ${p.floor} (${p.w}×${p.h} pixels${p.mm ? `, one pixel about ${p.mm.toFixed(1)} mm` : ""})`).join(", ")}, in that order, each with its origin top-left, x right and y down.

You are reading it for an air conditioning installer who needs the building in 3D: its heights, its roof and its roof space. Use the sections and elevations for heights and pitches, the roof plan (or the site plan's roof) for the roof's shape, and the floor plan images to set the roof out.

1. levels: for every floor named, the ceiling height above its floor level, and the floor zone between its ceiling and the next floor level (0 on the top floor), as the set writes them (heights or RLs), and where. A height it doesn't write is 0: never one scaled off a drawing or taken as usual.
2. roof_parts: the roof as rectangular parts. Break an L, T or U roof into rectangles, one per ridge. For each part: which floor's walls carry it, its form (gable: two slopes and gable ends; hip: slopes on all four sides; skillion: one slope; flat), its footprint as the 4 corners of the rectangle it covers AT THE WALL LINE, on THAT floor's plan image, in that image's pixels; which way its ridge runs on that image (across = along x, down = along y; for a skillion, the direction its edges run, not its slope); for a skillion, the side of the image it falls to (left, right, up or down; none for the others); its pitch in degrees and the top of the walls it sits on above that floor's level, in mm, each as the set writes it (0 for one it doesn't); its eaves overhang in mm, as written or dimensioned (0 where it isn't); and whether it is existing. A verandah or patio roof is its own part. A neighbouring building or an existing garage drawn on the plan only gets a part if the set shows its roof.
3. raked: every room whose ceiling follows the roof, with its low and high ceiling heights above its floor as the set writes them. Leave out a room whose heights it doesn't write.
4. material, and what the set shows about the roof space: how high it is at the ridge, whether anything is noted for it, and what would fit.
5. subfloor: the space between the ground and a suspended floor, where equipment can go. drawn: a plan or a section draws it as a space (labelled subfloor, sub-floor void, store under floor, crawl space, or a band or hatch marked as one). mentioned: a note or schedule only names one ("subfloor ventilation", "underfloor ducted system", "suspended floor with enclosed subfloor"). none: neither. Underfloor heating, a subfloor sheet or board under the flooring, or a slab on ground is not a subfloor. When drawn: the floor it is under, its outline on that floor's plan image round the rooms it runs under (where a section shows it under only some rooms, only those; a new slab beside it has none), those rooms in words, its height from the ground to the floor's underside (written, or measured off the section at its printed scale), and where that came from. Either way, the drawing number it is on and its words as written.

Put coordinates on the wall lines of the plan images, not on labels or dimension strings.`;

/** Her answer, back in each floor's sheet pixels. */
export function toRoof(raw: Raw, plans: { floorId: string; floor: string; sheetId: string; k: number; left: number; top: number }[]): RoofReading {
  const byName = new Map(plans.map((p) => [p.floor, p]));
  const P = (p: ReadPoint, at: (typeof plans)[number]) => ({ x: Math.round(p.x / at.k + at.left), y: Math.round(p.y / at.k + at.top) });
  const parts: ReadRoofPart[] = [];
  for (const r of asArr(raw.roof_parts)) {
    const at = byName.get(s(r.floor));
    const outline = parseOutline(s(r.footprint));
    if (!at || outline.length < 3 || !(FORMS as readonly string[]).includes(s(r.form))) continue;
    const form = s(r.form) as ReadRoofPart["form"];
    const ridge = r.ridge === "down" ? "down" : "across";
    const falls = s(r.falls_to);
    /* a skillion falls across the way its edges run, to a side she read: one
       that falls nowhere, or along its own edges, has no low side to build */
    const fallsTo = form !== "skillion" ? "" : ridge === "across" ? (falls === "up" || falls === "down" ? falls : null) : falls === "left" || falls === "right" ? falls : null;
    if (fallsTo === null) continue;
    /* a pitch and an eave the set doesn't write (0) are left out with their
       part, not set at floor level or flat; a flat roof may fall at 0 */
    const pitch = n(r.pitch_deg);
    if (n(r.eave_mm) <= 0 || pitch > 60 || (form === "flat" ? pitch < 0 : pitch <= 0)) continue;
    /* an overhang past 1.5 m is a misread: left out (0), not cut to 1.5 m */
    const overhang = n(r.overhang_mm);
    parts.push({
      floorId: at.floorId,
      sheetId: at.sheetId,
      form,
      outline: outline.map((p) => P(p, at)),
      ridge,
      fallsTo,
      pitchDeg: pitch,
      eaveMm: n(r.eave_mm),
      overhangMm: overhang > 0 && overhang <= 1500 ? overhang : 0,
      existing: r.existing === true,
      source: s(r.source),
    });
  }
  const levels: ReadLevel[] = [];
  for (const l of asArr(raw.levels)) {
    const at = byName.get(s(l.floor));
    /* a height is the set's only where she says where it is written: a drawing's number or an RL, never a scale or a usual height */
    const source = s(l.source);
    if (at && n(l.ceiling_mm) > 1800 && /\d/.test(source) && !GUESSED.test(source))
      levels.push({ floorId: at.floorId, ceilingMm: n(l.ceiling_mm), floorZoneMm: Math.max(0, n(l.floor_zone_mm)), source });
  }
  const raked: ReadRake[] = [];
  for (const r of asArr(raw.raked)) {
    const at = byName.get(s(r.floor));
    /* both heights written, and a ceiling a person stands under: else it isn't kept, so the room keeps its floor's */
    const low = n(r.low_mm);
    const high = n(r.high_mm);
    if (at && s(r.room) && low > 1800 && high >= low) raked.push({ floorId: at.floorId, room: s(r.room), lowMm: low, highMm: high });
  }
  const subfloor = toSubfloor(raw.subfloor, byName, P);
  return { levels, parts, raked, material: s(raw.material), roofSpace: s(raw.roof_space), ...(subfloor ? { subfloor } : {}) };
}

/** Her subfloor: drawn with its outline on the floor it is under, or only mentioned; nothing when neither. */
export function toSubfloor<At extends { floorId: string; sheetId: string }>(raw: unknown, byName: Map<string, At>, P: (p: ReadPoint, at: At) => ReadPoint): ReadSubfloor | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  const shown = s(r.shown);
  if (shown !== "drawn" && shown !== "mentioned") return undefined;
  /* on a floor not named, it is under no floor she read: left out, never put under the first */
  const at = byName.get(s(r.floor));
  if (!at) return undefined;
  const outline = shown === "drawn" ? parseOutline(s(r.outline)).map((p) => P(p, at)) : [];
  /* drawn with no shape to set out is as good as named */
  const drawn = shown === "drawn" && outline.length >= 3;
  const height = Math.round(n(r.height_mm));
  return {
    shown: drawn ? "drawn" : "mentioned",
    floorId: at.floorId,
    sheetId: at.sheetId,
    outline: drawn ? outline : [],
    rooms: drawn ? s(r.rooms).slice(0, 200) : "",
    heightMm: height >= 100 && height <= 6000 ? height : 0,
    heightFrom: height >= 100 && height <= 6000 ? s(r.height_from).slice(0, 120) : "",
    sheet: s(r.sheet).slice(0, 40),
    words: s(r.words).slice(0, 300),
  };
}

/** A reading as she wrote it: each floor by its name, its points back in that floor's plan image's pixels. */
export function fromRoof(r: RoofReading, plans: { floorId: string; floor: string; sheetId: string; k: number; left: number; top: number }[]): Json {
  const byId = new Map(plans.map((p) => [p.floorId, p]));
  const img = (pt: ReadPoint, at: (typeof plans)[number]) => `${Math.round((pt.x - at.left) * at.k)},${Math.round((pt.y - at.top) * at.k)}`;
  const name = (id: string) => byId.get(id)?.floor ?? "";
  return {
    levels: r.levels.map((l) => ({ floor: name(l.floorId), ceiling_mm: l.ceilingMm, floor_zone_mm: l.floorZoneMm, source: l.source })),
    roof_parts: r.parts
      .filter((p) => byId.has(p.floorId))
      .map((p) => ({
        floor: name(p.floorId),
        form: p.form,
        footprint: p.outline.map((pt) => img(pt, byId.get(p.floorId)!)).join(" "),
        ridge: p.ridge,
        falls_to: p.fallsTo || "none",
        pitch_deg: p.pitchDeg,
        eave_mm: p.eaveMm,
        overhang_mm: p.overhangMm,
        existing: p.existing,
        source: p.source,
      })),
    raked: r.raked.map((k) => ({ floor: name(k.floorId), room: k.room, low_mm: k.lowMm, high_mm: k.highMm })),
    material: r.material,
    roof_space: r.roofSpace,
    subfloor: r.subfloor
      ? {
          shown: r.subfloor.shown,
          floor: name(r.subfloor.floorId),
          outline: byId.has(r.subfloor.floorId) ? r.subfloor.outline.map((pt) => img(pt, byId.get(r.subfloor!.floorId)!)).join(" ") : "",
          rooms: r.subfloor.rooms,
          height_mm: r.subfloor.heightMm,
          height_from: r.subfloor.heightFrom,
          sheet: r.subfloor.sheet,
          words: r.subfloor.words,
        }
      : { shown: "none", floor: name(r.levels[0]?.floorId ?? ""), outline: "", rooms: "", height_mm: 0, height_from: "", sheet: "", words: "" },
  };
}

/* THE API TAKES 32 MB A REQUEST, and all of it is base64: a PDF goes at four
   characters for every three bytes, beside the plan images. So a set is cut
   to what fits beside its images, not to a size of its own: a cap of 30 MB
   on the file alone lets a 24 MB set through uncut, and base64 beside its
   floors that is over the ceiling, so its read is refused every time. A
   megabyte is kept for the prompt. */
const REQUEST_MAX = 31_000_000;
const base64 = (bytes: number) => Math.ceil(bytes / 3) * 4;

/** The set as it can be sent in `room` characters of base64: whole when it
    fits, else the pages `order` puts first, as many as fit and `least` at
    fewest, or all it gives where it gives fewer. A set none of whose cuts
    fit is too large to read, and says so. */
export async function fitted(pdf: Buffer, room: number, order: (total: number) => number[], least: number, tooLarge: string): Promise<Buffer> {
  if (base64(pdf.byteLength) <= room) return pdf;
  const { PDFDocument } = await import("pdf-lib");
  const whole = await PDFDocument.load(pdf, { ignoreEncryption: true });
  let keep = order(whole.getPageCount());
  /* a set whose floor plans are its last few pages is still tried with them */
  const fewest = Math.min(least, keep.length);
  while (keep.length && room > 0) {
    const cut = await PDFDocument.create();
    for (const pg of await cut.copyPages(whole, [...keep].sort((a, b) => a - b))) cut.addPage(pg);
    const out = Buffer.from(await cut.save());
    if (base64(out.byteLength) <= room) return out;
    if (keep.length === fewest) break;
    /* what goes is what `order` puts last */
    keep = keep.slice(0, Math.max(fewest, Math.min(keep.length - 1, Math.ceil(keep.length * 0.75))));
  }
  throw new Error(tooLarge);
}

/** The pages a site read is sent when the set is cut, forty at most: the
    site plan mostly comes before the floor plans, so every page before the
    first floor plan, nearest it first, then that plan, then the pages after
    it, nearest first, for a set that puts its site plan (or a site and roof
    plan) after its floors. Cut again, what goes is the far end of those. */
export function sitePages(total: number, from: number): number[] {
  if (total < 1) return [];
  const start = Math.min(Math.max(0, from), total - 1);
  const before = Array.from({ length: start }, (_, i) => start - 1 - i);
  const after = Array.from({ length: total - start - 1 }, (_, i) => start + 1 + i);
  return [...before, start, ...after].slice(0, 40);
}

/* REVISING IT (Isaac, 20 October 2026: "She should also be able to revise
   3d renderings if you are not happy, similar to how we have done it in
   chat"). The same read, handed what she read before and what the
   installer says is wrong; she gives the whole of it back corrected,
   changing only what they said and what follows from it, and says what
   she changed. */
export type RoofRevision = { current: RoofReading; words: string };

const reviseText = (current: unknown, words: string) => `

What was read before, in the same terms and the plan images' pixels:
${JSON.stringify(current)}

The installer looked at it in 3D and says: "${words.replace(/"/g, "'")}"

Give back the whole reading corrected: change what they said, and what follows from it, and keep the rest as it was. If what they say can't be right by the drawings, keep what the drawings show and say why. A height they give counts as written: its source is them, with the figure ("the installer: 2700"). In said, tell them in a sentence or two what you changed.`;

/** Reads the roof and the heights: the whole set as the architect drew it, and each floor's plan to set the roof out on. */
export async function readRoof(
  orgId: string,
  pdfRef: string | null,
  floors: SheetToRead[],
  revise?: RoofRevision,
  /** the set's first floor plan page (reading.ts `firstPlanPage`) */
  pdfFrom = 0,
): Promise<RoofReading & { said: string }> {
  if (!floors.length) throw new Error("There is no floor plan to set the roof out on");
  const plans = await Promise.all(floors.map(async (f) => ({ f, p: await prepare(orgId, f) })));
  const blocks: Block[] = [];
  if (pdfRef) {
    const images = plans.reduce((t, { p }) => t + base64(p.image.byteLength), 0);
    /* sent from its first floor plan on, forty pages at most: the plans lead, so what goes is the end, details and schedules */
    const pdf = await fitted(await fetchOwn(orgId, pdfRef), REQUEST_MAX - images, (total) => pagesToSend(total, pdfFrom, 40), 4, "The drawing set is too large to read the roof from");
    blocks.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: pdf.toString("base64") } });
  }
  for (const { p } of plans) blocks.push(pngBlock(p.image));
  /* each floor by a name of its own: two floors can share one ("Ground Floor" twice) */
  const seen = new Map<string, number>();
  const names = floors.map((f) => {
    const base = f.floorName.trim() || "Floor";
    const k = (seen.get(base) ?? 0) + 1;
    seen.set(base, k);
    return k > 1 ? `${base} (${k})` : base;
  });
  const at = plans.map(({ f, p }, i) => ({ floorId: f.floorId, floor: names[i], sheetId: f.sheetId, k: p.k, left: p.left, top: p.top }));
  const schema = roofSchema(names);
  const prompt = roofPrompt(plans.map(({ f, p }, i) => ({ floor: names[i], w: p.ow, h: p.oh, mm: f.mmPerPx ? f.mmPerPx / p.k : null })));
  const raw = revise
    ? await askWith(
        blocks,
        prompt + reviseText(fromRoof(revise.current, at), revise.words.slice(0, 2000)),
        { ...schema, required: [...(schema.required as string[]), "said"], properties: { ...(schema.properties as Json), said: str() } },
        32000,
      )
    : await askWith(blocks, prompt, schema, 32000);
  return { ...toRoof(raw, at), said: s(raw.said) };
}

/* ── the site round the house, off the site plan ── */

const SURFACES = ["driveway", "path", "paving", "deck", "lawn", "garden", "pool"] as const;

export const siteSchema = (): Json =>
  S({
    has_site_plan: bool(),
    boundary: OUTLINE("the property boundary, on the ground floor plan image; it may run past the image's edges"),
    surfaces: arr(S({ kind: en(SURFACES), outline: OUTLINE("on the ground floor plan image"), finish: str("as written: 'exposed aggregate', 'pavers', 'turf'") })),
    street: arr(S({ name: str(), kerb: str('the kerb line nearest the house, two points "x,y x,y" on the ground floor plan image'), width_mm: num("kerb to kerb as the set writes or dimensions it; 0 when it doesn't") }), "the street or streets the lot fronts, usually one"),
    neighbours: arr(
      S({
        outline: OUTLINE("the neighbouring building's footprint on the ground floor plan image"),
        storeys: num("as the set says; 0 when it doesn't"),
        attached: bool(),
        note: str("what the set says of it: 'No. 8, two storey brick', 'adjoining semi'"),
      }),
    ),
    fences: arr(S({ line: str('points "x,y x,y ..." on the ground floor plan image'), height_mm: num("as written; 0 when not") })),
  });

export const sitePrompt = (plan: { w: number; h: number; mm: number | null }) =>
  `The PDF is a building's drawing set. After it comes the ground floor plan image (${plan.w}×${plan.h} pixels${plan.mm ? `, one pixel about ${plan.mm.toFixed(1)} mm` : ""}), origin top-left, x right and y down.

You are reading the site round the house for a 3D view an air conditioning installer shows the owner. Use the site plan (and the floor plan where it shows the yard), and set everything out on the ground floor plan image, in its pixels, lined up with the house as drawn there. Points may run past the image's edges when the site is bigger than the image.

1. has_site_plan: whether the set has a site plan, or a floor plan that shows the yard.
2. boundary: the property boundary.
3. surfaces: every driveway, path, paved area, deck, lawn, garden bed and pool drawn, with what it is made of as written.
4. street: the street the lot fronts: its kerb line nearest the house, its name, and its width kerb to kerb where the set gives it.
5. neighbours: every neighbouring building drawn or outlined, with its storeys where the set says them, and attached when it shares a wall with this house (semi-detached, terrace) or with the boundary on this side. Say what the set notes of it.
6. fences: the fences drawn along the boundary, with their height where it is written.

Only what the set shows: an empty list where it shows nothing, 0 for a figure it doesn't give, and has_site_plan false when there is no site plan at all.`;

/** Her answer, back in the ground floor sheet's pixels. A figure the set
    doesn't give, or one no street, building or fence can be, is 0: a kerb
    with no road width, a neighbour of storeys not said, a fence of no
    height written. */
export function toSite(raw: Raw, at: { floorId: string; sheetId: string; k: number; left: number; top: number }): SiteReading | null {
  if (raw.has_site_plan === false) return null;
  const P = (p: ReadPoint) => ({ x: Math.round(p.x / at.k + at.left), y: Math.round(p.y / at.k + at.top) });
  const line = (t: unknown) => parseOutline(s(t)).map(P);
  const within = (v: number, lo: number, hi: number) => (v >= lo && v <= hi ? v : 0);
  const kerb = asArr(raw.street).map((r) => ({ name: s(r.name), kerb: line(r.kerb), widthMm: within(n(r.width_mm), 3000, 30000) })).find((r) => r.kerb.length >= 2);
  return {
    floorId: at.floorId,
    sheetId: at.sheetId,
    boundary: line(raw.boundary),
    surfaces: asArr(raw.surfaces)
      .map((r) => ({ kind: ((SURFACES as readonly string[]).includes(s(r.kind)) ? s(r.kind) : "paving") as ReadSurface["kind"], outline: line(r.outline), finish: s(r.finish) }))
      .filter((r) => r.outline.length >= 3),
    street: kerb ?? null,
    neighbours: asArr(raw.neighbours)
      .map((r) => ({ outline: line(r.outline), storeys: within(Math.round(n(r.storeys)), 1, 40), attached: r.attached === true, note: s(r.note) }))
      .filter((r) => r.outline.length >= 3),
    fences: asArr(raw.fences)
      .map((r) => ({ line: line(r.line), heightMm: within(n(r.height_mm), 600, 3000) }))
      .filter((r) => r.line.length >= 2),
  };
}

/** Reads the site round the house: the whole set, and the ground floor's
    plan to set it out on. Null only when there is no set, or it has no site
    plan; a set too large to send, or a read that fails, throws, so the site
    is read again next time rather than kept as none. */
export async function readSite(orgId: string, pdfRef: string | null, ground: SheetToRead, pdfFrom = 0): Promise<SiteReading | null> {
  if (!pdfRef) return null;
  const p = await prepare(orgId, ground);
  const pdf = await fitted(await fetchOwn(orgId, pdfRef), REQUEST_MAX - base64(p.image.byteLength), (total) => sitePages(total, pdfFrom), 1, "The drawing set is too large to read the site from");
  const blocks: Block[] = [{ type: "document", source: { type: "base64", media_type: "application/pdf", data: pdf.toString("base64") } }, pngBlock(p.image)];
  const raw = await askWith(blocks, sitePrompt({ w: p.ow, h: p.oh, mm: ground.mmPerPx ? ground.mmPerPx / p.k : null }), siteSchema(), 16000);
  return toSite(raw, { floorId: ground.floorId, sheetId: ground.sheetId, k: p.k, left: p.left, top: p.top });
}

export const READING_MODEL = MODEL;
