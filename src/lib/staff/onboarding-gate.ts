import { redirect } from "next/navigation";
import { auth0 } from "@/lib/auth0";
import { hasMinRole } from "@/lib/roles";
import { getDbRole } from "@/lib/permissions-server";
import { onboardingPending } from "./onboarding";

/* The one place the app steers a newly joined staff member into their first
   run. Built the way lib/org/setup-gate.ts is, and for the same reasons.

   HOME ONLY, AND SOFT. Sign-in and the invite-accept route both land on
   /dashboard, so gating Home catches everyone exactly where they arrive,
   without a DB read in the proxy or in the synchronous dashboard layout.
   Someone who deep-links elsewhere simply is not intercepted.

   EVERYONE BUT THE OWNER. An owner's first run is /welcome, which sets up the
   company; their own card is one they reach from there. Staff, managers and
   admins all joined somebody else's workspace, and all of them were seeded
   with a name nobody asked them for — an admin's card is no better than a
   crew member's. */
export async function redirectIfOnboardingPending(): Promise<void> {
  const session = await auth0.getSession();
  const orgId = session?.orgId as string | undefined;
  const userId = session?.user?.sub as string | undefined;
  if (!orgId || !userId) return;
  if (hasMinRole(await getDbRole(), "owner")) return;
  if (await onboardingPending(orgId, userId)) redirect("/welcome/details");
}
