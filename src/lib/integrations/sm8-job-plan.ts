/* A new job in ServiceM8 — the decisions, pure (new jobs to ServiceM8).

   The New job form queues ONE row (kind "job"). Its sender makes, in order,
   each under a uuid HeyTiff chose when the row was queued, so a step whose
   answer was lost is read back, never made twice:

     company   a new client (company.json), or a new site under a builder
               (company.json with parent_company_uuid) — only when the form
               named a new one
     job       the job (job.json), as a Quote, under the client or site
     contact   the person to ring (jobcontact.json, type JOB) — only when
               the form gave one

   The paths, fields and scopes were read off ServiceM8's developer
   reference on 2026-10-03: "Create a new Job" (status required; Quote,
   Work Order, Unsuccessful, Completed), "Create a new Client" (name
   required; parent_company_uuid makes a site), "Create a new Job Contact"
   (job_uuid required; type JOB, BILLING or Property Manager). A client
   uuid is accepted on each, and x-record-uuid answers with the one kept.

   ONE ROW PER PRESS (sm8_writes' dedupe_key): job:<the form's press id>.
   A Create pressed twice is one job. */

import { JOB_WORDS } from "./sm8-job-words";

export { JOB_WORDS };

export const JOB_STEPS = ["company", "job", "contact"] as const;
export type JobStep = (typeof JOB_STEPS)[number];

/** The status a new job starts as. */
export const NEW_JOB_STATUS = "Quote";
/** A job contact's role: the person to ring about the job. */
export const NEW_JOB_CONTACT_TYPE = "JOB";

