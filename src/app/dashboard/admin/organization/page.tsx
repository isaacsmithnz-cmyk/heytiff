import { redirect } from "next/navigation";
import { auth0 } from "@/lib/auth0";
import { supabaseAdmin } from "@/lib/supabase-server";
import { hasMinRole } from "@/lib/roles";
import { getDbRole, isMaster } from "@/lib/permissions-server";
import { OrgScreen } from "@/components/org/org-screen";
import { listOrgCredentials, listOwnerCandidates, orgAccount } from "@/lib/org/query";
import { signOne } from "@/lib/documents/query";
import { todayInAu } from "@/lib/au-dates";
import {
  clearOrgBrandColor,
  clearOrgLogo,
  saveOrgSection,
  setOrgBrandColor,
  setOrgLogo,
} from "@/app/actions/org";
import {
  addOrgCredential,
  removeOrgCredential,
  updateOrgCredential,
} from "@/app/actions/org-credentials";
import { transferOwnership } from "@/app/actions/org-ownership";
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
  "website, address, suburb, state, postcode, logo_url, brand_color";
// primary_owner_user_id and the legacy `name` are deliberately not selected —
// this screen edits the company profile, not ownership or the signup seed.

export default async function OrganizationPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
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
  /* THE HANDOVER IS MASTER-ONLY, so the roster it needs is loaded for the
     master and nobody else: a co-owner's render makes one query fewer and
     ships no list of user ids to a client that has no control to use it. */
  const master = await isMaster();
  const [credentials, account, logoUrl, ownerCandidates, params] = await Promise.all([
    listOrgCredentials(orgId),
    // whose account this is — owner, size, age, plan. The viewer's sub goes in
    // so the card can say "You" rather than printing a co-owner their own
    // name as if it were someone else's.
    orgAccount(orgId, session.user.sub as string),
    // the column holds a storage ref; the bucket is private, so the link is
    // minted here and expires
    signOne(org.logo_url),
    master
      ? listOwnerCandidates(orgId, session.user.sub as string)
      : Promise.resolve([]),
    // which tab a shared link asks for — read here rather than with
    // useSearchParams, so the screen needs no Suspense boundary around it
    searchParams,
  ]);

  return (
    <OrgScreen
      org={org}
      credentials={credentials}
      account={account}
      ownerCandidates={ownerCandidates}
      logoUrl={logoUrl}
      today={todayInAu()}
      initialSec={typeof params.sec === "string" ? params.sec : undefined}
      // Configured or not — the boolean crosses to the client, the key never
      // does (no NEXT_PUBLIC_ prefix, so Next cannot inline it either).
      addressLookup={Boolean(process.env.GOOGLE_MAPS_API_KEY)}
      actions={{
        onSave: saveOrgSection,
        onAddCredential: addOrgCredential,
        onUpdateCredential: updateOrgCredential,
        onRemoveCredential: removeOrgCredential,
        onSetLogo: setOrgLogo,
        onClearLogo: clearOrgLogo,
        onSetBrandColor: setOrgBrandColor,
        onClearBrandColor: clearOrgBrandColor,
        // absent for a co-owner: the control is not rendered rather than
        // rendered-and-refused. The action re-checks anyway.
        onTransferOwnership: master ? transferOwnership : undefined,
      }}
    />
  );
}
