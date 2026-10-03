import { auDayOf } from "@/lib/au-dates";
import { orgBrand } from "@/lib/org/query";
import type { OrgBrand } from "@/lib/org/brand";
import type { CertContent } from "./mechanical";
import { loadBusinessPapers, loadCertVersion, type BusinessPapers } from "./query";
import type { PaperJob, PaperSignOff } from "@/components/certs/certificate-paper";

/* WHAT THE PAPER IS DRAWN FROM — one version, read the same way for the
   person's page and for the headless browser's, so the PDF and the page are
   one document. The letterhead is the business's face today; everything else
   is the frozen version. */

export type CertPaperProps = {
  content: CertContent;
  brand: OrgBrand;
  papers: BusinessPapers;
  job: PaperJob;
  signOff: PaperSignOff;
  version: number;
};

export async function certPaperProps(orgId: string, versionId: string): Promise<CertPaperProps | null> {
  /* the letterhead needs only the org, so it is read alongside the version */
  const [v, brand, papers] = await Promise.all([
    loadCertVersion(orgId, versionId.slice(0, 80)),
    orgBrand(orgId, { seconds: 600 }),
    loadBusinessPapers(orgId),
  ]);
  if (!v) return null;
  return {
    content: v.content,
    brand,
    papers,
    job: {
      number: v.job?.number ?? null,
      builder: v.job?.clientName ?? null,
      address: v.job?.address ?? null,
    },
    signOff: {
      name: v.signatoryName,
      signedOn: auDayOf(v.issuedAt),
      signatureSvg: v.signatureSvg,
      arc: v.signatoryLicences.arc,
      contractor: v.signatoryLicences.contractor,
    },
    version: v.version,
  };
}
