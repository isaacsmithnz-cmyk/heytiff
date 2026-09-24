import { auth0 } from "@/lib/auth0";
import { supabaseAdmin } from "@/lib/supabase-server";
import { can } from "@/lib/permissions-server";
import { staffProfileIdFor } from "@/lib/fleet/query";
import { todayInAu } from "@/lib/au-dates";
import { orgExpiryWindow } from "@/lib/org/query";
import { familyMediaSources } from "@/lib/workboard/all-jobs-query";
import { readJobPapers } from "./query";
import {
  attachmentName,
  ourDocumentSendKey,
  paperLabel,
  paperSendKey,
  theirFileSendKey,
  withExtension,
  type PaperChoice,
  type SendPicks,
} from "./papers";

/* WHAT A TICK ON THE DOCUMENTS FACE RESOLVES TO, for whatever sends it.

   The face's ticks leave by two doors now: an email (app/actions/
   job-compliance) and ServiceM8 (app/actions/job-sm8). Both ask the same two
   questions first, who is asking and which files do those ticks name, and
   the answers must be the same whichever door they take: a ticket goes only
   where its scan may open for the sender, an expired certificate goes
   nowhere, and every id from the browser is re-resolved on THIS job in THIS
   org.

   A LIBRARY, NOT A SERVER FUNCTION FILE, and that is the point of moving it
   here. Anything exported from a "use server" module is a POST-able
   endpoint; `outgoing` takes a context the caller has already checked, and
   must never be reachable with one the browser made up. */

export type ComplianceCtx = {
  orgId: string;
  userId: string;
  staffId: string | null;
  /** `workboard_manage`: the business's papers, and sending. */
  company: boolean;
  /** `team`: people's tickets. */
  team: boolean;
};

export async function complianceContext(): Promise<ComplianceCtx | null> {
  const session = await auth0.getSession();
  const orgId = session?.orgId as string | undefined;
  const userId = session?.user?.sub as string | undefined;
  if (!orgId || !userId) return null;
  if (!(await can("workboard"))) return null;
  const [company, team, staffId] = await Promise.all([
    can("workboard_manage"),
    can("team"),
    staffProfileIdFor(orgId, userId),
  ]);
  return { orgId, userId, staffId, company, team };
}

export const trimId = (v: unknown) => String(v ?? "").trim().slice(0, 80);

export async function clock(orgId: string): Promise<{ today: string; warnDays: number }> {
  const { warnDays } = await orgExpiryWindow(orgId);
  return { today: todayInAu(), warnDays };
}

/** The id came from a browser, so it names a CHOICE — this decides whether it
    is a real job in this workspace's mirror. */
export async function jobIsReal(orgId: string, job: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from("sm8_jobs")
    .select("uuid")
    .eq("org_id", orgId)
    .eq("uuid", job)
    .maybeSingle();
  return !!data;
}

export const whose = (c: Pick<PaperChoice, "name" | "person">) => (c.person ? `${c.person}'s ${c.name}` : c.name);

/** One file on its way out: the bytes (by their place in the bucket), the
    name it leaves under, and where on the card it was ticked. */
export type Outgoing = {
  ref: string;
  size: number;
  name: string;
  /** The documents row the bytes are filed under. */
  documentId: string;
  mimeType: string;
  /** The tick it came from — see lib/compliance/papers' send keys. */
  key: string;
};

/** Everything ticked, as files the server may send: each re-resolved on THIS
    job in THIS org, and a ticket only where its scan may open for the sender. */
