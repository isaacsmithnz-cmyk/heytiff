import { notFound, redirect } from "next/navigation";
import { can } from "@/lib/permissions-server";
import { auth0 } from "@/lib/auth0";
import { readMirrorJob } from "@/app/actions/workboard";
import { resolveJobCard } from "@/lib/workboard/all-jobs-query";
import { QuoteScreen } from "@/components/workboard/quote/quote-screen";

/* ONE QUOTE, FULL SCREEN INSIDE THE WORKBOARD (Isaac, 2026-09-30: "a quote
   opens full screen inside the Workboard at its own route"; 2026-10-05, on
   2905: "it should have opened up the proper quote screen not a section
   below"). The job card's Create / Continue / Update ServiceM8 quote opens
   it; its way back is the job card.

   The id names a job — re-resolved inside the caller's org (a claim opens
   its parent), so a foreign id is a 404, not a leak. Anyone on the
   Workboard quotes; money is its own grant, asked once and handed down. The job is
   read here, as the card reads it, so the page lands with its title and
   ServiceM8's quote already known. */

export default async function WorkboardQuotePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  if (!(await can("workboard"))) redirect("/dashboard");
  const session = await auth0.getSession();
  const orgId = session?.orgId as string | undefined;
  if (!orgId) redirect("/dashboard");

  const { id } = await params;
  const job = id.trim().slice(0, 80);
  if (!job) notFound();
  /* anyone on the Workboard quotes, its money hidden without `financials`
     (Isaac, 2026-10-12: "For techs who are quoting a job") */
  const target = await resolveJobCard(orgId, job);
  const [{ detail }, moneyVisible, financials] = await Promise.all([
    readMirrorJob(target.parentRemoteId),
    can("workboard_money"),
    can("financials"),
  ]);
  if (!detail) notFound();
  /* the job card's Create a quote links ?start=1: the reply box is ready
     for the brief (the chat-first page, 2026-10-13) */
  const start = (await searchParams).start === "1";

  return <QuoteScreen job={target.parentRemoteId} detail={detail} moneyVisible={moneyVisible} financials={financials} start={start} />;
}
