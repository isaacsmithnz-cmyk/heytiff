import "server-only";
import { createHash } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import { supabaseAdmin } from "@/lib/supabase-server";
import { DOCUMENTS_BUCKET } from "@/lib/documents/query";
import { openPdf } from "@/lib/tiff/extract";
import { fmtAuWeekdayDayMonth } from "@/lib/au-dates";
import { SONNET_FALLBACK } from "@/lib/tiff/sonnet-fallback";
import type { EmailProposal } from "@/lib/email/proposal";
import { fileFor, type PlanPick } from "./plans-server";
import type { SpecWords } from "./plans";
import { SUPPLIED_SCHEMA, SUPPLIED_SYSTEM_PROMPT, drawingWords, emailSupplies, sheetNumbersOf, suppliedOf, suppliedPrompt, type SheetWord, type SuppliedScope, type SuppliedSource } from "./supplied-scope";

/* THE SUPPLIED SCOPE, kept (supplied-scope.ts says what it is). Written from
   the job's plans as read, a specification's pages on the air, and the
   emails from outside filed on the job, and only when one of those is new:
   the stamp says which it was written from. Asked for with the quoted
   brief (lib/workboard/job-scope-server.ts), which starts from it, and
   written with it, so the two are never out of step. Service role. */

const MODEL = "claude-sonnet-5-5";
const MAX_TOKENS = 8000;

/** What a supplied scope rests on, before any words are read: enough to stamp it. */
type Ref =
  | { kind: "drawings" | "spec"; id: string; at: string; name: string; pick: PlanPick; spec: SpecWords | null }
  | { kind: "email"; id: string; at: string; label: string; words: string };

/** Which sources the supplied scope was written from, as one short stamp. */
export function suppliedStamp(refs: readonly { id: string; at: string }[]): string | null {
  if (refs.length === 0) return null;
  const key = [...refs].map((r) => `${r.id}@${r.at}`).sort().join("|");
  return createHash("sha256").update(key).digest("hex").slice(0, 24);
}

type PlanRow = { id: string; kind: string | null; name: string; document_id: string | null; attachment_id: string | null; reading: { spec?: SpecWords } | null; read_at: string | null };
type EmailRow = { id: string; subject: string | null; body: string | null; from_name: string | null; received_at: string; proposal: EmailProposal | null };

async function refsOf(orgId: string, jobUuid: string): Promise<Ref[]> {
  const [plans, emails] = await Promise.all([
    supabaseAdmin.from("job_plans").select("id, kind, name, document_id, attachment_id, reading, read_at").eq("org_id", orgId).eq("job_uuid", jobUuid).in("state", ["read", "check"]),
    supabaseAdmin.from("email_in_messages").select("id, subject, body, from_name, received_at, proposal").eq("org_id", orgId).eq("job_uuid", jobUuid).in("state", ["made", "filed"]),
  ]);
  const refs: Ref[] = [];
  for (const p of (plans.data ?? []) as PlanRow[]) {
    if (!p.read_at) continue;
    const pick: PlanPick = p.document_id ? { documentId: p.document_id } : { attachmentId: p.attachment_id ?? "" };
    refs.push({ kind: p.kind === "spec" ? "spec" : "drawings", id: p.id, at: p.read_at, name: p.name, pick, spec: p.reading?.spec ?? null });
  }
  for (const e of (emails.data ?? []) as EmailRow[]) {
    const subject = e.subject ?? "";
    const body = (e.body ?? "").slice(0, 20_000);
    if (!emailSupplies(subject, body)) continue;
    const c = e.proposal?.contact;
    const who = [c?.first, c?.last].filter(Boolean).join(" ") || e.proposal?.client || e.from_name || "An";
    refs.push({ kind: "email", id: e.id, at: e.received_at, label: `${who}'s email, ${fmtAuWeekdayDayMonth(e.received_at)}`, words: `Subject: ${subject}\n${body}` });
  }
  return refs;
}

