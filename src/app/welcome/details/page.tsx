import { redirect } from "next/navigation";
import { auth0 } from "@/lib/auth0";
import { hasMinRole } from "@/lib/roles";
import { getDbRole, getOrgName } from "@/lib/permissions-server";
import { onboardingPending } from "@/lib/staff/onboarding";
import { FirstRun } from "@/components/first-run/first-run";
import { firstRunCommon } from "../first-run-props";
/* For the address box and the licence scan alone: their rules are `.fg`-scoped in the frame's sheet, and this page
   is outside the frame. Every rule in it is scoped to a class this page does not otherwise use. */
import "@/app/dashboard/shell.css";

/* SOMEONE JOINING A TEAM, THEIR FIRST RUN — where Home sends somebody who has
   joined a workspace and never been asked their name
   (lib/staff/onboarding-gate.ts), as the phone's (Isaac, 26 November 2026:
   "make the web first run match the phone"): your details, an emergency
   contact, your licences.

   EVERY GUARD RESOLVES TO A REDIRECT, as /welcome's do. THE DRAFT PREFILLS
   FROM THE CARD: a name the org typed on the invitation is offered back to be
   confirmed; a name that is really an address prefix only if it could be a
   name. */
export default async function StaffDetailsPage() {
  const session = await auth0.getSession();
  if (!session) redirect("/auth/login");
  const orgId = session.orgId as string | undefined;
  if (!orgId) redirect("/dashboard");
  if (hasMinRole(await getDbRole(), "owner")) redirect("/dashboard");
  if (!(await onboardingPending(orgId, session.user.sub as string))) redirect("/dashboard");

  const [common, orgName] = await Promise.all([firstRunCommon(), getOrgName()]);
  return <FirstRun steps={["details", "emergency", "licences"]} org={orgName} initialBusiness={{}} {...common} />;
}
