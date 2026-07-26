/* Reading and writing integration_links — server only.

   Same discipline as store.ts: every query is `.eq("org_id", orgId)` scoped,
   and nothing in a row is money. The extra rule here is the TENANT: every read
   filters on the connection's currently-active tenant, so switching which Xero
   organisation the workspace points at parks the old links instead of applying
   them to strangers. They are not deleted — switching back restores them. */

import { supabaseAdmin } from "@/lib/supabase-server";

const TABLE = "integration_links";

/** The only kind today. A future supplier→contact link is another value here,
    not another table. */
export const PAYROLL_EMPLOYEE = "payroll_employee";

export type IntegrationLink = {
  id: string;
  staffProfileId: string;
  remoteId: string;
  remoteLabel: string | null;
  matchedBy: "auto" | "manual";
  linkedAt: string;
};

const COLUMNS = "id, staff_profile_id, remote_id, remote_label, matched_by, linked_at";

function toLink(row: Record<string, unknown>): IntegrationLink {
  return {
    id: String(row.id),
    staffProfileId: String(row.staff_profile_id ?? ""),
    remoteId: String(row.remote_id ?? ""),
    remoteLabel: (row.remote_label as string | null) ?? null,
    matchedBy: row.matched_by === "manual" ? "manual" : "auto",
    linkedAt: String(row.linked_at ?? ""),
  };
}

/** Links for the ACTIVE tenant. A link recorded against a different Xero
    organisation is deliberately invisible here — see the module note. */
export async function listPayrollLinks(
  orgId: string,
  tenantId: string
): Promise<IntegrationLink[]> {
  const { data } = await supabaseAdmin
    .from(TABLE)
    .select(COLUMNS)
    .eq("org_id", orgId)
    .eq("provider", "xero")
    .eq("kind", PAYROLL_EMPLOYEE)
    .eq("tenant_id", tenantId);

  return ((data ?? []) as Record<string, unknown>[]).map(toLink).filter((l) => l.staffProfileId);
}

/** How many links exist for OTHER tenants — the number behind the screen's
    "N links belong to a different Xero organisation" line. Without it, a tenant
    switch looks like the links were destroyed. */
export async function countLinksElsewhere(orgId: string, tenantId: string): Promise<number> {
  const { count } = await supabaseAdmin
    .from(TABLE)
    .select("id", { count: "exact", head: true })
    .eq("org_id", orgId)
    .eq("provider", "xero")
    .eq("kind", PAYROLL_EMPLOYEE)
    .neq("tenant_id", tenantId);
  return count ?? 0;
}

export type LinkResult = { ok: true } | { ok: false; error: string };

/** Link one person to one Xero employee.

    Upsert on the SUBJECT index, so re-linking someone moves their link rather
    than failing or leaving two. The remote-side unique index is what catches
    the dangerous case — a second person claiming an employee somebody else is
    already linked to — and that comes back as a refusal, not a silent
    overwrite, because it means one of the two is wrong and a human has to
    decide which. */
export async function linkPayrollEmployee(input: {
  orgId: string;
  tenantId: string;
  staffProfileId: string;
  remoteId: string;
  remoteLabel: string | null;
  matchedBy: "auto" | "manual";
  userId: string;
}): Promise<LinkResult> {
  const { error } = await supabaseAdmin.from(TABLE).upsert(
    {
      org_id: input.orgId,
      provider: "xero",
      kind: PAYROLL_EMPLOYEE,
      tenant_id: input.tenantId,
      staff_profile_id: input.staffProfileId,
      remote_id: input.remoteId,
      remote_label: input.remoteLabel,
      matched_by: input.matchedBy,
      linked_by_user_id: input.userId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "org_id,provider,kind,tenant_id,staff_profile_id" }
  );

  if (error) {
    // 23505 on the remote index: that Xero employee is already somebody else's.
    if ((error as { code?: string }).code === "23505") {
      return { ok: false, error: "That Xero employee is already linked to someone else." };
    }
    return { ok: false, error: "Couldn't save that link." };
  }
  return { ok: true };
}

/** Remove one person's link for the active tenant. */
export async function unlinkPayrollEmployee(
  orgId: string,
  tenantId: string,
  staffProfileId: string
): Promise<LinkResult> {
  const { error } = await supabaseAdmin
    .from(TABLE)
    .delete()
    .eq("org_id", orgId)
    .eq("provider", "xero")
    .eq("kind", PAYROLL_EMPLOYEE)
    .eq("tenant_id", tenantId)
    .eq("staff_profile_id", staffProfileId);

  if (error) return { ok: false, error: "Couldn't remove that link." };
  return { ok: true };
}
