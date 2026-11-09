import "server-only";
import { supabaseAdmin } from "@/lib/supabase-server";
import { DOCUMENTS_BUCKET } from "@/lib/documents/query";
import { ALLOWED_TYPES, storageRef } from "@/lib/documents/files";
import type { KeptFile } from "./inbound-server";
import { writeJobNote } from "@/lib/workboard/job-note-write";
import type { EmailProposal } from "./proposal";
import { withClientNow } from "./proposal-server";
import { shareLinksIn, type ShareLink } from "./share-links";
import { addJobPlans } from "@/lib/jobs/plans-server";

/* An email to Tiff, after its card: what the card shows, and a job made from
   it. The job's files: each kept PDF and picture copied onto the job's
   Documents as the person's own upload (the studio's design-to-job does the
   same), so the quote's Read the job and Tiff's look_at have the drawings.
   Nothing half-made is left: no row without its file. Service role; the
   actions gate. */

export type EmailJobView = {
  id: string;
  state: "received" | "read" | "made" | "filed" | "not_a_job" | "refused" | "failed";
  proposal: EmailProposal | null;
  /** `drawings`: Tiff read it as a set of drawings, so the card offers it for the job's Plans */
  files: { name: string; size: number; drawings: boolean }[];
  /** the plans it points to rather than carries (share-links.ts) */
  links: ShareLink[];
  /** what couldn't be kept, in words */
  why: string | null;
  jobUuid: string | null;
  jobNumber: string | null;
  fromName: string | null;
  receivedAt: string;
  /** what the email said, as the Inbox shows it under Tiff's read */
  subject: string | null;
  body: string | null;
};

type Row = {
  id: string;
  org_id: string;
  state: EmailJobView["state"];
  proposal: EmailProposal | null;
  files: KeptFile[] | null;
  why: string | null;
  job_uuid: string | null;
  from_name: string | null;
  received_at: string;
  subject: string | null;
  body: string | null;
};

const COLS = "id, org_id, state, proposal, files, why, job_uuid, from_name, received_at, subject, body";

export async function readEmailRow(orgId: string, id: string): Promise<Row | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const { data } = await supabaseAdmin.from("email_in_messages").select(COLS).eq("org_id", orgId).eq("id", id).maybeSingle();
  return (data as Row | null) ?? null;
}

export async function emailJobView(orgId: string, id: string): Promise<EmailJobView | null> {
  const row = await readEmailRow(orgId, id);
  if (!row) return null;
  let jobNumber: string | null = null;
  if (row.job_uuid) {
    const { data } = await supabaseAdmin.from("sm8_jobs").select("generated_job_id").eq("org_id", orgId).eq("uuid", row.job_uuid).maybeSingle();
    jobNumber = (data?.generated_job_id as string | null) ?? null;
  }
  return {
    id: row.id,
    state: row.state,
    proposal: row.state === "read" ? await withClientNow(orgId, row.proposal) : row.proposal,
    files: (row.files ?? []).map((f) => ({ name: f.name, size: f.size, drawings: isDrawings(row.proposal, f) })),
    links: shareLinksIn(row.body),
    why: row.why,
    jobUuid: row.job_uuid,
    jobNumber,
    fromName: row.from_name,
    receivedAt: row.received_at,
    subject: row.subject,
    body: row.body,
  };
}

/** Whether Tiff read a kept file as drawings of the building: named in her
    read, or a PDF whose name says plans. */
export function isDrawings(p: EmailProposal | null, f: { name: string; contentType: string }): boolean {
  const named = (p?.drawings ?? []).some((n) => n.trim().toLowerCase() === f.name.trim().toLowerCase());
  return named || (f.contentType === "application/pdf" && /\b(plans?|drawings?|architectural|floor|da set|cc set)\b/i.test(f.name));
}

export type FiledFile = { name: string; documentId: string };

/** The email's kept files, onto the job's Documents: each that went on. */
export async function fileOnJob(orgId: string, row: Row, jobUuid: string, staffId: string | null): Promise<FiledFile[]> {
  const filed: FiledFile[] = [];
  for (const f of row.files ?? []) {
    const ext = ALLOWED_TYPES[f.contentType];
    if (!ext) continue;
    const { data: doc, error } = await supabaseAdmin
      .from("documents")
      .insert({
        org_id: orgId,
        kind: "job_document",
        storage_ref: `org/${orgId}/pending/${crypto.randomUUID()}`,
        file_name: f.name,
        mime_type: f.contentType,
        size_bytes: f.size,
        uploaded_by: staffId,
        sm8_job_uuid: jobUuid,
      })
      .select("id")
      .maybeSingle();
    if (error || !doc) continue;
    const documentId = String(doc.id);
    const ref = storageRef(orgId, "job_document", documentId, ext);
    const copied = await supabaseAdmin.storage.from(DOCUMENTS_BUCKET).copy(f.path, ref);
    const landed =
      !copied.error &&
      !(await supabaseAdmin.from("documents").update({ storage_ref: ref, uploaded_at: new Date().toISOString() }).eq("org_id", orgId).eq("id", documentId)).error;
    if (!landed) {
      if (!copied.error) await supabaseAdmin.storage.from(DOCUMENTS_BUCKET).remove([ref]);
      await supabaseAdmin.from("documents").delete().eq("org_id", orgId).eq("id", documentId);
      continue;
    }
    filed.push({ name: f.name, documentId });
  }
  return filed;
}

