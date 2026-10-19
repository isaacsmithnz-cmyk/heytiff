import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import sharp from "sharp";
import { supabaseAdmin } from "@/lib/supabase-server";
import {
  CHECKLIST,
  type ReadCheck,
  type ReadFurniture,
  type ReadMark,
  type ReadOpening,
  type ReadPoint,
  type ReadSpace,
  type SheetReading,
  type SpaceKind,
} from "./reading";

/* TIFF READS A FLOOR PLAN (v2, 20 October). The bench's checklist read
   (Opus 5.5, scored on Isaac's five floors and the 44 Frogmore St set,
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
      width_mm: num("written, else scaled; 0 if the scale isn't known"),
      room: str("the room it belongs to"),
      external: bool(),
      facing: str('N, E, S, W... for an external opening, else ""'),
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

export const floorPrompt = (floor: string, w: number, h: number, mmPerPx: number | null) =>
  `This is the ${floor} plan of a building, ${w}×${h} pixels (origin top-left, x right, y down).${
    mmPerPx ? ` One pixel is about ${mmPerPx.toFixed(1)} mm.` : ""
  } You are reading it for an air conditioning installer who has to design and quote the job.

Read it against this checklist. For every item, say what you found, or say that you looked and found none and where you looked. Never leave an item out.
1. rooms: every enclosed room, plus every outdoor space attached to the building (balcony, verandah, patio, deck). Include the small ones: robes, linen, broom and pantry cupboards, WC/powder rooms, stores, fridge recesses, under-stair stores. A space with its own walls is its own entry, even unnamed, and a WC or powder room inside a bathroom's walls is its own entry. Open-plan spaces with no wall between their parts are one room. Polygon on the INSIDE face of the walls. Note anything marked existing to remain.
2. stairs: every stair, its outline, risers and treads if they are numbered, and the rooms at its top and bottom.
3. voids and notches: double-height voids, stair voids, light wells, shafts, and any area inside the building with no floor on this level: "Roof Over", "Void", "Open to below", a notch over a lower roof. Say what it opens to.
4. doors, 5. windows, 6. skylights: every one, as a segment along its wall from jamb to jamb (a skylight: the long side of its outline), with its tag if written, its width (written, else scaled), its room, whether it is external, and which way an external one faces. A door with no tag is still a door; a skylight shown only as a note or a dashed outline is still a skylight.
7. joinery: built-ins (kitchen benches, island, robes, vanities, laundry bench, TV/fire joinery, linen and pantry shelving, bench seats), with a 4-corner footprint. Not loose furniture.
8. bulkheads: any bulkhead, dropped ceiling, or a note such as "Joinery/Bulkhead?".
9. ceiling fans: every fan symbol.
10. A/C notes: anything written about air conditioning ("A/C Over", unit or duct locations, grilles).
11. roof space: any note about roof space, "Roof Over", "Ridge Over", or what is above the ceiling.
A size written on a table, a bed or a fitting is not the room's size: only give a room the dimensions written for the room itself.
Put rooms, stairs, voids, notches and outdoor spaces in spaces (with their kind); doors, windows and skylights in openings; joinery, bulkheads, fans, A/C notes and roof-space notes in marks. The checklist has one entry per item, and its counts match what you listed.

Ignore the title block, legend, site and landscaping, neighbouring buildings, and section or detail views. Put coordinates on the wall lines, not on the labels.`;

export const FURNITURE_SCHEMA = S({
  furniture: arr(S({ kind: str("bed, sofa, dining table, desk, TV, fridge, washing machine..."), room: str(), polygon: OUTLINE("its footprint, 4 corners") })),
});
export const furniturePrompt = (w: number, h: number) =>
  `This is a floor plan, ${w}×${h} pixels (origin top-left). List the loose furniture and appliances drawn on it: beds, sofas, dining tables and chairs as one table, desks, TVs, fridges, washing machines, dryers. Not built-in joinery (benches, robes, vanities), not walls, doors or windows. For each: what it is, the room it's in, and its footprint as 4 corners in pixels.`;

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

/** Her answer, back in the sheet's own pixels: scaled up by `k` and moved by the crop's corner. */
export function toSheet(raw: Raw, furniture: Raw, sheetId: string, k: number, ox: number, oy: number): SheetReading {
  const P = (p: ReadPoint) => ({ x: Math.round(p.x / k + ox), y: Math.round(p.y / k + oy) });
  const outline = (v: unknown) => parseOutline(s(v)).map(P);
  return {
    sheetId,
    planUp: s(raw.plan_up_faces),
    spaces: asArr(raw.spaces).map(
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
    ),
    openings: asArr(raw.openings).map(
      (o): ReadOpening => ({
        kind: o.kind === "window" || o.kind === "skylight" ? o.kind : "door",
        tag: s(o.tag),
        a: P({ x: n(o.x1), y: n(o.y1) }),
        b: P({ x: n(o.x2), y: n(o.y2) }),
        widthMm: n(o.width_mm),
        room: s(o.room),
        external: o.external === true,
        facing: s(o.facing),
      }),
    ),
    marks: asArr(raw.marks).map((m): ReadMark => ({ item: (s(m.item) || "ac_note") as ReadMark["item"], text: s(m.text), room: s(m.room), outline: outline(m.polygon) })),
    furniture: asArr(furniture.furniture).map((f): ReadFurniture => ({ kind: s(f.kind), room: s(f.room), outline: outline(f.polygon) })),
    checklist: asArr(raw.checklist)
      .filter((c) => (CHECKLIST as readonly string[]).includes(s(c.item)))
      .map((c): ReadCheck => ({ item: s(c.item) as ReadCheck["item"], found: c.status === "found", count: n(c.count), note: s(c.note) })),
    flags: [],
  };
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
};