export const jobSubject = (pressId: string) => `job:${pressId}`;
export function parseJobSubject(s: string): string | null {
  const m = /^job:(\S+)$/.exec(s);
  return m ? m[1]! : null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** ServiceM8's own limits: a client's name 100, an address 500. */
const MAX = { name: 100, address: 500, description: 4000, person: 60, phone: 40, email: 200 };

export type NewJobContact = { first: string; last: string; mobile: string; phone: string; email: string };

/** What the form asks to make. */
export type NewJobInput = {
  client:
    | { kind: "existing"; uuid: string }
    | { kind: "new"; name: string; address: string }
    | { kind: "site"; parentUuid: string; address: string };
  jobAddress: string;
  description: string;
  categoryUuid: string | null;
  contact: NewJobContact | null;
};

/** The words a row keeps (job_draft): what the steps send. */
export type JobDraft = {
  companyName: string | null;
  companyAddress: string | null;
  address: string;
  description: string;
  contact: NewJobContact | null;
};

export type ValidNewJob = {
  companyNew: "client" | "site" | null;
  /** an existing client's uuid; null when a new one is to be made */
  existingUuid: string | null;
  parentUuid: string | null;
  categoryUuid: string | null;
  draft: JobDraft;
};

const clean = (s: unknown, max: number) => (typeof s === "string" ? s.replace(/\s+/g, " ").trim().slice(0, max) : "");
const cleanBlock = (s: unknown, max: number) => (typeof s === "string" ? s.replace(/\r\n/g, "\n").trim().slice(0, max) : "");

/** The form's input, made safe to send, or the reason it can't be. */
export function validNewJob(input: NewJobInput): { ok: true; job: ValidNewJob } | { ok: false; error: string } {
  const address = cleanBlock(input.jobAddress, MAX.address);
  const description = cleanBlock(input.description, MAX.description);
  if (!address) return { ok: false, error: "Where is the job? Add the site's address." };
  if (!description) return { ok: false, error: "Say what the job is." };
  const categoryUuid = input.categoryUuid && UUID.test(input.categoryUuid) ? input.categoryUuid : null;

  let contact: NewJobContact | null = null;
  if (input.contact) {
    const c = {
      first: clean(input.contact.first, MAX.person),
      last: clean(input.contact.last, MAX.person),
      mobile: clean(input.contact.mobile, MAX.phone),
      phone: clean(input.contact.phone, MAX.phone),
      email: clean(input.contact.email, MAX.email),
    };
    if (c.email && !EMAIL.test(c.email)) return { ok: false, error: "That email address doesn't look right." };
    if (c.first || c.last || c.mobile || c.phone || c.email) contact = c;
  }

  const cl = input.client;
  if (cl.kind === "existing") {
    if (!UUID.test(cl.uuid)) return { ok: false, error: JOB_WORDS.press.clientGone };
    return { ok: true, job: { companyNew: null, existingUuid: cl.uuid, parentUuid: null, categoryUuid, draft: { companyName: null, companyAddress: null, address, description, contact } } };
  }
  if (cl.kind === "new") {
    const name = clean(cl.name, MAX.name);
    if (!name) return { ok: false, error: "Who is the job for? Add the client's name." };
    return {
      ok: true,
      job: { companyNew: "client", existingUuid: null, parentUuid: null, categoryUuid, draft: { companyName: name, companyAddress: cleanBlock(cl.address, MAX.address) || address, address, description, contact } },
    };
  }
  if (!UUID.test(cl.parentUuid)) return { ok: false, error: JOB_WORDS.press.parentGone };
  /* a site is named by its address, as the business names them in ServiceM8 */
  const siteName = clean(cl.address || address, MAX.name);
  return {
    ok: true,
    job: { companyNew: "site", existingUuid: null, parentUuid: cl.parentUuid, categoryUuid, draft: { companyName: siteName, companyAddress: cleanBlock(cl.address, MAX.address) || address, address, description, contact } },
  };
}

/** What a queued row holds, as the sender reads it. */
export type JobRowFacts = {
  job_company_uuid?: string | null;
  job_company_new?: string | null;
  job_parent_uuid?: string | null;
  job_contact_uuid?: string | null;
  job_category_uuid?: string | null;
  job_draft?: unknown;
  job_done?: string[] | null;
  job_number?: string | null;
};

/** The steps a row has, in order. */
export function stepsOf(row: JobRowFacts): JobStep[] {
  return [...(row.job_company_new ? (["company"] as const) : []), "job", ...(row.job_contact_uuid ? (["contact"] as const) : [])];
}

/** The steps still to make, in order. */
export function stepsLeft(row: JobRowFacts): JobStep[] {
  const done = new Set(row.job_done ?? []);
  return stepsOf(row).filter((s) => !done.has(s));
}

/** The words a row keeps, read back off its jsonb; null when it can't be. */
export function draftOf(row: JobRowFacts): JobDraft | null {
  const d = row.job_draft;
  if (!d || typeof d !== "object" || Array.isArray(d)) return null;
  const r = d as Record<string, unknown>;
  const text = (v: unknown) => (typeof v === "string" ? v : null);
  if (!text(r.address) || !text(r.description)) return null;
  const c = r.contact && typeof r.contact === "object" ? (r.contact as Record<string, unknown>) : null;
  return {
    companyName: text(r.companyName),
    companyAddress: text(r.companyAddress),
    address: text(r.address)!,
    description: text(r.description)!,
    contact: c ? { first: text(c.first) ?? "", last: text(c.last) ?? "", mobile: text(c.mobile) ?? "", phone: text(c.phone) ?? "", email: text(c.email) ?? "" } : null,
  };
}

/** A new client or site: exactly these fields. */
export function companyBody(c: { uuid: string; name: string; address: string; parentUuid?: string | null }) {
  return {
    uuid: c.uuid,
    name: c.name,
    address: c.address,
    ...(c.parentUuid ? { parent_company_uuid: c.parentUuid } : {}),
  };
}

/** The job: a Quote, under its client or site; no category when none was chosen. */
export function jobBody(j: { uuid: string; companyUuid: string; address: string; description: string; categoryUuid?: string | null }) {
  return {
    uuid: j.uuid,
    status: NEW_JOB_STATUS,
    company_uuid: j.companyUuid,
    job_address: j.address,
    job_description: j.description,
    ...(j.categoryUuid ? { category_uuid: j.categoryUuid } : {}),
  };
}

/** The person to ring: only the fields given. */
export function jobContactBody(c: { uuid: string; jobUuid: string } & NewJobContact) {
  const given = (k: keyof NewJobContact) => (c[k] ? { [k]: c[k] } : {});
  return { uuid: c.uuid, job_uuid: c.jobUuid, type: NEW_JOB_CONTACT_TYPE, ...given("first"), ...given("last"), ...given("mobile"), ...given("phone"), ...given("email") };
}

/** What a step reads back live. */
export type Sm8LiveRecord = { uuid: string; active: number | null; parent: string | null; number: string | null; editDate: string | null };

/** What the form and the owner's list say of a row. */
export type JobLine = { state: "waiting" | "adding" | "in" | "partial" | "failed" | "cancelled"; words: string; number: string | null };

export function jobLine(row: JobRowFacts & { status: string; last_error?: string | null }): JobLine {
  const done = new Set(row.job_done ?? []);
  const number = row.job_number ?? null;
  const inSm8 = number ? `In ServiceM8 as #${number}.` : "In ServiceM8.";
  if (row.status === "sent") return { state: "in", words: inSm8, number };
  if (done.has("job")) return { state: "partial", words: row.last_error ? `${inSm8} ${row.last_error}` : inSm8, number };
  if (row.status === "failed") return { state: "failed", words: row.last_error ?? JOB_WORDS.row.threwGaveUp, number };
  if (row.status === "cancelled") return { state: "cancelled", words: row.last_error ?? JOB_WORDS.row.switchedOff, number };
  if (row.status === "sending") return { state: "adding", words: "Adding it to ServiceM8…", number };
  return { state: "waiting", words: "Waiting to go to ServiceM8.", number };
}
