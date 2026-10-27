import "server-only";

import { supabaseAdmin } from "@/lib/supabase-server";
import { readWriteStatus, subjectDocumentId, type JobSend } from "./sm8-write-plan";

/* WHAT HAS GONE FROM A JOB, BY FILE — the Documents face's lines and a
   job's photos read it. Its own light module, re-exported by sm8-writes, so
   a page's media read doesn't load the sender to say "In ServiceM8". */

/** What has been sent from one job, by file. */
export async function readJobSends(orgId: string, jobUuid: string): Promise<JobSend[]> {
  const { data } = await supabaseAdmin
    .from("sm8_writes")
    .select("subject, status, last_error, attempts, remote_uuid")
    .eq("org_id", orgId)
    .eq("kind", "attachment")
    .eq("sm8_job_uuid", jobUuid)
    .limit(500);
  const out: JobSend[] = [];
  for (const r of (data ?? []) as {
    subject: string;
    status: string;
    last_error: string | null;
    attempts: number | null;
    remote_uuid: string;
  }[]) {
    const documentId = subjectDocumentId(r.subject);
    if (!documentId) continue;
    out.push({
      documentId,
      status: readWriteStatus(r.status),
      error: r.last_error ?? null,
      attempts: r.attempts ?? 0,
      remoteUuid: r.remote_uuid,
    });
  }
  return out;
}
