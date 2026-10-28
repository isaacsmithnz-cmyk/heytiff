import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { supabaseAdmin } from "@/lib/supabase-server";
import { normName } from "@/lib/integrations/match";
import { DOCUMENTS_BUCKET } from "@/lib/documents/query";
import { todayInSydney } from "@/lib/quotes/price-book";
import { writeThreads } from "@/lib/tiff/threads-server";
import type { TiffThread } from "@/lib/tiff/threads";
import type { KeptFile } from "./inbound-server";
import { EMAIL_JOB_SCHEMA, emailJobPrompt, parseEmailJobRead, threadTitleOf, tiffSays, type ClientMatch, type EmailJobRead, type EmailProposal, type JobCandidate, type SiteMatch } from "./proposal";

export type { EmailProposal } from "./proposal";

/* An email to Tiff, read (proposal.ts says what is asked and what is
   believed): its words and its PDFs and pictures to Tiff, her answer matched
   to the business's own clients and sites, kept on the email's row as the
   job she proposes, and a thread in the forwarder's Conversations that says
   so, with the card the person makes the job from. Nothing goes to
   ServiceM8 here. Service role; the webhook calls it behind its answer. */

/* Sonnet, as the invoice reader: reading an email and its drawings for who,
   where and what is well within it. */
const MODEL = "claude-sonnet-5-5";
const FALLBACK_MODEL = "claude-opus-4-8";
/* what goes to Tiff with the words: the first six files, under 18 MB in all
   (a request is at most 32 MB once the files are base64) */
const READ_FILES = 6;
const READ_BYTES = 18 * 1024 * 1024;

type Row = {
  id: string;
  org_id: string;
  sender_sub: string | null;
  from_name: string | null;
  from_address: string;
  subject: string | null;
  body: string | null;
  files: KeptFile[] | null;
  received_at: string;
};

const like = (s: string) => s.replace(/[%_\\]/g, (c) => `\\${c}`);

/** The client a read names, when exactly one of the business's clients has
    that name: never a near one, which would put a tender on the wrong
    builder. A builder is a client with sites of its own. */
export async function clientMatchOf(orgId: string, name: string): Promise<ClientMatch | null> {
  const want = normName(name);
  if (want.length < 2) return null;
  const { data } = await supabaseAdmin
    .from("sm8_companies")
    .select("uuid, name")
    .eq("org_id", orgId)
    .eq("active", 1)
    .is("parent_company_uuid", null)
    .ilike("name", `%${like(name.trim().split(/\s+/)[0]!)}%`)
    .limit(40);
  const same = ((data ?? []) as { uuid: string; name: string | null }[]).filter((c) => normName(c.name) === want);
  if (same.length !== 1) return null;
  const hit = same[0]!;
  const { count } = await supabaseAdmin.from("sm8_companies").select("uuid", { count: "exact", head: true }).eq("org_id", orgId).eq("active", 1).eq("parent_company_uuid", hit.uuid);
  return { uuid: hit.uuid, name: hit.name ?? name, builder: (count ?? 0) > 0 };
}

/** A site already here at the street the read gives (matchPreviousSite's
    rule: a number and a street name, or it isn't a match worth saying). */
export async function siteMatchOf(orgId: string, address: string): Promise<SiteMatch | null> {
  const street = address.split(/[,\n]/)[0]!.replace(/\s+/g, " ").trim();
  if (!/^\d+\S*\s+\S{3,}/.test(street)) return null;
  const { data } = await supabaseAdmin
    .from("sm8_companies")
    .select("uuid, name, address, parent_company_uuid")
    .eq("org_id", orgId)
    .eq("active", 1)
    .ilike("address", `${like(street)}%`)
    .limit(1);
  const hit = ((data ?? []) as { uuid: string; name: string | null; address: string | null; parent_company_uuid: string | null }[])[0];
  if (!hit) return null;
  let parentName: string | null = null;
  if (hit.parent_company_uuid) {
    const { data: p } = await supabaseAdmin.from("sm8_companies").select("name").eq("org_id", orgId).eq("uuid", hit.parent_company_uuid).maybeSingle();
    parentName = (p as { name: string | null } | null)?.name ?? null;
  }
  return { uuid: hit.uuid, name: hit.name, address: hit.address, parentName };
}

type JobRow = { uuid: string; generated_job_id: string | null; job_address: string | null; status: string | null; company_uuid: string | null };
const JOB_COLS = "uuid, generated_job_id, job_address, status, company_uuid";
const OPEN = ["Quote", "Work Order"];

/** An email's subject as a thread knows it: without its Fw:/RE: marks, any case. */
export const subjectKey = (subject: string | null) =>
  (subject ?? "").replace(/^\s*((fw|fwd|re)\s*:\s*)+/i, "").replace(/\s+/g, " ").trim().toLowerCase();

