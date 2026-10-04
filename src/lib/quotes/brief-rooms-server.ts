import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { latestInstalledPack, loadInstalledPack } from "@/lib/studio/packs/server";
import type { BuildingType } from "@/lib/studio/loads";
import { sizeVrf, type VrfMethod, type VrfProposal } from "./brief-vrf";
import { checkDucted, ductedAirWords, sizeDucted, type DuctedPair, type DuctedRead } from "./brief-ducted";
import { checkRooms, isZone, sizeMulti, sizeRoom, type MultiProposal, type ReadBrief, type ReadRoom, type SizedRoom } from "./brief-rooms";
import { MODEL, readProposalJob, readStoredProposal } from "./proposal-writer";

/* The rooms in a job's brief, read by Tiff and sized from the shared data
   pack (brief-rooms.ts says how, and what's checked). The brief is the
   job's own words and its quote's brief, as the labour reads it. Service
   role; the route gates. */

const FALLBACK_MODEL = "claude-opus-4-8";
const PACK_BRAND = "mitsubishi-electric";

const SYSTEM_PROMPT = `You read an air-conditioning job's brief and site address for the rooms it gives a size for.

For each room the brief gives an area or two side lengths for, return:
- name: the room as the brief names it ("Living", "Bed 2"); "Room" if it doesn't name one.
- said: the brief's own words you read it from, copied exactly, character for character, as short as still holds the size (one clause).
- area_m2: the area when the brief states one; null when it gives sides instead.
- sides_m: the two side lengths in metres when the brief gives sides ("6 x 5", "6m by 5m"); an empty list otherwise.
- outdoor_at and outdoor_said: where this room's outdoor unit sits — ground (a slab, a pad, a balcony floor, the ground), wall (on brackets), or roof — and the brief's own words, copied exactly. "unknown" and "" when it doesn't say.
- drain and drain_said: "gravity" when the brief says it drains by gravity or to a point it can fall to, "pump" when it says it needs a pump or can't fall; with the words. "unknown" and "" when it doesn't say.
- new_circuit and circuit_said: "yes" when the brief says a new circuit or power from the switchboard is needed, "no" when it says existing power is used; with the words. "unknown" and "" when it doesn't say.
- run_m and run_said: the pipe run from indoor to outdoor in metres, and the brief's own words it's in, copied exactly; only when the brief states the run. null and "" otherwise.
- ceiling_m: only when the brief says it; null otherwise.
- glazing (low/moderate/high), insulation (well_insulated/standard/poor), facing (N, NE, E, SE, S, SW, W, NW: the main outside wall), room_above ("yes" when another floor is above, "no" when it's under the roof), style (wall, ducted, cassette, floor, bulkhead, under-ceiling): only when the brief says it; "unknown" otherwise.

A room the brief gives no size for is left out. Never estimate a size, never convert a room count or a unit's capacity into an area, never fill a field the brief doesn't state.

building_type: residential for a home, light_commercial for an office or shop, commercial for anything bigger; "unknown" if you can't tell.

zone: the Australian NCC climate zone (1 to 8) of the site address, and the town you placed it by; zone 0 and town "" when there's no address or you can't place it.

vrf_system: "yes" when the brief names a VRF, VRV, PUMY or City Multi system for the rooms, "no" when it names another kind, "unknown" otherwise.
vrf_heads: "box" when the brief puts the heads on a branch box, "joint" when it names City Multi heads or refnet joints, "unknown" otherwise.

replacing and replacing_said: "yes" when the brief says an old system comes out (a swap, a replacement), "no" when it says it's a new install; with its words. "unknown" and "" when it doesn't say.
keep_pipe and keep_pipe_said: "yes" when the brief says the existing pipework is kept or reused, "no" when it says new pipe; with its words. "unknown" and "" when it doesn't say.

ducted_system: "yes" when the brief describes one ducted system serving the rooms, "no" when it doesn't, "unknown" if you can't tell.`;

/* Every "not said" is a value, not a null: the API takes at most 16 fields
   that may be one of two types, and three numbers are the only nullable
   ones left. */
const known = (values: readonly string[]) => ({ type: "string", enum: [...values, "unknown"] });

