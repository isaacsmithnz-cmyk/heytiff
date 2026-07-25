import { redirect } from "next/navigation";
import { auth0 } from "@/lib/auth0";
import { supabaseAdmin } from "@/lib/supabase-server";
import { hasMinRole } from "@/lib/roles";
import { getDbRole } from "@/lib/permissions-server";
import { OrgScreen } from "@/components/org/org-screen";
import { listOrgCredentials } from "@/lib/org/query";
import { signOne } from "@/lib/documents/query";
import { todayInAu } from "@/lib/au-dates";
import { clearOrgLogo, saveOrgSection, setOrgLogo } from "@/app/actions/org";
import {
  addOrgCredential,
  removeOrgCredential,
  updateOrgCredential,
} from "@/app/actions/org-credentials";
import type { OrgSettings } from "@/lib/org/settings";

/* Organisation settings — owner-only (co-owners included; org settings are
   owner-intrinsic, unlike billing which is master-only).

   React now, on the staff card's machinery (components/profile/section-card),
   where this screen used to be an HTML string driven by ProfileBehaviors — the
   last caller of the injected-HTML profile renderer, which goes with it.

   The compliance COLUMNS are gone from this select: the ARC authorisation, the
   contractor licence and the insurance policy are rows in org_credentials now
   (docs/migrations/org_credentials.sql). The columns themselves drop in a later
   cleanup migration; nothing here reads them. */

const COLUMNS =
  "id, trading_name, legal_name, abn, acn, gst_registered, email, phone, " +
  "website, address, suburb, state, postcode, logo_url";
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

  const org = data as unknown as OrgSettings;
  const [credentials, logoUrl] = await Promise.all([
    listOrgCredentials(orgId),
    // the column holds a storage ref; the bucket is private, so the link is
    // minted here and expires
    signOne(org.logo_url),
  ]);

  return (
    <OrgScreen
      org={org}
      credentials={credentials}
      logoUrl={logoUrl}
      today={todayInAu()}
      actions={{
        onSave: saveOrgSection,
        onAddCredential: addOrgCredential,
        onUpdateCredential: updateOrgCredential,
        onRemoveCredential: removeOrgCredential,
        onSetLogo: setOrgLogo,
        onClearLogo: clearOrgLogo,
      }}
    />
  );
}
