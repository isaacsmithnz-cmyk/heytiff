import { supabaseAdmin } from "@/lib/supabase-server";
import { isCredKind, sortOrgCredentials, type OrgCredential } from "./credentials";

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