const schema = {
  type: "object",
  additionalProperties: false,
  required: ["rooms", "building_type", "zone", "ducted_system", "vrf_system", "vrf_heads", "replacing", "replacing_said", "keep_pipe", "keep_pipe_said"],
  properties: {
    rooms: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "said", "area_m2", "sides_m", "run_m", "run_said", "outdoor_at", "outdoor_said", "drain", "drain_said", "new_circuit", "circuit_said", "ceiling_m", "glazing", "insulation", "facing", "room_above", "style"],
        properties: {
          name: { type: "string" },
          said: { type: "string" },
          area_m2: { type: ["number", "null"] },
          sides_m: { type: "array", items: { type: "number" } },
          run_m: { type: ["number", "null"] },
          run_said: { type: "string" },
          outdoor_at: known(["ground", "wall", "roof"]),
          outdoor_said: { type: "string" },
          drain: known(["gravity", "pump"]),
          drain_said: { type: "string" },
          new_circuit: known(["yes", "no"]),
          circuit_said: { type: "string" },
          ceiling_m: { type: ["number", "null"] },
          glazing: known(["low", "moderate", "high"]),
          insulation: known(["well_insulated", "standard", "poor"]),
          facing: known(["N", "NE", "E", "SE", "S", "SW", "W", "NW"]),
          room_above: known(["yes", "no"]),
          style: known(["wall", "ducted", "cassette", "floor", "bulkhead", "under-ceiling"]),
        },
      },
    },
    building_type: known(["residential", "light_commercial", "commercial"]),
    zone: { type: "object", additionalProperties: false, required: ["zone", "town"], properties: { zone: { type: "integer" }, town: { type: "string" } } },
    ducted_system: known(["yes", "no"]),
    vrf_system: known(["yes", "no"]),
    vrf_heads: known(["box", "joint"]),
    replacing: known(["yes", "no"]),
    replacing_said: { type: "string" },
    keep_pipe: known(["yes", "no"]),
    keep_pipe_said: { type: "string" },
  },
};

/* THE DUCTED SYSTEM — its own read, made only when the room read says the
   brief describes one: one schema holding both is past what the API will
   compile ("the compiled grammar is too large"). */
const DUCTED_PROMPT = `You read an air-conditioning job's brief for its ducted system, as written.

is_ducted: "yes" when the brief describes one ducted system for the rooms; otherwise "no" and everything else empty.

Every "said" is the brief's own words, copied exactly. Sizes are in mm: a size in inches converts (6→150, 8→200, 10→250, 12→300, 14→350, 16→400, 18→450), and metres become mm (3m → 3000). 0, "" or "unknown" for anything the brief doesn't state; never a size, a count or a layout of your own.
- unit_at: where the indoor goes (roof, underfloor, bulkhead), with unit_said.
- run_m/run_said, outdoor_at/outdoor_said, drain/drain_said, new_circuit/circuit_said: as for a room, for the system.
- outlets: one entry per kind of outlet the brief lists: room (the room it serves, or "" when it's a count for the house), count, type (mdo, round, square, bar, slot, diffuser), neck_mm for a diffuser and neck_said (the words that give that size, copied exactly; "" when none), length_mm and height_mm for a bar or slot grille, flangeless, said.
  A supply size for every room ("each room will have a 10 inch supply") is the size of the outlets the brief lists, not more outlets: put it as neck_mm on each listed diffuser (not on a bar or slot grille), keeping each outlet's own said, with the words that give the size as its neck_said. Only when the brief lists no outlets does it make one outlet per room, of type unknown, with that size.
- outlets_unsure: when the brief isn't sure of the outlet count ("maybe 4 or 5 grilles"), the two counts and the words; 0, 0 and "" otherwise.
- returns: each return: room ("" for a common return), common, neck_mm or width_mm and height_mm, said. "Each room will have a 10 inch return" is one return per room the brief names.
- layout: the ductwork exactly as the brief writes it, piece by piece: a plenum (outs_mm: its spigots), a trunk (in_mm: its size, count), a fitting (in_mm one size in, outs_mm the sizes out: "split to 14/10/10/10" is in 350, outs 350, 250, 250, 250). Empty when the brief doesn't describe the ductwork.
- zoning: when the brief mentions zoning: zones (how many), control (temperature or on_off), controller (as named), sensors (room and wireless), common_zone (the room, or ""), wifi, said. said "" when there's no zoning.`;

