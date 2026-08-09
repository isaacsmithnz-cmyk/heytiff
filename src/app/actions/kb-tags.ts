"use server";

import { revalidatePath } from "next/cache";
import { requireOrg } from "@/lib/permissions-server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { staffProfileIdFor } from "@/lib/fleet/query";
import {
  asKbTagColor,
  asKbTagKind,
  checkKbTagLabel,
  KB_TAG_COLOR_DEFAULT,
  KB_TAGS_PER_ORG_MAX,
  kbTagColorFor,
  type KbTagKind,
  type KbTagRef,
} from "@/lib/tiff/tags";

/* Making, renaming and removing tags.

   EVERY ACTION NAMES `tiff_manage`, like every other write in the library:
   Server Functions are reachable by direct POST, so the absent button on the
   screen is not a gate — this is.

   REMOVING A TAG IS NOT OWNER-ONLY, and deleting a document is. The difference
   is what's lost: a document is what answers are quoted from, so removing one
   quietly changes what the whole company is told. A tag is a label on the
   spine — taking it off costs a filter, not an answer, and the documents are
   all still there. Anyone trusted to add manuals is trusted to tidy the
   labels on them.

   RE-TYPING AN EXISTING TAG FINDS IT. The slug is the identity, so "daikin"
   typed into the create box when "Daikin" already exists returns the tag
   that's there. A create that quietly does nothing would be worse: the picker
   would show no new chip and the manager would type it again. */

export type KbTagResult = { ok: true; tag: KbTagRef } | { ok: false; error: string };
export type KbTagVoid = { ok: true } | { ok: false; error: string };

const NO_MANAGE = "You don't have access to manage the library.";
const GONE = "That tag is no longer here.";

type Ctx = { orgId: string; userId: string };

async function ctx(): Promise<Ctx | null> {
  try {
    return await requireOrg("tiff_manage");
  } catch {
    return null;
  }
}

function refresh() {
  revalidatePath("/dashboard/tiff");
  revalidatePath("/dashboard/tiff/library");
}

const toRef = (r: Record<string, unknown>): KbTagRef => ({
  id: String(r.id),
  label: String(r.label ?? ""),
  slug: String(r.slug ?? ""),
  color: asKbTagColor(r.color) ?? KB_TAG_COLOR_DEFAULT,
  kind: asKbTagKind(r.kind) ?? "topic",
});

const SELECT = "id, label, slug, color, kind";

/** Create a tag, or hand back the one that already answers to that name. */
export async function createKbTag(input: {
  label: string;
  color?: string;
  kind?: string;
}): Promise<KbTagResult> {
  const c = await ctx();
  if (!c) return { ok: false, error: NO_MANAGE };

  const checked = checkKbTagLabel(input.label);
  if (!checked.ok) return { ok: false, error: checked.error };
  const { label, slug } = checked.value;

  /* The slug carries the identity, so this is the dedupe — and it runs before
     the ceiling check, because finding an existing tag is not creating one and
     a full library must still be able to re-tag a document. */
  const { data: existing } = await supabaseAdmin
    .from("kb_tags")
    .select(SELECT)
    .eq("org_id", c.orgId)
    .eq("slug", slug)
    .maybeSingle();
  if (existing) return { ok: true, tag: toRef(existing as Record<string, unknown>) };

  const { count } = await supabaseAdmin
    .from("kb_tags")
    .select("id", { count: "exact", head: true })
    .eq("org_id", c.orgId);
  if ((count ?? 0) >= KB_TAGS_PER_ORG_MAX)
    return {
      ok: false,
      error: `That's ${KB_TAGS_PER_ORG_MAX} tags — remove one you don't use before adding another.`,
    };

  const kind: KbTagKind = asKbTagKind(input.kind) ?? "topic";
  const staffId = await staffProfileIdFor(c.orgId, c.userId);

  const { data, error } = await supabaseAdmin
    .from("kb_tags")
    .insert({
      org_id: c.orgId,
      label,
      slug,
      color: asKbTagColor(input.color) ?? kbTagColorFor(label),
      kind,
      created_by: staffId,
    })
    .select(SELECT)
    .maybeSingle();

  /* The unique index can still fire: two people can type the same new tag in
     the same second, and the read above saw nothing for either of them. The
     loser reads the winner's row rather than showing an error for a tag that
     now exists and is exactly what they asked for. */
  if (error || !data) {
    const { data: raced } = await supabaseAdmin
      .from("kb_tags")
      .select(SELECT)
      .eq("org_id", c.orgId)
      .eq("slug", slug)
      .maybeSingle();
    if (raced) return { ok: true, tag: toRef(raced as Record<string, unknown>) };
    return { ok: false, error: "Couldn't create that tag." };
  }

  refresh();
  return { ok: true, tag: toRef(data as Record<string, unknown>) };
}

/** Rename a tag, recolour it, or move it between groups. */
export async function updateKbTag(
  tagId: string,
  input: { label?: string; color?: string; kind?: string }
): Promise<KbTagResult> {
  const c = await ctx();
  if (!c) return { ok: false, error: NO_MANAGE };

  const patch: Record<string, unknown> = {};

  if (input.label !== undefined) {
    const checked = checkKbTagLabel(input.label);
    if (!checked.ok) return { ok: false, error: checked.error };
    patch.label = checked.value.label;
    patch.slug = checked.value.slug;

    /* A rename onto a name that already exists is a MERGE request wearing a
       rename's clothes, and merging two tags means rewriting every document
       that wears either. Refused plainly rather than half-done. */
    const { data: clash } = await supabaseAdmin
      .from("kb_tags")
      .select("id")
      .eq("org_id", c.orgId)
      .eq("slug", checked.value.slug)
      .neq("id", tagId)
      .maybeSingle();
    if (clash) return { ok: false, error: `There's already a tag called “${checked.value.label}”.` };
  }

  if (input.color !== undefined) {
    const color = asKbTagColor(input.color);
    if (!color) return { ok: false, error: "That isn't a colour." };
    patch.color = color;
  }

  if (input.kind !== undefined) {
    const kind = asKbTagKind(input.kind);
    if (!kind) return { ok: false, error: "That isn't one of the groups." };
    patch.kind = kind;
  }

  if (Object.keys(patch).length === 0) {
    const { data } = await supabaseAdmin
      .from("kb_tags")
      .select(SELECT)
      .eq("org_id", c.orgId)
      .eq("id", tagId)
      .maybeSingle();
    if (!data) return { ok: false, error: GONE };
    return { ok: true, tag: toRef(data as Record<string, unknown>) };
  }

  patch.updated_at = new Date().toISOString();

  const { data, error } = await supabaseAdmin
    .from("kb_tags")
    .update(patch)
    .eq("org_id", c.orgId)
    .eq("id", tagId)
    .select(SELECT)
    .maybeSingle();
  if (error) return { ok: false, error: "Couldn't save that tag." };
  if (!data) return { ok: false, error: GONE };

  refresh();
  return { ok: true, tag: toRef(data as Record<string, unknown>) };
}

/* Remove a tag from the org.

   Every document wearing it loses the label — the join rows go by cascade, the
   documents themselves are untouched, and nothing Tiff can quote changes. The
   sheet says the count before it asks. */
export async function deleteKbTag(tagId: string): Promise<KbTagVoid> {
  const c = await ctx();
  if (!c) return { ok: false, error: NO_MANAGE };

  const { error } = await supabaseAdmin
    .from("kb_tags")
    .delete()
    .eq("org_id", c.orgId)
    .eq("id", tagId);
  if (error) return { ok: false, error: "Couldn't remove that tag." };

  refresh();
  return { ok: true };
}
