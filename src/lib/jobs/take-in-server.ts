import "server-only";
import { createHash } from "node:crypto";
import { headers } from "next/headers";
import { after } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { DOCUMENTS_BUCKET } from "@/lib/documents/query";
import { openPdf } from "@/lib/tiff/extract";
import { newId } from "@/lib/studio/document";
import { signPlanReadTicket } from "@/lib/studio/pdf-request";
import { addJobPlans, fileFor, kindOf, type PlanPick } from "./plans-server";
import { SORT_PAGES, sortPdf, type PdfPage, type TakeSort } from "./take-in";

/* EVERY PDF ON A JOB, TAKEN IN ONCE (take-in.ts says what is decided). The
   doors call takeInFiles after the file is on the job: an upload or a drop
   on Documents (actions/job-documents.ts), an email filed on the job or
   made into one (lib/email/made-server.ts), a PDF from the phone
   (api/mobile/jobs/[id]/pdfs). Each file gets one row in job_file_reads,
   used or not and why; a set of drawings or a spec goes into the job's
   Plans, and its read is started here on the server, so it never waits on
   a browser that may have gone. A file seen before is left alone, and the
   same bytes again point at the first. Service role; the doors gate. */

/** What a job has taken in, for "Scope built from". */
export type TakenFile = {
  id: string;
  documentId: string | null;
  attachmentId: string | null;
  name: string;
  sort: TakeSort;
  why: string;
  planId: string | null;
  readAt: string;
};

type ReadRow = { id: string; document_id: string | null; attachment_id: string | null; file_name: string; sort: TakeSort; why: string; plan_id: string | null; read_at: string };

/** The job's files as taken in, newest first; null when they can't be read
    (a workspace without the table yet). */
export async function readTakenFiles(orgId: string, jobUuid: string): Promise<TakenFile[] | null> {
  const { data, error } = await supabaseAdmin
    .from("job_file_reads")
    .select("id, document_id, attachment_id, file_name, sort, why, plan_id, read_at")
    .eq("org_id", orgId)
    .eq("job_uuid", jobUuid)
    .order("read_at", { ascending: false });
  if (error) return null;
  return ((data ?? []) as ReadRow[]).map((r) => ({
    id: r.id,
    documentId: r.document_id,
    attachmentId: r.attachment_id,
    name: r.file_name,
    sort: r.sort,
    why: r.why,
    planId: r.plan_id,
    readAt: r.read_at,
  }));
}

/** The business's own names, for knowing our own paperwork. */
async function ownNames(orgId: string): Promise<string[]> {
  const { data } = await supabaseAdmin.from("organizations").select("trading_name, name").eq("id", orgId).maybeSingle();
  const o = data as { trading_name: string | null; name: string | null } | null;
  return [o?.trading_name, o?.name].filter((n): n is string => !!n && n.trim().length >= 3);
}

async function siteOf(orgId: string, jobUuid: string): Promise<string> {
  const { data } = await supabaseAdmin.from("sm8_jobs").select("job_address").eq("org_id", orgId).eq("uuid", jobUuid).maybeSingle();
  return ((data as { job_address: string | null } | null)?.job_address ?? "").trim();
}

const keyOf = (pick: PlanPick) => ("documentId" in pick ? { col: "document_id", id: pick.documentId } : { col: "attachment_id", id: pick.attachmentId });

/** The plan a file already is on this job, if Add plans put it there. */
async function planOfFile(orgId: string, jobUuid: string, pick: PlanPick): Promise<string | null> {
  const k = keyOf(pick);
  const { data } = await supabaseAdmin.from("job_plans").select("id").eq("org_id", orgId).eq("job_uuid", jobUuid).eq(k.col, k.id).maybeSingle();
  return (data as { id: string } | null)?.id ?? null;
}

/** The files into the job, each once: sorted by its own words, a set of
    drawings or a spec into Plans. Returns the plans newly added, whose reads
    the caller starts (startPlanReads). Never throws: a file that can't be
    read says so on its row. */
