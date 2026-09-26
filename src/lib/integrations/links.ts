/* Reading and writing integration_links — server only.

   Same discipline as store.ts: every query is `.eq("org_id", orgId)` scoped,
   and nothing in a row is money. The extra rule here is the TENANT: every read
   filters on the connection's currently-active tenant, so switching which Xero
   organisation the workspace points at parks the old links instead of applying
   them to strangers. They are not deleted — switching back restores them. */

import { supabaseAdmin } from "@/lib/supabase-server";
import { displayNameOf } from "@/lib/staff/name";
import { sm8Handle } from "@/lib/workboard/sm8-mentions";
import { NOTE_WORDS } from "./sm8-note-words";

const TABLE = "integration_links";

type DbError = { code?: string; message?: string } | null;
/** A column this database doesn't have yet (its migration runs before the
    deploy, but a link shouldn't fail for want of it). */
const missingColumn = (e: DbError) => e?.code === "PGRST204" || e?.code === "42703";

/** A ServiceM8 link's answer to "Is <name> you?", as nothing. */
const UNCONFIRMED = {
  confirmed_remote_id: null,
  confirmed_answer: null,
  confirmed_at: null,
  confirmed_by_user_id: null,
};

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
  const row = {
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
  };
  const upsert = (r: Record<string, unknown>) =>
    supabaseAdmin.from(TABLE).upsert(r, { onConflict: "org_id,provider,kind,tenant_id,staff_profile_id" });
  /* A LINK MADE (OR MOVED) IS A LINK NOBODY HAS CONFIRMED. Whatever the
     person said to "Is <ServiceM8 name> you?" was said about the old one,
     so a relink writes the answer back to nothing. A database without the
     confirm columns yet links as before. */
  let { error } = await upsert({ ...row, ...UNCONFIRMED });
  if (missingColumn(error)) ({ error } = await upsert(row));

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

/* ── who a note goes as (two-way phase 2) ──

   A note HeyTiff puts in ServiceM8 goes AS THE PERSON WHO PRESSED IT
   (x-impersonate-uuid), so the link is no longer only a label: it decides
   whose name a note carries in somebody's ServiceM8. An owner makes links,
   by name match or by hand, and a match can be wrong. So before anything
   goes as them, each person answers "Is <ServiceM8 name> you?" once, and
   the answer is kept against the very link they saw:

     confirmed  ⇔  confirmed_answer = 'yes' AND confirmed_remote_id = remote_id
     'no'       is a denial, never a confirmation
     a relink   writes all four back to null (linkSm8StaffMember)

   Checked at queue time AND again at send time (sm8-note-send), so a link
   an owner moves between the press and the send never carries the note. */

const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Who a note would go as, for one HeyTiff person.
    - `ready`: confirmed, active in ServiceM8 — `staffUuid` is the link.
    - `confirm`: linked, not yet confirmed by them.
    - `denied`: they said the link isn't them.
    - `inactive`: ServiceM8 has them inactive, or the staff member is gone.
    - `bad_link`: the stored link isn't a staff uuid at all. Final: never
      retried.
    - `unlinked`: no link on the connected account (`noCard`: no staff card
      to link).
    - `unknown`: it couldn't be read. Nothing goes as `unknown`. */
export type NoteSender =
  | { state: "ready"; staffUuid: string; remoteId: string; sm8Name: string; handle: string | null }
  | { state: "confirm" | "denied" | "inactive"; remoteId: string; sm8Name: string; handle: string | null }
  | { state: "bad_link"; remoteId: string }
  | { state: "unlinked"; noCard: boolean }
  | { state: "unknown" };

type LinkRow = { remote_id: string | null; confirmed_remote_id: string | null; confirmed_answer: string | null };

async function heyTiffName(orgId: string, staffId: string): Promise<string> {
  const { data } = await supabaseAdmin
    .from("staff_profiles")
    .select("id, first_name, last_name, full_name, preferred_name")
    .eq("org_id", orgId)
    .eq("id", staffId)
    .maybeSingle();
  return data ? displayNameOf(data as Parameters<typeof displayNameOf>[0], "") : "";
}