const ductedSchema = {
  type: "object",
  additionalProperties: false,
  required: ["is_ducted", "unit_at", "unit_said", "run_m", "run_said", "outdoor_at", "outdoor_said", "drain", "drain_said", "new_circuit", "circuit_said", "outlets", "outlets_unsure", "returns", "layout", "zoning"],
  properties: {
    is_ducted: known(["yes", "no"]),
    unit_at: known(["roof", "underfloor", "bulkhead"]),
    unit_said: { type: "string" },
    run_m: { type: "number" },
    run_said: { type: "string" },
    outdoor_at: known(["ground", "wall", "roof"]),
    outdoor_said: { type: "string" },
    drain: known(["gravity", "pump"]),
    drain_said: { type: "string" },
    new_circuit: known(["yes", "no"]),
    circuit_said: { type: "string" },
    outlets: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["room", "count", "type", "neck_mm", "neck_said", "length_mm", "height_mm", "flangeless", "said"],
        properties: {
          room: { type: "string" },
          count: { type: "integer" },
          type: known(["mdo", "round", "square", "bar", "slot", "diffuser"]),
          neck_mm: { type: "integer" },
          neck_said: { type: "string" },
          length_mm: { type: "integer" },
          height_mm: { type: "integer" },
          flangeless: known(["yes", "no"]),
          said: { type: "string" },
        },
      },
    },
    outlets_unsure: {
      type: "object",
      additionalProperties: false,
      required: ["min", "max", "said"],
      properties: { min: { type: "integer" }, max: { type: "integer" }, said: { type: "string" } },
    },
    returns: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["room", "common", "neck_mm", "width_mm", "height_mm", "said"],
        properties: {
          room: { type: "string" },
          common: known(["yes", "no"]),
          neck_mm: { type: "integer" },
          width_mm: { type: "integer" },
          height_mm: { type: "integer" },
          said: { type: "string" },
        },
      },
    },
    layout: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["piece", "in_mm", "outs_mm", "count", "said"],
        properties: {
          piece: { type: "string", enum: ["plenum", "trunk", "fitting"] },
          in_mm: { type: "integer" },
          outs_mm: { type: "array", items: { type: "integer" } },
          count: { type: "integer" },
          said: { type: "string" },
        },
      },
    },
    zoning: {
      type: "object",
      additionalProperties: false,
      required: ["said", "zones", "control", "controller", "sensors", "common_zone", "wifi"],
      properties: {
        said: { type: "string" },
        zones: { type: "integer" },
        control: known(["temperature", "on_off"]),
        controller: { type: "string" },
        sensors: {
          type: "array",
          items: { type: "object", additionalProperties: false, required: ["room", "wireless"], properties: { room: { type: "string" }, wireless: known(["yes", "no"]) } },
        },
        common_zone: { type: "string" },
        wifi: known(["yes", "no"]),
      },
    },
  },
};

type Raw = {
  rooms: {
    name: string;
    said: string;
    area_m2: number | null;
    sides_m: number[];
    run_m: number | null;
    run_said: string;
    outdoor_at: string;
    outdoor_said: string;
    drain: string;
    drain_said: string;
    new_circuit: string;
    circuit_said: string;
    ceiling_m: number | null;
    glazing: string;
    insulation: string;
    facing: string;
    room_above: string;
    style: string;
  }[];
  building_type: string;
  zone: { zone: number; town: string };
  ducted_system?: string;
  vrf_system?: string;
  vrf_heads?: string;
  replacing?: string;
  replacing_said?: string;
  keep_pipe?: string;
  keep_pipe_said?: string;
};

type RawDucted = {
  is_ducted: string;
  unit_at: string;
  unit_said: string;
  run_m: number;
  run_said: string;
  outdoor_at: string;
  outdoor_said: string;
  drain: string;
  drain_said: string;
  new_circuit: string;
  circuit_said: string;
  outlets: { room: string; count: number; type: string; neck_mm: number; neck_said: string; length_mm: number; height_mm: number; flangeless: string; said: string }[];
  outlets_unsure: { min: number; max: number; said: string };
  returns: { room: string; common: string; neck_mm: number; width_mm: number; height_mm: number; said: string }[];
  layout: { piece: string; in_mm: number; outs_mm: number[]; count: number; said: string }[];
  zoning: { said: string; zones: number; control: string; controller: string; sensors: { room: string; wireless: string }[]; common_zone: string; wifi: string };
};

