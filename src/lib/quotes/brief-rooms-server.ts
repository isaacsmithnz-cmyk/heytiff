import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { latestInstalledPack, loadInstalledPack } from "@/lib/studio/packs/server";
import type { BuildingType } from "@/lib/studio/loads";
import { checkRooms, isZone, sizeRoom, type ReadBrief, type ReadRoom, type SizedRoom } from "./brief-rooms";
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
- sides_m: the two side lengths in metres when the brief gives sides ("6 x 5", "6m by 5m"); null otherwise.
- ceiling_m, glazing (low/moderate/high), insulation (well_insulated/standard/poor), facing (N, NE, E, SE, S, SW, W, NW: the main outside wall), room_above (true when another floor is above, false when it's under the roof), style (wall, ducted, cassette, floor, bulkhead, under-ceiling): only when the brief says it; null otherwise.

A room the brief gives no size for is left out. Never estimate a size, never convert a room count or a unit's capacity into an area, never fill a field the brief doesn't state.

building_type: residential for a home, light_commercial for an office or shop, commercial for anything bigger; null if you can't tell.

zone: the Australian NCC climate zone (1 to 8) of the site address, with the town you placed it by; null when there's no address or you can't place it.`;

const schema = {
  type: "object",
  additionalProperties: false,
  required: ["rooms", "building_type", "zone"],
  properties: {
    rooms: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "said", "area_m2", "sides_m", "ceiling_m", "glazing", "insulation", "facing", "room_above", "style"],
        properties: {
          name: { type: "string" },
          said: { type: "string" },
          area_m2: { type: ["number", "null"] },
          sides_m: { anyOf: [{ type: "array", items: { type: "number" } }, { type: "null" }] },
          ceiling_m: { type: ["number", "null"] },
          glazing: { anyOf: [{ type: "string", enum: ["low", "moderate", "high"] }, { type: "null" }] },
          insulation: { anyOf: [{ type: "string", enum: ["well_insulated", "standard", "poor"] }, { type: "null" }] },
          facing: { anyOf: [{ type: "string", enum: ["N", "NE", "E", "SE", "S", "SW", "W", "NW"] }, { type: "null" }] },
          room_above: { type: ["boolean", "null"] },
          style: { anyOf: [{ type: "string", enum: ["wall", "ducted", "cassette", "floor", "bulkhead", "under-ceiling"] }, { type: "null" }] },
        },
      },
    },
    building_type: { anyOf: [{ type: "string", enum: ["residential", "light_commercial", "commercial"] }, { type: "null" }] },
    zone: {
      anyOf: [
        { type: "object", additionalProperties: false, required: ["zone", "town"], properties: { zone: { type: "integer" }, town: { type: "string" } } },
        { type: "null" },
      ],
    },
  },
} as const;

type Raw = {
  rooms: {
    name: string;
    said: string;
    area_m2: number | null;
    sides_m: number[] | null;
    ceiling_m: number | null;
    glazing: ReadRoom["glazing"];
    insulation: ReadRoom["insulation"];
    facing: ReadRoom["facing"];
    room_above: boolean | null;
    style: ReadRoom["style"];
  }[];
  building_type: BuildingType | null;
  zone: { zone: number; town: string } | null;
};

const readOf = (raw: Raw): ReadBrief => ({
  rooms: (raw.rooms ?? []).slice(0, 20).map((r) => ({
    name: String(r.name ?? "Room").slice(0, 60) || "Room",
    said: String(r.said ?? "").slice(0, 300),
    areaM2: typeof r.area_m2 === "number" ? r.area_m2 : null,
    sidesM: Array.isArray(r.sides_m) && r.sides_m.length === 2 ? [r.sides_m[0]!, r.sides_m[1]!] : null,
    ceilingM: typeof r.ceiling_m === "number" && r.ceiling_m >= 2 && r.ceiling_m <= 8 ? r.ceiling_m : null,
    glazing: r.glazing ?? null,
    insulation: r.insulation ?? null,
    facing: r.facing ?? null,
    roomAbove: typeof r.room_above === "boolean" ? r.room_above : null,
    style: r.style ?? null,
  })),
  buildingType: raw.building_type ?? null,
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
};

export type BriefRoomsResult = { ok: true; rooms: BriefRooms } | { ok: false; reason: string };

/** Size rooms already read, at a zone: no call to Tiff. */
export async function sizeRooms(
  read: ReadRoom[],
  buildingType: BuildingType,
  buildingSaid: boolean,
  zone: BriefRooms["zone"],
  dropped: string[] = []
): Promise<BriefRooms> {
  const ref = await latestInstalledPack(PACK_BRAND);
  const pack = ref ? (await loadInstalledPack(ref.brand, ref.version)).pack : null;
  const sized = zone && pack ? read.filter((r): r is ReadRoom & { areaM2: number } => r.areaM2 != null).map((r) => sizeRoom(r, zone.zone, buildingType, pack)) : [];
  return { read, rooms: sized, dropped, buildingType, buildingSaid, zone };
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
    return { ok: true, read: readOf(JSON.parse(block.text) as Raw) };
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) return { ok: false, reason: "Tiff is busy. Try again in a minute." };
    return { ok: false, reason: "The brief couldn't be read. Try again." };
  }
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
  return { ok: true, rooms: await sizeRooms(rooms, read.buildingType ?? "residential", read.buildingType != null, zone, dropped) };
}
