import "server-only";
import { supabaseAdmin } from "@/lib/supabase-server";
import { unitSpecsOf } from "./fit-server";
import { byHandOf, linesDraft, optionNames, toggleAccepted, withCompared, withLoading, withName, withSupplier, type ByHand } from "./lines-job";
import { changeLine, readEngine, readLines } from "./lines-server";
import { bookProducts } from "./book-view-server";
import { bookPrice } from "./session/tools";
import type { QuoteLine } from "./lines";
import { readOrgDay } from "./org-day-server";
import type { ProposalDraft } from "./proposal";
import { readStoredProposal } from "./proposal-writer";

/* THE QUOTE, AS THE JOB READS IT, whichever engine prices it (lines-job.ts
   says why): the proposal Tiff's builder wrote, or a switched quote's
   options drawn from its kept lines, with those lines. Service role, by
   org; the callers gate. */

export type JobQuote = { draft: ProposalDraft; lines: QuoteLine[] | null };

export async function readJobQuote(orgId: string, cardId: string): Promise<JobQuote | null> {
  if ((await readEngine(orgId, cardId)) !== "lines") {
    const stored = await readStoredProposal(orgId, cardId);
    return stored ? { draft: stored.draft, lines: null } : null;
  }
  const [lines, row, day] = await Promise.all([
    readLines(orgId, cardId),
    supabaseAdmin.from("quote_drafts").select("draft").eq("org_id", orgId).eq("sm8_job_uuid", cardId).maybeSingle(),
    readOrgDay(orgId),
  ]);
  const raw = (row.data as { draft: unknown } | null)?.draft ?? null;
  const byHand = byHandOf(raw);
  const draft = linesDraft(lines, optionNames(raw, byHand), byHand, await unitSpecsOf(lines), day.hours?.hours ?? null);
  return draft ? { draft, lines } : null;
}

/** The accepted mark on a switched quote, read as it's kept. */
export async function readByHand(orgId: string, cardId: string): Promise<ByHand> {
  const { data } = await supabaseAdmin.from("quote_drafts").select("draft").eq("org_id", orgId).eq("sm8_job_uuid", cardId).maybeSingle();
  return byHandOf((data as { draft: unknown } | null)?.draft ?? null);
}

/** Marks option `i` of a switched quote accepted, or takes the mark off. */
export const markAccepted = (orgId: string, cardId: string, i: number, by: string) => changeByHand(orgId, cardId, by, (b) => toggleAccepted(b, i));
/** Names option `i`; blank takes the name off. */
export const nameOption = (orgId: string, cardId: string, i: number, name: unknown, by: string) => changeByHand(orgId, cardId, by, (b) => withName(b, i, name));
/** A unit kept beside a line's compare (10.2), by its book code. */
export const addCompared = (orgId: string, cardId: string, lineId: string, code: string, by: string) => changeByHand(orgId, cardId, by, (b) => withCompared(b, lineId, code));
/** The supplier the whole job buys from, or any. Picking one moves the
    lines already on the quote to its price for the same item, where it
    sells it, each kept in the history and undoable; a sell a person set
    stays as set. A line it doesn't sell stays where it is. */
export async function setSupplier(orgId: string, cardId: string, key: unknown, by: string, supplierName: string): Promise<{ ok: true; byHand: ByHand; moved: number } | { ok: false; reason: string }> {
  const r = await changeByHand(orgId, cardId, by, (b) => withSupplier(b, key));
  if (!r.ok || !r.byHand.supplier) return r.ok ? { ...r, moved: 0 } : r;
  const supplier = r.byHand.supplier;
  const [lines, products] = await Promise.all([readLines(orgId, cardId), bookProducts(orgId)]);
  let moved = 0;
  for (const l of lines) {
    if (!l.code || l.kind === "labour") continue;
    const p = bookPrice(products, l.code, l.unit, supplier);
    if (!p || p.supplierKey !== supplier || (p.code === l.code && l.supplierKey === supplier)) continue;
    const c = await changeLine(orgId, cardId, l.id, l.version, { code: p.code, supplierKey: p.supplierKey, costCents: p.costCents }, by, `Buy from ${supplierName} for this job`);
    if (c.ok) moved++;
  }
  return { ...r, moved };
}

/** Sets option `i`'s loading, or takes it off. */
export const setLoading = (orgId: string, cardId: string, i: number, loading: unknown, by: string) => changeByHand(orgId, cardId, by, (b) => withLoading(b, i, loading));

/** A change to a switched quote's by-hand record, written against the
    draft as it was read, so a proposal saved meanwhile is never
    overwritten; refused then, to be pressed again. */
async function changeByHand(orgId: string, cardId: string, by: string, change: (b: ByHand) => ByHand): Promise<{ ok: true; byHand: ByHand } | { ok: false; reason: string }> {
  const { data } = await supabaseAdmin
    .from("quote_drafts")
    .select("draft, updated_at, engine")
    .eq("org_id", orgId)
    .eq("sm8_job_uuid", cardId)
    .maybeSingle();
  const row = data as { draft: unknown; updated_at: string; engine: string } | null;
  if (!row || row.engine !== "lines") return { ok: false, reason: "This quote isn't built on its lines." };
  const byHand = change(byHandOf(row.draft));
  const draft = { ...(row.draft && typeof row.draft === "object" ? (row.draft as Record<string, unknown>) : {}), byHand };
  const { data: saved, error } = await supabaseAdmin
    .from("quote_drafts")
    .update({ draft, updated_by: by, updated_at: new Date().toISOString() })
    .eq("org_id", orgId)
    .eq("sm8_job_uuid", cardId)
    .eq("updated_at", row.updated_at)
    .select("sm8_job_uuid");
  if (error || !saved || saved.length === 0) return { ok: false, reason: "The quote changed as you pressed it. Try again." };
  return { ok: true, byHand };
}
