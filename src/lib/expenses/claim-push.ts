import "server-only";

import { after } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { resolve } from "@/lib/permissions";
import type { Role } from "@/lib/roles-shared";
import { pushToStaff } from "@/lib/mobile/push";

/* A CLAIM'S PUSHES (Isaac, 28 October 2026, "Looks good" on the phone's
   expense claims): whoever approves hears when a claim comes in, and the
   person who sent it hears when it's approved or declined. Never your own:
   you don't approve your own spending, so you aren't told about it.

   AFTER THE ANSWER, never in its way: a push is best effort (lib/mobile/push)
   and runs once the response has gone. */

const money = (n: number) => `$${n.toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Everyone in the workspace who may approve a claim, as staff cards, less one. */
export async function approverStaffIds(orgId: string, except: string | null): Promise<string[]> {
  const { data } = await supabaseAdmin.from("memberships").select("user_id, role, permissions").eq("org_id", orgId);
  const users = ((data ?? []) as { user_id: string | null; role: string | null; permissions: unknown }[])
    .filter((m) => m.user_id && resolve((m.role as Role | null) ?? null, m.permissions).has("approvals"))
    .map((m) => m.user_id as string);
  if (!users.length) return [];
  const { data: staff } = await supabaseAdmin.from("staff_profiles").select("id").eq("org_id", orgId).in("user_id", users);
  return ((staff ?? []) as { id: string }[]).map((s) => String(s.id)).filter((id) => id !== except);
}

/** Run a push once the answer has gone; outside a request (a test, a script) straight away. */
function later(fn: () => Promise<unknown>): void {
  const run = () => fn().catch((err: unknown) => console.error(`[push] a claim's push failed: ${err instanceof Error ? err.message : String(err)}`));
  try {
    after(run);
  } catch {
    void run();
  }
}

/** A claim came in: everyone who approves hears, but not the person who sent it. */
export function pushClaimSent(orgId: string, claim: { staffId: string; description: string; amount: number }): void {
  later(async () => {
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
  later(() =>
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
