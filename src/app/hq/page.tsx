import { requireHqPage } from "@/lib/hq/guard";
import { supabaseAdmin } from "@/lib/supabase-server";
import { installedPacks, loadInstalledPack } from "@/lib/studio/packs/server";
import { indoorReadiness, outdoorReadiness } from "@/lib/studio/packs/ready";
import { buildOrgRows } from "@/lib/hq/overview";
import { KpiGrid, type Kpi } from "@/components/hq/kpi-grid";
import { OrgTable } from "@/components/hq/org-table";
import { SystemCard, type EnvFlag } from "@/components/hq/system-card";

/* HQ overview — platform-wide KPIs and the org-first table. Read at request
   time (service-role queries + live pack read) so counts are always current. */

export const dynamic = "force-dynamic";

const DAY_MS = 86_400_000;

async function countOf(
  build: () => PromiseLike<{ count: number | null }>
): Promise<number> {
  const { count } = await build();
  return count ?? 0;
}

/** Catalog units + engine-ready share across installed packs (raw, no overrides
    yet in Stage A). A unit is engine-ready when no claimed role is missing a
    field, i.e. its readiness `missing` map is empty. */
async function catalogSummary(): Promise<{ units: number; readyPct: number }> {
  const refs = await installedPacks();
  let units = 0;
  let ready = 0;
  for (const ref of refs) {
    const { pack } = await loadInstalledPack(ref.brand, ref.version);
    for (const idu of pack.indoor_units) {
      units++;
      if (Object.keys(indoorReadiness(pack, idu).missing).length === 0) ready++;
    }
    for (const odu of pack.outdoor_units) {
      units++;
      if (Object.keys(outdoorReadiness(pack, odu).missing).length === 0) ready++;
    }
  }
  return { units, readyPct: units ? Math.round((ready / units) * 100) : 0 };
}

export default async function HqOverviewPage() {
  await requireHqPage();

  /* One clock reading, not two. The window and its end have to come from the
     same instant or the "last 30 days" figures are measured against a moment
     that has already moved on — and reading the clock twice mid-render is the
     impurity the compiler objects to. */
  const now = new Date();
  const nowIso = now.toISOString();
  const cutoff = new Date(now.getTime() - 30 * DAY_MS).toISOString();

  const [
    orgCount,
    userCount,
    newOrgs,
    newUsers,
    designCount,
    pendingInvites,
    catalog,
    orgsRes,
    membershipsRes,
    designsRes,
  ] = await Promise.all([
    countOf(() =>
      supabaseAdmin.from("organizations").select("*", { count: "exact", head: true })
    ),
    countOf(() =>
      supabaseAdmin.from("profiles").select("*", { count: "exact", head: true })
    ),
    countOf(() =>
      supabaseAdmin
        .from("organizations")
        .select("*", { count: "exact", head: true })
        .gte("created_at", cutoff)
    ),
    countOf(() =>
      supabaseAdmin
        .from("profiles")
        .select("*", { count: "exact", head: true })
        .gte("created_at", cutoff)
    ),
    countOf(() =>
      supabaseAdmin.from("studio_designs").select("*", { count: "exact", head: true })
    ),
    countOf(() =>
      supabaseAdmin
        .from("invitations")
        .select("*", { count: "exact", head: true })
        .is("accepted_at", null)
        .gt("expires_at", nowIso)
    ),
    catalogSummary(),
    supabaseAdmin.from("organizations").select("id, name, created_at"),
    supabaseAdmin.from("memberships").select("org_id, user_id"),
    supabaseAdmin.from("studio_designs").select("org_id, updated_at"),
  ]);

  const orgRows = buildOrgRows(
    orgsRes.data ?? [],
    membershipsRes.data ?? [],
    designsRes.data ?? []
  );

  const REQUIRED_ENV = [
    "HQ_EMAILS",
    "NEXT_PUBLIC_SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
    "AUTH0_DOMAIN",
    "AUTH0_CLIENT_ID",
    "AUTH0_CLIENT_SECRET",
    "AUTH0_SECRET",
    "APP_BASE_URL",
  ];
  const env: EnvFlag[] = REQUIRED_ENV.map((name) => ({
    name,
    set: !!process.env[name],
  }));
  const facts = [
    { label: "Environment", value: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "—" },
    { label: "Node", value: process.version },
    { label: "Catalog units", value: String(catalog.units) },
  ];

  const kpis: Kpi[] = [
    { label: "Organisations", value: orgCount, sub: <><b>+{newOrgs}</b> in 30 days</> },
    {
      label: "New signups · 30d",
      value: newOrgs,
      sub: <>{newUsers} new user{newUsers === 1 ? "" : "s"}</>,
    },
    { label: "Total users", value: userCount },
    { label: "Studio designs", value: designCount },
    { label: "Pending invites", value: pendingInvites },
    {
      label: "Catalog units",
      value: catalog.units,
      sub: <><b>{catalog.readyPct}%</b> engine-ready</>,
    },
  ];

  return (
    <main className="hq-main">
      <h1 className="hq-h1">Platform overview</h1>
      <p className="hq-lede">
        Everything customer organisations can&apos;t see — who&apos;s signed up,
        how active they are, and the state of the universal data table.
      </p>

      <KpiGrid items={kpis} />

      <h2 className="hq-section-h">Organisations</h2>
      <OrgTable rows={orgRows} />

      <h2 className="hq-section-h" style={{ marginTop: 36 }}>
        System &amp; support
      </h2>
      <SystemCard facts={facts} env={env} />
    </main>
  );
}
