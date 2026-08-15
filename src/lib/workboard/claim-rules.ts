/* When a ServiceM8 invoice earns a project claim, and when it stops — pure,
   client-safe, and kept apart from claim-mirror.ts's database half the way
   board-status is kept apart from board-query.

   THE MODEL DOESN'T CHANGE, ONLY WHO TYPES IT. project_claims has always
   carried `source` and `remote_ref`, and removeClaim has always refused to
   delete a non-manual row with the words "it mirrors an invoice — it clears
   itself". This is the decision that finally makes that sentence true.
   Everything downstream — deriveProjectMoney's two axes, the claimed-of-total
   line, the pipeline chip — reads project_claims and gets project payments for
   free.

   ONE CLAIM PER (PROJECT, JOB), because a doubled claim overstates what has
   been claimed. The same ServiceM8 job linked to two projects mirrors onto
   BOTH — project_jobs allows that link and the UI warns rather than refuses,
   so each project's own money stays honest and nothing rolls the two up.

   SERVICEM8 IS TRUTH FOR ITS OWN ROWS, IN BOTH DIRECTIONS: amount, dates and
   paid-ness are rewritten every pass, and a job that stops being invoiced
   takes its claim away with it. That is why setClaimPaid refuses mirrored rows
   — two writers on one field is how a number starts disagreeing with itself.

   A MISSING JOB IS NOT A CLEARED JOB. Deletion only follows a job the mirror
   HAS and which fails the invoice test. Absence means the cache is warming — a
   fresh backfill, a wipe mid-sync — and reading it as "no longer invoiced"
   would quietly delete a project's payment history on the worst possible day.
   Together with the caller never running this while standalone, that is what
   lets mirrored claims survive a disconnect as cached history: the claim
   happened, it just stops refreshing. */

import { jobMoneyOf } from "./job-money";

/** A project ↔ ServiceM8 job link, as project_jobs holds it. */
export type ClaimJobLink = {
  projectId: string;
  remoteId: string;
  jobNumber: string | null;
};

/** What the mirror says about one job's money. */
export type ClaimMirrorJob = {
  remoteId: string;
  jobNumber: string | null;
  active: number | null;
  /** ServiceM8's own status — 'Completed' is what says the work is done. */
  status: string | null;
  /** Summed from this job's payment rows; 0 when none. */
  paidCents: number;
  /** The latest payment's day, for stamping a settled claim. */
  lastPaidOn: string | null;
  totalInvoiceAmount: string | null;
  invoiceSent: number | null;
  invoiceDate: string | null;
  paymentReceived: number | null;
  paymentReceivedStamp: string | null;
};

/** An existing mirrored claim row, as the planner needs to see it. */
export type ExistingMirrorClaim = {
  id: string;
  projectId: string;
  remoteRef: string;
};

export type MirrorClaimUpsert = {
  projectId: string;
  remoteRef: string;
  label: string;
  amountCents: number;
  claimedOn: string;
  status: "awaiting" | "paid";
  paidOn: string | null;
};

export type MirrorClaimPlan = {
  upserts: MirrorClaimUpsert[];
  /** Ids of mirrored claims whose job no longer earns one. */
  deleteIds: string[];
};

/** A claim's name. Deliberately says which job it came from — on a project
    with three linked jobs, "Invoice" three times is unreadable. */
export function mirrorClaimLabel(jobNumber: string | null): string {
  return jobNumber ? `Invoice — job #${jobNumber}` : "Invoice from ServiceM8";
}

/** `today` is handed in for the one case where ServiceM8 flags an invoice
    without dating it — never read from the clock here. */
export function planMirrorClaims(input: {
  links: readonly ClaimJobLink[];
  jobs: readonly ClaimMirrorJob[];
  existing: readonly ExistingMirrorClaim[];
  today: string;
}): MirrorClaimPlan {
  const byRemote = new Map(input.jobs.map((j) => [j.remoteId, j]));
  const upserts: MirrorClaimUpsert[] = [];
  /** (project, job) pairs that SHOULD hold a mirrored claim after this pass. */
  const earned = new Set<string>();
  /** (project, job) pairs whose job the mirror can currently speak for. */
  const known = new Set<string>();

  for (const link of input.links) {
    const job = byRemote.get(link.remoteId);
    if (!job) continue; // absent ≠ cleared — see the header
    const key = `${link.projectId}|${link.remoteId}`;
    known.add(key);

    const money = jobMoneyOf({
      total_invoice_amount: job.totalInvoiceAmount,
      invoice_sent: job.invoiceSent,
      invoice_date: job.invoiceDate,
      payment_received: job.paymentReceived,
      payment_received_stamp: job.paymentReceivedStamp,
    });

    /* WHAT EARNS A CLAIM, now that the invoice flag is known never to arrive.
       Waiting for `invoice_sent` meant waiting forever, and `payment_received`
       is set on 45 jobs against 1,819 that actually hold payments — so both
       flags are out and the two REAL facts decide it:

         the job is finished (ServiceM8's own status), or money has come in
         against it — and it is worth a readable amount.

       A deleted job earns nothing. Nor does one with no readable total: a $0
       claim says "claimed nothing" where "nothing claimed yet" is the truth,
       and the amount is the whole point of the row. */
    const alive = job.active !== 0;
    const worked = job.status === "Completed" || job.paidCents > 0;
    if (!alive || !worked || money.valueCents === null) continue;

    /* Collection is counted, not flagged. A PART payment stays `awaiting`:
       project_claims is binary, and the honest read of "some of it came in"
       is that this claim is not yet collected — the money card's paid/awaiting
       strip would otherwise call a half-paid claim settled. */
    const settled = job.paidCents >= money.valueCents;

    earned.add(key);
    upserts.push({
      projectId: link.projectId,
      remoteRef: link.remoteId,
      label: mirrorClaimLabel(job.jobNumber ?? link.jobNumber),
      amountCents: money.valueCents,
      // The day it was invoiced, else the day money moved, else today.
      claimedOn: money.invoicedOn ?? job.lastPaidOn ?? money.paidOn ?? input.today,
      status: settled ? "paid" : "awaiting",
      paidOn: settled ? job.lastPaidOn ?? money.paidOn : null,
    });
  }

  const linkedPairs = new Set(input.links.map((l) => `${l.projectId}|${l.remoteId}`));
  const deleteIds = input.existing
    .filter((row) => {
      const key = `${row.projectId}|${row.remoteRef}`;
      if (earned.has(key)) return false;
      // No link at all: somebody detached the job from this project — a
      // deliberate human act, so the claim goes with it.
      if (!linkedPairs.has(key)) return true;
      // The link stands and the job is readable; it simply isn't invoiced.
      // If the job ISN'T readable, this returns false and the claim stays.
      return known.has(key);
    })
    .map((row) => row.id);

  return { upserts, deleteIds };
}