const pos = (n: unknown) => (typeof n === "number" && Number.isFinite(n) && n > 0 ? n : null);
const text = (v: unknown, max = 300) => (typeof v === "string" ? v.slice(0, max) : "");

/** The ducted system as Tiff read it, unchecked; null when it isn't one. */
function ductedOf(d: RawDucted | undefined): DuctedRead | null {
  if (!d || d.is_ducted !== "yes") return null;
  const zoning = d.zoning && words(d.zoning.said)
    ? {
        zones: pos(d.zoning.zones),
        control: oneOf(d.zoning.control, ["temperature", "on_off"] as const),
        controller: words(d.zoning.controller),
        sensors: (d.zoning.sensors ?? []).slice(0, 20).map((s) => ({ room: text(s.room, 60), wireless: s.wireless === "yes" })),
        commonZone: words(d.zoning.common_zone),
        wifi: yesNo(d.zoning.wifi),
        said: text(d.zoning.said),
      }
    : null;
  return {
    ducted: true,
    unitAt: oneOf(d.unit_at, ["roof", "underfloor", "bulkhead"] as const),
    unitSaid: words(d.unit_said),
    outlets: (d.outlets ?? []).slice(0, 30).map((o) => ({
      room: text(o.room, 60),
      count: Math.max(0, Math.round(pos(o.count) ?? 0)),
      type: oneOf(o.type, ["mdo", "round", "square", "bar", "slot", "diffuser"] as const),
      neckMm: pos(o.neck_mm),
      neckSaid: words(o.neck_said),
      lengthMm: pos(o.length_mm),
      heightMm: pos(o.height_mm),
      flangeless: o.flangeless === "yes",
      said: text(o.said),
    })),
    outletsUnsure: d.outlets_unsure && words(d.outlets_unsure.said) && pos(d.outlets_unsure.min) && pos(d.outlets_unsure.max)
      ? { min: d.outlets_unsure.min, max: d.outlets_unsure.max, said: text(d.outlets_unsure.said) }
      : null,
    returns: (d.returns ?? []).slice(0, 30).map((r) => ({
      room: text(r.room, 60),
      common: r.common === "yes",
      neckMm: pos(r.neck_mm),
      widthMm: pos(r.width_mm),
      heightMm: pos(r.height_mm),
      said: text(r.said),
    })),
    layout: (d.layout ?? []).slice(0, 30).flatMap((p) => {
      const piece = oneOf(p.piece, ["plenum", "trunk", "fitting"] as const);
      return piece
        ? [{ piece, inMm: pos(p.in_mm), outsMm: (p.outs_mm ?? []).filter((m) => pos(m) != null).slice(0, 12), count: Math.max(1, Math.round(pos(p.count) ?? 1)), said: text(p.said) }]
        : [];
    }),
    zoning,
    /* the system's own facts ride on the read for the kit */
    run: { m: pos(d.run_m), said: words(d.run_said) },
    outdoor: { at: oneOf(d.outdoor_at, ["ground", "wall", "roof"] as const), said: words(d.outdoor_said) },
    drain: { how: oneOf(d.drain, ["gravity", "pump"] as const), said: words(d.drain_said) },
    circuit: { needed: yesNo(d.new_circuit), said: words(d.circuit_said) },
  };
}

/** a value Tiff gave, when it's one of these; "unknown" and anything else are null */
const oneOf = <T extends string>(v: unknown, values: readonly T[]): T | null => (values.includes(v as T) ? (v as T) : null);
const words = (v: unknown) => (typeof v === "string" && v.trim() ? v.slice(0, 300) : null);
const yesNo = (v: unknown) => (v === "yes" ? true : v === "no" ? false : null);

