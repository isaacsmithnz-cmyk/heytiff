import "server-only";
import { supabaseAdmin } from "@/lib/supabase-server";
import { DOCUMENTS_BUCKET } from "@/lib/documents/query";
import { ALLOWED_TYPES, storageRef } from "@/lib/documents/files";
import type { KeptFile } from "./inbound-server";
import { writeJobNote } from "@/lib/workboard/job-note-write";
import type { EmailProposal } from "./proposal";
import { shareLinksIn, type ShareLink } from "./share-links";

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
  files: { name: string; size: number }[];
  /** the plans it points to rather than carries (share-links.ts) */
  links: ShareLink[];
  /** what couldn't be kept, in words */
  why: string | null;
  jobUuid: string | null;
  jobNumber: string | null;
  fromName: string | null;
  receivedAt: string;
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
    proposal: row.proposal,
    files: (row.files ?? []).map((f) => ({ name: f.name, size: f.size })),
    links: shareLinksIn(row.body),
    why: row.why,
    jobUuid: row.job_uuid,
    jobNumber,
    fromName: row.from_name,
    receivedAt: row.received_at,
  };
}

/** The email's kept files, onto the job's Documents. How many went on. */
export async function fileOnJob(orgId: string, row: Row, jobUuid: string, staffId: string | null): Promise<number> {
  let filed = 0;
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
    filed++;
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

/** The email filed on a job already here: its files on the job's Documents and
    its words on the job's notes (one note, however often it's pressed: the
    email's own id is the pen's). Once: a second call finds it filed. */
export async function markFiled(orgId: string, id: string, jobUuid: string, userId: string, staffId: string | null): Promise<boolean> {
  const row = await readEmailRow(orgId, id);
  if (!row) return false;
  if (row.state === "filed" || row.state === "made") return row.job_uuid === jobUuid;
  const { data: real } = await supabaseAdmin.from("sm8_jobs").select("uuid").eq("org_id", orgId).eq("uuid", jobUuid).maybeSingle();
  if (!real) return false;
  const { data: claimed } = await supabaseAdmin
    .from("email_in_messages")
    .update({ state: "filed", job_uuid: jobUuid, decided_by: userId, decided_at: new Date().toISOString() })
    .eq("org_id", orgId)
    .eq("id", id)
    .not("state", "in", "(filed,made)")
    .select("id");
  if (!claimed?.length) return true;
  await fileOnJob(orgId, row, jobUuid, staffId);
  await writeJobNote({ orgId, userId, jobUuid, body: noteOfEmail(row), composeId: row.id }).catch((err) =>
    console.error("[email-in] the email's note couldn't go on the job:", err instanceof Error ? err.message : err)
  );
  return true;
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
