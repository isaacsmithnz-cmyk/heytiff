import "server-only";
import { supabaseAdmin } from "@/lib/supabase-server";
import { bestCustomers, nameFits, searchWords, type CustomerHit } from "./find";

/* THE BOOK, LOOKED THROUGH (lib/customers/find says why and how a name
   fits). Three places a customer is kept in the ServiceM8 mirror: a client
   by its own name, a client's contact, a job's contact. Each is reached by
   any word of the name said, and find's `nameFits` decides. Read only,
   org-scoped, service role: the caller holds the right to ask. */

type Company = { uuid: string; name: string | null; address: string | null; parent_company_uuid: string | null };
type Contact = { first: string | null; last: string | null; company_uuid?: string | null; job_uuid?: string | null };
type Job = { uuid: string; generated_job_id: string | null; job_address: string | null; status: string | null; date: string | null; company_uuid: string | null };

const ROWS = 120;
const JOB_COLS = "uuid, generated_job_id, job_address, status, date, company_uuid";

const fullName = (c: Contact) => [c.first, c.last].filter((p) => p && p.trim()).join(" ").trim();
const any = (cols: string[], ws: string[]) => ws.flatMap((w) => cols.map((c) => `${c}.ilike.%${w}%`)).join(",");
const jobOf = (j: Job | undefined) => (j ? { number: j.generated_job_id ?? "", status: j.status, date: j.date ? j.date.slice(0, 10) : null } : null);

/** The customers the book has by this name: at most three, closest first. */
export async function findCustomers(orgId: string, said: string): Promise<CustomerHit[]> {
  const ws = searchWords(said);
  if (ws.length === 0) return [];
  const [companies, contacts, jobContacts] = await Promise.all([
    supabaseAdmin.from("sm8_companies").select("uuid, name, address, parent_company_uuid").eq("org_id", orgId).eq("active", 1).or(any(["name"], ws)).limit(ROWS),
    supabaseAdmin.from("sm8_company_contacts").select("first, last, company_uuid").eq("org_id", orgId).eq("active", 1).or(any(["first", "last"], ws)).limit(ROWS),
    supabaseAdmin.from("sm8_job_contacts").select("first, last, job_uuid").eq("org_id", orgId).eq("active", 1).or(any(["first", "last"], ws)).limit(ROWS),
  ]);

  const companyHits = ((companies.data ?? []) as Company[]).map((c) => ({ c, fit: nameFits(said, c.name) })).filter((x) => x.fit > 0);
  const contactHits = ((contacts.data ?? []) as Contact[]).map((c) => ({ c, fit: nameFits(said, fullName(c)) })).filter((x) => x.fit > 0);
  const jobContactHits = ((jobContacts.data ?? []) as Contact[]).map((c) => ({ c, fit: nameFits(said, fullName(c)) })).filter((x) => x.fit > 0);

  /* what each hit sits under: the contacts' clients, the job contacts' jobs,
     and each client's latest job */
  const jobUuids = [...new Set(jobContactHits.map((x) => x.c.job_uuid).filter((u): u is string => !!u))];
  const { data: jobRows } = jobUuids.length
    ? await supabaseAdmin.from("sm8_jobs").select(JOB_COLS).eq("org_id", orgId).in("uuid", jobUuids)
    : { data: [] };
  const jobs = new Map(((jobRows ?? []) as Job[]).map((j) => [j.uuid, j]));
  const clientUuids = [
    ...new Set([
      ...companyHits.map((x) => x.c.uuid),
      ...contactHits.map((x) => x.c.company_uuid),
      ...[...jobs.values()].map((j) => j.company_uuid),
    ].filter((u): u is string => !!u)),
  ];
  const [{ data: clientRows }, { data: latestRows }] = clientUuids.length
    ? await Promise.all([
        supabaseAdmin.from("sm8_companies").select("uuid, name, address, parent_company_uuid").eq("org_id", orgId).in("uuid", clientUuids),
        supabaseAdmin.from("sm8_jobs").select(JOB_COLS).eq("org_id", orgId).eq("active", 1).in("company_uuid", clientUuids).order("date", { ascending: false }).limit(200),
      ])
    : [{ data: [] }, { data: [] }];
  const clients = new Map(((clientRows ?? []) as Company[]).map((c) => [c.uuid, c]));
  const latest = new Map<string, Job>();
  for (const j of (latestRows ?? []) as Job[]) if (j.company_uuid && !latest.has(j.company_uuid)) latest.set(j.company_uuid, j);

  const hits: CustomerHit[] = [
    ...companyHits.map(({ c, fit }): CustomerHit => {
      const j = latest.get(c.uuid);
      return { name: c.name ?? said, via: "client", client: null, address: c.address ?? j?.job_address ?? null, job: jobOf(j), fit };
    }),
    ...contactHits.map(({ c, fit }): CustomerHit => {
      const co = c.company_uuid ? clients.get(c.company_uuid) : undefined;
      const j = c.company_uuid ? latest.get(c.company_uuid) : undefined;
      return { name: fullName(c), via: "contact", client: co?.name ?? null, address: co?.address ?? j?.job_address ?? null, job: jobOf(j), fit };
    }),
    ...jobContactHits.map(({ c, fit }): CustomerHit => {
      const j = c.job_uuid ? jobs.get(c.job_uuid) : undefined;
      const co = j?.company_uuid ? clients.get(j.company_uuid) : undefined;
      return { name: fullName(c), via: "job contact", client: co?.name ?? null, address: j?.job_address ?? co?.address ?? null, job: jobOf(j), fit };
    }),
  ];
  return bestCustomers(hits);
}