export async function takeInFiles(orgId: string, jobUuid: string, picks: readonly PlanPick[], staffId: string | null): Promise<{ planIds: string[] }> {
  const planIds: string[] = [];
  let own: string[] | null = null;
  let site: string | null = null;
  for (const pick of picks.slice(0, 20)) {
    const k = keyOf(pick);
    try {
      const { data: seen, error: seenErr } = await supabaseAdmin.from("job_file_reads").select("id").eq("org_id", orgId).eq(k.col, k.id).maybeSingle();
      if (seenErr || seen) continue;
      const file = await fileFor(orgId, jobUuid, pick);
      /* a picture of a plan goes in by a press; anything not a PDF isn't read here */
      if (!file || kindOf(file) !== "pdf") continue;
      const row = { id: newId("jread"), org_id: orgId, job_uuid: jobUuid, document_id: k.col === "document_id" ? k.id : null, attachment_id: k.col === "attachment_id" ? k.id : null, file_name: file.name };
      const { data: blob, error: dlErr } = await supabaseAdmin.storage.from(DOCUMENTS_BUCKET).download(file.ref);
      if (dlErr || !blob) {
        await supabaseAdmin.from("job_file_reads").insert({ ...row, sort: "failed", why: "Its file couldn't be opened" });
        continue;
      }
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      /* the same bytes again, by another door: the first one stands */
      const { data: twin } = await supabaseAdmin
        .from("job_file_reads")
        .select("file_name, plan_id")
        .eq("org_id", orgId)
        .eq("job_uuid", jobUuid)
        .eq("sha256", sha256)
        .neq("sort", "same")
        .limit(1)
        .maybeSingle();
      if (twin) {
        const t = twin as { file_name: string; plan_id: string | null };
        await supabaseAdmin.from("job_file_reads").insert({ ...row, sha256, sort: "same", why: `The same file as ${t.file_name}, read already`, plan_id: t.plan_id });
        continue;
      }
      own ??= await ownNames(orgId);
      site ??= await siteOf(orgId, jobUuid);
      const doc = await openPdf(bytes);
      let sorted: { sort: TakeSort; why: string };
      try {
        const pages: PdfPage[] = [];
        for (let n = 1; n <= Math.min(doc.numPages, SORT_PAGES); n++) {
          const size = (await doc.pageSize?.(n)) ?? { w: 595, h: 842 };
          pages.push({ ...size, text: await doc.pageText(n) });
        }
        sorted = sortPdf(pages, { own, site, pageCount: doc.numPages, title: (await doc.title?.()) ?? null });
      } finally {
        await doc.destroy();
      }
      /* pressed into Plans by hand (Add plans, the email card's tick): the press stands */
      const pressed = await planOfFile(orgId, jobUuid, pick);
      if (pressed && sorted.sort !== "drawings" && sorted.sort !== "spec") sorted = { sort: "drawings", why: "Put in Plans by hand" };
      let planId: string | null = null;
      if (sorted.sort === "drawings" || sorted.sort === "spec") {
        planId = pressed;
        if (!planId) {
          const added = await addJobPlans(orgId, jobUuid, [pick], staffId, sorted.sort === "spec" ? "spec" : "drawings");
          if (added.ok && added.planIds[0]) {
            planId = added.planIds[0];
            planIds.push(planId);
          }
        } else if (sorted.sort === "spec") {
          /* pressed in by hand as plans, but it reads as a specification */
          await supabaseAdmin.from("job_plans").update({ kind: "spec" }).eq("org_id", orgId).eq("id", planId).eq("state", "reading");
        }
      }
      await supabaseAdmin.from("job_file_reads").insert({ ...row, sha256, sort: sorted.sort, why: sorted.why, plan_id: planId });
    } catch (e) {
      console.error(`[take-in] ${k.id}: ${String(e)}`);
      await supabaseAdmin
        .from("job_file_reads")
        .insert({ id: newId("jread"), org_id: orgId, job_uuid: jobUuid, [k.col]: k.id, file_name: "File", sort: "failed", why: "It couldn't be read" })
        .then(
          () => {},
          () => {},
        );
    }
  }
  return { planIds };
}

/** Where this request came from, so the server can ask its own read route. */
export async function requestOrigin(): Promise<string | null> {
  const h = await headers().catch(() => null);
  const host = h?.get("x-forwarded-host") ?? h?.get("host");
  if (!host) return null;
  const proto = h?.get("x-forwarded-proto") ?? (/^(localhost|127\.0\.0\.1)(:|$)/.test(host) ? "http" : "https");
  return `${proto}://${host}`;
}

/** Each plan's read started, from the server: the read route is asked with
    a signed ticket and let go, since the read writes its row as it goes. */
export async function startPlanReads(orgId: string, planIds: readonly string[], origin: string | null): Promise<void> {
  if (!origin || planIds.length === 0) return;
  await Promise.all(
    planIds.map(async (planId) => {
      const stop = new AbortController();
      const timer = setTimeout(() => stop.abort(), 4_000);
      await fetch(`${origin}/api/jobs/plans/read`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-plan-read": signPlanReadTicket({ orgId, planId }) },
        body: JSON.stringify({ planId }),
        signal: stop.signal,
      }).catch(() => {});
      clearTimeout(timer);
    }),
  );
}

/** The doors' one call, after the answer has gone: the files taken in, and
    the new plans' reads begun. Outside a request (a test, a script) there is
    nothing to hang the work on, and it isn't done. */
export async function takeInAfter(orgId: string, jobUuid: string, picks: readonly PlanPick[], staffId: string | null): Promise<void> {
  if (picks.length === 0) return;
  const origin = await requestOrigin();
  try {
    after(() => takeInAndRead(orgId, jobUuid, picks, staffId, origin));
  } catch {
    /* no request to run after */
  }
}

/** The files taken in, and the new plans' reads begun. */
export async function takeInAndRead(orgId: string, jobUuid: string, picks: readonly PlanPick[], staffId: string | null, origin: string | null): Promise<void> {
  const { planIds } = await takeInFiles(orgId, jobUuid, picks, staffId);
  await startPlanReads(orgId, planIds, origin);
}
