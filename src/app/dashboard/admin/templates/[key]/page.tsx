import { notFound, redirect } from "next/navigation";
import { auth0 } from "@/lib/auth0";
import { TemplateFrame } from "@/components/admin/templates-list";
import { templateFor } from "@/components/admin/templates-catalogue";
import { CertificateTemplate, SwmsTemplate } from "@/components/admin/approved-templates";
import { DocumentsEmailTemplate, HandoverTemplate, ProjectChecklistTemplate, QuoteTemplate } from "@/components/admin/fixed-templates";
import { templateApprovals } from "../approvals";
import "@/components/swms/swms.css";
import "@/components/admin/templates.css";

/* ONE TEMPLATE, as it reads before a job fills it in. */
export default async function TemplatePage({ params }: { params: Promise<{ key: string }> }) {
  const session = await auth0.getSession();
  if (!session) redirect("/auth/login");
  const orgId = session.orgId as string | undefined;
  if (!orgId) redirect("/dashboard");

  const t = templateFor((await params).key);
  if (!t) notFound();

  let body: React.ReactNode;
  if (t.key === "certificate" || t.key === "swms") {
    const a = await templateApprovals(orgId);
    body =
      t.key === "certificate" ? (
        <CertificateTemplate isOwner={a.isOwner} ownerName={a.ownerName} wording={a.wording} />
      ) : (
        <SwmsTemplate approved={a.swms} isOwner={a.isOwner} ownerName={a.ownerName} />
      );
  } else if (t.key === "quote") body = <QuoteTemplate />;
  else if (t.key === "handover") body = <HandoverTemplate />;
  else if (t.key === "documents-email") body = <DocumentsEmailTemplate />;
  else body = <ProjectChecklistTemplate />;

  return <TemplateFrame title={t.title}>{body}</TemplateFrame>;
}
