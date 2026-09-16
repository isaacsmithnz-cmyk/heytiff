import { redirect } from "next/navigation";
import { auth0 } from "@/lib/auth0";
import { hasMinRole } from "@/lib/roles";
import { getDbRole, getOrgName } from "@/lib/permissions-server";
import { onboardingPending } from "@/lib/staff/onboarding";
import { looksLikeAName } from "@/lib/staff/name";
import { formatAuDate } from "@/lib/au-dates";
import { loadMyProfile } from "@/app/actions/profile";
import { completeMyOnboarding, skipMyOnboarding } from "@/app/actions/onboarding";
import { StaffOnboarding, type OnboardingDraft } from "@/components/onboarding/staff-onboarding";

/* A new staff member's first run — where Home sends somebody who has joined a
   workspace and never been asked their name (lib/staff/onboarding-gate.ts).

   EVERY GUARD RESOLVES TO A REDIRECT, not an error page, as /welcome's do: this
   URL survives in history and can be revisited signed out, org-less, as the
   owner, or long after it was answered, and each of those people has a better
   screen than a refusal.

   THE DRAFT PREFILLS FROM THE CARD, with one exception. A name the org typed on
   the invitation, or that the person already corrected, is offered back to be
   confirmed. A name that is really an address prefix is offered back only if it
   could be a name — `luke`, to be capitalised, yes; `isaacsmithnz+test`, which
   they would have to delete before they could type, no. */
export default async function StaffDetailsPage() {
  const session = await auth0.getSession();
  if (!session) redirect("/auth/login");

  const orgId = session.orgId as string | undefined;
  if (!orgId) redirect("/dashboard");
  if (hasMinRole(await getDbRole(), "owner")) redirect("/dashboard");
  if (!(await onboardingPending(orgId, session.user.sub as string))) redirect("/dashboard");

  const [p, orgName] = await Promise.all([loadMyProfile(), getOrgName()]);
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  const nameish = (v: unknown) => (looksLikeAName(v) ? str(v) : "");

  const initial: OnboardingDraft = {
    first_name: nameish(p.first_name),
    last_name: nameish(p.last_name),
    preferred_name: str(p.preferred_name),
    birthday: p.birthday ? formatAuDate(p.birthday) : "",
    phone: str(p.phone),
    address: str(p.address),
    emergency_name: str(p.emergency_name),
    emergency_relationship: str(p.emergency_relationship),
    emergency_phone: str(p.emergency_phone),
  };

  return (
    <StaffOnboarding
      initial={initial}
      orgName={orgName}
      actions={{ onComplete: completeMyOnboarding, onSkip: skipMyOnboarding }}
    />
  );
}
