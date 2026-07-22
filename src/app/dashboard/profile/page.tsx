import { redirect } from "next/navigation";
import { auth0 } from "@/lib/auth0";
import { profileHtml } from "@/components/shell/profile";
import { ProfileBehaviors } from "@/components/shell/profile-behaviors";
import { loadMyProfile, saveMyProfileSection } from "@/app/actions/profile";
import { yearsSince } from "@/lib/staff/derive";
import type { DemoStaff } from "@/mock/demo";

/* My profile — your own staff card, and the values that fill in Team.

   Payroll / Permissions / Notes are NOT rendered here (mode: "self"). They are
   admin-only and live in the admin-gated Team section. The save action's
   allowlist has no such columns either, so the omission is enforced, not
   merely visual. */

function initialsFrom(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

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
  const record: DemoStaff = {
    id: profile.id,
    initials: initialsFrom(displayName || email || "U"),
    name: displayName,
    nickname: profile.preferred_name || undefined,
    email,
    role: profile.job_title || "—",
    employmentType: profile.employment_type || "—",
    started: profile.start_date
      ? new Date(profile.start_date).toLocaleDateString("en-AU", {
          month: "short",
          year: "numeric",
        })
      : "—",
    years: yearsSince(profile.start_date),
    licenceCount: 0,
    status: profile.status,
    compliance: { label: "—", state: "ok", expiresDays: 9999 },
  };

  return (
    <ProfileBehaviors
      html={profileHtml(record, { mode: "self", profile })}
      onSave={saveMyProfileSection}
    />
  );
}
