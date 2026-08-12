import { cache } from "react";
import { supabaseAdmin } from "@/lib/supabase-server";
import { expiresIn } from "@/lib/format/duration";
import { deriveCompliance, initialsFrom, startedLabel, yearsSince } from "./derive";
import { firstNameOf, fullNameOf } from "./name";
import type { PendingInviteRow, StaffLicence, StaffRow } from "./types";
import type { Role } from "@/lib/roles-shared";

/* Team queries. Every one of these is scoped by org_id from the session —
   there is no unscoped read in this file, deliberately.

   THE MONEY RULE: wage columns are only ever named in COLUMNS_WITH_PAY, which
   callers pass `financials` to reach. Without it the columns are not selected,
   so they cannot be leaked by a component that forgets to hide them — the
   payload simply doesn't contain them. Do not add a wage column to the base
   list "for convenience". */

const IDENTITY_COLUMNS =
  "id, user_id, first_name, last_name, full_name, preferred_name, contact_email, phone, birthday, address, start_date, " +
  "employment_type, job_title, status, state, photo_url, " +
  "emergency_name, emergency_phone, emergency_relationship, emergency_alt_phone, " +
  "work_rights_status, visa_type, visa_expiry, hours_condition, vevo_checked_at, " +
  "work_rights_doc_url, qualifications";

const PAY_COLUMNS =
  "hourly_wage, pay_basis, contracted_hours, utilisation, super_override, workers_comp_override, cost_split";

/** Notes are written *about* a person; they ride with `team`, not with pay. */
const NOTE_COLUMNS = "notes";

export function staffColumns(opts: { pay: boolean; notes: boolean }): string {
  return [IDENTITY_COLUMNS, opts.pay ? PAY_COLUMNS : "", opts.notes ? NOTE_COLUMNS : ""]
    .filter(Boolean)
    .join(", ");
}

type StaffProfileRow = Record<string, unknown> & {
  id: string;
  user_id: string | null;
  first_name: string | null;
  last_name: string | null;
  full_name: string | null;
  preferred_name: string | null;
  contact_email: string | null;
  job_title: string | null;
  employment_type: string | null;
  start_date: string | null;
  status: "Active" | "Inactive";
  work_rights_status: string | null;
  visa_type: string | null;
  visa_expiry: string | null;
  /* The check date the forms write. NOT `work_rights_verified_at`, which no
     write path in the app has ever set — see lib/staff/derive. */
  vevo_checked_at: string | null;
};

/** Licences for a set of staff, grouped by staff_profile_id. */
async function licencesByStaff(
  orgId: string,
  staffIds: string[]
): Promise<Map<string, StaffLicence[]>> {
  const out = new Map<string, StaffLicence[]>();
  if (staffIds.length === 0) return out;
  const { data } = await supabaseAdmin
    .from("staff_licences")
    .select("id, staff_profile_id, type_name, licence_number, expiry_date, color")
    .eq("org_id", orgId)
    .in("staff_profile_id", staffIds);
  for (const r of data ?? []) {
    const list = out.get(r.staff_profile_id as string) ?? [];
    list.push({
      id: r.id as string,
      typeName: r.type_name as string,
      licenceNumber: (r.licence_number as string) ?? null,
      expiryDate: (r.expiry_date as string) ?? null,
      color: (r.color as string) ?? null,
    });
    out.set(r.staff_profile_id as string, list);
  }
  return out;
}

/** One staff member's licences, org-scoped — for their own Compliance card. */
export async function listLicences(orgId: string, staffProfileId: string): Promise<StaffLicence[]> {
  return (await licencesByStaff(orgId, [staffProfileId])).get(staffProfileId) ?? [];
}

/** Emails live on `profiles` (written at login), keyed by Auth0 sub.

    Exported for the Xero linking screen, which matches staff to payroll
    employees by address first — one resolver, rather than a second join that
    could disagree with this one about whose email is whose. */
export async function emailsByUser(userIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (userIds.length === 0) return out;
  const { data } = await supabaseAdmin
    .from("profiles")
    .select("user_id, email")
    .in("user_id", userIds);
  for (const r of data ?? []) {
    if (r.email) out.set(r.user_id as string, r.email as string);
  }
  return out;
}

/* Where an unclaimed card came from, for the directory's provenance chip.
   All kinds on purpose — an sm8 'staff' link and a xero 'payroll_employee'
   link both answer "which system already knows this person". First link
   wins; a card in two systems is still one card, and the chip is a hint,
   not an inventory. */