/** A set of drawings' words, sheet by sheet, cut to the air side. */
async function drawingsOf(orgId: string, jobUuid: string, pick: PlanPick): Promise<string> {
  const file = await fileFor(orgId, jobUuid, pick);
  if (!file) return "";
  const { data: blob } = await supabaseAdmin.storage.from(DOCUMENTS_BUCKET).download(file.ref);
  if (!blob) return "";
  if (!/pdf/i.test(file.mime ?? "") && !/\.pdf$/i.test(file.name)) return "";
  const doc = await openPdf(new Uint8Array(await blob.arrayBuffer()));
  try {
    const sheets: { n: number; lines: string[]; number?: string | null }[] = [];
    const placed: SheetWord[][] = [];
    for (let n = 1; n <= Math.min(doc.numPages, 80); n++) {
      sheets.push({ n, lines: await doc.pageLines(n) });
      placed.push((await doc.pagePlaced?.(n)) ?? []);
    }
    /* each sheet's own number off its title block, where the set prints one */
    const numbers = sheetNumbersOf(placed);
    return drawingWords(sheets.map((s, i) => ({ ...s, number: numbers[i] })));
  } finally {
    await doc.destroy();
  }
}

async function sourcesOf(orgId: string, jobUuid: string, refs: readonly Ref[]): Promise<SuppliedSource[]> {
  const out: SuppliedSource[] = [];
  /* the newest first, so the most recent issue and email are read first */
  for (const r of [...refs].sort((a, b) => b.at.localeCompare(a.at))) {
    if (r.kind === "email") out.push({ id: r.id, at: r.at, kind: "email", label: r.label, words: r.words });
    else if (r.kind === "spec") {
      if (r.spec?.words) out.push({ id: r.id, at: r.at, kind: "spec", label: `The specification, ${r.name}`, words: r.spec.words });
    } else {
      const words = await drawingsOf(orgId, jobUuid, r.pick).catch(() => "");
      if (words) out.push({ id: r.id, at: r.at, kind: "drawings", label: `The drawings, ${r.name}`, words });
    }
  }
  return out;
}

export type SuppliedNow = { scope: SuppliedScope | null; stamp: string | null; fresh: boolean };

/** The job's supplied scope as it should stand: the stored one while its
    sources haven't moved, else written again from them. `stored` and
    `storedStamp` are the row's. Never throws: a failed write keeps the old. */
export async function suppliedNow(orgId: string, jobUuid: string, stored: { supplied: unknown; stamp: string | null } | null, client: Anthropic, context: { client: string | null; site: string | null }): Promise<SuppliedNow> {
  const keep: SuppliedNow = { scope: suppliedOf(stored?.supplied ?? null), stamp: stored?.stamp ?? null, fresh: false };
  try {
    const refs = await refsOf(orgId, jobUuid);
    const stamp = suppliedStamp(refs);
    if (!stamp) return { scope: null, stamp: null, fresh: false };
    if (stamp === stored?.stamp) return keep;
    const sources = await sourcesOf(orgId, jobUuid, refs);
    if (sources.length === 0) return { scope: null, stamp, fresh: true };
    const response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      ...SONNET_FALLBACK,
      output_config: { effort: "medium", format: { type: "json_schema", schema: SUPPLIED_SCHEMA } },
      system: SUPPLIED_SYSTEM_PROMPT,
      messages: [{ role: "user", content: suppliedPrompt({ client: context.client, site: context.site, sources }) }],
    });
    if (response.stop_reason === "refusal") return keep;
    const block = response.content.find((b) => b.type === "text");
    const scope = block && block.type === "text" ? suppliedOf(JSON.parse(block.text)) : null;
    return scope ? { scope, stamp, fresh: true } : keep;
  } catch (e) {
    console.error(`[supplied-scope] ${jobUuid}: ${String(e)}`);
    return keep;
  }
}
