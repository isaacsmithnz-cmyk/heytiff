import { notFound, redirect } from "next/navigation";
import { auth0 } from "@/lib/auth0";
import { can } from "@/lib/permissions-server";
import { certPaperProps } from "@/lib/certs/paper-data";
import { CertificatePaper } from "@/components/certs/certificate-paper";
import { PrintButton } from "./print-button";
import "./certificate-page.css";

/* THE CERTIFICATE AS PAPER, for a person — one version, as it was issued.

   Lives OUTSIDE the dashboard shell, like the SWMS and the handover sheet, so
   what prints is the document and nothing else. The PDF on the job is the
   same paper, printed at issue; this page is where it can be read and
   printed again. It opens in the job card's viewer, so it carries no way
   back of its own. THE DOOR IS THE JOB CARD'S: `workboard`. */

export default async function CertificatePage({ params }: { params: Promise<{ versionId: string }> }) {
  const session = await auth0.getSession();
  const orgId = session?.orgId as string | undefined;
  if (!orgId) redirect("/dashboard");
  if (!(await can("workboard"))) redirect("/dashboard");
  const { versionId } = await params;
  const props = await certPaperProps(orgId, versionId);
  if (!props) notFound();
  return (
    <main className="cerp">
      <div className="cerp-bar">
        <PrintButton />
      </div>
      <div className="cerp-sheet">
        <CertificatePaper {...props} />
      </div>
    </main>
  );
}
