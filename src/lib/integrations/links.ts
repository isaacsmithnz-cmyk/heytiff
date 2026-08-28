/* Reading and writing integration_links — server only.

   Same discipline as store.ts: every query is `.eq("org_id", orgId)` scoped,
   and nothing in a row is money. The extra rule here is the TENANT: every read
   filters on the connection's currently-active tenant, so switching which Xero
   organisation the workspace points at parks the old links instead of applying
   them to strangers. They are not deleted — switching back restores them. */

import { supabaseAdmin } from "@/lib/supabase-server";

const TABLE = "integration_links";

/** Xero payroll employees — the first kind. A future supplier→contact link is
    another value here, not another table. */
export const PAYROLL_EMPLOYEE = "payroll_employee";

/** ServiceM8 staff members — the second kind, and the proof the table's
    design held: a new provider's people arrived as a row value. tenant_id
    carries the ServiceM8 vendor uuid (one account per grant). */
export const SM8_STAFF = "staff";

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

/* ── ServiceM8 staff — the same three helpers, the same discipline ── */

/** Links for the connected ServiceM8 account. */
export async function listSm8StaffLinks(
  orgId: string,
  tenantId: string
): Promise<IntegrationLink[]> {
  const { data } = await supabaseAdmin
    .from(TABLE)
    .select(COLUMNS)
    .eq("org_id", orgId)
    .eq("provider", "servicem8")
    .eq("kind", SM8_STAFF)
    .eq("tenant_id", tenantId);

  return ((data ?? []) as Record<string, unknown>[]).map(toLink).filter((l) => l.staffProfileId);
}

/** Link one person to one ServiceM8 staff member — upsert on the subject
    index like its Xero sibling, refusal on the remote index for the same
    reason: two people claiming one remote record means one of them is wrong,
    and a human decides which. */
export async function linkSm8StaffMember(input: {
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
      provider: "servicem8",
      kind: SM8_STAFF,
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
    if ((error as { code?: string }).code === "23505") {
      return { ok: false, error: "That ServiceM8 staff member is already linked to someone else." };
    }
    return { ok: false, error: "Couldn't save that link." };
  }
  return { ok: true };
}

/** Remove one person's ServiceM8 staff link for the connected account. */
export async function unlinkSm8StaffMember(
  orgId: string,
  tenantId: string,
  staffProfileId: string
): Promise<LinkResult> {
  const { error } = await supabaseAdmin
    .from(TABLE)
    .delete()
    .eq("org_id", orgId)
    .eq("provider", "servicem8")
    .eq("kind", SM8_STAFF)
    .eq("tenant_id", tenantId)
    .eq("staff_profile_id", staffProfileId);

  if (error) return { ok: false, error: "Couldn't remove that link." };
  return { ok: true };
}

/** ServiceM8 staff uuid → HeyTiff staff profile id, for the account this
    workspace is actually connected to.

    THE TENANT FILTER IS THE POINT, and it is why this lives here rather than
    in the caller: a workspace that re-granted against a different ServiceM8
    account still holds the old links, and applying them would put another
    business's people on this one's work. Reading the active tenant costs one
    cheap query on a table with a row per provider.

    Empty is an ordinary answer — nobody linked yet — and every caller must
    treat it as "we don't know who that is", never as "there is no such
    person". */
export async function sm8StaffLinkMap(orgId: string): Promise<Map<string, string>> {
  const { data: conn } = await supabaseAdmin
    .from("integration_connections")
    .select("tenant_id")
    .eq("org_id", orgId)
    .eq("provider", "servicem8")
    .maybeSingle();
  const tenantId = (conn as { tenant_id: string | null } | null)?.tenant_id ?? null;
  if (!tenantId) return new Map();

  const links = await listSm8StaffLinks(orgId, tenantId);
  return new Map(links.map((l) => [l.remoteId, l.staffProfileId]));
}
