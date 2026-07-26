"use server";

import { revalidatePath } from "next/cache";
import { auth0 } from "@/lib/auth0";
import { supabaseAdmin } from "@/lib/supabase-server";
import { can } from "@/lib/permissions-server";
import { staffProfileIdFor } from "@/lib/fleet/query";
import { todayInAu } from "@/lib/au-dates";
import { buildClaim, canTransition, isExpenseStatus, type ClaimInput } from "@/lib/expenses/claim";

/* Expense-claim mutations — reimbursing a person for money they spent.

   THE SAME THREE TIERS AS LEAVE, deliberately: this is the same kind of object,
   and a second approval model would drift from the proven one.

     OWN     submit / cancel your own claim. No capability — spending your own
             money on the job is not a privilege. Cancel only while nobody has
             decided.
     REVIEW  approve / decline. Needs `approvals`, and NEVER on your own claim.
     PAY     mark reimbursed. Needs `financials`, because it records that money
             moved — a manager can approve the spend without touching payroll.

   Every status change goes through canTransition(), so "already decided" and
   "already paid" are refusals rather than silent overwrites. The UI is not a
   control: everything is re-decided here. */

export type ExpenseResult = { ok: true } | { ok: false; error: string };

type Ctx = { orgId: string; staffId: string | null };

async function context(): Promise<Ctx | null> {
  const session = await auth0.getSession();
  const orgId = session?.orgId as string | undefined;
  const userId = session?.user?.sub as string | undefined;
  if (!orgId || !userId) return null;
  return { orgId, staffId: await staffProfileIdFor(orgId, userId) };
}

function refresh() {
  revalidatePath("/dashboard/my-expenses");
  revalidatePath("/dashboard/timepay");
}

/** The most receipts one claim can carry. A claim is one purchase; several
    pages of the same receipt is the case this allows for, not a folder. */
const MAX_RECEIPTS = 3;

/* ---------------- your own claim ---------------- */

export async function submitClaim(
  input: ClaimInput & { documentIds?: string[] }
): Promise<ExpenseResult> {
  const ctx = await context();
  if (!ctx?.staffId) return { ok: false, error: "No staff record for this account." };

  // Every rule the form applied, applied again — the form is a courtesy.
  const built = buildClaim(input, todayInAu());
  if ("error" in built) return { ok: false, error: built.error };

  const { data, error } = await supabaseAdmin
    .from("expense_claims")
    .insert({ org_id: ctx.orgId, staff_profile_id: ctx.staffId, ...built.row })
    .select("id")
    .maybeSingle();

  if (error || !data) return { ok: false, error: "Couldn't submit that claim." };

  /* Adopt the receipts, the way notices claim their attachments. Every clause
     matters: only this org's documents, only ones THIS person uploaded, only
     receipts, only ones no other claim has already taken, and only ones whose
     upload actually finished. */
  const ids = (input.documentIds ?? []).slice(0, MAX_RECEIPTS);
  if (ids.length > 0) {
    await supabaseAdmin
      .from("documents")
      .update({ expense_claim_id: data.id })
      .eq("org_id", ctx.orgId)
      .eq("uploaded_by", ctx.staffId)
      .eq("kind", "receipt")
      .is("expense_claim_id", null)
      .not("uploaded_at", "is", null)
      .in("id", ids);
  }

  refresh();
  return { ok: true };
}

export async function cancelClaim(claimId: string): Promise<ExpenseResult> {
  const ctx = await context();
  if (!ctx?.staffId) return { ok: false, error: "No staff record for this account." };

  const { data } = await supabaseAdmin
    .from("expense_claims")
    .select("status")
    .eq("org_id", ctx.orgId)
    // scoped to the caller's own row on the READ as well as the write, so a
    // stranger's id resolves to nothing rather than to a refusal that confirms
    // the claim exists
    .eq("staff_profile_id", ctx.staffId)
    .eq("id", claimId)
    .maybeSingle();

  if (!data) return { ok: false, error: "That claim isn't yours." };
  if (!isExpenseStatus(data.status) || !canTransition(data.status, "cancelled")) {
    return { ok: false, error: "That claim has already been decided." };
  }

  const { error } = await supabaseAdmin
    .from("expense_claims")
    .update({ status: "cancelled", updated_at: new Date().toISOString() })
    .eq("org_id", ctx.orgId)
    .eq("staff_profile_id", ctx.staffId)
    .eq("id", claimId);

  if (error) return { ok: false, error: "Couldn't cancel that claim." };
  refresh();
  return { ok: true };
}

/* ---------------- reviewing somebody else's ---------------- */

async function decide(
  claimId: string,
  status: "approved" | "declined",
  note: string | null
): Promise<ExpenseResult> {
  const ctx = await context();
  if (!ctx) return { ok: false, error: "Not signed in." };
  if (!(await can("approvals"))) return { ok: false, error: "You can't approve expenses." };

  const { data } = await supabaseAdmin
    .from("expense_claims")
    .select("status, staff_profile_id")
    .eq("org_id", ctx.orgId)
    .eq("id", claimId)
    .maybeSingle();

  if (!data) return { ok: false, error: "That claim doesn't exist." };
  // You don't sign off your own spending — the same rule as leave and hours.
  if (ctx.staffId && ctx.staffId === data.staff_profile_id) {
    return { ok: false, error: "You can't review your own expense claim." };
  }
  if (!isExpenseStatus(data.status) || !canTransition(data.status, status)) {
    return { ok: false, error: "That claim has already been decided." };
  }

  const { error } = await supabaseAdmin
    .from("expense_claims")
    .update({
      status,
      review_note: note,
      reviewed_by: ctx.staffId,
      reviewed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("org_id", ctx.orgId)
    .eq("id", claimId);

  if (error) return { ok: false, error: "Couldn't save that decision." };
  refresh();
  return { ok: true };
}

export async function approveClaim(claimId: string): Promise<ExpenseResult> {
  return decide(claimId, "approved", null);
}

/** Declining REQUIRES a reason. Somebody is out of pocket and being told no;
    "declined" on its own is not an answer they can do anything with. */
export async function declineClaim(claimId: string, reason: string): Promise<ExpenseResult> {
  const note = (reason ?? "").trim();
  if (!note) return { ok: false, error: "Give a reason so they know what to fix." };
  return decide(claimId, "declined", note.slice(0, 500));
}

/* ---------------- paying it ---------------- */

/** Record that the money actually moved. `financials`, not `approvals`:
    approving says the spend was legitimate, this says it was paid. */
export async function markReimbursed(claimId: string): Promise<ExpenseResult> {
  const ctx = await context();
  if (!ctx) return { ok: false, error: "Not signed in." };
  if (!(await can("financials"))) {
    return { ok: false, error: "You can't record reimbursements." };
  }

  const { data } = await supabaseAdmin
    .from("expense_claims")
    .select("status")
    .eq("org_id", ctx.orgId)
    .eq("id", claimId)
    .maybeSingle();

  if (!data) return { ok: false, error: "That claim doesn't exist." };
  if (!isExpenseStatus(data.status) || !canTransition(data.status, "reimbursed")) {
    // Covers both "not approved yet" and "already paid" — and the second is
    // the one worth refusing, because paying twice is real money.
    return { ok: false, error: "That claim isn't approved and awaiting payment." };
  }

  const { error } = await supabaseAdmin
    .from("expense_claims")
    .update({
      status: "reimbursed",
      reimbursed_by: ctx.staffId,
      reimbursed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("org_id", ctx.orgId)
    .eq("id", claimId);

  if (error) return { ok: false, error: "Couldn't record that." };
  refresh();
  return { ok: true };
}
