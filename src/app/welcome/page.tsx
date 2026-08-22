import { redirect } from "next/navigation";
import { auth0 } from "@/lib/auth0";
import { supabaseAdmin } from "@/lib/supabase-server";
import { hasMinRole } from "@/lib/roles";
import { getDbRole } from "@/lib/permissions-server";
import { orgSetupPending } from "@/lib/org/query";
import { formatAbn } from "@/lib/org/settings";
import { EMPTY_SETUP_DRAFT, type SetupDraft } from "@/lib/org/setup";
import { completeOrgSetup, skipOrgSetup } from "@/app/actions/org-setup";
import { CompanySetup } from "@/components/org/company-setup";

/* First-run company setup — where Home sends the owner of a brand-new org
   (lib/org/setup-gate.ts) before the empty dashboard gets a chance to read
   as a broken product.

   Uninvited first sign-in mints the org with nothing on it but the founder's
   email (lib/auth0.ts, create_org_for_owner): no trading name for the
   sidebar, no ABN for a document, no state for the public-holiday calendar.
   This screen collects those standard facts once, through the same section
   writes the Organisation screen makes — it adds no writable surface, only a
   front door.

   EVERY GUARD RESOLVES TO A REDIRECT, not an error page: this URL survives
   in history and can be revisited signed out, org-less, demoted, or long
   after setup finished, and each of those people has a better screen than a
   refusal. The DRAFT PREFILLS FROM THE ROW rather than assuming emptiness —
   an owner who half-filled Admin → Organisation first, or whose finish was
   interrupted between the section saves and the stamp, should find their
   words waiting, not a blank form asking again.

   Deliberately NOT prefilled: the contact email from the login. Seeding
   company-facing facts from personal ones is how every org in prod ended up
   named after somebody's gmail — the fields stay empty until the owner says
   what the BUSINESS uses. */

const COLUMNS =
  "trading_name, legal_name, abn, gst_registered, email, phone, address, suburb, state, postcode";

export default async function WelcomePage() {
  const session = await auth0.getSession();
  if (!session) redirect("/auth/login");

  const orgId = session.orgId as string | undefined;
  if (!orgId) redirect("/dashboard");
  if (!hasMinRole(await getDbRole(), "owner")) redirect("/dashboard");
  if (!(await orgSetupPending(orgId))) redirect("/dashboard");

  const { data } = await supabaseAdmin
    .from("organizations")
    .select(COLUMNS)
    .eq("id", orgId)
    .maybeSingle();

  const str = (v: unknown) => (typeof v === "string" ? v : "");
  const initial: SetupDraft = data
    ? {
        trading_name: str(data.trading_name),
        legal_name: str(data.legal_name),
        // stored bare, offered back in the ATO grouping the owner knows
        abn: data.abn ? formatAbn(String(data.abn)) : "",
        gst_registered:
          data.gst_registered === true ? "Yes" : data.gst_registered === false ? "No" : "",
        email: str(data.email),
        phone: str(data.phone),
        address: str(data.address),
        suburb: str(data.suburb),
        state: str(data.state),
        postcode: str(data.postcode),
      }
    : EMPTY_SETUP_DRAFT;

  return (
    <CompanySetup
      initial={initial}
      actions={{ onComplete: completeOrgSetup, onSkip: skipOrgSetup }}
    />
  );
}
