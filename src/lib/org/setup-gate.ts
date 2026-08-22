import { redirect } from "next/navigation";
import { auth0 } from "@/lib/auth0";
import { hasMinRole } from "@/lib/roles";
import { getDbRole } from "@/lib/permissions-server";
import { orgSetupPending } from "./query";

/* The one place the app steers a fresh company into first-run setup.

   HOME ONLY, AND SOFT ON PURPOSE. Sign-in lands on /dashboard
   (signInReturnToPath), so gating Home catches every new owner exactly where
   they arrive — without wiring a DB read into the proxy (which is a login
   gate, nothing more) or into the dashboard layout (synchronous by design;
   see its header). Someone who deep-links straight to another screen simply
   isn't intercepted: the wizard is a welcome, not a lock, and Home re-offers
   it next visit.

   OWNERS ONLY. Staff can land in an org whose owner hasn't finished setup —
   invited before the owner got around to it — and a screen of company fields
   they cannot save is worse than the empty Home they can at least use.

   getDbRole rides the request-cached membership read every dashboard screen
   already makes, so the only cost this adds to Home is the one-column
   setup read — and only for owners. */
export async function redirectIfSetupPending(): Promise<void> {
  const session = await auth0.getSession();
  const orgId = session?.orgId as string | undefined;
  if (!orgId) return;
  if (!hasMinRole(await getDbRole(), "owner")) return;
  if (await orgSetupPending(orgId)) redirect("/welcome");
}
