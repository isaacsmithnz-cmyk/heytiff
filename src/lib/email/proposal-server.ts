import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { supabaseAdmin } from "@/lib/supabase-server";
import { normName } from "@/lib/integrations/match";
import { DOCUMENTS_BUCKET } from "@/lib/documents/query";
import { todayInSydney } from "@/lib/quotes/price-book";
import { writeThreads } from "@/lib/tiff/threads-server";
import type { TiffThread } from "@/lib/tiff/threads";
import type { KeptFile } from "./inbound-server";
import { EMAIL_JOB_SCHEMA, emailJobPrompt, parseEmailJobRead, threadTitleOf, tiffSays, type ClientMatch, type EmailJobRead, type EmailProposal, type SiteMatch } from "./proposal";

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
    const [clientMatch, siteMatch] = await Promise.all([
      asked.read.isJob && asked.read.client ? clientMatchOf(row.org_id, asked.read.client) : Promise.resolve(null),
      asked.read.isJob && asked.read.site ? siteMatchOf(row.org_id, asked.read.site) : Promise.resolve(null),
    ]);
    proposal = { ...asked.read, clientMatch, siteMatch };
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