let client: Anthropic | null = null;

async function ask(image: Buffer, text: string, schema: Json, maxTokens: number): Promise<Raw> {
  client = client ?? new Anthropic();
  let tries = 0;
  for (;;) {
    try {
      const msg = await client.messages
        .stream({
          model: MODEL,
          max_tokens: maxTokens,
          output_config: { effort: "high", format: { type: "json_schema", schema } },
          messages: [{ role: "user", content: [{ type: "image", source: { type: "base64", media_type: "image/png", data: image.toString("base64") } }, { type: "text", text }] }],
        })
        .finalMessage();
      if (msg.stop_reason === "refusal") throw new Error("Tiff declined to read this plan");
      const block = [...msg.content].reverse().find((b) => b.type === "text");
      if (!block || block.type !== "text") throw new Error("Tiff found nothing to read");
      return JSON.parse(block.text) as Raw;
    } catch (e) {
      const retry = e instanceof Anthropic.RateLimitError || e instanceof Anthropic.InternalServerError || e instanceof Anthropic.APIConnectionError;
      tries += 1;
      if (!retry || tries >= 3) throw e;
      await new Promise((r) => setTimeout(r, 15000 * tries));
    }
  }
}

/** Reads one sheet: the checklist read and the furniture read, side by side. */
export async function readSheet(orgId: string, sheet: SheetToRead): Promise<SheetReading> {
  if (!sheet.ref.startsWith(`org/${orgId}/`)) throw new Error("That plan isn't this workspace's");
  const { data, error } = await supabaseAdmin.storage.from(BUCKET).download(sheet.ref);
  if (error || !data) throw new Error("The plan couldn't be fetched");
  const src = Buffer.from(await data.arrayBuffer());
  const meta = await sharp(src).metadata();
  const W = meta.width ?? 0;
  const H = meta.height ?? 0;
  const c = sheet.crop ?? { x: 0, y: 0, w: W, h: H };
  const left = Math.max(0, Math.round(c.x));
  const top = Math.max(0, Math.round(c.y));
  const width = Math.max(1, Math.min(W - left, Math.round(c.w)));
  const height = Math.max(1, Math.min(H - top, Math.round(c.h)));
  const k = Math.min(1, MAX_EDGE / Math.max(width, height), Math.sqrt(MAX_PIXELS / (width * height)));
  const ow = Math.round(width * k);
  const oh = Math.round(height * k);
  const image = await sharp(src).extract({ left, top, width, height }).resize(ow, oh).flatten({ background: "#ffffff" }).png().toBuffer();
  const mm = sheet.mmPerPx ? sheet.mmPerPx / k : null;
  const [floor, furniture] = await Promise.all([
    ask(image, floorPrompt(sheet.floorName, ow, oh, mm), FLOOR_SCHEMA, 48000),
    ask(image, furniturePrompt(ow, oh), FURNITURE_SCHEMA, 16000).catch(() => ({ furniture: [] }) as Raw),
  ]);
  return toSheet(floor, furniture, sheet.sheetId, k, left, top);
}

export const READING_MODEL = MODEL;
