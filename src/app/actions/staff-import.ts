"use server";

import { revalidatePath } from "next/cache";
import { auth0 } from "@/lib/auth0";
import { hasMinRole } from "@/lib/roles";
import { getDbRole } from "@/lib/permissions-server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { getConnectionView } from "@/lib/integrations/store";
import { readSm8StaffRows } from "@/lib/integrations/sm8-read";
import { listPayrollEmployees } from "@/lib/integrations/xero-read";
import { shapeSm8Person } from "@/lib/integrations/sm8-people";
import { xeroPersonOf } from "@/lib/integrations/xero-people";
import {
  buildPeopleRows,
  type ImportCandidate,
  type ImportStaffCandidate,
  type PersonRow,
} from "@/lib/integrations/people-import";
import {
  linkPayrollEmployee,
  linkSm8StaffMember,
  listPayrollLinks,
  listSm8StaffLinks,
  unlinkSm8StaffMember,
  type IntegrationLink,
} from "@/lib/integrations/links";
import { normEmail } from "@/lib/integrations/match";
import { emailsByUser } from "@/lib/staff/query";
import { displayNameOf } from "@/lib/staff/name";

/* Importing people from a connected system — the write half of the people
   screens (people-import.ts arranges, this file acts).

   ONE PATH, TWO PROVIDERS. ServiceM8 and Xero differ in exactly three things:
   where the live list comes from, which link kind records the correspondence,
   and what to call the system in a sentence. Everything that MATTERS — the
   accept rule, the gate, the card shape, the race handling — is written once
   below, because two copies would eventually disagree about what an import
   means.

   THE ACCEPT RULE: the card receives exactly the field values the reviewer
   left ticked and possibly edited — the client is trusted for VALUES the way
   any staff-card edit trusts its editor, but never for FACTS about the
   provider. Which ids exist, what they're called over there, and who is
   active is re-read live on every call; an id the account doesn't contain
   imports nothing. (Same posture as linkEmployee: an id from a client names a
   CHOICE, not a target.)

   WHAT IS NEVER IMPORTED: wages, pay basis, employment type. Those are
   HeyTiff's own, and Xero's answers reach them only through the drift lane,
   as suggestions a human accepts field by field.

   Owner-only, like every integrations action — a Server Function is reachable
   by direct POST, so the role is re-checked on every call. The org id comes
   from the session, never the client.

   One truth: importing creates an UNCLAIMED card (user_id null) plus its
   link, in that order, with the link's remote-side unique index as the race
   backstop — if the link loses the race, the fresh card is removed rather
   than left as a duplicate-in-waiting. */

export type ImportProvider = "servicem8" | "xero";

