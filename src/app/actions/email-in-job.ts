"use server";

import { requireOrg } from "@/lib/permissions-server";
import { staffProfileIdFor } from "@/lib/fleet/query";
import { auDayOf, fmtAuWeekdayDate } from "@/lib/au-dates";
import { JOB_WORDS } from "@/lib/integrations/sm8-job-words";
import { jobDescriptionOf } from "@/lib/email/proposal";
import { emailJobView, markMade, markNotAJob, readEmailRow, type EmailJobView } from "@/lib/email/made-server";
import { createNewJob, type CreateAnswer } from "./job-new";

/* EMAIL TO TIFF, THE CARD (Isaac, 28 October 2026, the mock he said "Build it
   in" to): the job Tiff proposes from a forwarded email, made only on Create
   job. The job goes to ServiceM8 through the New job form's own engine
   (createNewJob), with its gate (New jobs on, and running the board) and its
   press: the email's own id, so Create pressed twice, or Create and then the
   form, is one job. Once made, the email's PDFs and pictures go on the job's
   Documents. Not a job puts the card away. */

export type MadeAnswer = { ok: true; jobUuid: string; number: string | null } | { ok: false; error: string };

export async function readEmailJob(id: string): Promise<EmailJobView | null> {
  const { orgId } = await requireOrg("tiff");
  return emailJobView(orgId, id);
}

/** What the card's Create job sends: the client Tiff matched (a builder's job
    on a site of theirs, or a new one), else a new client; the site she read;
    the scope as written; the contact. */
export async function createJobFromEmail(id: string): Promise<MadeAnswer> {
  const { orgId, userId } = await requireOrg("tiff");
  const row = await readEmailRow(orgId, id);
  if (!row?.proposal) return { ok: false, error: "There's no job read from this email." };
  if (row.state === "made" && row.job_uuid) return { ok: true, jobUuid: row.job_uuid, number: null };
  const p = row.proposal;
  if (!p.isJob) return { ok: false, error: "This email doesn't read as a job. Change the details to make one." };
  const clientName = p.clientMatch?.name ?? p.client;
  if (!clientName) return { ok: false, error: "The email doesn't say who the client is. Change the details to say." };
  if (!p.site) return { ok: false, error: "The email doesn't say where the job is. Change the details to say." };
  /* a site already here only when it is this client's own */
  const theirSite = p.siteMatch && p.clientMatch && (p.siteMatch.uuid === p.clientMatch.uuid || p.siteMatch.parentName === p.clientMatch.name) ? p.siteMatch : null;
  const client = theirSite
    ? { kind: "existing" as const, uuid: theirSite.uuid }
    : p.clientMatch
      ? p.clientMatch.builder
        ? { kind: "site" as const, parentUuid: p.clientMatch.uuid, address: p.site }
        : { kind: "existing" as const, uuid: p.clientMatch.uuid }
      : { kind: "new" as const, name: p.client, address: p.site };
  const c = p.contact;
  const contact = c.first || c.last || c.mobile || c.phone || c.email ? { first: c.first, last: c.last, mobile: c.mobile, phone: c.phone, email: c.email } : null;
  const a: CreateAnswer = await createNewJob({
    pressId: row.id,
    clientName,
    client,
    jobAddress: theirSite?.address ?? p.site,
    description: jobDescriptionOf(p, { name: row.from_name, at: fmtAuWeekdayDate(auDayOf(row.received_at)) }),
    categoryUuid: null,
    contact,
    via: "email",
    next: null,
  }).catch((): CreateAnswer => ({ ok: false, error: JOB_WORDS.press.unqueued }));
  if (!a.ok) return { ok: false, error: a.error };
  if (a.line.state === "failed" || a.line.state === "cancelled") return { ok: false, error: a.line.words };
  await markMade(orgId, row.id, a.jobUuid, userId, await staffProfileIdFor(orgId, userId));
  return { ok: true, jobUuid: a.jobUuid, number: a.line.number };
}

/** The New job form made it instead (Change the details): the files follow. */
export async function emailJobMade(id: string, jobUuid: string): Promise<boolean> {
  const { orgId, userId } = await requireOrg("tiff");
  return markMade(orgId, id, jobUuid, userId, await staffProfileIdFor(orgId, userId));
}

export async function notAJob(id: string): Promise<boolean> {
  const { orgId, userId } = await requireOrg("tiff");
  return markNotAJob(orgId, id, userId);
}
