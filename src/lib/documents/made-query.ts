/* What the Documents list loads (v2, /dashboard/documents), server only.

   Today's reads, each as its own screen makes it: the job card's SWMS and
   certificates (listJobSwms, listJobCerts, read here for the whole
   workspace by the same engine), Admin's letters (listLetters, with its
   own rule for who may open one), the Projects list (listProjects) for the
   and handover sheets. No new tables. Templates live in Settings, not here
   (Isaac, 20 October).

   The page gates with can("workboard") before calling this: the SWMS, the
   certificates and the handover sheets are the Workboard's today. Letters
   stay admin and up, as Admin's list was; below that the kind is absent,
   held back here on the server (F-224). */

import { auth0 } from "@/lib/auth0";
import { getDbRole } from "@/lib/permissions-server";
import { hasMinRole } from "@/lib/roles-shared";
import { supabaseAdmin } from "@/lib/supabase-server";
import { inChunks } from "@/lib/in-chunks";
import { auDayOf, todayInAu } from "@/lib/au-dates";
import { listOrgSwms } from "@/lib/swms/query";
import { listOrgCerts } from "@/lib/certs/query";
import { listLetters } from "@/lib/letters/query";
import { listProjects, staffIdFor } from "@/lib/workboard/projects-query";
import { jobHue } from "@/lib/workboard/job-hue";
import {
  certRow,
  handoverRow,
  jobLabel,
  letterRow,
  swmsRow,
  type DocJob,
  type DocKind,
  type DocRow,
} from "./made";

export type DocumentsData = {
  rows: DocRow[];
  /** The kinds this reader sees, in the views' order. */
  kinds: DocKind[];
  today: string;
  /** Make a document › Letter: admin and up, as Admin's letters were. */
  canWriteLetters: boolean;
};


type JobRow = {
  uuid: string;
  generated_job_id: string | null;
  status: string | null;
  company_uuid: string | null;
  category_uuid: string | null;
  geo_city: string | null;
};
const JOB_COLUMNS = "uuid, generated_job_id, status, company_uuid, category_uuid, geo_city";

/** The jobs these documents are on, from the mirror, by uuid and by the job
    numbers a project carries: "3342 Rifkin, Bellevue Hill" and the job's
    colour, as the Jobs list names and colours them. */
async function readJobs(orgId: string, uuids: readonly string[], numbers: readonly string[]): Promise<{ byUuid: Map<string, DocJob>; byNumber: Map<string, DocJob> }> {
  const [byU, byN] = await Promise.all([
    inChunks([...new Set(uuids.filter(Boolean))], 200, async (chunk) => {
      const { data } = await supabaseAdmin.from("sm8_jobs").select(JOB_COLUMNS).eq("org_id", orgId).in("uuid", chunk);
      return (data ?? []) as JobRow[];
    }),
    inChunks([...new Set(numbers.filter(Boolean))], 200, async (chunk) => {
      const { data } = await supabaseAdmin.from("sm8_jobs").select(JOB_COLUMNS).eq("org_id", orgId).in("generated_job_id", chunk);
      return (data ?? []) as JobRow[];
    }),
  ]);
  const rows = [...byU, ...byN];
  const companyIds = [...new Set(rows.map((r) => r.company_uuid).filter((x): x is string => !!x))];
  const categoryIds = [...new Set(rows.map((r) => r.category_uuid).filter((x): x is string => !!x))];
  const [companies, categories] = await Promise.all([
    inChunks(companyIds, 200, async (chunk) => {
      const { data } = await supabaseAdmin.from("sm8_companies").select("uuid, name").eq("org_id", orgId).in("uuid", chunk);
      return (data ?? []) as { uuid: string; name: string | null }[];
    }),
    inChunks(categoryIds, 200, async (chunk) => {
      const { data } = await supabaseAdmin.from("sm8_categories").select("uuid, colour").eq("org_id", orgId).in("uuid", chunk);
      return (data ?? []) as { uuid: string; colour: string | null }[];
    }),
  ]);
  const clientOf = new Map(companies.map((c) => [c.uuid, c.name?.trim() || null]));
  const colourOf = new Map(categories.map((c) => [c.uuid, c.colour]));
  const jobOf = (r: JobRow): DocJob => ({
    label: jobLabel(r.generated_job_id, r.company_uuid ? clientOf.get(r.company_uuid) ?? null : null, r.geo_city),
    hue: jobHue(r.category_uuid ? colourOf.get(r.category_uuid) : null, (r.status ?? "").trim().toLowerCase() === "unsuccessful"),
  });
  return {
    byUuid: new Map(byU.map((r) => [r.uuid, jobOf(r)])),
    byNumber: new Map(byN.filter((r) => r.generated_job_id).map((r) => [r.generated_job_id!, jobOf(r)])),
  };
}

/** Each project's handover checks: its checklist's Handover section, the
    rows the sheet prints (handover/[id]). */
async function readHandoverChecks(orgId: string, projectIds: readonly string[]): Promise<Map<string, { done: number; total: number }>> {
  const rows = await inChunks([...projectIds], 200, async (chunk) => {
    const { data } = await supabaseAdmin
      .from("project_checklist_items")
      .select("project_id, done")
      .eq("org_id", orgId)
      .eq("section", "Handover")
      .in("project_id", chunk);
    return (data ?? []) as { project_id: string; done: boolean }[];
  });
  const out = new Map<string, { done: number; total: number }>();
  for (const r of rows) {
    const c = out.get(r.project_id) ?? { done: 0, total: 0 };
    c.total += 1;
    if (r.done) c.done += 1;
    out.set(r.project_id, c);
  }
  return out;
}

export async function loadDocuments(): Promise<DocumentsData | null> {
  const session = await auth0.getSession();
  const orgId = session?.orgId as string | undefined;
  const userId = session?.user?.sub as string | undefined;
  if (!orgId || !userId) return null;

  const role = await getDbRole();
  const letters = hasMinRole(role, "admin");

  const [swms, certs, projects, letterList] = await Promise.all([
    listOrgSwms(orgId),
    listOrgCerts(orgId),
    listProjects(orgId, { includeArchived: false }),
    letters
      ? staffIdFor(orgId, userId).then((staffId) => listLetters(orgId, { staffId, isOwner: hasMinRole(role, "owner") }))
      : Promise.resolve([]),
  ]);

  const [jobs, checks] = await Promise.all([
    readJobs(
      orgId,
      [...swms.map((s) => s.jobUuid), ...certs.map((c) => c.jobUuid)],
      projects.map((p) => p.jobNumbers[0] ?? ""),
    ),
    readHandoverChecks(
      orgId,
      projects.map((p) => p.id),
    ),
  ]);

  const rows: DocRow[] = [
    ...swms.map((s) => swmsRow(s, jobs.byUuid.get(s.jobUuid) ?? null, auDayOf)),
    ...certs.map((c) => certRow(c, jobs.byUuid.get(c.jobUuid) ?? null, auDayOf)),
    ...letterList.map((l) => letterRow(l, auDayOf)),
    ...projects.map((p) => {
      const n = p.jobNumbers[0] ?? null;
      const job = (n && jobs.byNumber.get(n)) || { label: jobLabel(n, p.clientName, p.siteLabel), hue: null };
      return handoverRow(p, checks.get(p.id) ?? { done: 0, total: 0 }, job, auDayOf);
    }),
  ];

  return {
    rows,
    kinds: letters ? ["swms", "certificate", "letter", "handover"] : ["swms", "certificate", "handover"],
    today: todayInAu(),
    canWriteLetters: letters,
  };
}
