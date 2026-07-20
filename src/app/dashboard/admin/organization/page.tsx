import { redirect } from "next/navigation";
import { auth0 } from "@/lib/auth0";
import { supabaseAdmin } from "@/lib/supabase-server";
import { hasMinRole } from "@/lib/roles";
import { getDbRole } from "@/lib/permissions-server";
import { orgSettingsHtml } from "@/components/shell/org-settings";
import { ProfileBehaviors } from "@/components/shell/profile-behaviors";
import { saveOrgSection } from "@/app/actions/org";
import type { OrgSettings } from "@/lib/org/settings";

/* Organisation settings — owner-only (co-owners included; org settings are
   owner-intrinsic, unlike billing which is master-only). Reuses the staff
   card's per-card edit machinery: ProfileBehaviors + a section allowlist in
   the save action. */

const COLUMNS =
  "id, trading_name, legal_name, abn, acn, gst_registered, email, phone, " +
  "website, address, suburb, state, postcode, arc_rta, contractor_licence, " +
  "insurer, insurance_policy, insurance_expiry, logo_url";
// primary_owner_user_id and the legacy `name` are deliberately not selected —
// this screen edits the company profile, not ownership or the signup seed.

export default async function OrganizationPage() {
  const session = await auth0.getSession();
  if (!session) redirect("/auth/login");
  if (!hasMinRole(await getDbRole(), "owner")) redirect("/dashboard");

  const orgId = session.orgId as string;
  const { data } = await supabaseAdmin
    .from("organizations")
    .select(COLUMNS)
    .eq("id", orgId)
    .maybeSingle();
  if (!data) redirect("/dashboard");

  return (
    <ProfileBehaviors
      html={orgSettingsHtml(data as unknown as OrgSettings)}
      onSave={saveOrgSection}
    />
  );
}