const readOf = (raw: Raw): ReadBrief => ({
  rooms: (raw.rooms ?? []).slice(0, 20).map((r) => ({
    name: String(r.name ?? "Room").slice(0, 60) || "Room",
    said: String(r.said ?? "").slice(0, 300),
    areaM2: typeof r.area_m2 === "number" ? r.area_m2 : null,
    sidesM: Array.isArray(r.sides_m) && r.sides_m.length === 2 ? [r.sides_m[0]!, r.sides_m[1]!] : null,
    ceilingM: typeof r.ceiling_m === "number" && r.ceiling_m >= 2 && r.ceiling_m <= 8 ? r.ceiling_m : null,
    glazing: oneOf(r.glazing, ["low", "moderate", "high"] as const),
    insulation: oneOf(r.insulation, ["well_insulated", "standard", "poor"] as const),
    facing: oneOf(r.facing, ["N", "NE", "E", "SE", "S", "SW", "W", "NW"] as const),
    roomAbove: yesNo(r.room_above),
    style: oneOf(r.style, ["wall", "ducted", "cassette", "floor", "bulkhead", "under-ceiling"] as const),
    runM: typeof r.run_m === "number" ? r.run_m : null,
    runSaid: words(r.run_said),
    outdoorAt: oneOf(r.outdoor_at, ["ground", "wall", "roof"] as const),
    outdoorSaid: words(r.outdoor_said),
    drain: oneOf(r.drain, ["gravity", "pump"] as const),
    drainSaid: words(r.drain_said),
    newCircuit: yesNo(r.new_circuit),
    circuitSaid: words(r.circuit_said),
  })),
  buildingType: oneOf(raw.building_type, ["residential", "light_commercial", "commercial"] as const),
  /* filled by the second read, when the first says it's ducted */
  ducted: null,
  vrf: raw.vrf_system === "yes",
  vrfHeads: oneOf(raw.vrf_heads, ["box", "joint"] as const),
  swap: { replacing: yesNo(raw.replacing), replacingSaid: words(raw.replacing_said), keepPipe: yesNo(raw.keep_pipe), keepPipeSaid: words(raw.keep_pipe_said) },
  zone: raw.zone && isZone(raw.zone.zone) ? { zone: raw.zone.zone, town: String(raw.zone.town ?? "").slice(0, 60) } : null,
});

export type BriefRooms = {
  /** the rooms as read and checked, for a re-size without another read */
  read: ReadRoom[];
  rooms: SizedRoom[];
  /** rooms Tiff named whose size isn't in the brief's words: not used */
  dropped: string[];
  buildingType: BuildingType;
  buildingSaid: boolean;
  zone: { zone: number; from: "address" | "chosen"; town: string | null } | null;
  /** the same rooms on one multi, when there are two or more */
  multi: MultiProposal | null;
  /** the rooms on a VRF or PUMY, both ways their heads can connect, when the
      brief names one or no multi takes them; `vrfHeads` is the way the brief
      says, when it does */
  vrf: { box: VrfProposal | null; joint: VrfProposal | null } | null;
  vrfHeads: VrfMethod | null;
  /** the brief names a VRF, for a re-size */
  vrfSaid: boolean;
  /** a swap as the brief says it (each true only on its words) */
  swap: { replacing: boolean; keepPipe: boolean };
  /** one ducted system for the rooms, when the brief describes one */
  ducted: {
    read: DuctedRead;
    /** what Tiff read whose words aren't the brief's: not used */
    dropped: string[];
    loadKw: number;
    options: DuctedPair[];
    /** the pack's air check for the first option */
    air: string[];
  } | null;
};

export type BriefRoomsResult = { ok: true; rooms: BriefRooms } | { ok: false; reason: string };

/** Size rooms already read, at a zone: no call to Tiff. */
export async function sizeRooms(
  read: ReadRoom[],
  buildingType: BuildingType,
  buildingSaid: boolean,
  zone: BriefRooms["zone"],
  dropped: string[] = [],
  ducted: { read: DuctedRead; dropped: string[] } | null = null,
  swap: BriefRooms["swap"] = { replacing: false, keepPipe: false },
  vrfSaid = false,
  vrfHeads: VrfMethod | null = null
): Promise<BriefRooms> {
  const ref = await latestInstalledPack(PACK_BRAND);
  const pack = ref ? (await loadInstalledPack(ref.brand, ref.version)).pack : null;
  const sized = zone && pack ? read.filter((r): r is ReadRoom & { areaM2: number } => r.areaM2 != null).map((r) => sizeRoom(r, zone.zone, buildingType, pack)) : [];
  const multi = pack && !ducted && !vrfSaid ? sizeMulti(sized, pack) : null;
  /* a ducted brief is one system for the rooms: its pair covers them together */
  const system = ducted && pack && sized.length > 0 ? sizeDucted(sized, pack) : null;
  return {
    read,
    rooms: sized,
    dropped,
    buildingType,
    buildingSaid,
    zone,
    swap,
    multi,
    vrf: pack && !ducted && sized.length >= 2 && (vrfSaid || (multi != null && !multi.ok)) ? { box: sizeVrf(sized, pack, "box"), joint: sizeVrf(sized, pack, "joint") } : null,
    vrfSaid,
    vrfHeads,
    ducted:
      ducted && system
        ? { read: ducted.read, dropped: ducted.dropped, loadKw: system.loadKw, options: system.options, air: system.options[0] ? ductedAirWords(system.options[0], ducted.read) : [] }
        : null,
  };
}

