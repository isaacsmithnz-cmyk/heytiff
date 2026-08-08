/* Reading the library. Org-scoped, and every URL is signed here rather
   than stored — the bucket is private, so a link is minted per request, expires,
   and only ever after the org check has already passed. Same doctrine as
   lib/documents/query.ts, which this deliberately mirrors. */

import { supabaseAdmin } from "@/lib/supabase-server";
import { SIGNED_URL_SECONDS } from "@/lib/documents/query";
import { displayNameOf } from "@/lib/staff/name";
import { asKbCategory, KB_BUCKET, KB_CATEGORIES, type KbCategory } from "./files";
import { auMonthStart } from "./quota";

export type KbDocRow = {
  id: string;
  category: KbCategory;
  title: string;
  source: string | null;
  edition: string | null;
  /** The name the file arrived with — null on anything uploaded before it was
      captured. Searchable, never shown as the document's name. */
  fileName: string | null;
  kind: string;
  storageRef: string | null;
  sizeBytes: number | null;
  pageCount: number | null;
  scannedPages: number;
  status: string;
  error: string | null;
  /** The resume bookmark, so a row can render "page 84 of 300". */
  nextPage: number;
  chunkCount: number;
  uploadedById: string | null;
  uploadedAt: string | null;
  updatedAt: string;
};

const COLUMNS =
  "id, category, title, source, edition, file_name, kind, storage_ref, size_bytes, page_count, " +
  "scanned_pages, status, error, next_page, chunk_count, uploaded_by, uploaded_at, updated_at";

function toRow(r: Record<string, unknown>): KbDocRow {
  return {
    id: String(r.id),
    category: asKbCategory(r.category) ?? "specs",
    title: String(r.title ?? ""),
    source: (r.source as string) ?? null,
    edition: (r.edition as string) ?? null,
    fileName: (r.file_name as string) ?? null,
    kind: String(r.kind ?? "PDF"),
    storageRef: (r.storage_ref as string) ?? null,
    sizeBytes: r.size_bytes === null || r.size_bytes === undefined ? null : Number(r.size_bytes),
    pageCount: r.page_count === null || r.page_count === undefined ? null : Number(r.page_count),
    scannedPages: Number(r.scanned_pages) || 0,
    status: String(r.status ?? "uploading"),
    error: (r.error as string) ?? null,
    nextPage: Number(r.next_page) || 1,
    chunkCount: Number(r.chunk_count) || 0,
    uploadedById: (r.uploaded_by as string) ?? null,
    uploadedAt: (r.uploaded_at as string) ?? null,
    updatedAt: String(r.updated_at ?? ""),
  };
}

/* The library, newest first.

   Rows that were never confirmed are excluded — a slot handed out and
   abandoned has no `uploaded_at`, and showing it would put a permanently
   "uploading" row on the library page with no way to explain it. Same rule as
   documentsForNotices. */
export async function kbDocsForOrg(orgId: string): Promise<KbDocRow[]> {
  const { data } = await supabaseAdmin
    .from("kb_documents")
    .select(COLUMNS)
    .eq("org_id", orgId)
    .not("uploaded_at", "is", null)
    .order("created_at", { ascending: false });

  return ((data ?? []) as unknown as Record<string, unknown>[]).map(toRow);
}

/** Documents per category — the counts on the four cards. READY only: a
    half-ingested manual can't answer anything yet, so counting it would
    promise coverage the library doesn't have. */
export async function kbCategoryCounts(orgId: string): Promise<Record<KbCategory, number>> {
  const counts = Object.fromEntries(KB_CATEGORIES.map((c) => [c, 0])) as Record<KbCategory, number>;

  const { data } = await supabaseAdmin
    .from("kb_documents")
    .select("category")
    .eq("org_id", orgId)
    .eq("status", "ready");

  for (const r of (data ?? []) as unknown as { category: unknown }[]) {
    const cat = asKbCategory(r.category);
    if (cat) counts[cat] += 1;
  }
  return counts;
}

/* Who put each document there, by staff-profile id. A separate read rather
   than a join: `uploaded_by` is nullable (a row can outlive the person's
   profile) and the library shows a name as a nicety, so it must never be the
   thing that makes the page fail to load. Names only — this is the same
   minimum-identity shape listFleetStaff uses. */
export async function kbUploaderNames(orgId: string): Promise<Record<string, string>> {
  const { data } = await supabaseAdmin
    .from("staff_profiles")
    .select("id, first_name, last_name, full_name, preferred_name")
    .eq("org_id", orgId);

  const names: Record<string, string> = {};
  for (const r of (data ?? []) as unknown as Record<string, unknown>[]) {
    const name = displayNameOf(r, "");
    if (name) names[String(r.id)] = name;
  }
  return names;
}

export type KbUsageRow = { month: string; pagesProcessed: number; questionsAsked: number };

/** This AU month's counters. A missing row is zero, not an error — it simply
    means nothing has been ingested yet this month. */
export async function kbUsageThisMonth(orgId: string, now: Date = new Date()): Promise<KbUsageRow> {
  const month = auMonthStart(now);
  const { data } = await supabaseAdmin
    .from("kb_usage")
    .select("pages_processed, questions_asked")
    .eq("org_id", orgId)
    .eq("month", month)
    .maybeSingle();

  return {
    month,
    pagesProcessed: Number(data?.pages_processed) || 0,
    questionsAsked: Number(data?.questions_asked) || 0,
  };
}

/** A short-lived link to the stored PDF — for "open the document at page 42".
    Null when the object is gone, so the caller drops the link rather than
    rendering a dead one. */
export async function signKbRef(ref: string | null | undefined): Promise<string | null> {
  if (!ref) return null;
  const { data } = await supabaseAdmin.storage
    .from(KB_BUCKET)
    .createSignedUrl(ref, SIGNED_URL_SECONDS);
  return data?.signedUrl ?? null;
}
