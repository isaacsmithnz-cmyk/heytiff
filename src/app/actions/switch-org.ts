"use server";

import { auth0 } from "@/lib/auth0";
import { supabaseAdmin } from "@/lib/supabase-server";
import { redirect } from "next/navigation";

export async function switchOrg(formData: FormData) {
  const targetOrgId = formData.get("orgId") as string;
  const session = await auth0.getSession();
  if (!session) throw new Error("Not authenticated");

  // Verify the user is actually a member before switching
  const { data: membership } = await supabaseAdmin
    .from("memberships")
    .select("org_id, role")
    .eq("user_id", session.user.sub)
    .eq("org_id", targetOrgId)
    .single();

  if (!membership) throw new Error("Not a member of this org");

  await auth0.updateSession({ ...session, orgId: targetOrgId, orgRole: membership.role });
  redirect("/dashboard");
}
