import { notFound, redirect } from "next/navigation";
import { can } from "@/lib/permissions-server";
import { auth0 } from "@/lib/auth0";
import { openMirrorJob, readJobFiles, readJobRecord, readMirrorJob } from "@/app/actions/workboard";
import { listJobPicklist } from "@/app/actions/job-picklist";
import { listJobPhotoFavourites } from "@/app/actions/job-photo-favourites";
import { readJobConversation } from "@/app/actions/job-conversation";
import { customerEditOffered } from "@/app/actions/job-customer";
import type { JobCardFirst } from "@/components/workboard/board/job-sheet";
import { resolveJobCard } from "@/lib/workboard/all-jobs-query";
import { parseSection } from "@/lib/jobs/job-sections";
import { jobPageHref } from "@/lib/shell/links";
import { JobPage } from "@/components/jobs/job-page";

/* ONE JOB, A PAGE OF ITS OWN (v2, step 5, "Jobs and a job"), inside the
   dashboard frame: its name, one grey line, Open in ServiceM8, Add and
   Actions, and its eight sections, each the job card's own faces.

   The id is the job's ServiceM8 uuid, resolved inside the caller's org as
   the quote page resolves it, so a foreign id is a 404, not a leak. A
   claim's id (ServiceM8's #2380A) is the parent job's page, on Billing
   where its claims are, so one job never has two pages (rule 11: two tabs
   never show the same page). The Workboard's gate is this page's gate.

   `?tab=` names the section: one of the eight; anything else, Billing
   without the money grant and Design without the Studio, is Overview.

   Awaits the request on purpose: under the dashboard's loading.tsx the
   frame paints at once and this streams in behind it (the layout stays
   synchronous; see dashboard/layout.tsx). */

export default async function JobPageRoute({
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

  const [target, moneyVisible, manage, studio, search] = await Promise.all([
    resolveJobCard(orgId, job),
    can("workboard_money"),
    can("workboard_manage"),
    can("studio"),
    searchParams,
  ]);
  const section = parseSection(search.tab, moneyVisible, studio);
  if (target.parentRemoteId !== job) redirect(jobPageHref(target.parentRemoteId, moneyVisible ? "billing" : section));

  /* the row the card opens on, read inside this org's mirror: null for a
     job it doesn't hold. AND WHAT THE CARD READS FIRST, beside it: the
     browser sends a card's reads one after another, so the card drew its
     placeholders and filled them in over seconds (Isaac, 5 November 2026:
     "it has all the placeholders empty and then it's like it refreshes and
     fills it all in"). Here they go side by side and the card arrives
     full. A read that fails is left out, and the card reads it itself. */
  const card = target.parentRemoteId;
  const kept = <T,>(p: Promise<T>): Promise<T | undefined> => p.catch(() => undefined);
  const [row, mirror, record, files, picklist, favourites, conversation, customerEdit] = await Promise.all([
    openMirrorJob(card),
    kept(readMirrorJob(card)),
    kept(readJobRecord(card)),
    kept(readJobFiles(card)),
    kept(listJobPicklist(card)),
    kept(listJobPhotoFavourites(card).then((rows) => rows.map((r) => r.remoteId))),
    kept(readJobConversation(card)),
    manage ? kept(customerEditOffered()) : Promise.resolve(undefined),
  ]);
  if (!row) notFound();
  const first: JobCardFirst = { cardId: card, mirror, record, files, picklist, favourites, conversation, customerEdit };

  /* `?add=`: Documents' Make a document, asking for what Add › SWMS or Add ›
     Certificate does; anything else asks for nothing */
  const add = search.add === "swms" || search.add === "certificate" ? search.add : null;

  return <JobPage row={row} section={section} manage={manage} moneyVisible={moneyVisible} studio={studio} add={add} first={first} />;
}
