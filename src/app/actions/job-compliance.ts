"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { supabaseAdmin } from "@/lib/supabase-server";
import { todayInAu } from "@/lib/au-dates";
import {
  currentPaperOf,
  jobPaperRows,
  readJobPapers,
  readPaperChoices,
  readPaperOffer,
} from "@/lib/compliance/query";
import {
  EMAIL_MAX_BYTES,
  EMAIL_MAX_TO,
  defaultMessage,
  defaultSubject,
  isEmailAddress,
  paperKey,
  readPaperKey,
  sentNote,
  splitSendKeys,
  uniqueNames,
  type JobPapersRead,
  type PaperChoices,
} from "@/lib/compliance/papers";
import { DOCUMENTS_BUCKET } from "@/lib/documents/query";
import { clock, complianceContext, jobIsReal, outgoing, trimId, whose } from "@/lib/compliance/send";
import { fmtBytes, refIsOrgs } from "@/lib/documents/files";
import { staffDisplayNames } from "@/lib/workboard/job-notes-query";
import { emailsByUser } from "@/lib/staff/query";
import { isEmailConfigured, sendEmail, type MailAttachment } from "@/lib/email/send";
import { documentsLetter } from "@/lib/email/documents-letter";
import type { OurJobNote } from "@/lib/workboard/job-notes-query";

/* COMPLIANCE ON A JOB, AND SENDING WHAT'S ON IT.

   The Documents face's two new acts: put the business's papers and the team's
   tickets on a job (a link — see docs/migrations/job_compliance.sql), and
   email whatever files the job holds to the customer.

   THE GATES, and why each is the one it is:
     reading the job's papers   `workboard` — the card's own tier; anyone on
                                the job may see what is on it
     the business's papers      `workboard_manage` — running the board; the
                                certificates are made to be handed out, but
                                what goes on a job is an office decision
     a person's tickets         `team` — the same people who can already open
                                every staff card; a driver licence is
                                government ID about one named person
     opening a ticket's scan    `team`, or being the person it belongs to
     emailing                   `workboard_manage` — sending is outward-facing,
                                and a ticket goes only where its scan may open

   Server Functions are reachable by direct POST, so every one re-checks for
   itself, and every id from the browser is re-resolved in this org. Nothing
   here throws: the face says what went wrong in words.

   NOTHING HERE WRITES TO SERVICEM8. The footer's other door, Send to
   ServiceM8, is app/actions/job-sm8.ts, over the write path in
   lib/integrations/sm8-writes. The two share lib/compliance/send: who is
   asking, and which files the ticks name. */

export type ComplianceResult = { ok: true } | { ok: false; error: string };

export type AddPapersResult = { ok: true; added: string[] } | { ok: false; error: string };

/** One person the email could go to, off the job and the client in ServiceM8. */
export type EmailContact = { name: string | null; email: string; role: string };

export type EmailDraft = {
  contacts: EmailContact[];
  subject: string;
  message: string;
  /** Whether a letter posted from here can leave — false on a local or
      preview build with no mail key. */
  ready: boolean;
};

export type EmailDocumentsInput = {
  jobUuid: string;
  /** The face's ticks — see splitSendKeys. */
  keys: string[];
  to: string[];
  subject: string;
  message: string;
};

export type EmailDocumentsResult =
  | {
      ok: true;
      to: string[];
      /** The diary's record of the send, as the card paints it — null in
          the rare case the letter left and the note didn't save. */
      note: OurJobNote | null;
    }
  | { ok: false; error: string };

/** The job's papers, as the Documents face lists them, and what this viewer
    may do there. Null when the viewer can't open the job card at all. */
export async function listJobPapers(jobUuid: string): Promise<JobPapersRead | null> {
  const ctx = await complianceContext();
  if (!ctx) return null;
  const job = trimId(jobUuid);
  if (!job) return null;
  const { today, warnDays } = await clock(ctx.orgId);
  const papers = await readJobPapers(ctx.orgId, job, {
    staffId: ctx.staffId,
    company: ctx.company,
    team: ctx.team,
    today,
    warnDays,
  });
  return { papers, may: { company: ctx.company, staff: ctx.team, send: ctx.company } };
}

/** What "Add compliance" offers. Null for a viewer who may add neither side. */
export async function readComplianceChoices(jobUuid: string): Promise<PaperChoices | null> {
  const ctx = await complianceContext();
  if (!ctx || (!ctx.company && !ctx.team)) return null;
  const job = trimId(jobUuid);
  if (!job) return null;
  const { today, warnDays } = await clock(ctx.orgId);
  return readPaperChoices(ctx.orgId, job, { company: ctx.company, staff: ctx.team, today, warnDays });
}