/** THE JOBS AN EMAIL MAY BE ABOUT, found in the business's own records,
    never guessed: a job number written in it; an earlier email on the same
    thread filed on a job (made from it, or filed on it); an open job (a quote
    or a work order) at the same street; the matched client's open jobs. The
    strongest first, a job once, five at most. Tiff only chooses among these. */
export async function jobCandidates(orgId: string, read: EmailJobRead, client: ClientMatch | null, subject: string | null, selfId: string): Promise<JobCandidate[]> {
  const found = new Map<string, { row: JobRow; found: JobCandidate["found"] }>();
  const add = (rows: JobRow[], how: JobCandidate["found"]) => {
    for (const r of rows) if (!found.has(r.uuid)) found.set(r.uuid, { row: r, found: how });
  };
  if (read.jobNumbers.length) {
    const { data } = await supabaseAdmin.from("sm8_jobs").select(JOB_COLS).eq("org_id", orgId).eq("active", 1).in("generated_job_id", read.jobNumbers);
    add((data ?? []) as JobRow[], "number");
  }
  const key = subjectKey(subject);
  if (key.length >= 6) {
    const since = new Date(Date.now() - 120 * 24 * 3600 * 1000).toISOString();
    const { data } = await supabaseAdmin
      .from("email_in_messages")
      .select("subject, job_uuid")
      .eq("org_id", orgId)
      .in("state", ["made", "filed"])
      .not("job_uuid", "is", null)
      .neq("id", selfId)
      .gte("received_at", since)
      .order("received_at", { ascending: false })
      .limit(200);
    const uuids = [...new Set(((data ?? []) as { subject: string | null; job_uuid: string }[]).filter((e) => subjectKey(e.subject) === key).map((e) => e.job_uuid))];
    if (uuids.length) {
      const { data: jobs } = await supabaseAdmin.from("sm8_jobs").select(JOB_COLS).eq("org_id", orgId).in("uuid", uuids);
      add((jobs ?? []) as JobRow[], "thread");
    }
  }
  const street = read.site.split(/[,\n]/)[0]!.replace(/\s+/g, " ").trim();
  if (/^\d+\S*\s+\S{3,}/.test(street)) {
    const { data } = await supabaseAdmin.from("sm8_jobs").select(JOB_COLS).eq("org_id", orgId).eq("active", 1).in("status", OPEN).ilike("job_address", `${like(street)}%`).limit(3);
    add((data ?? []) as JobRow[], "site");
  }
  if (client) {
    const { data: sites } = await supabaseAdmin.from("sm8_companies").select("uuid").eq("org_id", orgId).eq("active", 1).eq("parent_company_uuid", client.uuid).limit(200);
    const companies = [client.uuid, ...((sites ?? []) as { uuid: string }[]).map((x) => x.uuid)];
    const { data } = await supabaseAdmin
      .from("sm8_jobs")
      .select(JOB_COLS)
      .eq("org_id", orgId)
      .eq("active", 1)
      .in("status", OPEN)
      .in("company_uuid", companies)
      .order("date", { ascending: false })
      .limit(5);
    add((data ?? []) as JobRow[], "client");
  }
  const picked = [...found.values()].slice(0, 5);
  /* who each job is for: its company, or the client a site belongs to */
  const companyIds = [...new Set(picked.map((p) => p.row.company_uuid).filter((c): c is string => !!c))];
  const names = new Map<string, string>();
  if (companyIds.length) {
    const { data } = await supabaseAdmin.from("sm8_companies").select("uuid, name, parent_company_uuid").eq("org_id", orgId).in("uuid", companyIds);
    const rows = (data ?? []) as { uuid: string; name: string | null; parent_company_uuid: string | null }[];
    const parents = [...new Set(rows.map((r) => r.parent_company_uuid).filter((x): x is string => !!x))];
    const parentNames = new Map<string, string>();
    if (parents.length) {
      const { data: ps } = await supabaseAdmin.from("sm8_companies").select("uuid, name").eq("org_id", orgId).in("uuid", parents);
      for (const p of (ps ?? []) as { uuid: string; name: string | null }[]) if (p.name) parentNames.set(p.uuid, p.name);
    }
    for (const r of rows) names.set(r.uuid, (r.parent_company_uuid ? parentNames.get(r.parent_company_uuid) : null) ?? r.name ?? "");
  }
  return picked.map(({ row, found: how }) => ({
    uuid: row.uuid,
    number: row.generated_job_id,
    address: row.job_address,
    client: (row.company_uuid && names.get(row.company_uuid)) || null,
    status: row.status,
    found: how,
  }));
}