const PROVIDER_LABEL: Record<string, string> = { servicem8: "ServiceM8", xero: "Xero" };

async function importSourceByStaff(
  orgId: string,
  staffIds: string[]
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (staffIds.length === 0) return out;
  const { data } = await supabaseAdmin
    .from("integration_links")
    .select("staff_profile_id, provider")
    .eq("org_id", orgId)
    .in("staff_profile_id", staffIds);
  for (const r of data ?? []) {
    const id = r.staff_profile_id as string | null;
    const provider = r.provider as string;
    if (id && !out.has(id)) out.set(id, PROVIDER_LABEL[provider] ?? provider);
  }
  return out;
}

/** Roles live on `memberships` — the Permissions card's source. */
async function rolesByUser(
  orgId: string,
  userIds: string[]
): Promise<Map<string, Role>> {
  const out = new Map<string, Role>();
  if (userIds.length === 0) return out;
  const { data } = await supabaseAdmin
    .from("memberships")
    .select("user_id, role")
    .eq("org_id", orgId)
    .in("user_id", userIds);
  for (const r of data ?? []) out.set(r.user_id as string, r.role as Role);
  return out;
}

/** One person's sparse capability overrides, for rendering their card. */
export async function permissionsOf(orgId: string, userId: string): Promise<unknown> {
  const { data } = await supabaseAdmin
    .from("memberships")
    .select("permissions")
    .eq("org_id", orgId)
    .eq("user_id", userId)
    .maybeSingle();
  return data?.permissions ?? null;
}

async function primaryOwnerOf(orgId: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from("organizations")
    .select("primary_owner_user_id")
    .eq("id", orgId)
    .maybeSingle();
  return (data?.primary_owner_user_id as string) ?? null;
}

/** Every staff member in the org, shaped for the directory. */
export async function listStaff(orgId: string, now = new Date()): Promise<StaffRow[]> {
  const { data, error } = await supabaseAdmin
    .from("staff_profiles")
    // identity only — the directory never shows pay
    .select(staffColumns({ pay: false, notes: false }))
    .eq("org_id", orgId);
  if (error || !data) return [];

  const rows = data as unknown as StaffProfileRow[];
  const ids = rows.map((r) => r.id);
  const userIds = rows.map((r) => r.user_id).filter((u): u is string => !!u);

  const [licences, emails, roles, master, sources] = await Promise.all([
    licencesByStaff(orgId, ids),
    emailsByUser(userIds),
    rolesByUser(orgId, userIds),
    primaryOwnerOf(orgId),
    importSourceByStaff(orgId, ids),
  ]);

  return rows.map((r) => toStaffRow(r, {
    licences: licences.get(r.id) ?? [],
    // account email once they've arrived; before that the address the card
    // was imported or pre-seeded with, so the row can still say who they are
    // (and so Invite has something to prefill)
    email: (r.user_id ? emails.get(r.user_id) ?? "" : "") || r.contact_email || "",
    orgRole: r.user_id ? roles.get(r.user_id) ?? null : null,
    isMaster: !!r.user_id && r.user_id === master,
    importedFrom: sources.get(r.id) ?? null,
    now,
  }));
}

/** One staff member by id, SCOPED TO THE ORG — a foreign UUID returns null,
    which the route turns into a 404. Never look one up by id alone. */
export async function getStaff(
  orgId: string,
  staffId: string,
  opts: { pay: boolean; notes: boolean },
  now = new Date()
): Promise<{ row: StaffRow; profile: Record<string, unknown>; licences: StaffLicence[] } | null> {
  const { data, error } = await supabaseAdmin
    .from("staff_profiles")
    .select(staffColumns(opts))
    .eq("org_id", orgId)
    .eq("id", staffId)
    .maybeSingle();
  if (error || !data) return null;

  const profile = data as unknown as StaffProfileRow;
  const [licences, emails, roles, master] = await Promise.all([
    licencesByStaff(orgId, [staffId]),
    emailsByUser(profile.user_id ? [profile.user_id] : []),
    rolesByUser(orgId, profile.user_id ? [profile.user_id] : []),
    primaryOwnerOf(orgId),
  ]);

  const lics = licences.get(staffId) ?? [];
  return {
    row: toStaffRow(profile, {
      licences: lics,
      email: profile.user_id ? emails.get(profile.user_id) ?? "" : "",
      orgRole: profile.user_id ? roles.get(profile.user_id) ?? null : null,
      isMaster: !!profile.user_id && profile.user_id === master,
      now,
    }),
    profile: profile as Record<string, unknown>,
    licences: lics,
  };
}

