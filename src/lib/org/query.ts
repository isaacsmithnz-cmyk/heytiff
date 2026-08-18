import { supabaseAdmin } from "@/lib/supabase-server";
import { isCredKind, sortOrgCredentials, type OrgCredential } from "./credentials";
import type { OrgAccount } from "./account";

/* Reading the organisation's own credentials. Org-scoped, like every other
   query module here — there is no unscoped select in this file, and the sort is
   the pure one from credentials.ts so the grid and any other caller can never
   disagree about the order. */

const COLUMNS = "id, kind, name, number, issuer, expiry_date, color";

export async function listOrgCredentials(orgId: string): Promise<OrgCredential[]> {
  const { data } = await supabaseAdmin
    .from("org_credentials")
    .select(COLUMNS)
    .eq("org_id", orgId);

  const rows = (data ?? []) as Record<string, unknown>[];
  return sortOrgCredentials(
    rows
      .filter((r) => isCredKind(r.kind))
      .map((r) => ({
        id: String(r.id),
        kind: r.kind as OrgCredential["kind"],
        name: String(r.name ?? ""),
        number: (r.number as string) ?? null,
        issuer: (r.issuer as string) ?? null,
        expiryDate: (r.expiry_date as string) ?? null,
        color: (r.color as string) ?? null,
      }))
  );
}

/* The account's own facts — see account.ts for why they are on this screen.

   Four reads, all org-scoped and all HEAD counts where they can be: the two
   staff numbers never pull a row, only a count, so adding this card to the page
   costs a pair of index probes rather than the directory.

   Nothing here throws or redirects. A missing profile row is a real state (an
   owner who has never signed in since profiles existed), and it should read as
   a dash on one line, not as a 500 for the whole screen. */
export async function orgAccount(orgId: string, viewerUserId: string): Promise<OrgAccount> {
  const { data: org } = await supabaseAdmin
    .from("organizations")
    .select("created_at, plan, primary_owner_user_id")
    .eq("id", orgId)
    .maybeSingle();

  const ownerId = (org?.primary_owner_user_id as string | undefined) ?? null;

  const [owner, active, total] = await Promise.all([
    ownerId
      ? supabaseAdmin.from("profiles").select("name, email").eq("user_id", ownerId).maybeSingle()
      : Promise.resolve({ data: null }),
    supabaseAdmin
      .from("staff_profiles")
      .select("id", { count: "exact", head: true })
      .eq("org_id", orgId)
      .eq("status", "Active"),
    supabaseAdmin
      .from("staff_profiles")
      .select("id", { count: "exact", head: true })
      .eq("org_id", orgId),
  ]);

  return {
    ownerName: (owner.data?.name as string | undefined) ?? null,
    ownerEmail: (owner.data?.email as string | undefined) ?? null,
    ownerIsYou: Boolean(ownerId) && ownerId === viewerUserId,
    activeStaff: active.count ?? 0,
    totalStaff: total.count ?? 0,
    createdAt: (org?.created_at as string | undefined) ?? null,
    plan: (org?.plan as string | undefined) ?? "",
  };
}
