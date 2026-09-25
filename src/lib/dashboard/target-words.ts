import { supabaseAdmin } from "@/lib/supabase-server";
import { issueWhere, type IssueTargetKind } from "./issues";

/* WHERE A THING IS, IN WORDS — for anything that points at a target by a
   kind and an id.

   An issue's target, a diary note's target: each is a kind and an id, which
   is nothing a person can read. Four narrow reads name them — a visit
   through its agreement, an agreement, a project, a ServiceM8 job through
   its company — batched by kind, so a page of fifty rows is at most five
   round trips, never one per row. A target that has gone (a deleted
   project) simply has no words, and the caller says so rather than
   inventing a place.

   Server only. NO SESSION HERE: the caller establishes the right to ask
   (every caller gates it on `workboard`, since each of these tables is the
   board's) and hands in an orgId.

   It was `whereOf` inside ./issues-query. The Tasks face names the target of
   the diary note a task came from the same way, so it moved here rather
   than being written a second time. */

/** One row to name: `key` is the caller's own id for it, handed back as the
    key of the answer. */
export type TargetRef = {
  key: string;
  target_kind: string;
  target_id: string | null;
};

const KINDS: readonly IssueTargetKind[] = ["none", "project", "visit", "agreement", "job"];

/** A stored kind, narrowed. Anything unknown is `none`, which names nothing. */
export const asTargetKind = (k: string): IssueTargetKind =>
  (KINDS as readonly string[]).includes(k) ? (k as IssueTargetKind) : "none";

type Rec = Record<string, unknown>;
const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

/** key → where it is, for every row whose target could be named. */
export async function targetWords(orgId: string, rows: readonly TargetRef[]): Promise<Map<string, string>> {
  const ids = (kind: IssueTargetKind) =>
    [...new Set(rows.filter((r) => asTargetKind(r.target_kind) === kind && r.target_id).map((r) => r.target_id!))];
  const visitIds = ids("visit");
  const agreementIds = ids("agreement");
  const projectIds = ids("project");
  const jobIds = ids("job");

  /* Visits first: they name the agreements that have to be read as well. */
  const visits = visitIds.length
    ? (
        (
          await supabaseAdmin
            .from("maintenance_visits")
            .select("id, agreement_id, job_number, job_no")
            .eq("org_id", orgId)
            .in("id", visitIds)
        ).data ?? []
      ).map((v) => v as Rec)
    : [];
  const wantAgreements = [
    ...new Set([...agreementIds, ...visits.map((v) => str(v.agreement_id)).filter((x): x is string => !!x)]),
  ];

  const jobs = jobIds.length
    ? (
        (
          await supabaseAdmin
            .from("sm8_jobs")
            .select("uuid, generated_job_id, company_uuid")
            .eq("org_id", orgId)
            .in("uuid", jobIds)
        ).data ?? []
      ).map((j) => j as Rec)
    : [];
  const companyIds = [...new Set(jobs.map((j) => str(j.company_uuid)).filter((x): x is string => !!x))];

  const [agreements, projects, companies] = await Promise.all([
    wantAgreements.length
      ? supabaseAdmin
          .from("maintenance_agreements")
          .select("id, label, client_name")
          .eq("org_id", orgId)
          .in("id", wantAgreements)
      : Promise.resolve({ data: [] as Rec[] }),
    projectIds.length
      ? supabaseAdmin.from("projects").select("id, name, client_name").eq("org_id", orgId).in("id", projectIds)
      : Promise.resolve({ data: [] as Rec[] }),
    companyIds.length
      ? supabaseAdmin.from("sm8_companies").select("uuid, name").eq("org_id", orgId).in("uuid", companyIds)
      : Promise.resolve({ data: [] as Rec[] }),
  ]);

  const agreement = new Map(((agreements.data ?? []) as Rec[]).map((a) => [String(a.id), a]));
  const project = new Map(((projects.data ?? []) as Rec[]).map((p) => [String(p.id), p]));
  const company = new Map(((companies.data ?? []) as Rec[]).map((c) => [String(c.uuid), c]));
  const visit = new Map(visits.map((v) => [String(v.id), v]));
  const job = new Map(jobs.map((j) => [String(j.uuid), j]));

  const out = new Map<string, string>();
  for (const r of rows) {
    if (!r.target_id) continue;
    let words: string | null = null;
    switch (asTargetKind(r.target_kind)) {
      case "visit": {
        const v = visit.get(r.target_id);
        const a = v ? agreement.get(String(v.agreement_id)) : undefined;
        if (v)
          words = issueWhere({
            /* `job_number` is ServiceM8's, `job_no` is ours (#1001 up); either
               answers "which job" — see job-candidates for the same reading. */
            jobNumber: str(v.job_number) ?? (v.job_no == null ? null : String(v.job_no)),
            clientName: a ? str(a.client_name) : null,
            label: a ? str(a.label) : null,
          });
        break;
      }
      case "agreement": {
        const a = agreement.get(r.target_id);
        if (a) words = issueWhere({ clientName: str(a.client_name), label: str(a.label) });
        break;
      }
      case "project": {
        const p = project.get(r.target_id);
        if (p) words = issueWhere({ clientName: str(p.client_name), label: str(p.name) });
        break;
      }
      case "job": {
        const j = job.get(r.target_id);
        if (j)
          words = issueWhere({
            jobNumber: str(j.generated_job_id),
            clientName: str(company.get(str(j.company_uuid) ?? "")?.name),
          });
        break;
      }
      default:
        break;
    }
    if (words) out.set(r.key, words);
  }
  return out;
}
