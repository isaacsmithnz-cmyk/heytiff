/* Reading and attaching tags. Server only.

   TWO FLAT READS, JOINED IN TYPESCRIPT, rather than one nested PostgREST
   select. Both foreign keys on kb_document_tags are composite (they carry
   org_id so a tag cannot cross a workspace), and embedded selects over
   composite relationships need explicit hints and break quietly when the
   constraint names change. The same reasoning already keeps kbUploaderNames a
   separate read: a nicety must never be the thing that stops the library
   loading.

   THE ORG IS ON EVERY QUERY, and on the writes it is on both halves of the
   pair — the delete that clears a document's tags is scoped to the org as well
   as the document, so a leaked id still can't reach across. */

import { supabaseAdmin } from "@/lib/supabase-server";
import {
  asKbTagColor,
  asKbTagKind,
  KB_TAG_COLOR_DEFAULT,
  KB_TAG_SEEDS,
  kbTagColorFor,
  kbTagSlug,
  type KbTagRef,
} from "./tags";

const COLUMNS = "id, label, slug, color, kind";

function toTag(r: Record<string, unknown>): KbTagRef {
  return {
    id: String(r.id),
    label: String(r.label ?? ""),
    slug: String(r.slug ?? ""),
    color: asKbTagColor(r.color) ?? KB_TAG_COLOR_DEFAULT,
    kind: asKbTagKind(r.kind) ?? "topic",
  };
}

/** Every tag this org has, alphabetically inside each group. */
export async function kbTagsForOrg(orgId: string): Promise<KbTagRef[]> {
  const { data } = await supabaseAdmin
    .from("kb_tags")
    .select(COLUMNS)
    .eq("org_id", orgId)
    .order("label", { ascending: true });

  return ((data ?? []) as unknown as Record<string, unknown>[]).map(toTag);
}

/** documentId → the tags on it. One read for the whole library; the library
    page already holds every row, so a per-document query would be N of these
    to answer a question one of them can. */
export async function kbTagsByDocument(orgId: string): Promise<Record<string, KbTagRef[]>> {
  const [tags, { data }] = await Promise.all([
    kbTagsForOrg(orgId),
    supabaseAdmin.from("kb_document_tags").select("document_id, tag_id").eq("org_id", orgId),
  ]);

  const byId = new Map(tags.map((t) => [t.id, t]));
  const out: Record<string, KbTagRef[]> = {};

  for (const row of (data ?? []) as unknown as Record<string, unknown>[]) {
    const tag = byId.get(String(row.tag_id));
    // a join row whose tag went in the same breath: skip rather than render a
    // pill with no name on it
    if (!tag) continue;
    const docId = String(row.document_id);
    (out[docId] ??= []).push(tag);
  }

  for (const list of Object.values(out)) list.sort((a, b) => a.label.localeCompare(b.label));
  return out;
}

/** How many documents wear each tag — what the manage sheet needs before it
    will let one be deleted. Tags on nothing are absent from the map, so the
    caller reads a missing key as zero. */
export async function kbTagUsage(orgId: string): Promise<Record<string, number>> {
  const { data } = await supabaseAdmin
    .from("kb_document_tags")
    .select("tag_id")
    .eq("org_id", orgId);

  const counts: Record<string, number> = {};
  for (const row of (data ?? []) as unknown as { tag_id: unknown }[]) {
    const id = String(row.tag_id);
    counts[id] = (counts[id] ?? 0) + 1;
  }
  return counts;
}

/* The starter set, put in the first time an org's library asks for its tags.

   IDEMPOTENT AND RACE-PROOF. Two people opening the library at once both see
   an empty list and both insert; `ignoreDuplicates` against the (org_id, slug)
   index makes the second one a no-op instead of a failed page load.

   ONLY EVER ON AN EMPTY LIST. Once an org has any tag at all this does
   nothing — a manager who deleted "Bonaire" because they never touch one is
   not handed it back on the next page load. */
export async function ensureKbSeedTags(orgId: string): Promise<void> {
  const { count } = await supabaseAdmin
    .from("kb_tags")
    .select("id", { count: "exact", head: true })
    .eq("org_id", orgId);

  if ((count ?? 0) > 0) return;

  await supabaseAdmin.from("kb_tags").upsert(
    KB_TAG_SEEDS.map((seed) => ({
      org_id: orgId,
      label: seed.label,
      slug: kbTagSlug(seed.label),
      color: kbTagColorFor(seed.label),
      kind: seed.kind,
    })),
    { onConflict: "org_id,slug", ignoreDuplicates: true }
  );
}

/* Set exactly which tags a document wears.

   A REPLACE, NOT A MERGE: the picker hands over the full list it is showing,
   so a tag the manager unticked has to come off. Computed as a difference
   rather than delete-then-insert, because the empty window in between is a
   window where the library renders the document as untagged — and because a
   failed insert after a successful delete would silently strip a row.

   The caller has already sanitised the ids against the org's real tags
   (lib/tiff/tags.ts::sanitiseTagIds); this trusts that and scopes the writes
   to the org anyway. Returns false only when the database refused. */
export async function setKbDocumentTags(
  orgId: string,
  documentId: string,
  tagIds: readonly string[]
): Promise<boolean> {
  const { data, error: readErr } = await supabaseAdmin
    .from("kb_document_tags")
    .select("tag_id")
    .eq("org_id", orgId)
    .eq("document_id", documentId);
  if (readErr) return false;

  const have = new Set(((data ?? []) as unknown as { tag_id: unknown }[]).map((r) => String(r.tag_id)));
  const want = new Set(tagIds.map(String));

  const add = [...want].filter((id) => !have.has(id));
  const drop = [...have].filter((id) => !want.has(id));

  if (add.length > 0) {
    const { error } = await supabaseAdmin.from("kb_document_tags").insert(
      add.map((tagId) => ({ org_id: orgId, document_id: documentId, tag_id: tagId }))
    );
    if (error) return false;
  }

  if (drop.length > 0) {
    const { error } = await supabaseAdmin
      .from("kb_document_tags")
      .delete()
      .eq("org_id", orgId)
      .eq("document_id", documentId)
      .in("tag_id", drop);
    if (error) return false;
  }

  return true;
}