/** Put ticked papers on a job, each pinned to the term that is current now.
    Returns the new rows' ids, so the face can tick them ready to send. */
export async function addJobPapers(jobUuid: string, keys: string[]): Promise<AddPapersResult> {
  const ctx = await complianceContext();
  if (!ctx) return { ok: false, error: "You can't add compliance to jobs." };
  const job = trimId(jobUuid);
  const wanted = [
    ...new Map(
      (Array.isArray(keys) ? keys : [])
        .slice(0, 60)
        .map(readPaperKey)
        .filter((k): k is NonNullable<typeof k> => !!k)
        .map((k) => [paperKey(k.kind, k.id), k] as const)
    ).values(),
  ];
  if (!job || wanted.length === 0) return { ok: false, error: "Tick something to add." };
  const wantsCompany = wanted.some((k) => k.kind === "company");
  const wantsStaff = wanted.some((k) => k.kind === "staff");
  if (wantsCompany && !ctx.company) return { ok: false, error: "You can't add the business's papers to jobs." };
  if (wantsStaff && !ctx.team) return { ok: false, error: "You can't add staff licences to jobs." };
  if (!(await jobIsReal(ctx.orgId, job))) return { ok: false, error: "That job isn't in ServiceM8's copy any more." };

  const { today, warnDays } = await clock(ctx.orgId);
  const offer = await readPaperOffer(ctx.orgId, job, {
    company: wantsCompany,
    staff: wantsStaff,
    today,
    warnDays,
  });
  const byKey = new Map([...(offer.company ?? []), ...(offer.staff ?? [])].map((o) => [o.choice.key, o]));

  const rows: Record<string, unknown>[] = [];
  for (const k of wanted) {
    const o = byKey.get(paperKey(k.kind, k.id));
    if (!o) return { ok: false, error: "One of those isn't on file any more." };
    if (o.choice.onJob) continue;
    /* the chooser can't tick these; this is the same answer for a POST that
       skipped the chooser */
    if (o.choice.files === 0) return { ok: false, error: `${whose(o.choice)} has nothing on file to give.` };
    if (o.choice.state === "bad") return { ok: false, error: `${whose(o.choice)} has expired.` };
    rows.push({
      org_id: ctx.orgId,
      sm8_job_uuid: job,
      org_credential_id: k.kind === "company" ? k.id : null,
      staff_licence_id: k.kind === "staff" ? k.id : null,
      credential_record_id: k.kind === "company" ? o.termId : null,
      licence_record_id: k.kind === "staff" ? o.termId : null,
      added_by: ctx.staffId,
    });
  }
  if (rows.length === 0) return { ok: true, added: [] };

  const { data, error } = await supabaseAdmin.from("job_compliance").insert(rows).select("id");
  if (error) {
    /* two presses racing: the unique index refused the second, and the paper
       is on the job either way */
    if ((error as { code?: string }).code === "23505") return { ok: true, added: [] };
    return { ok: false, error: "Couldn't add them to the job." };
  }
  return { ok: true, added: ((data ?? []) as { id: string }[]).map((r) => r.id) };
}

/** Take one paper off a job. The paper itself is untouched — this is a link. */
export async function removeJobPaper(paperId: string): Promise<ComplianceResult> {
  const ctx = await complianceContext();
  if (!ctx) return { ok: false, error: "You can't change compliance on jobs." };
  const id = trimId(paperId);
  const [row] = await jobPaperRows(ctx.orgId, null, [id]);
  /* already gone — the face drops it either way */
  if (!row) return { ok: true };
  if (row.org_credential_id ? !ctx.company : !ctx.team) return { ok: false, error: "You can't take that off the job." };
  const { error } = await supabaseAdmin.from("job_compliance").delete().eq("org_id", ctx.orgId).eq("id", id);
  if (error) return { ok: false, error: "Couldn't take that off the job." };
  return { ok: true };
}

/** Move a paper on a job to the renewal that has come in since. */
export async function renewJobPaper(paperId: string): Promise<ComplianceResult> {
  const ctx = await complianceContext();
  if (!ctx) return { ok: false, error: "You can't change compliance on jobs." };
  const id = trimId(paperId);
  const [row] = await jobPaperRows(ctx.orgId, null, [id]);
  if (!row) return { ok: false, error: "That's no longer on the job." };
  const company = !!row.org_credential_id;
  if (company ? !ctx.company : !ctx.team) return { ok: false, error: "You can't change that." };
  const owner = company ? row.org_credential_id : row.staff_licence_id;
  const now = owner ? await currentPaperOf(ctx.orgId, company ? "company" : "staff", owner, todayInAu()) : null;
  if (!now?.termId || now.files === 0) return { ok: false, error: "There's no renewal on file to use." };
  const { error } = await supabaseAdmin
    .from("job_compliance")
    .update(company ? { credential_record_id: now.termId } : { licence_record_id: now.termId })
    .eq("org_id", ctx.orgId)
    .eq("id", id);
  if (error) return { ok: false, error: "Couldn't switch to the renewal." };
  return { ok: true };
}

