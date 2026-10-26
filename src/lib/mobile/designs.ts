import "server-only";

import { supabaseAdmin } from "@/lib/supabase-server";
import { migrateDesign } from "@/lib/studio/migrations";
import { buildDesignSnapshot, type DesignSnapshot } from "@/lib/studio/summary";
import { planFigureBounds } from "@/lib/studio/figure-bounds";
import { roomAreaM2, roomLoadKw, type RoomObj } from "@/lib/studio/loads-room";
import type { DesignDocument, DesignObject } from "@/lib/studio/document";
import { floorDisplayName } from "@/lib/studio/plans";
import { sceneOf, type Scene3D } from "@/lib/studio/scene3d";

/* THE DESIGNS, FOR THE PHONE TO LOOK AT (Isaac, 26 October 2026: the More
   page's Design). Read-only: the workspace's designs newest first, and one
   design as the phone draws it: each floor's plan sheets (signed for an
   hour), its rooms as polygons with their area and load, its units placed
   with their footprint, and the design's headline figures (the Summary's
   own `buildDesignSnapshot`). Nothing is drawn or changed on the phone.

   And the design in 3D (Isaac, 27 October 2026: "build the 3D view into
   the phone's Design"): the Studio's own `sceneOf`, which the phone hands
   to the web's own 3D view (app/phone/3d), so it turns and looks the same.

   Session-free, for the workspace the phone's token check verified; the
   studio's own actions read the same table the same way (actions/studio's
   listStudioDesigns, loadStudioDesign). */

const BUCKET = "studio-plans";
const SIGN_SECONDS = 3600;
const LIST_MAX = 100;

export type DesignListItem = {
  id: string;
  name: string;
  jobNumber: string | null;
  client: string | null;
  floors: number;
  systems: number;
  updatedAt: string;
  /** the first floor's first plan, signed; null when it has none */
  thumbUrl: string | null;
};

export type PhoneRoom = { id: string; name: string; points: { x: number; y: number }[]; areaM2: number | null; loadKw: number | null };
export type PhoneUnit = {
  id: string;
  role: "idu" | "odu" | null;
  model: string | null;
  at: { x: number; y: number };
  rotation: number;
  /** footprint in the floor's world units; null on an uncalibrated floor */
  w: number | null;
  h: number | null;
  colour: string | null;
};
export type PhoneSheet = { url: string; x: number; y: number; width: number; height: number; crop: { x: number; y: number; w: number; h: number } | null };
export type PhoneFloor = {
  id: string;
  name: string;
  level: number;
  /** what to frame, in world units; null for a floor with nothing on it */
  box: { x: number; y: number; w: number; h: number } | null;
  sheets: PhoneSheet[];
  rooms: PhoneRoom[];
  units: PhoneUnit[];
};
export type PhoneDesign = {
  id: string;
  name: string;
  jobNumber: string | null;
  client: string | null;
  site: string | null;
  /** the ServiceM8 job it is on, for the phone's job screen */
  jobUuid: string | null;
  updatedAt: string;
  snapshot: DesignSnapshot;
  systems: { id: string; name: string; brand: string; colour: string; type: string }[];
  floors: PhoneFloor[];
};

type ListRow = {
  id: string;
  name: string | null;
  floor_count: number | null;
  system_count: number | null;
  updated_at: string;
  job_number: string | null;
  client: string | null;
  thumb_ref: string | null;
};

async function sign(refs: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  await Promise.all(
    [...new Set(refs.filter(Boolean))].map(async (ref) => {
      const { data } = await supabaseAdmin.storage.from(BUCKET).createSignedUrl(ref, SIGN_SECONDS);
      if (data?.signedUrl) out.set(ref, data.signedUrl);
    }),
  );
  return out;
}

const text = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

/** The workspace's designs, newest first; `q` narrows by name, job or client. */
export async function listDesigns(orgId: string, q = ""): Promise<DesignListItem[]> {
  const { data, error } = await supabaseAdmin
    .from("studio_designs")
    .select("id, name, floor_count, system_count, updated_at, job_number:doc->meta->>jobNumber, client:doc->meta->>client, thumb_ref:doc->floors->0->plans->0->>imageRef")
    .eq("org_id", orgId)
    .order("updated_at", { ascending: false })
    .limit(LIST_MAX);
  if (error || !data) return [];
  const want = q.trim().toLowerCase();
  const rows = (data as ListRow[]).filter((r) => !want || [r.name, r.job_number, r.client].some((s) => (s ?? "").toLowerCase().includes(want)));
  const urls = await sign(rows.map((r) => r.thumb_ref ?? "").slice(0, 30));
  return rows.map((r) => ({
    id: r.id,
    name: text(r.name) ?? "Untitled design",
    jobNumber: text(r.job_number),
    client: text(r.client),
    floors: r.floor_count ?? 0,
    systems: r.system_count ?? 0,
    updatedAt: r.updated_at,
    thumbUrl: r.thumb_ref ? (urls.get(r.thumb_ref) ?? null) : null,
  }));
}

