"use server";

import { revalidatePath } from "next/cache";
import { auth0 } from "@/lib/auth0";
import { hasMinRole } from "@/lib/roles";
import { getDbRole } from "@/lib/permissions-server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { getConnectionView } from "@/lib/integrations/store";
import { readSm8StaffRows } from "@/lib/integrations/sm8-read";
import {
  buildSm8PeopleRows,
  shapeSm8Person,
  type ImportStaffCandidate,
  type Sm8Person,
  type Sm8PersonRow,
} from "@/lib/integrations/sm8-people";
import {
  linkSm8StaffMember,
  listSm8StaffLinks,
  unlinkSm8StaffMember,
} from "@/lib/integrations/links";
import { normEmail } from "@/lib/integrations/match";
import { emailsByUser } from "@/lib/staff/query";
import { displayNameOf } from "@/lib/staff/name";

/* Importing and linking ServiceM8 staff — the write half of the people
   screen (sm8-people.ts arranges, this file acts).

   THE ACCEPT RULE: the card receives exactly the field values the reviewer
   left ticked and possibly edited — the client is trusted for VALUES the way
   any staff-card edit trusts its editor, but never for FACTS about ServiceM8.
   Which uuids exist, what they're called over there, and who is active is
   re-read live on every call; a uuid the account doesn't contain imports
   nothing. (Same posture as linkEmployee: an id from a client names a
   CHOICE, not a target.)

   Owner-only, like every integrations action — a Server Function is reachable
   by direct POST, so the role is re-checked on every call. The org id comes
   from the session, never the client.

   One truth: importing creates an UNCLAIMED card (user_id null) plus its
   link, in that order, with the link's remote-side unique index as the race
   backstop — if the link loses the race, the fresh card is removed rather
   than left as a duplicate-in-waiting. */

export type ImportPersonInput = {
  uuid: string;
  /** Accepted field values — absent means the reviewer unticked it. */
  firstName?: string;
  lastName?: string;
  jobTitle?: string;
  email?: string;
  phone?: string;
};

export type ImportResult =
  | { ok: true; imported: number; skipped: number }
  | { ok: false; error: string };

export type LinkResult = { ok: true } | { ok: false; error: string };

const NOT_OWNER = "Only an owner can change connected apps.";
const NOT_CONNECTED = "ServiceM8 isn't connected.";

async function ownerCtx(): Promise<{ orgId: string; userId: string } | { error: string }> {
  const session = await auth0.getSession();
  const orgId = session?.orgId as string | undefined;
  const userId = session?.user?.sub as string | undefined;
  if (!orgId || !userId) return { error: NOT_OWNER };
  if (!hasMinRole(await getDbRole(), "owner")) return { error: NOT_OWNER };
  return { orgId, userId };
}

function refresh() {
  revalidatePath("/dashboard/admin/integrations/servicem8");
  revalidatePath("/dashboard/team");
}

/** The live account, shaped and keyed — every action validates client uuids
    against this, never against what the browser claims exists. */
async function livePeople(orgId: string): Promise<
  { ok: true; byUuid: Map<string, Sm8Person> } | { ok: false; error: string }
> {
  const rows = await readSm8StaffRows(orgId);
  if (!rows.ok) return rows;
  const byUuid = new Map<string, Sm8Person>();
  for (const raw of rows.data) {
    const person = shapeSm8Person(raw);
    if (person) byUuid.set(person.uuid, person);
  }
  return { ok: true, byUuid };
}

/** Everything the people card renders, assembled server-side — the SM8
    sibling of getLinkingData. Null when there's nothing to show (not
    connected, or the caller shouldn't see it); a failed READ still returns,
    carrying its sentence, so the card can say why instead of vanishing. */
export type Sm8PeopleView = {
  rows: Sm8PersonRow[];
  linkable: { staffProfileId: string; name: string }[];
  error: string | null;
};