const CONTACT_ROLE: Record<string, string> = {
  job: "Job contact",
  billing: "Billing contact",
  "property manager": "Property manager",
};

type ContactRow = { first: string | null; last: string | null; email: string | null; type: string | null };

/** Who the email could go to, and the words it starts with. Null for a
    viewer who can't send, or a job this workspace doesn't hold. */
export async function readEmailDraft(jobUuid: string): Promise<EmailDraft | null> {
  const ctx = await complianceContext();
  if (!ctx?.company) return null;
  const job = trimId(jobUuid);
  if (!job) return null;
  const { data: jobData } = await supabaseAdmin
    .from("sm8_jobs")
    .select("uuid, generated_job_id, job_address, company_uuid")
    .eq("org_id", ctx.orgId)
    .eq("uuid", job)
    .maybeSingle();
  const jobRow = jobData as {
    generated_job_id: string | null;
    job_address: string | null;
    company_uuid: string | null;
  } | null;
  if (!jobRow) return null;

  const [onJob, ofClient, org, names] = await Promise.all([
    supabaseAdmin
      .from("sm8_job_contacts")
      .select("first, last, email, type")
      .eq("org_id", ctx.orgId)
      .eq("job_uuid", job)
      .eq("active", 1),
    jobRow.company_uuid
      ? supabaseAdmin
          .from("sm8_company_contacts")
          .select("first, last, email, type")
          .eq("org_id", ctx.orgId)
          .eq("company_uuid", jobRow.company_uuid)
          .eq("active", 1)
      : Promise.resolve({ data: [] }),
    supabaseAdmin.from("organizations").select("trading_name").eq("id", ctx.orgId).maybeSingle(),
    staffDisplayNames(ctx.orgId, [ctx.staffId]),
  ]);

  /* the job's own people first — they are who asked — then the client's;
     one entry per address however many times ServiceM8 lists it */
  const contacts: EmailContact[] = [];
  const add = (rows: ContactRow[], role: (type: string | null) => string) => {
    for (const r of rows) {
      const email = r.email?.trim() ?? "";
      if (!isEmailAddress(email) || contacts.some((c) => c.email.toLowerCase() === email.toLowerCase())) continue;
      const name = [r.first, r.last].map((p) => p?.trim()).filter(Boolean).join(" ") || null;
      contacts.push({ name, email, role: role(r.type) });
    }
  };
  add((onJob.data ?? []) as ContactRow[], (t) => CONTACT_ROLE[(t ?? "").trim().toLowerCase()] ?? "Job contact");
  add((ofClient.data ?? []) as ContactRow[], () => "Client contact");

  const business = ((org.data as { trading_name?: string | null } | null)?.trading_name ?? "").trim() || null;
  /* the address's first line: the whole of it is two lines and a postcode */
  const address = (jobRow.job_address ?? "").split(/\r?\n/)[0]?.trim() || null;
  return {
    contacts,
    subject: defaultSubject({ number: jobRow.generated_job_id?.trim() || null, address }),
    message: defaultMessage(ctx.staffId ? names.get(ctx.staffId) ?? null : null, business),
    ready: isEmailConfigured(),
  };
}

async function appOrigin(): Promise<string> {
  if (process.env.APP_BASE_URL) return process.env.APP_BASE_URL;
  const h = await headers();
  const host = h.get("host");
  const proto = h.get("x-forwarded-proto") ?? "https";
  return host ? `${proto}://${host}` : "http://localhost:3000";
}

/** Email the ticked files to the customer. The letter leaves in the
    business's name from the verified address, replies reach the sender, the
    sender gets a quiet copy, and the job's diary records what went to whom. */