export type ImportPersonInput = {
  /** The provider's stable id for this person. */
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

export type PeopleView = {
  rows: PersonRow[];
  /** Active cards with no link of this kind yet — the manual picker's options. */
  linkable: { staffProfileId: string; name: string }[];
  /** The read failed — the sentence to show instead of rows. */
  error: string | null;
};

const NOT_OWNER = "Only an owner can change connected apps.";

/* ── the three things a provider differs in ── */

type ProviderAdapter = {
  label: string;
  notConnected: string;
  /** The live list, already shaped — every action validates ids against it. */
  read: (orgId: string) => Promise<{ ok: true; data: ImportCandidate[] } | { ok: false; error: string }>;
  links: (orgId: string, tenantId: string) => Promise<IntegrationLink[]>;
  link: (input: {
    orgId: string;
    tenantId: string;
    staffProfileId: string;
    remoteId: string;
    remoteLabel: string | null;
    matchedBy: "auto" | "manual";
    userId: string;
  }) => Promise<LinkResult>;
};

const ADAPTERS: Record<ImportProvider, ProviderAdapter> = {
  servicem8: {
    label: "ServiceM8",
    notConnected: "ServiceM8 isn't connected.",
    read: async (orgId) => {
      const rows = await readSm8StaffRows(orgId);
      if (!rows.ok) return rows;
      const data: ImportCandidate[] = [];
      for (const raw of rows.data) {
        const person = shapeSm8Person(raw);
        if (person) data.push(person);
      }
      return { ok: true, data };
    },
    links: listSm8StaffLinks,
    link: linkSm8StaffMember,
  },
  xero: {
    label: "Xero",
    notConnected: "Xero isn't connected.",
    read: async (orgId) => {
      const employees = await listPayrollEmployees(orgId);
      if (!employees.ok) return employees;
      return { ok: true, data: employees.data.map(xeroPersonOf) };
    },
    links: listPayrollLinks,
    /* The SAME writer the Time & Pay linking screen uses. Two writers for one
       kind is how two screens end up disagreeing about who is linked. */
    link: linkPayrollEmployee,
  },
};

async function ownerCtx(): Promise<{ orgId: string; userId: string } | { error: string }> {
  const session = await auth0.getSession();
  const orgId = session?.orgId as string | undefined;
  const userId = session?.user?.sub as string | undefined;
  if (!orgId || !userId) return { error: NOT_OWNER };
  if (!hasMinRole(await getDbRole(), "owner")) return { error: NOT_OWNER };
  return { orgId, userId };
}

function refresh(provider: ImportProvider) {
  revalidatePath(`/dashboard/admin/integrations/${provider}`);
  revalidatePath("/dashboard/team");
  // A Xero import creates the same payroll link the Time & Pay screen reads.
  if (provider === "xero") revalidatePath("/dashboard/timepay");
}

/** The workspace's cards, as both the matcher and the picker need them. */
async function staffCandidates(orgId: string): Promise<ImportStaffCandidate[]> {
  const { data } = await supabaseAdmin
    .from("staff_profiles")
    // every status: a linked bucket that can't name an archived card would
    // show "a removed card" for someone who is merely inactive
    .select("id, user_id, first_name, last_name, full_name, preferred_name, contact_email, status")
    .eq("org_id", orgId);

  const rows = (data ?? []) as Record<string, unknown>[];
  const userIds = rows.map((r) => r.user_id).filter((v): v is string => typeof v === "string");
  const emails = await emailsByUser(userIds);

  return rows.map((r) => {
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
}

/** Everything a people card renders, assembled server-side. Null when there's
    nothing to show (not connected, or the caller shouldn't see it); a failed
    READ still returns, carrying its sentence, so the card can say why instead
    of vanishing. */
async function peopleData(provider: ImportProvider): Promise<PeopleView | null> {
  const ctx = await ownerCtx();
  if ("error" in ctx) return null;

  const adapter = ADAPTERS[provider];
  const connection = await getConnectionView(ctx.orgId, provider);
  if (!connection?.tenantId) return null;

  const [read, links, candidates] = await Promise.all([
    adapter.read(ctx.orgId),
    adapter.links(ctx.orgId, connection.tenantId),
    staffCandidates(ctx.orgId),
  ]);

  if (!read.ok) return { rows: [], linkable: [], error: read.error };

  const linkedStaff = new Set(links.map((l) => l.staffProfileId));
  return {
    rows: buildPeopleRows(read.data, candidates, links),
    linkable: candidates
      .filter((c) => c.status === "Active" && !linkedStaff.has(c.staffProfileId))
      .map((c) => ({ staffProfileId: c.staffProfileId, name: c.name }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    error: null,
  };
}

export async function getSm8PeopleData(): Promise<PeopleView | null> {
  return peopleData("servicem8");
}

export async function getXeroPeopleData(): Promise<PeopleView | null> {
  return peopleData("xero");
}

/** Import the selected people as unclaimed cards, each with its link.

    Per-person and forgiving: a row that can't land (unknown id, already
    imported by a racing click, a lost insert) is counted and skipped, never
    the whole batch failed — the screen re-reads afterwards and shows exactly
    what stuck. */
export async function importPeople(
  provider: ImportProvider,
  people: ImportPersonInput[]
): Promise<ImportResult> {
  const ctx = await ownerCtx();
  if ("error" in ctx) return { ok: false, error: NOT_OWNER };

  const adapter = ADAPTERS[provider];
  if (!adapter) return { ok: false, error: "Unknown connected app." };

  if (!Array.isArray(people) || people.length === 0) {
    return { ok: false, error: "Nothing was selected to import." };
  }
  if (people.length > 200) {
    return { ok: false, error: "That's more than one import can take — select fewer at once." };
  }

  const connection = await getConnectionView(ctx.orgId, provider);
  if (!connection?.tenantId) return { ok: false, error: adapter.notConnected };

  const read = await adapter.read(ctx.orgId);
  if (!read.ok) return { ok: false, error: read.error };
  const byId = new Map(read.data.map((p) => [p.id, p]));

  const [links, org] = await Promise.all([
    adapter.links(ctx.orgId, connection.tenantId),
    supabaseAdmin.from("organizations").select("state").eq("id", ctx.orgId).maybeSingle(),
  ]);
  const alreadyLinked = new Set(links.map((l) => l.remoteId));
  // Same seed ensureStaffCard plants: holiday resolution needs a state from
  // this person's first day, and the org's is the only honest default.
  const orgState = (org.data?.state as string | undefined) ?? null;

  let imported = 0;
  let skipped = 0;

  for (const input of people) {
    const id = typeof input.uuid === "string" ? input.uuid.trim() : "";
    const person = id ? byId.get(id) : undefined;
    if (!person || alreadyLinked.has(id)) {
      skipped++;
      continue;
    }

    /* Accepted values, trimmed; names fall back to the provider's own when
       the payload carries none, because a nameless card is unusable. */
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

    const link = await adapter.link({
      orgId: ctx.orgId,
      tenantId: connection.tenantId,
      staffProfileId: card.id as string,
      remoteId: person.id,
      // the provider's own name at link time — provenance, not the card's truth
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

    alreadyLinked.add(id);
    imported++;
  }

  refresh(provider);
  return { ok: true, imported, skipped };
}

/** Link one remote person to an existing card — accepting a suggestion
    ('auto') or picking from the list ('manual'). Both are human decisions;
    nothing in this codebase links anybody on its own. */
export async function linkPerson(
  provider: ImportProvider,
  staffProfileId: string,
  remoteId: string,
  matchedBy: "auto" | "manual"
): Promise<LinkResult> {
  const ctx = await ownerCtx();
  if ("error" in ctx) return { ok: false, error: NOT_OWNER };

  const adapter = ADAPTERS[provider];
  if (!adapter) return { ok: false, error: "Unknown connected app." };

  const connection = await getConnectionView(ctx.orgId, provider);
  if (!connection?.tenantId) return { ok: false, error: adapter.notConnected };

  const [read, staffCheck] = await Promise.all([
    adapter.read(ctx.orgId),
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
  if (!read.ok) return { ok: false, error: read.error };

  const person = read.data.find((p) => p.id === remoteId);
  if (!person)
    return { ok: false, error: `They aren't in the connected ${adapter.label} account.` };

  const result = await adapter.link({
    orgId: ctx.orgId,
    tenantId: connection.tenantId,
    staffProfileId,
    remoteId,
    remoteLabel: person.name,
    matchedBy: matchedBy === "auto" ? "auto" : "manual",
    userId: ctx.userId,
  });
  if (!result.ok) return result;

  refresh(provider);
  return { ok: true };
}

/** Remove one person's ServiceM8 link. The card stays — a link is a
    correspondence, not the person.

    ServiceM8 only: a Xero payroll link is unmatched from the Time & Pay
    screen, behind `financials` (unlinkEmployee), because unmatching there
    also settles the wage drift the link was carrying. Routing it through
    here would be a second, weaker gate on the same decision. */
export async function unlinkSm8Staff(staffProfileId: string): Promise<LinkResult> {
  const ctx = await ownerCtx();
  if ("error" in ctx) return { ok: false, error: NOT_OWNER };

  const connection = await getConnectionView(ctx.orgId, "servicem8");
  if (!connection?.tenantId) return { ok: false, error: ADAPTERS.servicem8.notConnected };

  const result = await unlinkSm8StaffMember(ctx.orgId, connection.tenantId, staffProfileId);
  if (!result.ok) return result;

  refresh("servicem8");
  return { ok: true };
}
