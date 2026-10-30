import "server-only";
import { supabaseAdmin } from "@/lib/supabase-server";
import { inboxOf, type InboxEmail, type InboxRowIn } from "./inbox";
import type { EmailProposal } from "./proposal";

/* The Inbox's rows (inbox.ts says them): the business's emails to Tiff from
   the last ninety days, the job each became, and who forwarded each, by the
   name the team knows them by. Service role; the page gates on `tiff`. */

const LOOK_DAYS = 90;
const MAX = 100;

export async function readInbox(orgId: string, me: string | null): Promise<InboxEmail[]> {
  const since = new Date(Date.now() - LOOK_DAYS * 24 * 3600 * 1000).toISOString();
  const { data, error } = await supabaseAdmin
    .from("email_in_messages")
    .select("id, subject, received_at, state, proposal, sender_sub, job_uuid")
    .eq("org_id", orgId)
    .neq("state", "refused")
    .gte("received_at", since)
    .order("received_at", { ascending: false })
    .limit(MAX);
  if (error || !data) return [];
  const rows = data as {
    id: string;
    subject: string | null;
    received_at: string;
    state: InboxRowIn["state"];
    proposal: EmailProposal | null;
    sender_sub: string | null;
    job_uuid: string | null;
  }[];

  const jobUuids = [...new Set(rows.map((r) => r.job_uuid).filter((u): u is string => Boolean(u)))];
  const subs = [...new Set(rows.map((r) => r.sender_sub).filter((s): s is string => Boolean(s)))];
  const [jobs, people] = await Promise.all([
    jobUuids.length
      ? supabaseAdmin.from("sm8_jobs").select("uuid, generated_job_id").eq("org_id", orgId).in("uuid", jobUuids)
      : Promise.resolve({ data: [] }),
    subs.length
      ? supabaseAdmin.from("staff_profiles").select("user_id, preferred_name, first_name, full_name").eq("org_id", orgId).in("user_id", subs)
      : Promise.resolve({ data: [] }),
  ]);
  const numbers = new Map(((jobs.data ?? []) as { uuid: string; generated_job_id: string | null }[]).map((j) => [j.uuid, j.generated_job_id]));
  const names = new Map<string, string>();
  for (const p of (people.data ?? []) as { user_id: string | null; preferred_name: string | null; first_name: string | null; full_name: string | null }[]) {
    const name = p.preferred_name?.trim() || p.first_name?.trim() || p.full_name?.trim();
    if (p.user_id && name) names.set(p.user_id, name);
  }
  return inboxOf(
    rows.map((r) => ({ ...r, jobNumber: r.job_uuid ? (numbers.get(r.job_uuid) ?? null) : null })),
    me,
    names
  );
}