export async function emailJobDocuments(input: EmailDocumentsInput): Promise<EmailDocumentsResult> {
  const ctx = await complianceContext();
  if (!ctx?.company) return { ok: false, error: "You can't email documents from jobs." };
  const job = trimId(input?.jobUuid);
  if (!job || !(await jobIsReal(ctx.orgId, job))) {
    return { ok: false, error: "That job isn't in ServiceM8's copy any more." };
  }

  const to = [
    ...new Map(
      (Array.isArray(input.to) ? input.to : [])
        .map((a) => String(a ?? "").trim())
        .filter(Boolean)
        .map((a) => [a.toLowerCase(), a] as const)
    ).values(),
  ];
  if (to.length === 0) return { ok: false, error: "Say who it's going to." };
  if (to.length > EMAIL_MAX_TO) return { ok: false, error: `An email goes to ${EMAIL_MAX_TO} people at most.` };
  const bad = to.find((a) => !isEmailAddress(a));
  if (bad) return { ok: false, error: `${bad} isn't an email address.` };
  const subject = String(input.subject ?? "").replace(/[\r\n]+/g, " ").trim().slice(0, 200);
  if (!subject) return { ok: false, error: "Give the email a subject." };
  const message = String(input.message ?? "").slice(0, 5000);

  const picks = splitSendKeys(Array.isArray(input.keys) ? input.keys.slice(0, 60) : []);
  if (picks.papers.length + picks.documents.length + picks.files.length === 0) {
    return { ok: false, error: "Tick at least one document to send." };
  }
  const found = await outgoing(ctx, job, picks);
  if (!found.ok) return found;

  const total = found.files.reduce((sum, f) => sum + f.size, 0);
  if (total > EMAIL_MAX_BYTES) {
    return {
      ok: false,
      error: `Those come to ${fmtBytes(total)}, and one email takes ${fmtBytes(EMAIL_MAX_BYTES)}. Untick some and send them in two.`,
    };
  }
  if (found.files.some((f) => !refIsOrgs(f.ref, ctx.orgId))) {
    return { ok: false, error: "One of those files doesn't belong to this organisation." };
  }

  const names = uniqueNames(found.files.map((f) => f.name));
  const bytes = await Promise.all(
    found.files.map(async (f) => {
      const { data, error } = await supabaseAdmin.storage.from(DOCUMENTS_BUCKET).download(f.ref);
      return error || !data ? null : Buffer.from(await data.arrayBuffer()).toString("base64");
    })
  );
  if (bytes.some((b) => b === null)) return { ok: false, error: "One of those files couldn't be read. Try again." };
  const attachments: MailAttachment[] = names.map((filename, i) => ({ filename, content: bytes[i] as string }));

  const [org, senderNames, senderEmails, baseUrl] = await Promise.all([
    supabaseAdmin.from("organizations").select("trading_name").eq("id", ctx.orgId).maybeSingle(),
    staffDisplayNames(ctx.orgId, [ctx.staffId]),
    emailsByUser([ctx.userId]),
    appOrigin(),
  ]);
  const business = ((org.data as { trading_name?: string | null } | null)?.trading_name ?? "").trim() || null;
  const sender = ctx.staffId ? senderNames.get(ctx.staffId) ?? null : null;
  const senderEmail = senderEmails.get(ctx.userId) ?? null;

  const res = await sendEmail({
    to,
    subject,
    html: documentsLetter({ baseUrl, business, sender, message, files: names }),
    replyTo: senderEmail ?? undefined,
    bcc: senderEmail && !to.some((a) => a.toLowerCase() === senderEmail.toLowerCase()) ? [senderEmail] : undefined,
    fromName: business ? `${business} via HeyTiff` : undefined,
    attachments,
  });
  if (!res.ok) {
    if (res.reason === "unconfigured") {
      return { ok: false, error: "Email isn't set up on this deployment, so nothing was sent." };
    }
    // the provider's own words go to the log, never to the screen
    console.error("[job-compliance] email failed:", res.detail);
    return { ok: false, error: "The email didn't send. Try again in a minute." };
  }

  /* THE DIARY KEEPS THE RECORD — what went, to whom, and (by its author) who
     sent it. The letter has already left, so a note that fails to save is
     logged rather than reported as a failed send. */
  const text = sentNote(found.labels, to);
  const now = new Date().toISOString();
  const { data: saved, error: noteErr } = await supabaseAdmin
    .from("workboard_notes")
    .insert({
      org_id: ctx.orgId,
      author_id: ctx.staffId,
      target_kind: "job",
      target_id: job,
      transcript: text,
      source: "text",
      status: "applied",
      applied: { jobNotes: [text] },
      applied_at: now,
    })
    .select("id, applied_at, created_at")
    .maybeSingle();
  if (noteErr) console.error("[job-compliance] sent, but the diary note didn't save:", noteErr.message);
  revalidatePath("/dashboard/workboard");
  const row = saved as { id: string; applied_at: string | null; created_at: string } | null;
  return {
    ok: true,
    to,
    note: row ? { id: row.id, text, at: row.applied_at ?? row.created_at, author: sender } : null,
  };
}