export async function getSm8PeopleData(): Promise<Sm8PeopleView | null> {
  const ctx = await ownerCtx();
  if ("error" in ctx) return null;

  const connection = await getConnectionView(ctx.orgId, "servicem8");
  if (!connection?.tenantId) return null;

  const [rowsRead, links, staffRead] = await Promise.all([
    readSm8StaffRows(ctx.orgId),
    listSm8StaffLinks(ctx.orgId, connection.tenantId),
    supabaseAdmin
      .from("staff_profiles")
      // every status: a linked bucket that can't name an archived card would
      // show "a removed card" for someone who is merely inactive
      .select("id, user_id, first_name, last_name, full_name, preferred_name, contact_email, status")
      .eq("org_id", ctx.orgId),
  ]);

  if (!rowsRead.ok) return { rows: [], linkable: [], error: rowsRead.error };

  const people = rowsRead.data
    .map(shapeSm8Person)
    .filter((p): p is Sm8Person => p !== null);

  const staffRows = (staffRead.data ?? []) as Record<string, unknown>[];
  const userIds = staffRows
    .map((r) => r.user_id)
    .filter((v): v is string => typeof v === "string");
  const emails = await emailsByUser(userIds);

  const candidates: ImportStaffCandidate[] = staffRows.map((r) => {
    const firstName = (r.first_name as string | null) ?? null;
    const lastName = (r.last_name as string | null) ?? null;
    const fullName = (r.full_name as string | null) ?? null;
    return {
      staffProfileId: String(r.id),
      firstName,
      lastName,
      fullName,
      // account email once they've arrived, else the address the card holds
      email:
        (typeof r.user_id === "string" ? (emails.get(r.user_id) ?? null) : null) ??
        ((r.contact_email as string | null) || null),
      name: displayNameOf({
        first_name: firstName,
        last_name: lastName,
        full_name: fullName,
        preferred_name: (r.preferred_name as string | null) ?? null,
      }),
      status: r.status === "Inactive" ? "Inactive" : "Active",
    };
  });

  const rows = buildSm8PeopleRows(people, candidates, links);

  const linkedStaff = new Set(links.map((l) => l.staffProfileId));
  const linkable = candidates
    .filter((c) => c.status === "Active" && !linkedStaff.has(c.staffProfileId))
    .map((c) => ({ staffProfileId: c.staffProfileId, name: c.name }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return { rows, linkable, error: null };
}

/** Import the selected people as unclaimed cards, each with its link.

    Per-person and forgiving: a row that can't land (unknown uuid, already
    imported by a racing click, a lost insert) is counted and skipped, never
    the whole batch failed — the screen re-reads afterwards and shows exactly
    what stuck. */
export async function importSm8Staff(people: ImportPersonInput[]): Promise<ImportResult> {
  const ctx = await ownerCtx();
  if ("error" in ctx) return { ok: false, error: ctx.error };

  if (!Array.isArray(people) || people.length === 0) {
    return { ok: false, error: "Nothing was selected to import." };
  }
  if (people.length > 200) {
    return { ok: false, error: "That's more than one import can take — select fewer at once." };
  }

  const connection = await getConnectionView(ctx.orgId, "servicem8");
  if (!connection?.tenantId) return { ok: false, error: NOT_CONNECTED };

  const live = await livePeople(ctx.orgId);
  if (!live.ok) return { ok: false, error: live.error };

  const [links, org] = await Promise.all([
    listSm8StaffLinks(ctx.orgId, connection.tenantId),
    supabaseAdmin.from("organizations").select("state").eq("id", ctx.orgId).maybeSingle(),
  ]);
  const alreadyLinked = new Set(links.map((l) => l.remoteId));
  // Same seed ensureStaffCard plants: holiday resolution needs a state from
  // this person's first day, and the org's is the only honest default.
  const orgState = (org.data?.state as string | undefined) ?? null;

  let imported = 0;
  let skipped = 0;

  for (const input of people) {
    const uuid = typeof input.uuid === "string" ? input.uuid.trim() : "";
    const person = uuid ? live.byUuid.get(uuid) : undefined;
    if (!person || alreadyLinked.has(uuid)) {
      skipped++;
      continue;
    }

    /* Accepted values, trimmed; names fall back to ServiceM8's own when the
       payload carries none, because a nameless card is unusable everywhere. */
    const str = (v: unknown): string | null =>
      typeof v === "string" && v.trim() ? v.trim() : null;
    const firstName = str(input.firstName) ?? person.first;
    const lastName = str(input.lastName) ?? person.last;
    const fullName = [firstName, lastName].filter(Boolean).join(" ");
    if (!fullName) {
      skipped++;
      continue;
    }

    const { data: card, error } = await supabaseAdmin
      .from("staff_profiles")
      .insert({
        org_id: ctx.orgId,
        first_name: firstName,
        last_name: lastName,
        full_name: fullName,
        job_title: str(input.jobTitle),
        phone: str(input.phone),
        // normalised on write — the claim path's fallback compares normalised
        contact_email: normEmail(str(input.email)) || null,
        status: person.active ? "Active" : "Inactive",
        state: orgState,
      })
      .select("id")
      .single();

    if (error || !card) {
      skipped++;
      continue;
    }

    const link = await linkSm8StaffMember({
      orgId: ctx.orgId,
      tenantId: connection.tenantId,
      staffProfileId: card.id as string,
      remoteId: person.uuid,
      // ServiceM8's own name at link time — provenance, not the card's truth.
      remoteLabel: person.name,
      matchedBy: "manual",
      userId: ctx.userId,
    });

    if (!link.ok) {
      /* The link lost the remote-side race — someone else imported or linked
         this person between our read and now. The card we just made would be
         a duplicate-in-waiting, so it goes; user_id is the guard against ever
         deleting a card somebody claimed in the gap. */
      await supabaseAdmin
        .from("staff_profiles")
        .delete()
        .eq("org_id", ctx.orgId)
        .eq("id", card.id as string)
        .is("user_id", null);
      skipped++;
      continue;
    }

    alreadyLinked.add(uuid);
    imported++;
  }

  refresh();
  return { ok: true, imported, skipped };
}

/** Link one ServiceM8 person to an existing card — accepting a suggestion
    ('auto') or picking from the list ('manual'). Both are human decisions;
    nothing in this codebase links anybody on its own. */
export async function linkSm8Staff(
  staffProfileId: string,
  remoteId: string,
  matchedBy: "auto" | "manual"
): Promise<LinkResult> {
  const ctx = await ownerCtx();
  if ("error" in ctx) return { ok: false, error: ctx.error };

  const connection = await getConnectionView(ctx.orgId, "servicem8");
  if (!connection?.tenantId) return { ok: false, error: NOT_CONNECTED };

  const [live, staffCheck] = await Promise.all([
    livePeople(ctx.orgId),
    supabaseAdmin
      .from("staff_profiles")
      .select("id, status")
      .eq("org_id", ctx.orgId)
      .eq("id", staffProfileId)
      .maybeSingle(),
  ]);

  if (!staffCheck.data) return { ok: false, error: "That person isn't in this workspace." };
  if (staffCheck.data.status !== "Active")
    return { ok: false, error: "They're archived here — restore them in Team before matching." };
  if (!live.ok) return { ok: false, error: live.error };

  const person = live.byUuid.get(remoteId);
  if (!person) return { ok: false, error: "That staff member isn't in the connected ServiceM8 account." };

  const result = await linkSm8StaffMember({
    orgId: ctx.orgId,
    tenantId: connection.tenantId,
    staffProfileId,
    remoteId,
    remoteLabel: person.name,
    matchedBy: matchedBy === "auto" ? "auto" : "manual",
    userId: ctx.userId,
  });
  if (!result.ok) return result;

  refresh();
  return { ok: true };
}

/** Remove one person's ServiceM8 link. The card stays — a link is a
    correspondence, not the person. */
export async function unlinkSm8Staff(staffProfileId: string): Promise<LinkResult> {
  const ctx = await ownerCtx();
  if ("error" in ctx) return { ok: false, error: ctx.error };

  const connection = await getConnectionView(ctx.orgId, "servicem8");
  if (!connection?.tenantId) return { ok: false, error: NOT_CONNECTED };

  const result = await unlinkSm8StaffMember(ctx.orgId, connection.tenantId, staffProfileId);
  if (!result.ok) return result;

  refresh();
  return { ok: true };
}
