import "server-only";
import sharp from "sharp";
import { supabaseAdmin } from "@/lib/supabase-server";
import { DOCUMENTS_BUCKET } from "@/lib/documents/query";
import { displayName, refIsOrgs, storageRef } from "@/lib/documents/files";
import { newId, type DesignDocument } from "@/lib/studio/document";
import { staffDisplayNames } from "@/lib/workboard/job-notes-query";
import { stateOfRead } from "./plans";
import { designPlanGroups, needsCounts, planFromGroup, type DesignPlanGroup } from "./plans-from-design";

/* LINKING A DESIGN MOVES ITS PLANS ONTO THE JOB (plans-from-design.ts says
   why). Each of the design's files goes onto the job's Documents and into its
   Plans, its pages the design's own pictures and her reading the design's,
   so nothing is drawn or read again; a file the design never had read goes
   on to be read, and the caller starts that read. The design itself is
   linked by the caller, as Link job always has: the Studio saves it. */

const PLANS_BUCKET = "studio-plans";
const PREVIEW_WIDTH = 480;

export type LinkPlansResult =
  /** `planIds` the plans made; `toRead` those still to be read; `lead` the plan the design now says it came from */
  { ok: true; planIds: string[]; toRead: string[]; lead: string | null } | { ok: false; error: string };

async function bytesOf(ref: string): Promise<Buffer> {
  const { data, error } = await supabaseAdmin.storage.from(PLANS_BUCKET).download(ref);
  if (error || !data) throw new Error("A plan's file couldn't be fetched");
  return Buffer.from(await data.arrayBuffer());
}

async function pageCountOf(pdf: Buffer): Promise<number> {
  const { PDFDocument } = await import("pdf-lib");
  return (await PDFDocument.load(new Uint8Array(pdf), { ignoreEncryption: true })).getPageCount();
}

const MIME: Record<string, string> = { pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp" };
const extOfName = (name: string, kind: "pdf" | "image") => (kind === "pdf" ? "pdf" : (name.match(/\.(png|jpe?g|webp)$/i)?.[1] ?? "png").toLowerCase());

/** What a failed link leaves behind, taken away again. */
type Made = { plans: string[]; documents: string[]; documentRefs: string[]; previews: string[] };

async function undo(orgId: string, made: Made): Promise<void> {
  if (made.plans.length) await supabaseAdmin.from("job_plans").delete().eq("org_id", orgId).in("id", made.plans);
  if (made.documents.length) await supabaseAdmin.from("documents").delete().eq("org_id", orgId).in("id", made.documents);
  if (made.documentRefs.length) await supabaseAdmin.storage.from(DOCUMENTS_BUCKET).remove(made.documentRefs);
  if (made.previews.length) await supabaseAdmin.storage.from(PLANS_BUCKET).remove(made.previews);
}

/** The small pictures for the job's thumbnails, by page. */
async function previewsOf(orgId: string, g: DesignPlanGroup, made: Made): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  for (const p of g.pages) {
    if (out.has(p.n)) continue;
    try {
      const small = await sharp(await bytesOf(p.sheet.imageRef)).resize({ width: PREVIEW_WIDTH, withoutEnlargement: true }).jpeg({ quality: 72 }).toBuffer();
      const ref = `org/${orgId}/${newId("plan")}.jpeg`;
      const put = await supabaseAdmin.storage.from(PLANS_BUCKET).upload(ref, small, { contentType: "image/jpeg", upsert: false });
      if (put.error) continue;
      made.previews.push(ref);
      out.set(p.n, ref);
    } catch (e) {
      /* a page with no thumbnail still goes on */
      console.error(`[link-plans] page ${p.n} thumbnail: ${String(e)}`);
    }
  }
  return out;
}

