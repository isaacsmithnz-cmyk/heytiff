"use server";

import { auth0 } from "@/lib/auth0";
import { supabaseAdmin } from "@/lib/supabase-server";
import { getCapabilities, getDbRole } from "@/lib/permissions-server";
import { invitableRoles } from "@/lib/permissions";
import { redirect } from "next/navigation";

export async function createInvite(formData: FormData) {
  const session = await auth0.getSession();
  if (!session) throw new Error("Not authenticated");

  // Two separate checks, both server-side: MAY they invite at all, and may
  // they invite AT THIS ROLE. The form only offers permitted roles, but a
  // direct POST can say anything — a delegated inviter asking for "admin"
  // is a role assignment, and those are owner-only.
  const [actorRole, caps] = await Promise.all([getDbRole(), getCapabilities()]);
  const allowedRoles = invitableRoles(actorRole, caps);
  if (allowedRoles.length === 0) throw new Error("Insufficient permissions");

  const email = formData.get("email") as string;
  const role = formData.get("role") as string;
  if (!allowedRoles.includes(role as (typeof allowedRoles)[number])) {
    throw new Error("Insufficient permissions to invite at that role");
  }
  const orgId = session.orgId as string;

  const { error } = await supabaseAdmin.from("invitations").insert({
    org_id: orgId,
    email,
    role,
    invited_by: session.user.sub,
  });

  if (error) throw new Error(error.message);

  // TODO: send invite email via Resend when wired up

  redirect("/dashboard/admin/invite");
}