const round = (v: number | null, places: number) => (v == null ? null : Math.round(v * 10 ** places) / 10 ** places);

const isRoom = (o: DesignObject): o is RoomObj => o.type === "room" && o.geometry.kind === "polygon";

type DesignRow = { id: string; name: string | null; updated_at: string; doc: DesignDocument };

/** The workspace's design with its document brought up to date, or null. */
async function loadDesign(orgId: string, id: string): Promise<DesignRow | null> {
  const { data, error } = await supabaseAdmin
    .from("studio_designs")
    .select("id, name, updated_at, doc")
    .eq("org_id", orgId)
    .eq("id", id)
    .maybeSingle();
  if (error || !data) return null;
  const row = data as { id: string; name: string | null; updated_at: string; doc: unknown };
  try {
    return { ...row, doc: migrateDesign(row.doc).doc };
  } catch {
    return null;
  }
}

/** One design as the phone draws it, or null when it isn't this workspace's. */
export async function readDesign(orgId: string, id: string): Promise<PhoneDesign | null> {
  const row = await loadDesign(orgId, id);
  if (!row) return null;
  const { doc } = row;

  const urls = await sign(doc.floors.flatMap((f) => f.plans.map((p) => p.imageRef)));
  const colourOf = new Map(doc.systems.map((s) => [s.id, s.colour]));
  const meta = (doc.meta ?? {}) as unknown as Record<string, unknown>;

  const floors: PhoneFloor[] = [...doc.floors]
    .sort((a, b) => a.level - b.level)
    .map((f) => {
      const scale = f.scaleMmPerUnit;
      const here = doc.objects.filter((o) => o.floorId === f.id);
      return {
        id: f.id,
        name: f.name,
        level: f.level,
        box: planFigureBounds(doc, f),
        sheets: f.plans
          .filter((p) => urls.has(p.imageRef))
          .map((p) => ({ url: urls.get(p.imageRef)!, x: p.x, y: p.y, width: p.width, height: p.height, crop: p.crop ?? null })),
        rooms: here.filter(isRoom).map((r) => ({
          id: r.id,
          name: text(r.props.name) ?? "Room",
          points: r.geometry.points,
          areaM2: round(roomAreaM2(doc, r), 1),
          loadKw: round(roomLoadKw(doc, r), 2),
        })),
        units: here
          .filter((o) => o.type === "unit" && o.geometry.kind === "point")
          .map((u) => {
            const g = u.geometry as { kind: "point"; at: { x: number; y: number }; rotation?: number };
            const wMm = typeof u.props.widthMm === "number" ? u.props.widthMm : null;
            const dMm = typeof u.props.depthMm === "number" ? u.props.depthMm : null;
            return {
              id: u.id,
              role: u.props.role === "idu" || u.props.role === "odu" ? u.props.role : null,
              model: text(u.props.model),
              at: g.at,
              rotation: g.rotation ?? 0,
              w: scale && wMm ? wMm / scale : null,
              h: scale && dMm ? dMm / scale : null,
              colour: (u.systemId && colourOf.get(u.systemId)) || null,
            };
          }),
      };
    });

  return {
    id: row.id,
    name: text(row.name) ?? "Untitled design",
    jobNumber: text(meta.jobNumber),
    client: text(meta.client),
    site: text(meta.site),
    jobUuid: doc.jobLink?.remoteId ?? null,
    updatedAt: row.updated_at,
    snapshot: buildDesignSnapshot(doc),
    systems: doc.systems.map((s) => ({ id: s.id, name: s.name, brand: s.brand, colour: s.colour, type: s.type })),
    floors,
  };
}

export type PhoneScene = {
  scene: Scene3D;
  /** the floors the 3D draws, bottom up, by the names the Studio shows */
  floors: { id: string; name: string }[];
};

/** One design in 3D, or null when it isn't this workspace's. */
export async function readScene(orgId: string, id: string): Promise<PhoneScene | null> {
  const row = await loadDesign(orgId, id);
  if (!row) return null;
  const scene = sceneOf(row.doc);
  return { scene, floors: scene.floors.map((f) => ({ id: f.id, name: floorDisplayName(f) })) };
}
