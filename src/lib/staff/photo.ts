import { supabaseAdmin } from "@/lib/supabase-server";
import { refIsOrgs } from "@/lib/documents/files";
import { signOne } from "@/lib/documents/query";

/* Pointing a staff card at an uploaded photo.

   The bytes already landed: the browser asked for a signed slot, PUT the file
   straight to storage and confirmed it (lib/documents/upload-client.ts). All
   the actions do is POINT `photo_url` at a document — which is exactly why
   this re-checks everything about that document instead of trusting the id it
   was handed. A Server Function is reachable by direct POST, so "the picker
   only offered your own upload" is not a control. Wrong org, wrong kind, or an
   upload that never finished are all refused.

   Shared by the admin action and the self action so the two can't drift: the
   only thing that differs between them is WHOSE row gets the ref. */

export type PhotoRef = { ok: true; ref: string } | { ok: false; error: string };

export async function resolvePhotoDocument(
  orgId: string,
  documentId: string
): Promise<PhotoRef> {
  const { data } = await supabaseAdmin
    .from("documents")
    .select("kind, storage_ref, uploaded_at")
    .eq("org_id", orgId)
    .eq("id", documentId)
    .maybeSingle();

  if (!data) return { ok: false, error: "That upload no longer exists." };
  if (data.kind !== "staff_photo") return { ok: false, error: "That file isn't a photo." };
  if (!data.uploaded_at) return { ok: false, error: "That upload didn't finish." };

  const ref = String(data.storage_ref);
  // The path itself carries the org — a confirmed document from another org
  // could otherwise be pointed at by id alone.
  if (!refIsOrgs(ref, orgId)) {
    return { ok: false, error: "That file doesn't belong to this organisation." };
  }
  return { ok: true, ref };
}

/* photo_url holds a STORAGE REF now, but it did not always: a card created
   before this existed was seeded with the absolute URL Auth0 had for the
   person (see actions/profile.ts). Both stay valid — an absolute URL is used
   as-is, anything else is a ref and gets signed at render.

   Kept as one exported predicate rather than an inline `startsWith` at each
   render site, so the day the seeded URLs are migrated there is one place to
   delete. */
export function isAbsolutePhotoUrl(value: string | null | undefined): boolean {
  return typeof value === "string" && /^https?:\/\//i.test(value);
}

/** What the avatar should actually load: an Auth0 URL as-is, a storage ref
    signed per render (a link into a private bucket has to be), and null for
    both "no photo" and "the object is gone" — the caller draws initials for
    either, rather than a broken image. */
export async function signPhotoUrl(value: string | null | undefined): Promise<string | null> {
  if (!value) return null;
  if (isAbsolutePhotoUrl(value)) return value;
  return signOne(value);
}
