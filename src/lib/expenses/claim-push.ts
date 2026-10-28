import "server-only";

import { supabaseAdmin } from "@/lib/supabase-server";
import { afterResponse } from "@/lib/mobile/after-response";
import { staffHolding } from "@/lib/mobile/holders";
import { pushToStaff } from "@/lib/mobile/push";

/* A CLAIM'S PUSHES (Isaac, 28 October 2026, "Looks good" on the phone's
   expense claims): whoever approves hears when a claim comes in, and the
   person who sent it hears when it's approved or declined. Never your own:
   you don't approve your own spending, so you aren't told about it.

   AFTER THE ANSWER, never in its way: a push is best effort (lib/mobile/push)
   and runs once the response has gone. */

const money = (n: number) => `$${n.toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Everyone in the workspace who may approve a claim, as staff cards, less one. */
export function approverStaffIds(orgId: string, except: string | null): Promise<string[]> {
  return staffHolding(orgId, "approvals", except);
}

/** A claim came in: everyone who approves hears, but not the person who sent it. */
export function pushClaimSent(orgId: string, claim: { staffId: string; description: string; amount: number }): void {
  afterResponse(async () => {
    const [approvers, name] = await Promise.all([approverStaffIds(orgId, claim.staffId), firstNameOf(orgId, claim.staffId)]);
    if (!approvers.length) return;
    await pushToStaff(orgId, approvers, {
      title: `${name ?? "Someone"} sent an expense claim`,
      body: `${claim.description}, ${money(claim.amount)}`,
      path: "/approvals",
    });
  });
}

/** A claim was decided: the person who sent it hears, with the reason when it's no. */
export function pushClaimDecided(
  orgId: string,
  claim: { staffId: string; description: string; amount: number },
  decision: { status: "approved" | "declined"; note: string | null },
): void {
  afterResponse(() =>
    pushToStaff(orgId, [claim.staffId], {
      title: decision.status === "approved" ? "Your expense claim was approved" : "Your expense claim was declined",
      body: decision.status === "declined" && decision.note ? `${claim.description}: ${decision.note}` : `${claim.description}, ${money(claim.amount)}`,
      path: "/expenses",
    }),
  );
}

async function firstNameOf(orgId: string, staffId: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from("staff_profiles")
    .select("first_name, preferred_name, full_name")
    .eq("org_id", orgId)
    .eq("id", staffId)
    .maybeSingle();
  const r = data as { first_name: string | null; preferred_name: string | null; full_name: string | null } | null;
  return (r?.preferred_name ?? r?.first_name ?? r?.full_name?.split(" ")[0] ?? "").trim() || null;
}
