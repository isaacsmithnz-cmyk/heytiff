"use server";

/* THE JOB CARD'S CUSTOMER DIALOG — its actions (Isaac, 2026-10-02: "editing
   the customer… pop-up modal… look at ServiceM8's job contact page… same
   information… lots of different site contacts… each with a role").

   Everything here answers before any session or database read where the
   deployment doesn't save customer changes (sm8CustomersAllowed), and asks
   workboard_manage of whoever is reading.

   What it opens with comes from the mirror — the job's contacts, its client
   or site — and the job's billing address read live from ServiceM8, because
   the mirror never kept it. Saving queues one row per record changed
   through the customer queue's one door, and sends them in the foreground
   for a few seconds. */

import { requireOrg } from "@/lib/permissions-server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { sm8CustomersAllowed } from "@/lib/integrations/sm8-kinds";
import { sm8PressFromSession } from "@/lib/integrations/sm8-press";
import { readSm8WriteState } from "@/lib/integrations/sm8-writes";
import { offersSend } from "@/lib/integrations/sm8-write-plan";
import { settlePressedWrites } from "@/lib/integrations/sm8-drain";
import { sm8AccessResult } from "@/lib/integrations/sm8-store";
import { sm8CallOf } from "@/lib/integrations/sm8-http";
import { readSm8Raw } from "@/lib/integrations/sm8-write";
import { CUSTOMER_WORDS, customerChanges, type CustomerForm } from "@/lib/integrations/sm8-customer-plan";
import { queueCustomerChanges } from "./sm8-customer-queue";

const SAVE_BUDGET_MS = 10_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function gate(): Promise<{ orgId: string } | { error: string }> {
  if (!sm8CustomersAllowed()) return { error: CUSTOMER_WORDS.card.customersUnavailable };
  try {
    const { orgId } = await requireOrg("workboard_manage");
    return { orgId };
  } catch {
    return { error: CUSTOMER_WORDS.press.noManage };
  }
}

/** Whether the card offers Edit on its contacts: the deployment saves
    customer changes, the reader runs the board, the owner has them on. */
export async function customerEditOffered(): Promise<boolean> {
  const g = await gate();
  if ("error" in g) return false;
  return offersSend(await readSm8WriteState(g.orgId), "customer");
}

export type CustomerForEdit =
  | { ok: true; form: CustomerForm; siteAddress: string | null; billingRead: boolean }
  | { ok: false; error: string };

/** What the dialog opens with. */
export async function readCustomerForEdit(jobUuid: string): Promise<CustomerForEdit> {
  const g = await gate();
  if ("error" in g) return { ok: false, error: g.error };
  if (!UUID.test(jobUuid)) return { ok: false, error: CUSTOMER_WORDS.row.gone };
  const { data: job } = await supabaseAdmin.from("sm8_jobs").select("uuid, company_uuid, job_address").eq("org_id", g.orgId).eq("uuid", jobUuid).maybeSingle();
  const j = job as { uuid: string; company_uuid: string | null; job_address: string | null } | null;
  if (!j) return { ok: false, error: CUSTOMER_WORDS.row.gone };
  const [{ data: company }, { data: contacts }] = await Promise.all([
    j.company_uuid
      ? supabaseAdmin.from("sm8_companies").select("uuid, name, address").eq("org_id", g.orgId).eq("uuid", j.company_uuid).maybeSingle()
      : Promise.resolve({ data: null }),
    supabaseAdmin.from("sm8_job_contacts").select("uuid, first, last, mobile, phone, email, type").eq("org_id", g.orgId).eq("job_uuid", jobUuid).eq("active", 1),
  ]);
  const c = company as { uuid: string; name: string | null; address: string | null } | null;

  /* the billing address, live: the mirror never kept it */
  let billingAddress: string | null = null;
  let billingRead = false;
  const access = await sm8AccessResult(g.orgId);
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

export type CustomerSaveAnswer = { ok: true; saved: number; waiting: number; failed: string[] } | { ok: false; error: string };

/** Save what the dialog holds. WHAT IT CHANGES IS WORKED OUT HERE, against
    the job as it stands now — never against the browser's copy — so a save
    can only touch this job's own contacts, its own client, and its own
    billing address. */
export async function saveCustomer(pressId: string, after: CustomerForm): Promise<CustomerSaveAnswer> {
  const startedAt = Date.now();
  const g = await gate();
  if ("error" in g) return { ok: false, error: g.error };
  const now = await readCustomerForEdit(after.jobUuid);
  if (!now.ok) return now;
  const before = now.form;
  /* a billing address that couldn't be read now isn't changed blind */
  const held: CustomerForm = { ...after, billingAddress: before.billingAddress === null ? null : after.billingAddress, company: after.company && before.company ? { ...after.company, uuid: before.company.uuid } : before.company };
  const diff = customerChanges(before, held);
  if (!diff.ok) return diff;
  if (diff.changes.length === 0) return { ok: false, error: CUSTOMER_WORDS.press.nothing };
  const press = await sm8PressFromSession();
  if (!press || press.orgId !== g.orgId) return { ok: false, error: CUSTOMER_WORDS.press.unqueued };
  const q = await queueCustomerChanges(press, pressId, after.jobUuid, diff.changes);
  if (!q.ok) return q;
  await settlePressedWrites(g.orgId, q.ids, { startedAt, budgetMs: SAVE_BUDGET_MS });
  const { data } = await supabaseAdmin.from("sm8_writes").select("id, status, last_error").eq("org_id", g.orgId).in("id", q.ids);
  const rows = (data ?? []) as { id: string; status: string; last_error: string | null }[];
  return {
    ok: true,
    saved: rows.filter((r) => r.status === "sent").length,
    waiting: rows.filter((r) => r.status === "queued" || r.status === "sending").length,
    failed: rows.filter((r) => r.status === "failed" || r.status === "cancelled").map((r) => r.last_error ?? CUSTOMER_WORDS.row.refused),
  };
}
