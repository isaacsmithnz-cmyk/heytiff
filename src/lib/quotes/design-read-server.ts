import "server-only";
import { supabaseAdmin } from "@/lib/supabase-server";
import { migrateDesign } from "@/lib/studio/migrations";
import type { DesignDocument } from "@/lib/studio/document";
import type { DataPack } from "@/lib/studio/packs/schema";
import { resolvePacks } from "@/lib/studio/packs/loader";
import { latestInstalledPack, loadInstalledPack } from "@/lib/studio/packs/server";
import { loadPackWithOverrides } from "@/lib/studio/packs/overrides-server";
import { dayOf } from "./session/job-sources";
import { designRead, NO_DESIGN, type DesignOnJob, type JobDesign } from "./design-read";

/* The job's Studio design, read for Tiff (design-read.ts says what she's
   given): the designs whose sm8_job_uuid is the job, newest first, as the
   job card lists them (all-jobs-query.ts), the newest read unless she names
   another; read with the packs of the brands it's built in, the newest
   installed with HQ's corrections on, as the Studio, its Summary and the
   printed sheet read them. Reads only. Service role, by org; the route
   gates. */

/** The designs linked to a job, newest first. */
export async function designsOnJob(orgId: string, jobUuid: string): Promise<(DesignOnJob & { systems: number })[]> {
  if (!jobUuid) return [];
  const { data } = await supabaseAdmin
    .from("studio_designs")
    .select("id, name, system_count, updated_at")
    .eq("org_id", orgId)
    .eq("sm8_job_uuid", jobUuid)
    .order("updated_at", { ascending: false })
    .limit(12);
  return ((data ?? []) as { id: string; name: string | null; system_count: number | null; updated_at: string | null }[]).map((r) => ({
    id: r.id,
    name: r.name?.trim() || "Untitled design",
    saved: dayOf(r.updated_at),
    systems: r.system_count ?? 0,
  }));
}

/** One brand's pack as the Studio reads it: the newest installed, HQ's
    corrections on; without them if they can't be read; null when none. */
async function studioPack(brand: string): Promise<DataPack | null> {
  const ref = await latestInstalledPack(brand).catch(() => null);
  if (!ref) return null;
  try {
    return (await loadPackWithOverrides(ref.brand, ref.version)).pack;
  } catch {
    return loadInstalledPack(ref.brand, ref.version)
      .then((p) => p.pack)
      .catch(() => null);
  }
}

/** Every brand the design is built in, its packs merged; null when none is installed. */
async function designPacks(doc: DesignDocument): Promise<DataPack | null> {
  const brands = [...new Set([...doc.systems.map((s) => s.brand), ...Object.keys(doc.packPins)].filter(Boolean))].sort();
  const packs = (await Promise.all(brands.map(studioPack))).filter((p): p is DataPack => p != null);
  return packs.length ? resolvePacks(packs) : null;
}

/** The job's design as she reads it: `id`'s, else the newest. */
export async function readJobDesign(orgId: string, jobUuid: string, id: string | null = null): Promise<JobDesign> {
  const list = await designsOnJob(orgId, jobUuid);
  if (list.length === 0) return { found: false, reason: NO_DESIGN };
  const designs = list.map(({ id: designId, name, saved }) => ({ id: designId, name, saved }));
  const chosen = id ? designs.find((d) => d.id === id) : designs[0];
  if (!chosen) return { found: false, reason: "That design isn't linked to this job.", designs };
  const { data } = await supabaseAdmin.from("studio_designs").select("doc").eq("org_id", orgId).eq("id", chosen.id).maybeSingle();
  let doc: DesignDocument;
  try {
    doc = migrateDesign((data as { doc: unknown } | null)?.doc).doc;
  } catch {
    return { found: false, reason: `The design "${chosen.name}" couldn't be read.`, designs };
  }
  return { found: true, read: designRead(doc, await designPacks(doc)), others: designs.filter((d) => d.id !== chosen.id) };
}
