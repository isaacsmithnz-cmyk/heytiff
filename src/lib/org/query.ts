import { supabaseAdmin } from "@/lib/supabase-server";
import { signOne } from "@/lib/documents/query";
import { isCredKind, sortOrgCredentials, type OrgCredential } from "./credentials";
import { NO_BRAND, type OrgBrand } from "./brand";
import { sortCandidates, type OwnerCandidate } from "./ownership";
import type { OrgAccount } from "./account";
import type { Role } from "@/lib/roles-shared";

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

/* WHO THE ACCOUNT COULD BE HANDED TO — every other member with a login.

   MEMBERSHIPS IS THE ROSTER, not staff_profiles. A membership row IS the login;
   a staff card without one is a person who has been entered but has never
   signed in, and naming them here would offer a handover the FK refuses
   (organizations_primary_owner_fkey points at memberships). The name comes off
   profiles for the same reason the Account card's owner does.

   The current master is excluded rather than disabled — they are the one person
   this list cannot mean. */
export async function listOwnerCandidates(
  orgId: string,
  currentOwnerUserId: string | null
): Promise<OwnerCandidate[]> {
  const { data: members } = await supabaseAdmin
    .from("memberships")
    .select("user_id, role")
    .eq("org_id", orgId);

  const rows = (members ?? []).filter((m) => (m.user_id as string) !== currentOwnerUserId);
  if (rows.length === 0) return [];

  const { data: profiles } = await supabaseAdmin
    .from("profiles")
    .select("user_id, name, email")
    .in(
      "user_id",
      rows.map((m) => m.user_id as string)
    );

  const byUser = new Map<string, { name: string | null; email: string | null }>();
  for (const p of profiles ?? []) {
    byUser.set(p.user_id as string, {
      name: (p.name as string | undefined) ?? null,
      email: (p.email as string | undefined) ?? null,
    });
  }

  return sortCandidates(
    rows.map((m) => {
      const p = byUser.get(m.user_id as string);
      return {
        userId: m.user_id as string,
        name: p?.name ?? null,
        email: p?.email ?? null,
        role: (m.role as Role) ?? "staff",
      };
    })
  );
}

/* HAS THIS ORG BEEN THROUGH FIRST-RUN SETUP? Null timestamp = never — the
   state create_org_for_owner leaves a fresh org in, and the one condition the
   welcome flow redirects on (lib/org/setup.ts has the flow itself).

   FAILS SOFT TO "NOTHING PENDING", and the direction matters: this read runs
   on every owner's visit to Home, and the column arrives by migration
   (docs/migrations/org_setup_completed.sql). Code deployed ahead of the
   migration errors here — resolving that to `true` would bounce every owner
   in production to a setup screen for orgs that are already set up, so an
   error means "stay out of the way", never "redirect". */
export async function orgSetupPending(orgId: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from("organizations")
    .select("setup_completed_at")
    .eq("id", orgId)
    .maybeSingle();
  if (error || !data) return false;
  return data.setup_completed_at == null;
}

/** WHEN A RAISED INVOICE GOES OVERDUE, for the surfaces that read money out
    of the ServiceM8 mirror. ServiceM8 mirrors no invoice terms, so this is
    the only source there is — one number the business set on its own card.

    FAILS SOFT TO NULL, and null is a real answer here rather than a
    degraded one: unset terms mean the claim rows say when a claim was
    RAISED and nothing about when it is due. A read that errored must land
    on the same silence, never on a guessed fortnight that would call
    somebody late. */
export async function orgPaymentTermsDays(orgId: string): Promise<number | null> {
  const { data } = await supabaseAdmin
    .from("organizations")
    .select("payment_terms_days")
    .eq("id", orgId)
    .maybeSingle();
  const days = (data as { payment_terms_days: number | null } | null)?.payment_terms_days;
  return typeof days === "number" ? days : null;
}

/* The company's face, for a surface a customer receives — see lib/org/brand.ts.

   One row, six columns, and the logo signed on the way out. Callers that hold
   a page open for a long time (the live design link) pass their own clock;
   everything else takes the one-page-view default.

   Fails SOFT. A surface that could not read the org must still render — a
   handover sheet that 500s because a logo link could not be minted is worse
   than one that prints without it — so a missing row resolves to NO_BRAND and
   the caller falls back to its own wording. */
export async function orgBrand(
  orgId: string,
  opts: { seconds?: number } = {}
): Promise<OrgBrand> {
  const { data } = await supabaseAdmin
    .from("organizations")
    .select("trading_name, legal_name, abn, phone, email, website, logo_url, brand_color")
    .eq("id", orgId)
    .maybeSingle();
  if (!data) return NO_BRAND;

  const str = (v: unknown) => {
    const s = typeof v === "string" ? v.trim() : "";
    return s || null;
  };

  return {
    name: str(data.trading_name) ?? str(data.legal_name) ?? "",
    logoUrl: await signOne(data.logo_url as string | null, opts.seconds),
    color: str(data.brand_color),
    abn: str(data.abn),
    phone: str(data.phone),
    email: str(data.email),
    website: str(data.website),
  };
}
