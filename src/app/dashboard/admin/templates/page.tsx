import { redirect } from "next/navigation";
import { auth0 } from "@/lib/auth0";
import { TemplatesList, type TemplateStatus } from "@/components/admin/templates-list";
import { templateFor, templateHref } from "@/components/admin/templates-catalogue";
import type { PaperApproval } from "@/components/admin/approved-templates";
import { templateApprovals } from "./approvals";

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
  const approval = (done: PaperApproval): TemplateStatus =>
    done ? { text: "Approved", tone: "on" } : { text: a.isOwner ? "Waiting for your approval" : "Waiting for approval", tone: "warn" };

  return <TemplatesList status={{ certificate: approval(a.wording.approved), swms: approval(a.swms) }} />;
}
