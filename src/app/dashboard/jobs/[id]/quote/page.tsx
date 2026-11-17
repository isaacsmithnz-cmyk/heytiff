import { renderJobPage } from "../job-page-server";

/* THE QUOTE IN A TAB OF ITS OWN (/dashboard/jobs/<id>/quote): the job's
   page with the quote open, Build, Breakdown and Proposal, the total beside
   them (job-page-server.tsx). `?start=1` opens with the reply box ready for
   the brief, `?option=N` on that option, `?update=1` on Update quote. It
   was this address's from 24 October to 15 November 2026, then landed on
   the job's Price tab until the quote took a tab again on 18 November. The
   Workboard is its gate, as the job page's. */

export default async function JobQuotePage(props: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  return renderJobPage({ ...props, doc: "quote" });
}
