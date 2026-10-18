"use server";

import { auth0 } from "@/lib/auth0";
import { supabaseAdmin } from "@/lib/supabase-server";
import { can } from "@/lib/permissions-server";
import { getConnectionView } from "@/lib/integrations/store";

/* What New agreement reads when it opens away from the board (a job's page,
   a project's handover): the agreements its duplicate guard checks a client
   against, the categories it offers, whether ServiceM8 is connected (the
   From tray), and whether Tiff can read a job. The board hands the same from
   its own load. Read only; null for someone who can't make an agreement.

   A module of its own, not workboard-maintenance: the connection read pulls
   the integrations store (and its Xero client) in, and the maintenance and
   project actions are imported by suites and routes that should not carry it. */

export type AgreementFormContext = {
  agreements: { id: string; label: string; clientName: string; siteLabel: string | null; status: string }[];
  categories: { id: string; name: string; accent: string }[];
  connected: boolean;
  voiceless: boolean;
};

export async function agreementFormContext(): Promise<AgreementFormContext | null> {
  const session = await auth0.getSession();
  const orgId = session?.orgId as string | undefined;
  if (!orgId || !session?.user?.sub) return null;
  if (!(await can("workboard_manage"))) return null;
  const [{ data: agreementRows }, { data: categoryRows }, connection] = await Promise.all([
    supabaseAdmin
      .from("maintenance_agreements")
      .select("id, label, client_name, site_label, status")
      .eq("org_id", orgId)
      .in("status", ["active", "paused"]),
    supabaseAdmin.from("agreement_categories").select("id, name, accent").eq("org_id", orgId),
    getConnectionView(orgId, "servicem8"),
  ]);
  const agreements = ((agreementRows ?? []) as {
    id: string;
    label: string;
    client_name: string;
    site_label: string | null;
    status: string;
  }[]).map((a) => ({ id: a.id, label: a.label, clientName: a.client_name, siteLabel: a.site_label, status: a.status }));
  const categories = ((categoryRows ?? []) as AgreementFormContext["categories"]).sort((a, b) => a.name.localeCompare(b.name));
  return {
    agreements,
    categories,
    // as the board decides it: a grant waiting to be signed in again still reads
    connected: connection !== null,
    voiceless: !process.env.ANTHROPIC_API_KEY,
  };
}
