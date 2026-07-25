import { redirect } from "next/navigation";
import { auth0 } from "@/lib/auth0";
import { ProfileScreen } from "@/components/profile/profile-screen";
import type { ProfileHeader } from "@/components/profile/types";
import {
  addMyLicence,
  loadMyProfile,
  removeMyLicence,
  saveMyProfileSection,
} from "@/app/actions/profile";
import { initialsFrom, startedLabel, yearsSince } from "@/lib/staff/derive";
import { fullNameOf } from "@/lib/staff/name";
import { assignedVehicleFor } from "@/lib/fleet/query";
import { listLicences } from "@/lib/staff/query";
import { getMyPay } from "@/lib/staff/my-pay";
import { getOrgName } from "@/lib/permissions-server";
import { todayInAu } from "@/lib/au-dates";

/* My profile — your own staff card, and the values that fill in Team.

   Payroll / Permissions / Notes are NOT rendered here (mode: "self", and no
   adminExtras passed). They are admin-only and live in the admin-gated Team
   section. The save action's allowlist has no such columns either, so the
   omission is enforced, not merely visual.

   My pay is the mirror image and the reason this page reads pay at all: your
   own rate is intrinsic, so getMyPay resolves YOUR row by org + user id and
   never goes near the `financials`-gated reads that serve other people's. */

export default async function MyProfilePage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const session = await auth0.getSession();
  if (!session) redirect("/auth/login");

  const profile = await loadMyProfile();
  const orgId = session.orgId as string | undefined;
  const userId = session.user.sub as string;
  const [assignedVehicle, licences, myPay, orgName, params] = await Promise.all([
    orgId ? assignedVehicleFor(orgId, profile.id) : Promise.resolve(null),
    orgId ? listLicences(orgId, profile.id) : Promise.resolve([]),
    orgId ? getMyPay(orgId, userId) : Promise.resolve(null),
    getOrgName(),
    searchParams,
  ]);

  const email = session.user.email ?? "";
  const displayName =
    fullNameOf(profile) ||
    (session.user.name as string | undefined) ||
    email.split("@")[0] ||
    "User";

  // Header stats come from the stored card; unknowns render as an em dash
  // rather than invented values.
  const header: ProfileHeader = {
    id: profile.id,
    initials: initialsFrom(displayName, email),
    name: displayName,
    nickname: profile.preferred_name || undefined,
    email,
    role: profile.job_title || "—",
    employmentType: profile.employment_type || "—",
    started: startedLabel(profile.start_date),
    years: yearsSince(profile.start_date),
    licenceCount: licences.length,
    status: profile.status,
  };

  // read here, not with useSearchParams: the screen only needs the OPENING
  // section, and reading it on the server keeps the page out of a Suspense
  // boundary it would otherwise need.
  const sec = params.sec;

  return (
    <ProfileScreen
      mode="self"
      header={header}
      profile={profile}
      licences={licences}
      vehicle={assignedVehicle}
      today={todayInAu()}
      org={orgName}
      myPay={myPay}
      initialSec={typeof sec === "string" ? sec : undefined}
      actions={{
        onSave: saveMyProfileSection,
        onAddLicence: addMyLicence,
        onRemoveLicence: removeMyLicence,
      }}
    />
  );
}