/** The email made into a job: its files on the job, the row says so. Once:
    a second call finds it made and files nothing again. */
export async function markMade(orgId: string, id: string, jobUuid: string, by: string, staffId: string | null): Promise<boolean> {
  const row = await readEmailRow(orgId, id);
  if (!row) return false;
  if (row.state === "made" || row.state === "filed") return row.job_uuid === jobUuid;
  const { data: claimed } = await supabaseAdmin
    .from("email_in_messages")
    .update({ state: "made", job_uuid: jobUuid, decided_by: by, decided_at: new Date().toISOString() })
    .eq("org_id", orgId)
    .eq("id", id)
    .not("state", "in", "(filed,made)")
    .select("id");
  if (!claimed?.length) return true;
  await fileOnJob(orgId, row, jobUuid, staffId);
  return true;
}

/** What goes on the job's notes from an email filed on it: whose it was and
    what it said, in the 4,000 characters a note holds. */
export function noteOfEmail(row: { subject: string | null; body: string | null; from_name: string | null; proposal: EmailProposal | null }): string {
  const p = row.proposal;
  const who = p ? [[p.contact.first, p.contact.last].filter(Boolean).join(" "), p.client].filter(Boolean).join(", ") : "";
  const head = `Email${who ? ` from ${who}` : ""}${row.from_name ? `, forwarded to Tiff by ${row.from_name}` : ""}: ${row.subject ?? ""}`.trim();
  const out = `${head}\n\n${row.body ?? ""}`.trim();
  return out.length > 4000 ? out.slice(0, 4000).trimEnd() : out;
}

/** `planned`: the names of the files that went into the job's Plans */
export type FiledOutcome = { ok: boolean; planIds: string[]; planned: string[] };

/** The email filed on a job already here: its files on the job's Documents and
    its words on the job's notes (one note, however often it's pressed: the
    email's own id is the pen's). The files named in `plans` go into the
    job's Plans as well, each a plan to be read (lib/jobs/plans-server.ts);
    the caller starts the reads. Once: a second call finds it filed. */
export async function markFiled(orgId: string, id: string, jobUuid: string, userId: string, staffId: string | null, plans: readonly string[] = []): Promise<FiledOutcome> {
  const row = await readEmailRow(orgId, id);
  if (!row) return { ok: false, planIds: [], planned: [] };
  if (row.state === "filed" || row.state === "made") return { ok: row.job_uuid === jobUuid, planIds: [], planned: [] };
  const { data: real } = await supabaseAdmin.from("sm8_jobs").select("uuid").eq("org_id", orgId).eq("uuid", jobUuid).maybeSingle();
  if (!real) return { ok: false, planIds: [], planned: [] };
  const { data: claimed } = await supabaseAdmin
    .from("email_in_messages")
    .update({ state: "filed", job_uuid: jobUuid, decided_by: userId, decided_at: new Date().toISOString() })
    .eq("org_id", orgId)
    .eq("id", id)
    .not("state", "in", "(filed,made)")
    .select("id");
  if (!claimed?.length) return { ok: true, planIds: [], planned: [] };
  const filed = await fileOnJob(orgId, row, jobUuid, staffId);
  await writeJobNote({ orgId, userId, jobUuid, body: noteOfEmail(row), composeId: row.id }).catch((err) =>
    console.error("[email-in] the email's note couldn't go on the job:", err instanceof Error ? err.message : err)
  );
  const wanted = new Set(plans.map((n) => n.trim().toLowerCase()));
  const going = filed.filter((f) => wanted.has(f.name.trim().toLowerCase()));
  if (going.length === 0) return { ok: true, planIds: [], planned: [] };
  const added = await addJobPlans(orgId, jobUuid, going.map((f) => ({ documentId: f.documentId })), staffId).catch(() => null);
  if (added?.ok) return { ok: true, planIds: added.planIds, planned: going.map((f) => f.name) };
  console.error("[email-in] the drawings couldn't go into Plans:", added && !added.ok ? added.error : "the add threw");
  return { ok: true, planIds: [], planned: [] };
}

export async function markNotAJob(orgId: string, id: string, by: string): Promise<boolean> {
  const { error } = await supabaseAdmin
    .from("email_in_messages")
    .update({ state: "not_a_job", decided_by: by, decided_at: new Date().toISOString() })
    .eq("org_id", orgId)
    .eq("id", id)
    .in("state", ["read", "received", "failed"]);
  return !error;
}
