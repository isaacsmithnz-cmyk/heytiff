import { redirect } from "next/navigation";
import { can } from "@/lib/permissions-server";
import { loadLinkedJob, loadWorkboardPage } from "@/lib/workboard/page-data";
import { OverviewScreen } from "@/components/workboard/overview-screen";

/* The Workboard — Overview today; Projects and Maintenance land as their own
   sub-pages. Gated by the `workboard` capability (a staff DEFAULT — the board
   is for the people on the tools), and the gate lives here because a leaf
   route is deep-linkable: a revoked member typing the URL lands back on
   /dashboard exactly as if the nav entry weren't there. */

export default async function WorkboardPage({
  searchParams,
}: {
  searchParams: Promise<{ job?: string | string[] }>;
}) {
  if (!(await can("workboard"))) redirect("/dashboard");

  const data = await loadWorkboardPage();
  if (!data) redirect("/dashboard");

  /* `?job=<uuid>` lands on the jobs side with that job's card open — the way
     in from outside the board (Home's day band hands its agreement door
     here, the palette every job it finds). The book the page already loaded
     answers first; past it, the whole mirror does, because the palette finds
     jobs finished long before the board's window. A link to a job this org
     does not hold simply lands on the board. */
  const wanted = (await searchParams).job;
  const openJob = typeof wanted === "string" && wanted ? await loadLinkedJob(data, wanted) : null;

  return <OverviewScreen data={data} openJob={openJob} />;
}