/** One read of a brief by Tiff: the rooms as Tiff says them, unchecked. */
export async function runRoomRead(
  brief: string,
  address: string | null,
  client: Anthropic = new Anthropic()
): Promise<{ ok: true; read: ReadBrief } | { ok: false; reason: string }> {
  try {
    const response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 8000,
      betas: ["server-side-fallback-2026-06-01"],
      fallbacks: [{ model: FALLBACK_MODEL }],
      output_config: { effort: "low", format: { type: "json_schema", schema } },
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: `Site address: ${address ?? "not given"}\n\nThe brief:\n${brief}` }],
    });
    if (response.stop_reason === "refusal") return { ok: false, reason: "Tiff declined to read this brief." };
    const block = [...response.content].reverse().find((b) => b.type === "text");
    if (!block || block.type !== "text") return { ok: false, reason: "Tiff returned nothing. Try again." };
    const raw = JSON.parse(block.text) as Raw;
    const read = readOf(raw);
    if (raw.ducted_system === "yes") read.ducted = await runDuctedRead(brief, client);
    return { ok: true, read };
  } catch (err) {
    console.error("[quotes] the brief couldn't be read:", err instanceof Error ? err.message : err);
    if (err instanceof Anthropic.RateLimitError) return { ok: false, reason: "Tiff is busy. Try again in a minute." };
    return { ok: false, reason: "The brief couldn't be read. Try again." };
  }
}

/** The second read: the ducted system as the brief writes it, unchecked.
    Throws on an API failure, for the first read's catch to say. */
async function runDuctedRead(brief: string, client: Anthropic): Promise<DuctedRead | null> {
  const response = await client.beta.messages.create({
    model: MODEL,
    max_tokens: 8000,
    betas: ["server-side-fallback-2026-06-01"],
    fallbacks: [{ model: FALLBACK_MODEL }],
    output_config: { effort: "low", format: { type: "json_schema", schema: ductedSchema } },
    system: DUCTED_PROMPT,
    messages: [{ role: "user", content: `The brief:\n${brief}` }],
  });
  if (response.stop_reason === "refusal") return null;
  const block = [...response.content].reverse().find((b) => b.type === "text");
  return block && block.type === "text" ? ductedOf(JSON.parse(block.text) as RawDucted) : null;
}

/** `job`: the card's id, as the job card names it. */
export async function readBriefRooms(orgId: string, job: string, client: Anthropic = new Anthropic()): Promise<BriefRoomsResult> {
  const card = await readProposalJob(orgId, job);
  if (!card) return { ok: false, reason: "That job isn't in HeyTiff's copy of ServiceM8." };
  const proposal = await readStoredProposal(orgId, card.cardId).catch(() => null);
  const brief = [card.scope, proposal?.brief].filter((t): t is string => !!t?.trim()).join("\n");
  if (!brief.trim()) return { ok: false, reason: "The job has no brief to read rooms from." };

  const got = await runRoomRead(brief, card.address ?? null, client);
  if (!got.ok) return got;
  const read = got.read;
  const { rooms, dropped } = checkRooms(read, brief);
  const zone = read.zone ? { zone: read.zone.zone, from: "address" as const, town: read.zone.town || null } : null;
  const ducted = read.ducted ? checkDucted(read.ducted, brief) : null;
  /* a swap counts only on the brief's own words */
  const said = (w: string | null) => !!w && w.trim().length >= 3 && brief.toLowerCase().replace(/\s+/g, " ").includes(w.toLowerCase().replace(/\s+/g, " ").trim());
  const swap = { replacing: read.swap.replacing === true && said(read.swap.replacingSaid), keepPipe: read.swap.keepPipe === true && said(read.swap.keepPipeSaid) };
  return { ok: true, rooms: await sizeRooms(rooms, read.buildingType ?? "residential", read.buildingType != null, zone, dropped, ducted, swap, read.vrf, read.vrfHeads) };
}