export async function sm8NoteSender(orgId: string, staffId: string | null, tenantId?: string): Promise<NoteSender> {
  if (!staffId) return { state: "unlinked", noCard: true };
  try {
    let tenant = tenantId ?? null;
    if (!tenant) {
      const { data, error } = await supabaseAdmin
        .from("integration_connections")
        .select("tenant_id")
        .eq("org_id", orgId)
        .eq("provider", "servicem8")
        .maybeSingle();
      if (error) return { state: "unknown" };
      tenant = (data as { tenant_id: string | null } | null)?.tenant_id ?? null;
    }
    if (!tenant) return { state: "unlinked", noCard: false };

    const { data: link, error: linkError } = await supabaseAdmin
      .from(TABLE)
      .select("remote_id, confirmed_remote_id, confirmed_answer")
      .eq("org_id", orgId)
      .eq("provider", "servicem8")
      .eq("kind", SM8_STAFF)
      .eq("tenant_id", tenant)
      .eq("staff_profile_id", staffId)
      .maybeSingle();
    if (linkError) return { state: "unknown" };
    const row = link as LinkRow | null;
    if (!row || !row.remote_id) return { state: "unlinked", noCard: false };
    const remoteId = row.remote_id;
    if (!UUID_SHAPE.test(remoteId)) {
      console.error(`[sm8] the ServiceM8 link for staff ${staffId} in org ${orgId} isn't a staff uuid; nothing goes as them`);
      return { state: "bad_link", remoteId };
    }

    const { data: staff, error: staffError } = await supabaseAdmin
      .from("sm8_staff")
      .select("uuid, first, last, active")
      .eq("org_id", orgId)
      .eq("uuid", remoteId)
      .maybeSingle();
    if (staffError) return { state: "unknown" };
    const s = staff as { first: string | null; last: string | null; active: number | null } | null;
    if (!s) {
      /* linked to somebody ServiceM8 no longer has: named by HeyTiff's name */
      return { state: "inactive", remoteId, sm8Name: (await heyTiffName(orgId, staffId)) || "that person", handle: null };
    }
    const sm8Name = `${(s.first ?? "").trim()} ${(s.last ?? "").trim()}`.trim() || "that person";
    const handle = sm8Handle(s.first, s.last);

    const answered = row.confirmed_remote_id === remoteId;
    if (answered && row.confirmed_answer === "no") return { state: "denied", remoteId, sm8Name, handle };
    if (!(answered && row.confirmed_answer === "yes")) return { state: "confirm", remoteId, sm8Name, handle };
    if (s.active !== 1) return { state: "inactive", remoteId, sm8Name, handle };
    return { state: "ready", staffUuid: remoteId, remoteId, sm8Name, handle };
  } catch (err) {
    console.error(
      `[sm8] couldn't read who staff ${staffId} is in ServiceM8 for org ${orgId}: ${err instanceof Error ? err.message : String(err)}`
    );
    return { state: "unknown" };
  }
}

/** The ServiceM8 staff this account's people said AREN'T them ("Not me",
    for the link as it stands) — the owner's people card says so beside the
    link, which is where it gets fixed. A database without the confirm
    columns has no answers yet. */
export async function sm8DeniedLinks(orgId: string, tenantId: string): Promise<Set<string>> {
  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .select("remote_id, confirmed_remote_id, confirmed_answer")
    .eq("org_id", orgId)
    .eq("provider", "servicem8")
    .eq("kind", SM8_STAFF)
    .eq("tenant_id", tenantId)
    .eq("confirmed_answer", "no");
  if (error) return new Set();
  return new Set(
    ((data ?? []) as LinkRow[]).filter((r) => r.remote_id && r.confirmed_remote_id === r.remote_id).map((r) => r.remote_id!)
  );
}

/** A person's answer to "Is <ServiceM8 name> you?", for THEIR OWN link, and
    only for the link they saw (`remoteId`): a conditional update that
    matches nothing once an owner has relinked them, so Yes after a relink
    confirms nothing. */
export async function confirmSm8Link(input: {
  orgId: string;
  tenantId: string;
  staffId: string;
  userId: string;
  remoteId: string;
  answer: "yes" | "no";
}): Promise<{ ok: true } | { ok: false; error: string }> {
  if (input.answer !== "yes" && input.answer !== "no") return { ok: false, error: "That isn't an answer." };
  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .update({
      confirmed_remote_id: input.remoteId,
      confirmed_answer: input.answer,
      confirmed_at: new Date().toISOString(),
      confirmed_by_user_id: input.userId,
    })
    .eq("org_id", input.orgId)
    .eq("provider", "servicem8")
    .eq("kind", SM8_STAFF)
    .eq("tenant_id", input.tenantId)
    .eq("staff_profile_id", input.staffId)
    .eq("remote_id", input.remoteId)
    .select("id");
  if (error) return { ok: false, error: "Couldn't save that. Try again." };
  if ((data ?? []).length === 0) return { ok: false, error: NOTE_WORDS.press.linkChanged };
  return { ok: true };
}
