import "server-only";
import { supabaseAdmin } from "@/lib/supabase-server";
import { sameStreet, streetOf, streetSearch } from "@/lib/address/street";
import { clientScore, clientWords, workWords, type JobNamed, type JobsFound, type NamedJob } from "./note-job";

/* THE JOBS THE WORDS NAME, read from the ServiceM8 mirror (note-job says
   what is found and why). Every status, finished jobs included: a warranty
   call or a builder's callback is about a job that is done. Read only. */

type JobRow = { uuid: string; generated_job_id: string | null; job_address: string | null; status: string | null; company_uuid: string | null; date: string | null; job_description?: string | null };
type CompanyRow = { uuid: string; name: string | null; parent_company_uuid: string | null };

const JOB_COLS = "uuid, generated_job_id, job_address, status, company_uuid, date, job_description";
/** What a job still open is in ServiceM8: a quote, or work accepted and not done. */
const OPEN = ["Quote", "Work Order"];
/** How many of a client's or a place's jobs are read, newest first. */
const JOBS_READ = 40;

const like = (s: string) => s.replace(/[%_\\]/g, (c) => `\\${c}`);

/** The business's clients the words name: the best-scoring names, with
    the sites filed under them. Empty when none answers. */
async function clientsNamed(orgId: string, said: string): Promise<string[]> {
  const words = clientWords(said);
  if (!words.length) return [];
  const { data } = await supabaseAdmin
    .from("sm8_companies")
    .select("uuid, name, parent_company_uuid")
    .eq("org_id", orgId)
    .eq("active", 1)
    .or(words.map((w) => `name.ilike.%${w}%`).join(","))
    .limit(400);
  const rows = (data ?? []) as CompanyRow[];
  const scored = rows.map((c) => ({ c, score: clientScore(said, c.name) })).filter((s) => s.score > 0);
  const best = Math.max(0, ...scored.map((s) => s.score));
  const named = scored.filter((s) => s.score === best).map((s) => s.c.uuid);
  if (!named.length) return [];
  const { data: sites } = await supabaseAdmin
    .from("sm8_companies")
    .select("uuid")
    .eq("org_id", orgId)
    .in("parent_company_uuid", named)
    .limit(400);
  return [...named, ...((sites ?? []) as { uuid: string }[]).map((s) => s.uuid)];
}

/** Who each job is for: its company, or the client a site belongs to. */
async function clientNames(orgId: string, rows: readonly JobRow[]): Promise<Map<string, string>> {
  const ids = [...new Set(rows.map((r) => r.company_uuid).filter((c): c is string => !!c))];
  const names = new Map<string, string>();
  if (!ids.length) return names;
  const { data } = await supabaseAdmin.from("sm8_companies").select("uuid, name, parent_company_uuid").eq("org_id", orgId).in("uuid", ids);
  const companies = (data ?? []) as CompanyRow[];
  const parents = [...new Set(companies.map((c) => c.parent_company_uuid).filter((p): p is string => !!p))];
  const parentNames = new Map<string, string>();
  if (parents.length) {
    const { data: ps } = await supabaseAdmin.from("sm8_companies").select("uuid, name").eq("org_id", orgId).in("uuid", parents);
    for (const p of (ps ?? []) as { uuid: string; name: string | null }[]) if (p.name) parentNames.set(p.uuid, p.name);
  }
  for (const c of companies) names.set(c.uuid, (c.parent_company_uuid ? parentNames.get(c.parent_company_uuid) : null) ?? c.name ?? "");
  return names;
}

/** The jobs the words name: by number when one was said; else the named
    client's jobs, narrowed to the place when one was said; else the jobs at
    the place. A client named and not found finds nothing, rather than every
    job in a suburb. */
export async function findNamedJobs(orgId: string, named: JobNamed): Promise<JobsFound> {
  let rows: JobRow[] = [];
  let noClient = false;
  if (named.number) {
    const { data } = await supabaseAdmin.from("sm8_jobs").select(JOB_COLS).eq("org_id", orgId).eq("active", 1).ilike("generated_job_id", like(named.number)).limit(5);
    rows = (data ?? []) as JobRow[];
  }
  if (!rows.length && (named.client || named.place)) {
    const companies = named.client ? await clientsNamed(orgId, named.client) : [];
    noClient = !!named.client && companies.length === 0;
    if (!noClient) {
      const street = streetOf(named.place);
      let q = supabaseAdmin.from("sm8_jobs").select(JOB_COLS).eq("org_id", orgId).eq("active", 1);
      if (companies.length) q = q.in("company_uuid", companies);
      if (street) {
        const { number, word } = streetSearch(street);
        q = q.ilike("job_address", `%${like(number)}%`).ilike("job_address", `%${like(word)}%`);
      } else if (named.place.length >= 3) {
        q = q.ilike("job_address", `%${like(named.place)}%`);
      }
      if (companies.length || named.place.length >= 3) {
        const { data } = await q.order("date", { ascending: false }).limit(JOBS_READ);
        rows = ((data ?? []) as JobRow[]).filter((r) => !street || sameStreet(streetOf(r.job_address), street));
      }
    }
  }
  /* A JOB NAMED BY ITS WORK (Isaac, 26 November 2026: "We need to get a
     quote built out for the split system that is outstanding" made a task
     and asked who, never which job): the open jobs whose description has
     every word of the work. Only open ones: by its work alone, a finished
     job is any of hundreds. With a client or a place too, the work narrows
     what they found, when it leaves any. */
  const work = workWords(named.work ?? "");
  const hasWork = (r: JobRow) => work.every((w) => (r.job_description ?? "").toLowerCase().includes(w));
  if (!rows.length && work.length && !named.client && !named.place && !named.number) {
    let q = supabaseAdmin.from("sm8_jobs").select(JOB_COLS).eq("org_id", orgId).eq("active", 1).in("status", OPEN);
    for (const w of work) q = q.ilike("job_description", `%${like(w)}%`);
    const { data } = await q.order("date", { ascending: false }).limit(JOBS_READ);
    rows = (data ?? []) as JobRow[];
  } else if (rows.length > 1) {
    const open = named.open ? rows.filter((r) => OPEN.includes(r.status ?? "")) : rows;
    const narrowed = work.length ? open.filter(hasWork) : open;
    if (narrowed.length) rows = narrowed;
  }
  const names = await clientNames(orgId, rows);
  const jobs: NamedJob[] = rows.map((r) => ({
    uuid: r.uuid,
    number: r.generated_job_id,
    address: r.job_address,
    client: (r.company_uuid && names.get(r.company_uuid)) || null,
    status: r.status,
    date: r.date,
  }));
  return { jobs, noClient };
}
