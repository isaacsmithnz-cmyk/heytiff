import { renderJobPage } from "./job-page-server";

/* ONE JOB, A PAGE OF ITS OWN (v2, step 5, "Jobs and a job"): the loader is
   job-page-server.tsx, shared with the quote's own tab (./quote). */

export default async function JobPageRoute(props: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  return renderJobPage(props);
}
