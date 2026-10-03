import { redirect } from "next/navigation";
import { auth0 } from "@/lib/auth0";
import { TemplatesList } from "@/components/admin/templates-list";
import { templateFor, templateHref } from "@/components/admin/templates-catalogue";
import { approvalStatus, templateApprovals } from "./approvals";

/* TEMPLATES — in Admin with the business's other settings. Anyone signed in
   can read them, as they could read the two template pages these replace;
   only the owner approves. An old `?sec=` address goes to its template. */
export default async function TemplatesPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const session = await auth0.getSession();
  if (!session) redirect("/auth/login");
  const orgId = session.orgId as string | undefined;
  if (!orgId) redirect("/dashboard");

  const sec = templateFor((await searchParams).sec);
  if (sec) redirect(templateHref(sec.key));

  const a = await templateApprovals(orgId);
  return (
    <TemplatesList
      status={{
        certificate: approvalStatus(a.wording.approved, a.isOwner, a.wording.changed?.length ?? 0),
        swms: approvalStatus(a.swms, a.isOwner),
      }}
    />
  );
}
