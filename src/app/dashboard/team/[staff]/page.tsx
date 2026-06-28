import { notFound } from "next/navigation";
import { getDemoStaff } from "@/mock/demo";
import { profileHtml } from "@/components/shell/profile";
import { ProfileBehaviors } from "@/components/shell/profile-behaviors";

export default async function StaffProfilePage({
  params,
}: {
  params: Promise<{ staff: string }>;
}) {
  const { staff } = await params;
  const record = getDemoStaff(staff);
  if (!record) notFound();

  return <ProfileBehaviors html={profileHtml(record)} />;
}