export async function outgoing(
  ctx: ComplianceCtx,
  job: string,
  picks: SendPicks
): Promise<{ ok: true; files: Outgoing[]; labels: string[] } | { ok: false; error: string }> {
  const files: Outgoing[] = [];
  const labels: string[] = [];
  const gone = { ok: false as const, error: "One of those is no longer on the job. Close the card and open it again." };

  if (picks.papers.length > 0) {
    const { today, warnDays } = await clock(ctx.orgId);
    const papers = await readJobPapers(ctx.orgId, job, {
      staffId: ctx.staffId,
      company: ctx.company,
      team: ctx.team,
      today,
      warnDays,
    });
    const picked: { paper: (typeof papers)[number]; file: (typeof papers)[number]["files"][number]; i: number; n: number }[] = [];
    for (const id of picks.papers) {
      const paper = papers.find((p) => p.id === id);
      if (!paper) return gone;
      /* the face offers no tick for these; the same answer for a POST that
         skipped the face */
      if (paper.state === "bad") {
        return { ok: false, error: `${whose(paper)} on this job has expired. Use the renewal, or untick it.` };
      }
      const open = paper.files.filter((f) => f.url);
      if (open.length === 0) return { ok: false, error: `You can't send ${whose(paper)}.` };
      open.forEach((file, i) => picked.push({ paper, file, i, n: open.length }));
      labels.push(paperLabel(paper));
    }
    const { data } = await supabaseAdmin
      .from("documents")
      .select("id, storage_ref, size_bytes, mime_type")
      .eq("org_id", ctx.orgId)
      .in(
        "id",
        picked.map((p) => p.file.id)
      );
    const refs = new Map(
      ((data ?? []) as { id: string; storage_ref: string; size_bytes: number | null; mime_type: string }[]).map((r) => [
        r.id,
        r,
      ])
    );
    for (const p of picked) {
      const row = refs.get(p.file.id);
      if (!row) return gone;
      files.push({
        ref: row.storage_ref,
        size: Number(row.size_bytes) || 0,
        name: attachmentName(p.paper, p.file, p.i, p.n),
        documentId: row.id,
        mimeType: row.mime_type,
        key: paperSendKey(p.paper.id),
      });
    }
  }

  type DocRow = {
    id: string;
    storage_ref: string;
    file_name: string;
    mime_type: string;
    size_bytes: number | null;
    remote_ref?: string | null;
  };
  const take = (rows: DocRow[], keyOf: (r: DocRow) => string) => {
    for (const r of rows) {
      files.push({
        ref: r.storage_ref,
        size: Number(r.size_bytes) || 0,
        name: withExtension(r.file_name, r.mime_type),
        documentId: r.id,
        mimeType: r.mime_type,
        key: keyOf(r),
      });
      labels.push(r.file_name);
    }
  };

  if (picks.documents.length > 0) {
    const { data } = await supabaseAdmin
      .from("documents")
      .select("id, storage_ref, file_name, mime_type, size_bytes")
      .eq("org_id", ctx.orgId)
      .eq("kind", "job_document")
      .eq("sm8_job_uuid", job)
      .in("id", picks.documents)
      .not("uploaded_at", "is", null);
    const rows = (data ?? []) as DocRow[];
    if (rows.length !== picks.documents.length) return gone;
    take(rows, (r) => ourDocumentSendKey(r.id));
  }

  if (picks.files.length > 0) {
    /* ServiceM8's own files, from the copies cached here — the card gathers
       a job's claims' files onto it, so the family is where they may be */
    const family = [job, ...(await familyMediaSources(ctx.orgId, job)).map((s) => s.remoteId)];
    const { data } = await supabaseAdmin
      .from("documents")
      .select("id, storage_ref, file_name, mime_type, size_bytes, remote_ref")
      .eq("org_id", ctx.orgId)
      .eq("source", "servicem8")
      .in("sm8_job_uuid", family)
      .in("remote_ref", picks.files)
      .not("uploaded_at", "is", null);
    const rows = (data ?? []) as DocRow[];
    if (rows.length !== picks.files.length) {
      return { ok: false, error: "One of ServiceM8's files hasn't been brought across yet. Untick it and send the rest." };
    }
    take(rows, (r) => theirFileSendKey(r.remote_ref ?? ""));
  }

  return { ok: true, files, labels };
}
