import { notFound } from "next/navigation";
import { readPlanPagesTicket } from "@/lib/studio/pdf-request";
import { PlanPages } from "./plan-pages";

/* WHAT THE HEADLESS BROWSER DRAWS — /print/plan-pages?t=<ticket>.

   A plan pressed into a job's Plans is read on the server, which has no
   canvas to draw a PDF's pages with; the headless Chrome that prints the
   design draws them here, with the Studio's own pdf.js renderer, so a plan
   read on the job has the very rasters New design would have made. Nobody
   opens this by hand: lib/jobs/plans-server.ts sends the browser here with
   a ticket (lib/studio/pdf-request.ts) and waits for the page to say it is
   done. A missing, forged or stale ticket is a 404 and says nothing. */

export const dynamic = "force-dynamic";

export default async function PrintPlanPagesPage({ searchParams }: { searchParams: Promise<{ t?: string }> }) {
  const { t } = await searchParams;
  const ticket = readPlanPagesTicket(t);
  if (!ticket) notFound();
  return <PlanPages ticket={ticket} />;
}
