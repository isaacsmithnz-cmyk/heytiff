import { redirect } from "next/navigation";
import { auth0 } from "@/lib/auth0";
import { profileHtml, type ProfileHeader } from "@/components/shell/profile";
import { ProfileBehaviors } from "@/components/shell/profile-behaviors";
import { loadMyProfile, saveMyProfileSection } from "@/app/actions/profile";
import { initialsFrom, startedLabel, yearsSince } from "@/lib/staff/derive";

/* My profile — your own staff card, and the values that fill in Team.

   Payroll / Permissions / Notes are NOT rendered here (mode: "self", and no
   `sections` passed). They are admin-only and live in the admin-gated Team
   section. The save action's allowlist has no such columns either, so the
   omission is enforced, not merely visual. */

export default async function MyProfilePage() {
  const session = await auth0.getSession();
  if (!session) redirect("/auth/login");

  const profile = await loadMyProfile();

  const email = session.user.email ?? "";
  const displayName =
    profile.full_name ||
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
    licenceCount: 0,
    status: profile.status,
  };

  return (
    <ProfileBehaviors
      html={profileHtml(header, { mode: "self", profile })}
      onSave={saveMyProfileSection}
    />
  );
}
