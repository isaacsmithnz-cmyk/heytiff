/* A JOB'S CUSTOMER, read to change and saved — for the web's Edit customer
   dialog (actions/job-customer) and the phone's Contact sheet
   (api/mobile/jobs/[id]/customer), behind whichever gate each has.

   Nothing here asks who is reading: the caller has already checked the
   deployment saves customer changes and the person runs the board, and
   hands in the workspace, or a press minted from that check.

   What it opens with comes from the mirror — the job's contacts, its client
   or site, its site address — and the job's billing address read live from
   ServiceM8, because the mirror never kept it. Saving queues one row per
   record changed through the customer queue's one door, and sends them in
   the foreground for a few seconds. */

import { supabaseAdmin } from "@/lib/supabase-server";
import type { Sm8Press } from "@/lib/integrations/sm8-press";
import { settlePressedWrites } from "@/lib/integrations/sm8-drain";
import { syncSm8AfterSend } from "@/lib/integrations/sm8-freshness";
import { sm8AccessResult } from "@/lib/integrations/sm8-store";
import { sm8CallOf } from "@/lib/integrations/sm8-http";
import { readSm8Raw } from "@/lib/integrations/sm8-write";
import { CUSTOMER_WORDS, customerChanges, type CustomerForm } from "@/lib/integrations/sm8-customer-plan";
import { queueCustomerChanges } from "@/app/actions/sm8-customer-queue";

const SAVE_BUDGET_MS = 10_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type CustomerForEdit =
  | { ok: true; form: CustomerForm; siteAddress: string | null; billingRead: boolean }
  | { ok: false; error: string };

export type CustomerSaveAnswer = { ok: true; saved: number; waiting: number; failed: string[] } | { ok: false; error: string };

/** The job's customer as it stands, in `orgId`'s mirror and, for the
    billing address, live in ServiceM8. */
export async function readCustomerFormIn(orgId: string, jobUuid: string): Promise<CustomerForEdit> {
  if (!UUID.test(jobUuid)) return { ok: false, error: CUSTOMER_WORDS.row.gone };
  const { data: job } = await supabaseAdmin.from("sm8_jobs").select("uuid, company_uuid, job_address").eq("org_id", orgId).eq("uuid", jobUuid).maybeSingle();
  const j = job as { uuid: string; company_uuid: string | null; job_address: string | null } | null;
  if (!j) return { ok: false, error: CUSTOMER_WORDS.row.gone };
  const [{ data: company }, { data: contacts }] = await Promise.all([
    j.company_uuid
      ? supabaseAdmin.from("sm8_companies").select("uuid, name, address").eq("org_id", orgId).eq("uuid", j.company_uuid).maybeSingle()
      : Promise.resolve({ data: null }),
    supabaseAdmin.from("sm8_job_contacts").select("uuid, first, last, mobile, phone, email, type").eq("org_id", orgId).eq("job_uuid", jobUuid).eq("active", 1),
  ]);
  const c = company as { uuid: string; name: string | null; address: string | null } | null;

  /* the billing address, live: the mirror never kept it */
  let billingAddress: string | null = null;
  let billingRead = false;
  const access = await sm8AccessResult(orgId);
  if (access.ok) {
    const r = await readSm8Raw(sm8CallOf(access.access, "read"), "job", jobUuid);
    if (r.ok && r.found) {
      billingAddress = typeof r.row.billing_address === "string" ? r.row.billing_address : "";
      billingRead = true;
    }
  }

  const t = (v: string | null | undefined) => (v ?? "").trim();
  return {
    ok: true,
    siteAddress: j.job_address?.trim() || null,
    billingRead,
    form: {
      jobUuid,
      company: c ? { uuid: c.uuid, name: t(c.name), address: t(c.address) } : null,
      billingAddress: billingRead ? billingAddress : null,
      siteAddress: t(j.job_address),
      contacts: ((contacts ?? []) as { uuid: string; first: string | null; last: string | null; mobile: string | null; phone: string | null; email: string | null; type: string | null }[]).map((x) => ({
        uuid: x.uuid,
        first: t(x.first),
        last: t(x.last),
        mobile: t(x.mobile),
        phone: t(x.phone),
        email: t(x.email),
        type: t(x.type) || "JOB",
      })),
    },
  };
}

/** What to save: the whole form (the web's dialog), or how to make it from
    the job as it stands now (the phone's one change, lib/mobile/customer-edit). */
export type CustomerSave = CustomerForm | { jobUuid: string; shape: (before: CustomerForm) => { ok: true; after: CustomerForm } | { ok: false; error: string } };

/** Save as `press`'s. WHAT IT CHANGES IS WORKED OUT HERE, against the job
    as it stands now — never against the caller's copy — so a save can only
    touch this job's own contacts, its own client, and its own two
    addresses. */
export async function saveCustomerWith(press: Sm8Press, pressId: string, save: CustomerSave, startedAt: number): Promise<CustomerSaveAnswer> {
  const orgId = press.orgId;
  const now = await readCustomerFormIn(orgId, save.jobUuid);
  if (!now.ok) return now;
  const before = now.form;
  let after: CustomerForm;
  if ("shape" in save) {
    const shaped = save.shape(before);
    if (!shaped.ok) return shaped;
    after = { ...shaped.after, jobUuid: save.jobUuid };
  } else after = save;
  /* a billing address that couldn't be read now isn't changed blind */
  const held: CustomerForm = { ...after, billingAddress: before.billingAddress === null ? null : after.billingAddress, company: after.company && before.company ? { ...after.company, uuid: before.company.uuid } : before.company };
  const diff = customerChanges(before, held);
  if (!diff.ok) return diff;
  if (diff.changes.length === 0) return { ok: false, error: CUSTOMER_WORDS.press.nothing };
  const q = await queueCustomerChanges(press, pressId, after.jobUuid, diff.changes);
  if (!q.ok) return q;
  await settlePressedWrites(orgId, q.ids, { startedAt, budgetMs: SAVE_BUDGET_MS });
  const { data } = await supabaseAdmin.from("sm8_writes").select("id, status, last_error").eq("org_id", orgId).in("id", q.ids);
  const rows = (data ?? []) as { id: string; status: string; last_error: string | null }[];
  /* job contacts get no live updates, and the mirror's site address is
     ServiceM8's: read what landed back now */
  if (rows.some((r) => r.status === "sent")) syncSm8AfterSend(orgId);
  return {
    ok: true,
    saved: rows.filter((r) => r.status === "sent").length,
    waiting: rows.filter((r) => r.status === "queued" || r.status === "sending").length,
    failed: rows.filter((r) => r.status === "failed" || r.status === "cancelled").map((r) => r.last_error ?? CUSTOMER_WORDS.row.refused),
  };
}
