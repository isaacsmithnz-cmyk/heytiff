"use server";

import { auth0 } from "@/lib/auth0";
import { supabaseAdmin } from "@/lib/supabase-server";
import { isDesignDocumentShape } from "@/lib/studio/document";
import { recordContribution } from "./studio-contributors";
import type { DesignSummary } from "@/lib/studio/store";

/* Design Studio persistence — server side. Follows the invite-action pattern:
   authenticate the Auth0 session, then read/write via the service role with
   an explicit org_id scope. Server Functions are reachable by direct POST, so
   every function re-checks the session itself. */

async function requireOrg(): Promise<{ orgId: string; userId: string }> {
  const session = await auth0.getSession();
  if (!session) throw new Error("Not authenticated");
  const orgId = session.orgId as string | undefined;
  if (!orgId) throw new Error("No active organization");
  return { orgId, userId: session.user.sub as string };
}

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
  const { orgId } = await requireOrg();
  const { data, error } = await supabaseAdmin
    .from("studio_designs")
    .select("id, name, mode, floor_count, system_count, created_at, updated_at")
    .eq("org_id", orgId)
    .order("updated_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data as DesignRow[]).map(toSummary);
}

export async function loadStudioDesign(id: string): Promise<unknown | null> {
  const { orgId } = await requireOrg();
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

export async function saveStudioDesign(doc: unknown): Promise<void> {
  const { orgId, userId } = await requireOrg();
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

export async function deleteStudioDesign(id: string): Promise<void> {
  const { orgId } = await requireOrg();
  const { error } = await supabaseAdmin
    .from("studio_designs")
    .delete()
    .eq("org_id", orgId)
    .eq("id", id);
  if (error) throw new Error(error.message);
}
