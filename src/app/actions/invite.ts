"use server";

import { auth0 } from "@/lib/auth0";
import { supabaseAdmin } from "@/lib/supabase-server";
import { hasMinRole } from "@/lib/roles";
import { redirect } from "next/navigation";

export async function createInvite(formData: FormData) {
  const session = await auth0.getSession();
  if (!session) throw new Error("Not authenticated");

  const orgRole = session.orgRole as string | undefined;
  if (!hasMinRole(orgRole as "owner" | "admin" | "staff" | null, "admin")) {
    throw new Error("Insufficient permissions");
  }

  const email = formData.get("email") as string;
  const role = formData.get("role") as string;
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