/** The files Tiff reads with the words. */
async function filesFor(files: readonly KeptFile[]): Promise<Anthropic.Beta.Messages.BetaContentBlockParam[]> {
  const out: Anthropic.Beta.Messages.BetaContentBlockParam[] = [];
  let bytes = 0;
  for (const f of files.slice(0, READ_FILES)) {
    if (bytes + f.size > READ_BYTES) continue;
    const { data } = await supabaseAdmin.storage.from(DOCUMENTS_BUCKET).download(f.path);
    if (!data) continue;
    const b64 = Buffer.from(await data.arrayBuffer()).toString("base64");
    bytes += f.size;
    if (f.contentType === "application/pdf") out.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: b64 }, title: f.name });
    else if (["image/jpeg", "image/png", "image/webp", "image/gif"].includes(f.contentType))
      out.push({ type: "image", source: { type: "base64", media_type: f.contentType as "image/jpeg", data: b64 } });
  }
  return out;
}

async function askTiff(row: Row, business: string, client: Anthropic): Promise<{ ok: true; read: EmailJobRead } | { ok: false; reason: string }> {
  const email = `<email>\nSubject: ${row.subject ?? ""}\n\n${row.body ?? ""}\n</email>`;
  try {
    const files = await filesFor(row.files ?? []);
    const response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 8000,
      betas: ["server-side-fallback-2026-06-01"],
      fallbacks: [{ model: FALLBACK_MODEL }],
      output_config: { effort: "medium", format: { type: "json_schema", schema: EMAIL_JOB_SCHEMA } },
      /* the files and the email BEFORE the ask */
      messages: [{ role: "user", content: [...files, { type: "text", text: email }, { type: "text", text: emailJobPrompt({ business, forwarder: row.from_name, today: todayInSydney() }) }] }],
    });
    if (response.stop_reason === "refusal") return { ok: false, reason: "Tiff declined to read this email." };
    const block = [...response.content].reverse().find((b) => b.type === "text");
    if (!block || block.type !== "text") return { ok: false, reason: "Tiff found nothing to read." };
    return { ok: true, read: parseEmailJobRead(JSON.parse(block.text)) };
  } catch (err) {
    console.error("[email-in] reading an email failed:", err instanceof Error ? err.message : err);
    if (err instanceof Anthropic.RateLimitError) return { ok: false, reason: "Tiff was busy." };
    return { ok: false, reason: "The email couldn't be read." };
  }
}

/** An email to Tiff, read into the job she proposes, and the forwarder's
    thread that shows it. */
export async function readEmailIntoJob(rowId: string, client: Anthropic = new Anthropic()): Promise<"read" | "failed"> {
  const { data } = await supabaseAdmin
    .from("email_in_messages")
    .select("id, org_id, sender_sub, from_name, from_address, subject, body, files, received_at")
    .eq("id", rowId)
    .maybeSingle();
  const row = data as Row | null;
  if (!row) return "failed";
  const { data: org } = await supabaseAdmin.from("organizations").select("trading_name, name").eq("id", row.org_id).maybeSingle();
  const business = ((org?.trading_name as string | null) || (org?.name as string | null) || "this business").trim();

  const asked = await askTiff(row, business, client);
  let proposal: EmailProposal | null = null;
  if (asked.ok) {
    const work = asked.read.isJob || asked.read.aboutJob;
    const [clientMatch, siteMatch] = await Promise.all([
      work && asked.read.client ? clientMatchOf(row.org_id, asked.read.client) : Promise.resolve(null),
      work && asked.read.site ? siteMatchOf(row.org_id, asked.read.site) : Promise.resolve(null),
    ]);
    const jobs = work ? await jobCandidates(row.org_id, asked.read, clientMatch, row.subject, row.id) : [];
    proposal = { ...asked.read, clientMatch, siteMatch, jobs };
  }
  await supabaseAdmin
    .from("email_in_messages")
    .update({ state: asked.ok ? "read" : "failed", proposal, why: asked.ok ? undefined : asked.reason, thread_id: `email-${row.id}` })
    .eq("id", row.id);

  if (row.sender_sub) {
    const now = Date.now();
    const attached = (row.files ?? []).map((f) => f.name);
    const mine = [row.subject ?? "", "", row.body ?? "", ...(attached.length ? ["", `Attached: ${attached.join(", ")}`] : [])].join("\n").trim();
    const thread: TiffThread = {
      id: `email-${row.id}`,
      title: threadTitleOf(row.subject, proposal),
      updatedAt: now,
      messages: [
        { role: "user", text: mine.slice(0, 60_000), at: Date.parse(row.received_at) || now },
        { role: "tiff", text: tiffSays(proposal, asked.ok ? null : asked.reason), at: now, email: row.id },
      ],
    };
    await writeThreads({ orgId: row.org_id, userSub: row.sender_sub }, [thread], []);
  }
  return asked.ok ? "read" : "failed";
}
