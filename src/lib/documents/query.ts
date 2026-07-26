import { supabaseAdmin } from "@/lib/supabase-server";
import { asDocumentKind, isImage, type DocumentKind } from "./files";

/* Reading documents. Org-scoped, and every URL is signed here rather than
   stored — the bucket is private, so a link is minted per request, expires, and
   only ever after the org check has already passed. Nothing about a file is
   reachable from a URL somebody kept. */

export const DOCUMENTS_BUCKET = "documents";

/** How long a rendered link lives. One page view, comfortably. */
/** Exported for lib/expenses, which signs a page of receipts in one round trip
    and must expire them on the same clock as every other private file. */
export const SIGNED_URL_SECONDS = 3600;

export type StoredDocument = {
  id: string;
  kind: DocumentKind;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  uploadedById: string | null;
  createdAt: string;
  /** Short-lived, signed. Null if the link couldn't be minted. */
  url: string | null;
  image: boolean;
};

const COLUMNS =
  "id, kind, storage_ref, file_name, mime_type, size_bytes, uploaded_by, created_at, notice_id";

/* The attachments on a page of notices, keyed by notice.

   Only CONFIRMED uploads are returned. A slot that was handed out and never
   used has no uploaded_at, and showing it would mean a broken thumbnail on
   somebody's board with no way to explain it. */
export async function documentsForNotices(
  orgId: string,
  noticeIds: readonly string[],
): Promise<Map<string, StoredDocument[]>> {
  const out = new Map<string, StoredDocument[]>();
  if (noticeIds.length === 0) return out;

  const { data } = await supabaseAdmin
    .from("documents")
    .select(COLUMNS)
    .eq("org_id", orgId)
    .in("notice_id", [...noticeIds])
    .not("uploaded_at", "is", null)
    .order("created_at", { ascending: true });

  const rows = (data ?? []) as Record<string, unknown>[];
  const urls = await signMany(rows.map((r) => String(r.storage_ref)));

  for (const r of rows) {
    const key = String(r.notice_id);
    const list = out.get(key) ?? [];
    list.push(toStored(r, urls));
    out.set(key, list);
  }
  return out;
}

function toStored(r: Record<string, unknown>, urls: Map<string, string>): StoredDocument {
  const mimeType = String(r.mime_type);
  return {
    id: String(r.id),
    kind: asDocumentKind(r.kind) ?? "other",
    fileName: String(r.file_name),
    mimeType,
    sizeBytes: Number(r.size_bytes) || 0,
    uploadedById: (r.uploaded_by as string) ?? null,
    createdAt: String(r.created_at),
    url: urls.get(String(r.storage_ref)) ?? null,
    image: isImage(mimeType),
  };
}

/* A single link — the org logo, on the sidebar and on the company card.

   Same rule as everything else here: the ref is what's stored, the URL is
   minted per render and expires. Null when the object is gone, so a caller
   renders its fallback (initials) rather than a broken image. */
export async function signOne(ref: string | null | undefined): Promise<string | null> {
  if (!ref) return null;
  const { data } = await supabaseAdmin.storage
    .from(DOCUMENTS_BUCKET)
    .createSignedUrl(ref, SIGNED_URL_SECONDS);
  return data?.signedUrl ?? null;
}

/* One round trip for every link on the page. createSignedUrls takes the whole
   list, so a board with twenty photos costs one call rather than twenty. */
async function signMany(refs: readonly string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (refs.length === 0) return out;
  const { data } = await supabaseAdmin.storage
    .from(DOCUMENTS_BUCKET)
    .createSignedUrls([...new Set(refs)], SIGNED_URL_SECONDS);
  for (const row of data ?? []) {
    if (row.path && row.signedUrl) out.set(row.path, row.signedUrl);
  }
  return out;
}