/** The file onto the job's Documents, landed: its id. */
async function fileOntoJob(orgId: string, jobUuid: string, g: DesignPlanGroup, staffId: string | null, made: Made): Promise<string> {
  const bytes = await bytesOf(g.sourceRef);
  const ext = extOfName(g.sourceRef, g.sourceKind);
  const { data, error } = await supabaseAdmin
    .from("documents")
    .insert({
      org_id: orgId,
      kind: "job_document",
      storage_ref: `org/${orgId}/pending/${crypto.randomUUID()}`,
      file_name: displayName(g.name),
      mime_type: MIME[ext] ?? "application/octet-stream",
      size_bytes: bytes.length,
      uploaded_by: staffId,
      sm8_job_uuid: jobUuid,
    })
    .select("id")
    .maybeSingle();
  if (error || !data) throw new Error("The plan couldn't be put on the job");
  const documentId = String(data.id);
  made.documents.push(documentId);
  const ref = storageRef(orgId, "job_document", documentId, ext);
  const put = await supabaseAdmin.storage.from(DOCUMENTS_BUCKET).upload(ref, bytes, { contentType: MIME[ext], upsert: false });
  if (put.error) throw new Error("The plan's file couldn't be copied to the job");
  made.documentRefs.push(ref);
  const { error: refErr } = await supabaseAdmin.from("documents").update({ storage_ref: ref }).eq("org_id", orgId).eq("id", documentId);
  if (refErr) throw new Error("The plan couldn't be put on the job");
  return documentId;
}

/** The design's plans onto the job, read as the design has them. A design
    already made from one of this job's plans has nothing to move. */
export async function linkDesignPlans(orgId: string, jobUuid: string, designId: string, staffId: string | null): Promise<LinkPlansResult> {
  const { data: row } = await supabaseAdmin.from("studio_designs").select("doc").eq("org_id", orgId).eq("id", designId).maybeSingle();
  const doc = (row as { doc: DesignDocument } | null)?.doc ?? null;
  if (!doc) return { ok: false, error: "The design isn't saved yet. Try again in a moment." };
  const { data: job } = await supabaseAdmin.from("sm8_jobs").select("uuid").eq("org_id", orgId).eq("uuid", jobUuid).maybeSingle();
  if (!job) return { ok: false, error: "That job isn't in ServiceM8's copy any more." };

  const from = doc.planImport?.jobPlanId;
  if (from) {
    const { data: was } = await supabaseAdmin.from("job_plans").select("job_uuid").eq("org_id", orgId).eq("id", from).maybeSingle();
    if ((was as { job_uuid: string } | null)?.job_uuid === jobUuid) return { ok: true, planIds: [], toRead: [], lead: from };
  }

  const made: Made = { plans: [], documents: [], documentRefs: [], previews: [] };
  try {
    const sources = doc.planImport?.sources ?? [];
    const counts = needsCounts(doc) ? await Promise.all(sources.map(async (s) => (s.kind === "pdf" ? pageCountOf(await bytesOf(s.ref)) : 1))) : undefined;
    const groups = designPlanGroups(doc, counts).filter((g) => refIsOrgs(g.sourceRef, orgId));
    const by = staffId ? ((await staffDisplayNames(orgId, [staffId])).get(staffId) ?? null) : null;
    const at = new Date().toISOString();
    const toRead: string[] = [];
    for (const g of groups) {
      const documentId = await fileOntoJob(orgId, jobUuid, g, staffId, made);
      const previews = await previewsOf(orgId, g, made);
      const { pages, reading } = planFromGroup(doc, g, { previews, by, at });
      const read = reading ? stateOfRead(pages, reading) : null;
      const id = newId("jplan");
      const { error } = await supabaseAdmin.from("job_plans").insert({
        id,
        org_id: orgId,
        job_uuid: jobUuid,
        document_id: documentId,
        name: displayName(g.name),
        source_ref: g.sourceRef,
        source_kind: g.sourceKind,
        page_count: g.pageCount,
        pages,
        reading,
        state: read?.state ?? "reading",
        said: read?.said ?? null,
        added_by: staffId,
        read_at: reading ? at : null,
      });
      if (error) throw new Error("The plan couldn't be added to the job's Plans");
      made.plans.push(id);
      if (!read) toRead.push(id);
    }
    /* landed last: until then no screen and no take-in sees the files */
    if (made.documents.length) {
      const { error } = await supabaseAdmin.from("documents").update({ uploaded_at: at }).eq("org_id", orgId).in("id", made.documents);
      if (error) throw new Error("The plans couldn't be put on the job");
    }
    return { ok: true, planIds: made.plans, toRead, lead: made.plans[0] ?? null };
  } catch (e) {
    console.error(`[link-plans] ${designId} → ${jobUuid}: ${String(e)}`);
    await undo(orgId, made).catch(() => {});
    return { ok: false, error: e instanceof Error ? `${e.message}. Nothing was linked.` : "The plans couldn't be moved. Nothing was linked." };
  }
}
