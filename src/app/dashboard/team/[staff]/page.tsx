import { notFound, redirect } from "next/navigation";
import { getDemoStaff } from "@/mock/demo";
import { profileHtml } from "@/components/shell/profile";
import { ProfileBehaviors } from "@/components/shell/profile-behaviors";
import { can } from "@/lib/permissions-server";

// Capability-gated (`team`, default admin+) — this view includes the Payroll
// and Permissions sections; Payroll additionally needs `financials` once the
// card is wired to real data. Your own card lives at /dashboard/profile and
// omits them entirely.

export default async function StaffProfilePage({
  params,
}: {
  params: Promise<{ staff: string }>;
}) {
  if (!(await can("team"))) redirect("/dashboard");

  const { staff } = await params;
  const record = getDemoStaff(staff);
  if (!record) notFound();

  return <ProfileBehaviors html={profileHtml(record, { mode: "admin" })} />;
}
