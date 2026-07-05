"use server";

import { auth0 } from "@/lib/auth0";
import { supabaseAdmin } from "@/lib/supabase-server";
import { newId } from "@/lib/studio/document";

/* Floor-plan image storage — signed-URL flow so image bytes never pass
   through a server action (no body-size limits): the client asks for a
   signed upload slot, PUTs the rendered page image straight to storage,
   and stores only the ref (path) in the design document. Every ref is
   validated against the caller's org prefix. */

const BUCKET = "studio-plans";

async function requireOrg(): Promise<string> {
  const session = await auth0.getSession();
  if (!session) throw new Error("Not authenticated");
  const orgId = session.orgId as string | undefined;
  if (!orgId) throw new Error("No active organization");
  return orgId;
}

function assertOrgRef(ref: string, orgId: string): void {
  if (!ref.startsWith(`org/${orgId}/`)) {
    throw new Error("Plan image does not belong to this organization");
  }
}

export async function createPlanUpload(
  ext: "png" | "jpeg"
): Promise<{ ref: string; token: string }> {
  const orgId = await requireOrg();
  const ref = `org/${orgId}/${newId("plan")}.${ext}`;
  const { data, error } = await supabaseAdmin.storage
    .from(BUCKET)
    .createSignedUploadUrl(ref);
  if (error || !data) throw new Error(error?.message ?? "Could not create upload");
  return { ref, token: data.token };
}

/** Short-lived read URL for rendering a stored plan on the canvas. */
export async function planImageUrl(ref: string): Promise<string> {
  const orgId = await requireOrg();
  assertOrgRef(ref, orgId);
  const { data, error } = await supabaseAdmin.storage
    .from(BUCKET)
    .createSignedUrl(ref, 3600);
  if (error || !data) throw new Error(error?.message ?? "Could not sign URL");
  return data.signedUrl;
}

export async function deletePlanImage(ref: string): Promise<void> {
  const orgId = await requireOrg();
  assertOrgRef(ref, orgId);
  const { error } = await supabaseAdmin.storage.from(BUCKET).remove([ref]);
  if (error) throw new Error(error.message);
}
