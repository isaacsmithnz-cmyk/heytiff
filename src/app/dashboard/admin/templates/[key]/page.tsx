import { notFound, redirect } from "next/navigation";
import { auth0 } from "@/lib/auth0";
import { orgBrand } from "@/lib/org/query";
import { loadBusinessPapers } from "@/lib/certs/query";
import { orgTemplates } from "@/lib/templates/query";
import { getDbRole } from "@/lib/permissions-server";
import { hasMinRole } from "@/lib/roles-shared";
import { templateFor } from "@/components/admin/templates-catalogue";
import { CertificateTemplate, SwmsTemplate } from "@/components/admin/approved-templates";
import { DocumentsEmailTemplate, HandoverTemplate, ProjectChecklistTemplate, QuoteTemplate } from "@/components/admin/fixed-templates";
import { approvalStatus, templateApprovals } from "../approvals";
import "@/components/swms/swms.css";

/* ONE TEMPLATE, drawn as the document it is, on the business's own
   letterhead, before a job fills it in. */
export default async function TemplatePage({ params }: { params: Promise<{ key: string }> }) {
  const session = await auth0.getSession();
  if (!session) redirect("/auth/login");
  const orgId = session.orgId as string | undefined;
  if (!orgId) redirect("/dashboard");

  const t = templateFor((await params).key);
  if (!t) notFound();

  if (t.key === "certificate") {
    const [a, brand, papers] = await Promise.all([templateApprovals(orgId), orgBrand(orgId), loadBusinessPapers(orgId)]);
    return (
      <CertificateTemplate
        isOwner={a.isOwner}
        ownerName={a.ownerName}
        wording={a.wording}
        brand={brand}
        papers={papers}
        status={approvalStatus(a.wording.approved, a.isOwner, a.wording.changed?.length ?? 0)}
      />
    );
  }
  if (t.key === "swms") {
    const a = await templateApprovals(orgId);
    return <SwmsTemplate approved={a.swms} isOwner={a.isOwner} ownerName={a.ownerName} status={approvalStatus(a.swms, a.isOwner)} />;
  }
  const [brand, templates, role] = await Promise.all([orgBrand(orgId), orgTemplates(orgId), getDbRole()]);
  const props = { brand, templates, isOwner: hasMinRole(role, "owner") };
  if (t.key === "project-checklist") return <ProjectChecklistTemplate {...props} />;
  if (t.key === "quote") return <QuoteTemplate {...props} />;
  if (t.key === "handover") return <HandoverTemplate {...props} />;
  return <DocumentsEmailTemplate {...props} />;
}
