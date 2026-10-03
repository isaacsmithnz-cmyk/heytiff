import { auth0 } from "@/lib/auth0";
import { can } from "@/lib/permissions-server";
import { isZone, type ReadRoom } from "@/lib/quotes/brief-rooms";
import { readBriefRooms, sizeRooms } from "@/lib/quotes/brief-rooms-server";
import type { BuildingType } from "@/lib/studio/loads";

/* The job card's Quote section: the rooms the brief gives a size for, read
   by Tiff and sized from the data pack (Isaac, 2026-10-04: "What if I said
   the room is 30m2?"). POST {job} reads the brief; POST {job, read, zone,
   buildingType} sizes rooms already read at a zone a person chose, with no
   second read. Running the board, like the draft beside it; no money in it.

   A ROUTE, as quote-draft is: a Claude call is seconds, and maxDuration is
   a route-segment option. */

export const maxDuration = 120;

const BUILDINGS: BuildingType[] = ["residential", "light_commercial", "commercial"];

export async function POST(req: Request) {
  const session = await auth0.getSession();
  const orgId = (session?.orgId as string | undefined) ?? null;
  if (!orgId || !(await can("workboard_manage"))) {
    return Response.json({ ok: false, reason: "Sizing rooms needs Workboard manage access." }, { status: 403 });
  }
  const body = (await req.json().catch(() => ({}))) as { job?: unknown; read?: unknown; zone?: unknown; buildingType?: unknown; buildingSaid?: unknown; dropped?: unknown };
  const job = typeof body.job === "string" ? body.job.trim().slice(0, 80) : "";
  if (!job) return Response.json({ ok: false, reason: "No job named." }, { status: 400 });

  if (Array.isArray(body.read) && isZone(body.zone)) {
    const read = (body.read as ReadRoom[]).slice(0, 20).filter((r) => r && typeof r.areaM2 === "number" && r.areaM2 > 0 && r.areaM2 <= 500);
    const building = BUILDINGS.includes(body.buildingType as BuildingType) ? (body.buildingType as BuildingType) : "residential";
    const dropped = Array.isArray(body.dropped) ? body.dropped.filter((d): d is string => typeof d === "string").slice(0, 20) : [];
    return Response.json({ ok: true, rooms: await sizeRooms(read, building, body.buildingSaid === true, { zone: body.zone, from: "chosen", town: null }, dropped) });
  }
  return Response.json(await readBriefRooms(orgId, job));
}
