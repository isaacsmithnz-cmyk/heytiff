"use server";

import { supabaseAdmin } from "@/lib/supabase-server";
import { can, requireOrg } from "@/lib/permissions-server";
import { isDesignDocumentShape } from "@/lib/studio/document";
import { recordContribution } from "@/lib/studio/contributions-server";
import type { StudioJobHit } from "@/lib/studio/job-link";
import type { DesignSummary } from "@/lib/studio/store";
import { searchMirrorJobs } from "@/lib/workboard/projects-query";
import { studioJobsByIds, studioJobsByNumber } from "@/lib/studio/job-cards-server";

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
  job_number: string | null;
  client: string | null;
  thumb_ref: string | null;
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
    jobNumber: r.job_number ?? "",
    client: r.client ?? "",
    ...(r.thumb_ref ? { thumbRef: r.thumb_ref } : {}),
  };
}

export async function listStudioDesigns(): Promise<DesignSummary[]> {
  const { orgId } = await requireOrg("studio");
  const { data, error } = await supabaseAdmin
    .from("studio_designs")
    .select(
      /* the job and a plan to show, read out of the document by PostgREST's
         JSON paths rather than shipping every document to draw the list */
      "id, name, mode, floor_count, system_count, created_at, updated_at, job_number:doc->meta->>jobNumber, client:doc->meta->>client, thumb_ref:doc->floors->0->plans->0->>imageRef"
    )
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
  /* each found job as its card: its kind, its colour and whether it has
     plans read; one the card read loses keeps its plain answer */
  const cards = new Map((await studioJobsByIds(orgId, hits.map((h) => h.remoteId))).map((c) => [c.remoteId, c]));
  return hits.map(
    (h) =>
      cards.get(h.remoteId) ?? {
        remoteId: h.remoteId,
        jobNumber: h.jobNumber,
        clientName: h.clientName,
        status: h.status,
        address: h.address,
        suburb: h.suburb,
        description: h.description,
      }
  );
}

/* NEW DESIGN'S JOBS (Isaac, 14 November 2026): Recent is the jobs this
   browser last opened, read fresh by id; All jobs is the newest number
   first, a page at a time. The same two gates as the search. */
export async function readStudioJobs(ids: string[]): Promise<StudioJobHit[]> {
  const { orgId } = await requireOrg("studio");
  if (!(await can("workboard"))) return [];
  if (!Array.isArray(ids)) return [];
  return studioJobsByIds(orgId, ids.filter((id): id is string => typeof id === "string").slice(0, 20));
}

export async function listStudioJobs(from: number, limit: number): Promise<StudioJobHit[]> {
  const { orgId } = await requireOrg("studio");
  if (!(await can("workboard"))) return [];
  return studioJobsByNumber(orgId, Number(from) || 0, Number(limit) || 0);
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

/* FROM THE QUOTE (from-quote.ts): the units each option of a design's job's
   quote names, with which options are accepted and what they're called. The
   codes and the rooms only, never a price. Nothing for a quote kept the old
   way, or one with no unit lines. Lazy, so the quote engine's server code
   loads only when a design asks. */
export async function readQuotedUnits(jobRemoteId: string): Promise<{
  lines: { optionIndex: number; system: string; name: string; code: string | null; kind: string; qty: number }[];
  accepted: number[];
  names: Record<number, string>;
  /** the brands whose books have the quote's units: the Studio loads their
      packs, so an option comes in as the brand it was quoted in */
  brands: string[];
}> {
  const empty = { lines: [], accepted: [], names: {}, brands: [] };
  const { orgId } = await requireOrg("studio");
  if (!(await can("workboard")) || typeof jobRemoteId !== "string" || !jobRemoteId) return empty;
  const [{ readEngine, readLines }, { readByHand }] = await Promise.all([import("@/lib/quotes/lines-server"), import("@/lib/quotes/lines-job-server")]);
  if ((await readEngine(orgId, jobRemoteId)) !== "lines") return empty;
  const [lines, byHand] = await Promise.all([readLines(orgId, jobRemoteId), readByHand(orgId, jobRemoteId)]);
  const names: Record<number, string> = {};
  byHand.names.forEach((n, i) => {
    if (n) names[i] = n;
  });
  const units = lines
    .filter((l) => l.kind === "unit" && l.code)
    .map((l) => ({ optionIndex: l.optionIndex, system: l.system, name: l.name, code: l.code, kind: l.kind, qty: l.qty }));
  /* the materials by their words, never a price: the quote's answers to
     Install details (install-from-quote.ts) */
  const materials = lines
    .filter((l) => l.kind === "material")
    .map((l) => ({ optionIndex: l.optionIndex, system: l.system, name: l.name, code: null, kind: l.kind, qty: l.qty }));
  return { lines: [...units, ...materials], accepted: byHand.accepted, names, brands: await quotedBrands(units.map((l) => l.code!)) };
}

/* WHAT THE DESIGN TAKES FROM THE QUOTE (take-from-quote.ts): the units a
   person said the quote has right, waiting for this design to take them,
   and the units they said go. Read as the design opens and when its tab is
   come back to; Undo of what it took sends the quote back to asking. */
export async function readQuoteTakes(jobRemoteId: string, designId: string): Promise<{ takes: import("@/lib/studio/take-from-quote").QuoteTake[]; drop: string[] }> {
  const { orgId } = await requireOrg("studio");
  if (!(await can("workboard")) || typeof jobRemoteId !== "string" || !jobRemoteId || typeof designId !== "string") return { takes: [], drop: [] };
  const { quoteTakes } = await import("@/lib/quotes/design-units-server");
  return quoteTakes(orgId, jobRemoteId, designId);
}

export async function refuseQuoteTakes(jobRemoteId: string, lineIds: string[], dropped: string[]): Promise<boolean> {
  const { orgId, userId } = await requireOrg("studio");
  if (!(await can("workboard")) || typeof jobRemoteId !== "string" || !jobRemoteId) return false;
  const ids = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, 200) : []);
  const { refuseTakes } = await import("@/lib/quotes/design-units-server");
  return refuseTakes(orgId, jobRemoteId, ids(lineIds), ids(dropped), userId);
}

/** the installed brands whose books have one of these codes, newest edition */
async function quotedBrands(codes: readonly string[]): Promise<string[]> {
  if (codes.length === 0) return [];
  const [{ installedPacks, loadInstalledPack }, { modelForCode }] = await Promise.all([
    import("@/lib/studio/packs/server"),
    import("@/lib/studio/from-quote"),
  ]);
  const latest = new Map<string, string>();
  for (const r of await installedPacks()) if (r.version.localeCompare(latest.get(r.brand) ?? "") > 0) latest.set(r.brand, r.version);
  const found: string[] = [];
  await Promise.all(
    [...latest].map(async ([brand, version]) => {
      const pack = await loadInstalledPack(brand, version).then((p) => p.pack).catch(() => null);
      if (!pack) return;
      const models = [...pack.indoor_units, ...pack.outdoor_units].map((u) => u.model);
      if (codes.some((c) => modelForCode(models, c))) found.push(brand);
    })
  );
  return found.sort();
}
