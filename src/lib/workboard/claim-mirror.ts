/* The money mirror tail — reads the three sides, asks claim-rules what should
   be true, writes the difference. Sibling to autoCompleteVisitsFromMirror, and
   called from the same after() chain behind a board load.

   Every decision worth arguing about lives in claim-rules.ts (pure, tested);
   this file is plumbing. NO SESSION HERE — callers establish the right to ask.
   Note it runs regardless of who is looking: `workboard_money` gates READING
   money, not whether the business's own books stay current. */

import { supabaseAdmin } from "@/lib/supabase-server";
import { parseSm8AmountToCents, SM8_JOB_MONEY_COLUMNS } from "./job-money";
import { planMirrorClaims, type ClaimJobLink, type ClaimMirrorJob } from "./claim-rules";

export async function ensureMirrorClaims(orgId: string, today: string): Promise<void> {
  const [{ data: linkRows }, { data: existingRows }] = await Promise.all([
    supabaseAdmin
      .from("project_jobs")
      .select("project_id, job_number, remote_id")
      .eq("org_id", orgId)
      .eq("provider", "servicem8")
      .not("remote_id", "is", null),
    supabaseAdmin
      .from("project_claims")
      .select("id, project_id, remote_ref")
      .eq("org_id", orgId)
      .eq("source", "servicem8")
      .not("remote_ref", "is", null),
  ]);

  const links: ClaimJobLink[] = (
    (linkRows ?? []) as { project_id: string; job_number: string | null; remote_id: string }[]
  ).map((r) => ({ projectId: r.project_id, remoteId: r.remote_id, jobNumber: r.job_number }));

  const existing = (
    (existingRows ?? []) as { id: string; project_id: string; remote_ref: string }[]
  ).map((r) => ({ id: r.id, projectId: r.project_id, remoteRef: r.remote_ref }));

  // Nothing linked and nothing left over: no work, and no third query.
  if (links.length === 0 && existing.length === 0) return;

  const remoteIds = [...new Set(links.map((l) => l.remoteId))];
  /* The payment ROWS are the collection truth — `payment_received` is flagged
     on 45 jobs while 1,819 hold actual payments — so they are read alongside
     the job rather than inferred from it. */
  const [{ data: jobRows }, { data: paymentRows }] = remoteIds.length
    ? await Promise.all([
        supabaseAdmin
          .from("sm8_jobs")
          .select(`uuid, generated_job_id, status, active, ${SM8_JOB_MONEY_COLUMNS}`)
          .eq("org_id", orgId)
          .in("uuid", remoteIds),
        supabaseAdmin
          .from("sm8_job_payments")
          .select("job_uuid, amount, timestamp")
          .eq("org_id", orgId)
          .eq("active", 1)
          .in("job_uuid", remoteIds),
      ])
    : [{ data: [] }, { data: [] }];

  const paid = new Map<string, { cents: number; lastOn: string | null }>();
  for (const p of (paymentRows ?? []) as {
    job_uuid: string;
    amount: string | null;
    timestamp: string | null;
  }[]) {
    const cents = parseSm8AmountToCents(p.amount);
    if (cents === null) continue;
    const day = p.timestamp && p.timestamp.length >= 10 ? p.timestamp.slice(0, 10) : null;
    const cur = paid.get(p.job_uuid) ?? { cents: 0, lastOn: null };
    paid.set(p.job_uuid, {
      cents: cur.cents + cents,
      // The LAST payment is when the claim actually settled.
      lastOn: !cur.lastOn || (day && day > cur.lastOn) ? day ?? cur.lastOn : cur.lastOn,
    });
  }

  type JobRow = {
    uuid: string;
    generated_job_id: string | null;
    status: string | null;
    active: number | null;
    total_invoice_amount: string | null;
    invoice_sent: number | null;
    invoice_date: string | null;
    payment_received: number | null;
    payment_received_stamp: string | null;
  };
  const jobs: ClaimMirrorJob[] = ((jobRows ?? []) as unknown as JobRow[]).map((j) => ({
    remoteId: j.uuid,
    jobNumber: j.generated_job_id,
    status: j.status,
    active: j.active,
    paidCents: paid.get(j.uuid)?.cents ?? 0,
    lastPaidOn: paid.get(j.uuid)?.lastOn ?? null,
    totalInvoiceAmount: j.total_invoice_amount,
    invoiceSent: j.invoice_sent,
    invoiceDate: j.invoice_date,
    paymentReceived: j.payment_received,
    paymentReceivedStamp: j.payment_received_stamp,
  }));

  const plan = planMirrorClaims({ links, jobs, existing, today });

  if (plan.upserts.length > 0) {
    /* onConflict names project_claims_remote_uniq's columns. That index is
       deliberately NOT partial: PostgREST emits `ON CONFLICT (cols)` with no
       predicate, and Postgres refuses to infer a partial index from that —
       verified against this database, because the failure is a runtime error
       nothing local would have caught. */
    await supabaseAdmin.from("project_claims").upsert(
      plan.upserts.map((u) => ({
        org_id: orgId,
        project_id: u.projectId,
        label: u.label,
        amount_cents: u.amountCents,
        claimed_on: u.claimedOn,
        status: u.status,
        paid_on: u.paidOn,
        source: "servicem8",
        remote_ref: u.remoteRef,
      })),
      { onConflict: "org_id,project_id,source,remote_ref" }
    );
  }

  if (plan.deleteIds.length > 0) {
    // Belt and braces: the planner only ever hands back mirrored ids, and the
    // source filter makes a bug here unable to touch a hand-typed claim.
    await supabaseAdmin
      .from("project_claims")
      .delete()
      .eq("org_id", orgId)
      .eq("source", "servicem8")
      .in("id", plan.deleteIds);
  }
}
