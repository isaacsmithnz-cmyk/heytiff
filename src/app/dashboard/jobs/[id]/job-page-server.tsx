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
import { invoiceHref, jobPageHref, quoteHref } from "@/lib/shell/links";
import { JobPage, type JobDoc } from "@/components/jobs/job-page";
import { isStarred } from "@/lib/jobs/job-stars";

/* ONE JOB, A PAGE OF ITS OWN (v2, step 5, "Jobs and a job"), inside the
   dashboard frame: its name, one grey line, Open in ServiceM8, Add and
   Actions, and its eight sections, each the job card's own faces.

   The id is the job's ServiceM8 uuid, resolved inside the caller's org as
   the quote page resolves it, so a foreign id is a 404, not a leak. A
   claim's id (ServiceM8's #2380A) is the parent job's page, on Billing
   where its claims are, so one job never has two pages (rule 11: two tabs
   never show the same page). The Workboard's gate is this page's gate.

   `?tab=` names the section: one of the six; anything else, and Billing
   without the money grant, is Overview. On Price, `?start=1`, `?option=N`
   and `?update=1` are the quote's old page's (it lands here), and
   `?invoice=` a claim's.

   THE QUOTE IN A TAB OF ITS OWN (/dashboard/jobs/<id>/quote; Isaac, 17
   November 2026: "Quote and invoice should open full screen", then the
   phone's Build, Breakdown and Proposal, "the same on either system"): the
   same page and the same reads, `doc` set, so the job's head and sections
   give way to the quote's, and the browser's tab is the quote's
   (rule 51: a document opens in its own tab). Its `?start=1`, `?option=N`
   and `?update=1` ask what the Price tab's did.

   Awaits the request on purpose: under the dashboard's loading.tsx the
   frame paints at once and this streams in behind it (the layout stays
   synchronous; see dashboard/layout.tsx). */

export async function renderJobPage({
  params,
  searchParams,
  doc = null,
  claim = null,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
  /** the quote open in a tab of its own (/dashboard/jobs/<id>/quote), or an
      invoice (/dashboard/jobs/<id>/invoice/<claim>) */
  doc?: JobDoc | null;
  /** the invoice's claim, ServiceM8's uuid, when `doc` is an invoice */
  claim?: string | null;
}) {
  if (!(await can("workboard"))) redirect("/dashboard");
  const session = await auth0.getSession();
  const orgId = session?.orgId as string | undefined;
  if (!orgId) redirect("/dashboard");

  const { id } = await params;
  const job = id.trim().slice(0, 80);
  if (!job) notFound();

  const [target, moneyVisible, manage, studio, financials, search] = await Promise.all([
    resolveJobCard(orgId, job),
    can("workboard_money"),
    can("workboard_manage"),
    can("studio"),
    can("financials"),
    searchParams,
  ]);
  /* an invoice is the money's: without it, the job's page */
  if (doc === "invoice" && !moneyVisible) redirect(jobPageHref(job));
  const section = doc ? "price" : parseSection(search.tab, moneyVisible, studio);
  /* a claim's own number opens its invoice on Price, an invoice's one home
     (build 10), for whoever sees money */
  if (target.parentRemoteId !== job)
    redirect(doc === "quote" ? quoteHref(target.parentRemoteId) : doc === "invoice" ? invoiceHref(target.parentRemoteId, job) : moneyVisible ? `${jobPageHref(target.parentRemoteId, "price")}&invoice=${encodeURIComponent(job)}` : jobPageHref(target.parentRemoteId, section));

  /* the row the card opens on, read inside this org's mirror: null for a
     job it doesn't hold. AND WHAT THE CARD READS FIRST, beside it: the
     browser sends a card's reads one after another, so the card drew its
     placeholders and filled them in over seconds (Isaac, 5 November 2026:
     "it has all the placeholders empty and then it's like it refreshes and
     fills it all in"). Here they go side by side and the card arrives
     full. A read that fails is left out, and the card reads it itself. */
  const card = target.parentRemoteId;
  const kept = <T,>(p: Promise<T>): Promise<T | undefined> => p.catch(() => undefined);
  const userId = session?.user?.sub as string | undefined;
  const [row, mirror, record, files, picklist, favourites, conversation, customerEdit, starred] = await Promise.all([
    openMirrorJob(card),
    kept(readMirrorJob(card)),
    kept(readJobRecord(card)),
    kept(readJobFiles(card)),
    kept(listJobPicklist(card)),
    kept(listJobPhotoFavourites(card).then((rows) => rows.map((r) => r.remoteId))),
    kept(readJobConversation(card)),
    manage ? kept(customerEditOffered()) : Promise.resolve(undefined),
    /* your star on it, for Actions' Star the job */
    userId ? isStarred({ orgId, userId }, card).catch(() => false) : Promise.resolve(false),
  ]);
  if (!row) notFound();
  const first: JobCardFirst = { cardId: card, mirror, record, files, picklist, favourites, conversation, customerEdit };

  /* `?add=`: Documents' Make a document, asking for what Add › SWMS or Add ›
     Certificate does; anything else asks for nothing */
  const add = search.add === "swms" || search.add === "certificate" ? search.add : null;
  /* PRICE'S ASK, from the quote's old page (?start=1, ?option=N, ?update=1)
     and a claim's own number (?invoice=): the quote and its page are one */
  const raw = typeof search.option === "string" ? Number(search.option) : NaN;
  const option = Number.isInteger(raw) && raw >= 0 && raw <= 19 ? raw : null;
  const invoice = doc === "invoice" ? (claim?.trim().slice(0, 80) || null) : !doc && typeof search.invoice === "string" && moneyVisible ? search.invoice.trim().slice(0, 80) || null : null;
  const price =
    section === "price" && (search.start === "1" || search.update === "1" || option !== null || invoice)
      ? { start: search.start === "1", option, update: search.update === "1", invoice }
      : null;

  return (
    <JobPage
      row={row}
      section={section}
      manage={manage}
      moneyVisible={moneyVisible}
      financials={financials}
      studio={studio}
      add={add}
      price={price}
      first={first}
      doc={doc}
      starred={starred}
    />
  );
}
