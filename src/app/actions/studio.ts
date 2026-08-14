"use server";

import { supabaseAdmin } from "@/lib/supabase-server";
import { can, requireOrg } from "@/lib/permissions-server";
import { isDesignDocumentShape } from "@/lib/studio/document";
import { recordContribution } from "@/lib/studio/contributions-server";
import type { StudioJobHit } from "@/lib/studio/job-link";
import type { DesignSummary } from "@/lib/studio/store";
import { searchMirrorJobs } from "@/lib/workboard/projects-query";

/* Design Studio persistence — server side. Follows the invite-action pattern:
   authenticate the Auth0 session, then read/write via the service role with
   an explicit org_id scope. Server Functions are reachable by direct POST, so
   every function re-checks for itself — and `studio` is revocable, so each
   one names the capability, same as the route gate. */

type DesignRow = {
  id: string;
  name: string;
  mode: "plan" | "blank";
  floor_count: number;
  system_count: number;
  created_at: string;
  updated_at: string;
};

function toSummary(r: DesignRow): DesignSummary {
  return {
    id: r.id,
    name: r.name,
    mode: r.mode,
    floorCount: r.floor_count,
    systemCount: r.system_count,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export async function listStudioDesigns(): Promise<DesignSummary[]> {
  const { orgId } = await requireOrg("studio");
  const { data, error } = await supabaseAdmin
    .from("studio_designs")
    .select("id, name, mode, floor_count, system_count, created_at, updated_at")
    .eq("org_id", orgId)
    .order("updated_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data as DesignRow[]).map(toSummary);
}

export async function loadStudioDesign(id: string): Promise<unknown | null> {
  const { orgId } = await requireOrg("studio");
  const { data, error } = await supabaseAdmin
    .from("studio_designs")
    .select("doc")
    .eq("org_id", orgId)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  // raw jsonb — the client runs it through migrateDesign, same as any file
  return data?.doc ?? null;
}

/* The linked job's uuid, read defensively off a document the client handed
   in. A save arrives as `unknown` and is only shape-checked at the top level,
   so this reads its way down rather than trusting the type — a malformed
   `jobLink` must leave the column null, never throw and lose the save. */
function sm8JobUuid(doc: { jobLink?: unknown }): string | null {
  const link = doc.jobLink as
    | { provider?: unknown; remoteId?: unknown }
    | null
    | undefined;
  if (!link || typeof link !== "object") return null;
  if (link.provider !== "servicem8") return null;
  const id = typeof link.remoteId === "string" ? link.remoteId.trim() : "";
  return id ? id.slice(0, 80) : null;
}

export async function saveStudioDesign(doc: unknown): Promise<void> {
  const { orgId, userId } = await requireOrg("studio");
  if (!isDesignDocumentShape(doc)) throw new Error("Not a design document");
  const meta = doc.meta as {
    name?: unknown;
    mode?: unknown;
    createdAt?: unknown;
    updatedAt?: unknown;
  };
  if (typeof meta.name !== "string" || (meta.mode !== "plan" && meta.mode !== "blank")) {
    throw new Error("Design metadata is malformed");
  }
  const { error } = await supabaseAdmin.from("studio_designs").upsert(
    {
      id: doc.id,
      org_id: orgId,
      name: meta.name,
      mode: meta.mode,
      schema_version: doc.schemaVersion,
      doc,
      floor_count: doc.floors.length,
      system_count: doc.systems.length,
      /* The linked job's uuid, MIRRORED OUT of the document exactly as name,
         mode and the two counts already are — the doc stays the source of
         truth, the column is what makes "which designs are for this job?" a
         query instead of a scan of every jsonb blob in the table. Rewritten
         on every save, so unlinking in the document unlinks here too. */
      sm8_job_uuid: sm8JobUuid(doc),
      /* NB this is overwritten on every save, so it holds the LAST saver, not
         the creator. Who made it — and everyone since — comes from
         studio_design_contributors below. */
      created_by: userId,
      created_at: typeof meta.createdAt === "string" ? meta.createdAt : undefined,
      updated_at: typeof meta.updatedAt === "string" ? meta.updatedAt : new Date().toISOString(),
    },
    { onConflict: "org_id,id" }
  );
  if (error) throw new Error(error.message);

  /* Record the saver as a contributor. Deliberately non-fatal: the design is
     already stored by this point, and losing a line of credit must never
     surface to the user as "your save failed". */
  try {
    await recordContribution(orgId, doc.id, userId);
  } catch {
    /* the save itself succeeded — that's what matters */
  }
}

/* The new-design step's ServiceM8 search.

   TWO GATES, BOTH REQUIRED. `studio` is the surface asking; `workboard` is
   what makes the client book readable at all. They agree with the rule the
   attach picker already follows — a picker must never find more than the
   list beside it — and in practice both are staff defaults, so the box is
   there for everyone who has the mirror. Someone whose `workboard` was
   revoked gets a studio with no ServiceM8 step, not a studio that leaks the
   client book through the back of it.

   The same mirror search the Workboard uses, mapped to the browser-safe
   shape: no company uuid, no project links, nothing this screen can't say. */
export async function searchStudioJobs(query: string): Promise<StudioJobHit[]> {
  const { orgId } = await requireOrg("studio");
  if (!(await can("workboard"))) return [];
  const q = query.trim().slice(0, 80);
  if (q.length < 2) return [];

  const hits = await searchMirrorJobs(orgId, q, 8);
  return hits.map((h) => ({
    remoteId: h.remoteId,
    jobNumber: h.jobNumber,
    clientName: h.clientName,
    status: h.status,
    address: h.address,
    suburb: h.suburb,
    description: h.description,
  }));
}

export async function deleteStudioDesign(id: string): Promise<void> {
  const { orgId } = await requireOrg("studio");
  const { error } = await supabaseAdmin
    .from("studio_designs")
    .delete()
    .eq("org_id", orgId)
    .eq("id", id);
  if (error) throw new Error(error.message);
}