function toStaffRow(
  p: StaffProfileRow,
  ctx: {
    licences: StaffLicence[];
    email: string;
    orgRole: Role | null;
    isMaster: boolean;
    /** provenance chip for unclaimed cards; the profile route doesn't need it */
    importedFrom?: string | null;
    now: Date;
  }
): StaffRow {
  const stored = fullNameOf(p);
  const name = stored || ctx.email.split("@")[0] || "Unnamed";
  return {
    id: p.id,
    userId: p.user_id,
    initials: initialsFrom(stored, ctx.email),
    name,
    nickname: p.preferred_name || undefined,
    email: ctx.email,
    role: p.job_title || "—",
    employmentType: p.employment_type || "—",
    started: startedLabel(p.start_date),
    years: yearsSince(p.start_date, ctx.now),
    licenceCount: ctx.licences.length,
    status: p.status,
    // Fleet is still demo-backed and keyed by demo staff ids, so a real card
    // has no vehicle until Stage 4 wires the register to staff_profiles.id.
    vehicle: "—",
    compliance: deriveCompliance(
      ctx.licences,
      {
        status: p.work_rights_status,
        visaType: p.visa_type,
        visaExpiry: p.visa_expiry,
        vevoCheckedAt: p.vevo_checked_at,
      },
      ctx.now
    ),
    orgRole: ctx.orgRole,
    isMaster: ctx.isMaster,
    importedFrom: ctx.importedFrom ?? null,
  };
}

/* The signed-in person's own name, for the shell topbar and the dashboard
   greeting.

   Both used to derive this from the Auth0 session, which sets no `name` claim
   here — so they fell back to the email prefix and showed "isaacsmithnz1"
   instead of a name. The staff record is the real, editable source of truth, so
   read it and keep the session only as a last resort for someone with no card
   yet. Cached, so the layout and the page share one query per request. */
export type ViewerName = { full: string; first: string };

export const getViewerName = cache(
  async (orgId: string, userId: string, fallback: string): Promise<ViewerName> => {
    const { data } = await supabaseAdmin
      .from("staff_profiles")
      .select("first_name, last_name, full_name, preferred_name")
      .eq("org_id", orgId)
      .eq("user_id", userId)
      .maybeSingle();

    const row = data ?? {};
    const full = fullNameOf(row);
    const safeFallback = fallback.trim() || "there";

    return {
      full: full || safeFallback,
      // firstNameOf lets a preferred name win — that's the point of it
      first: firstNameOf(row) || safeFallback,
    };
  },
);

/** Outstanding invitations, shaped for the directory's Pending tab.

    `withLinks` follows the house money-boundary pattern: the token IS the
    invite (possessing the link is what joins someone to the org), so it is
    selected only for a viewer who may invite — absent from the payload, not
    hidden in the UI. Same for `id`, which renew/revoke act on. */
export async function listPendingInvites(
  orgId: string,
  opts: { withLinks?: boolean } = {},
  now = new Date()
): Promise<PendingInviteRow[]> {
  const withLinks = opts.withLinks === true;
  // plain `string` so supabase-js doesn't try to parse the union literal
  const cols: string = withLinks
    ? "id, email, role, token, expires_at, accepted_at"
    : "email, role, expires_at, accepted_at";
  const { data } = await supabaseAdmin
    .from("invitations")
    .select(cols)
    .eq("org_id", orgId)
    .is("accepted_at", null)
    .order("created_at", { ascending: false });

  return ((data ?? []) as unknown as Record<string, unknown>[]).map((r) => {
    const expiresAt = r.expires_at as string;
    const expires = new Date(expiresAt);
    const days = Math.round((expires.getTime() - now.getTime()) / 86_400_000);
    const live = days >= 0;
    return {
      id: withLinks ? (r.id as string) : null,
      // no name until they accept — the email is the only thing we know
      name: (r.email as string).split("@")[0],
      email: r.email as string,
      role: r.role === "admin" ? "Admin" : "Staff",
      state: live ? ("live" as const) : ("expired" as const),
      note: expiresIn(days),
      token: withLinks ? (r.token as string) : null,
      expiresAt,
    };
  });
}
