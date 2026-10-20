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
  type ReadLevel,
  type ReadRake,
  type ReadRoofPart,
  type ReadSpace,
  type RoofReading,
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

type Block = Anthropic.Messages.ContentBlockParam;
const pngBlock = (image: Buffer): Block => ({ type: "image", source: { type: "base64", media_type: "image/png", data: image.toString("base64") } });

async function ask(image: Buffer, text: string, schema: Json, maxTokens: number): Promise<Raw> {
  return askWith([pngBlock(image)], text, schema, maxTokens);
}

async function askWith(blocks: Block[], text: string, schema: Json, maxTokens: number): Promise<Raw> {
  client = client ?? new Anthropic();
  let tries = 0;
  for (;;) {
    try {
      const msg = await client.messages
        .stream({
          model: MODEL,
          max_tokens: maxTokens,
          output_config: { effort: "high", format: { type: "json_schema", schema } },
          messages: [{ role: "user", content: [...blocks, { type: "text", text }] }],
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
  const k = Math.min(1, MAX_EDGE / Math.max(width, height), Math.sqrt(MAX_PIXELS / (width * height)));
  const ow = Math.round(width * k);
  const oh = Math.round(height * k);
  const image = await sharp(src).extract({ left, top, width, height }).resize(ow, oh).flatten({ background: "#ffffff" }).png().toBuffer();
  return { image, ow, oh, k, left, top };
}

/** Reads one sheet: the checklist read and the furniture read, side by side. */
export async function readSheet(orgId: string, sheet: SheetToRead): Promise<SheetReading> {
  const { image, ow, oh, k, left, top } = await prepare(orgId, sheet);
  const mm = sheet.mmPerPx ? sheet.mmPerPx / k : null;
  const [floor, furniture] = await Promise.all([
    ask(image, floorPrompt(sheet.floorName, ow, oh, mm), FLOOR_SCHEMA, 48000),
    ask(image, furniturePrompt(ow, oh), FURNITURE_SCHEMA, 16000).catch(() => ({ furniture: [] }) as Raw),
  ]);
  return toSheet(floor, furniture, sheet.sheetId, k, left, top);
}

/* ── the roof and the heights, off the whole set ── */

const FORMS = ["gable", "hip", "skillion", "flat"] as const;

export const roofSchema = (floors: string[]): Json =>
  S({
    levels: arr(
      S({
        floor: en(floors),
        ceiling_mm: num("floor level to the ceiling (to the top of the walls where the ceiling rakes)"),
        floor_zone_mm: num("this floor's ceiling to the floor level above, 0 for the top floor"),
        source: str("where it is written: sheet and label, or 'scaled'"),
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
        pitch_deg: num(),
        eave_mm: num("top of the walls it sits on, above that floor's floor level"),
        overhang_mm: num("eaves overhang past the wall line, 0 where there are none"),
        existing: bool(),
        source: str("the sheets it was read from"),
      }),
    ),
    raked: arr(S({ floor: en(floors), room: str(), low_mm: num(), high_mm: num() })),
    material: str(),
    roof_space: str("what the set shows about the roof space and what could go in it"),
  });

export const roofPrompt = (plans: { floor: string; w: number; h: number; mm: number | null }[]) =>
  `The PDF is a building's drawing set. After it come the floor plan images of ${plans.map((p) => `the ${p.floor} (${p.w}×${p.h} pixels${p.mm ? `, one pixel about ${p.mm.toFixed(1)} mm` : ""})`).join(", ")}, in that order, each with its origin top-left, x right and y down.

You are reading it for an air conditioning installer who needs the building in 3D: its heights, its roof and its roof space. Use the sections and elevations for heights and pitches, the roof plan (or the site plan's roof) for the roof's shape, and the floor plan images to set the roof out.

1. levels: for every floor named, the ceiling height above its floor level, and the floor zone between its ceiling and the next floor level (0 on the top floor). Written heights and RLs win; say where you read it.
2. roof_parts: the roof as rectangular parts. Break an L, T or U roof into rectangles, one per ridge. For each part: which floor's walls carry it, its form (gable: two slopes and gable ends; hip: slopes on all four sides; skillion: one slope; flat), its footprint as the 4 corners of the rectangle it covers AT THE WALL LINE, on THAT floor's plan image, in that image's pixels; which way its ridge runs on that image (across = along x, down = along y; for a skillion, the direction its edges run, not its slope); for a skillion, the side of the image it falls to (left, right, up or down; none for the others); its pitch in degrees; the top of the walls it sits on above that floor's level, in mm; its eaves overhang in mm; and whether it is existing. A verandah or patio roof is its own part. A neighbouring building or an existing garage drawn on the plan only gets a part if the set shows its roof.
3. raked: every room whose ceiling follows the roof, with its low and high ceiling heights above its floor.
4. material, and what the set shows about the roof space: how high it is at the ridge, whether anything is noted for it, and what would fit.

Put coordinates on the wall lines of the plan images, not on labels or dimension strings.`;

/** Her answer, back in each floor's sheet pixels. */
export function toRoof(raw: Raw, plans: { floorId: string; floor: string; sheetId: string; k: number; left: number; top: number }[]): RoofReading {
  const byName = new Map(plans.map((p) => [p.floor, p]));
  const P = (p: ReadPoint, at: (typeof plans)[number]) => ({ x: Math.round(p.x / at.k + at.left), y: Math.round(p.y / at.k + at.top) });
  const parts: ReadRoofPart[] = [];
  for (const r of asArr(raw.roof_parts)) {
    const at = byName.get(s(r.floor));
    const outline = parseOutline(s(r.footprint));
    if (!at || outline.length < 3) continue;
    const form = (FORMS as readonly string[]).includes(s(r.form)) ? (s(r.form) as ReadRoofPart["form"]) : "gable";
    const falls = s(r.falls_to);
    parts.push({
      floorId: at.floorId,
      sheetId: at.sheetId,
      form,
      outline: outline.map((p) => P(p, at)),
      ridge: r.ridge === "down" ? "down" : "across",
      fallsTo: falls === "left" || falls === "right" || falls === "up" || falls === "down" ? falls : "",
      pitchDeg: Math.max(0, Math.min(60, n(r.pitch_deg))),
      eaveMm: Math.max(0, n(r.eave_mm)),
      overhangMm: Math.max(0, Math.min(1500, n(r.overhang_mm))),
      existing: r.existing === true,
      source: s(r.source),
    });
  }
  const levels: ReadLevel[] = [];
  for (const l of asArr(raw.levels)) {
    const at = byName.get(s(l.floor));
    if (at && n(l.ceiling_mm) > 1800) levels.push({ floorId: at.floorId, ceilingMm: n(l.ceiling_mm), floorZoneMm: Math.max(0, n(l.floor_zone_mm)), source: s(l.source) });
  }
  const raked: ReadRake[] = [];
  for (const r of asArr(raw.raked)) {
    const at = byName.get(s(r.floor));
    if (at && s(r.room)) raked.push({ floorId: at.floorId, room: s(r.room), lowMm: n(r.low_mm), highMm: n(r.high_mm) });
  }
  return { levels, parts, raked, material: s(raw.material), roofSpace: s(raw.roof_space) };
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
  };
}

/* A PDF past this is sent without the pages after the first forty, which is
   where a long set's schedules and details sit; past the API's own ceiling
   it can't go at all. */
const PDF_MAX_BYTES = 30 * 1024 * 1024;

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

Give back the whole reading corrected: change what they said, and what follows from it, and keep the rest as it was. If what they say can't be right by the drawings, keep what the drawings show and say why. In said, tell them in a sentence or two what you changed.`;

/** Reads the roof and the heights: the whole set as the architect drew it, and each floor's plan to set the roof out on. */
export async function readRoof(orgId: string, pdfRef: string | null, floors: SheetToRead[], revise?: RoofRevision): Promise<RoofReading & { said: string }> {
  if (!floors.length) throw new Error("There is no floor plan to set the roof out on");
  const plans = await Promise.all(floors.map(async (f) => ({ f, p: await prepare(orgId, f) })));
  const blocks: Block[] = [];
  if (pdfRef) {
    let pdf = await fetchOwn(orgId, pdfRef);
    if (pdf.byteLength > PDF_MAX_BYTES) {
      const { PDFDocument } = await import("pdf-lib");
      const whole = await PDFDocument.load(pdf, { ignoreEncryption: true });
      const cut = await PDFDocument.create();
      const pages = await cut.copyPages(whole, whole.getPageIndices().slice(0, 40));
      for (const pg of pages) cut.addPage(pg);
      pdf = Buffer.from(await cut.save());
      if (pdf.byteLength > PDF_MAX_BYTES) throw new Error("The drawing set is too large to read the roof from");
    }
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

export const READING_MODEL = MODEL;
