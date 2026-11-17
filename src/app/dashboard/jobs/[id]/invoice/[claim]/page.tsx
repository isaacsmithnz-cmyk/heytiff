import { renderJobPage } from "../../job-page-server";

/* AN INVOICE IN A TAB OF ITS OWN (/dashboard/jobs/<id>/invoice/<claim>; the
   Price overhaul, 18 November 2026, decision 6: "1", the quote's shape):
   the job's page with the invoice open, Breakdown and Invoice, its total and
   where it's up to beside them (job-page-server.tsx). The money's only; the
   Workboard is its gate, as the job page's. */

export default async function JobInvoicePage(props: {
  params: Promise<{ id: string; claim: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { claim } = await props.params;
  return renderJobPage({ ...props, doc: "invoice", claim: decodeURIComponent(claim) });
}
