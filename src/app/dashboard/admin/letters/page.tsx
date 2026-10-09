import { redirect } from "next/navigation";
import { auth0 } from "@/lib/auth0";
import { getDbRole } from "@/lib/permissions-server";
import { hasMinRole } from "@/lib/roles";
import { staffIdFor } from "@/lib/workboard/projects-query";
import { listLetters } from "@/lib/letters/query";
import { LettersList } from "@/components/letters/letters-list";
import "@/components/admin/templates.css";

/* LETTERS — in Admin, so admin and up, like the rest of the section. Each
   person sees the letters they wrote or sign; the owner sees them all. */
export default async function LettersPage() {
  const session = await auth0.getSession();
  if (!session) redirect("/auth/login");
  const orgId = session.orgId as string | undefined;
  const userId = session.user?.sub as string | undefined;
  if (!orgId || !userId) redirect("/dashboard");
  const role = await getDbRole();
  if (!hasMinRole(role, "admin")) redirect("/dashboard");
  const staffId = await staffIdFor(orgId, userId);
  const letters = await listLetters(orgId, { staffId, isOwner: hasMinRole(role, "owner") });
  return <LettersList letters={letters} />;
}
