import { supabaseAdmin } from "@/lib/supabase-server";
import { remindAtFrom } from "@/lib/dashboard/reminders";
import { workdayHours } from "@/lib/dashboard/reminders-query";
import { getSm8Timezone } from "@/lib/workboard/query";
import { isReminderLead, reminderDueDate } from "@/lib/fleet/reminders";
import {
  LICENCE_DOC_KIND,
  buildLicenceTermRow,
  licenceReminderDetail,
  licenceReminderTitle,
  type LicenceTermInput,
  type LicenceTermRow,
} from "./licence-records";

/* THE WRITES BEHIND A STAFF LICENCE'S TERMS — the I/O half, shared.

   IT LIVES HERE BECAUSE THERE ARE TWO DOORS AND ONE TRUTH. Your own
   Compliance card writes through app/actions/profile.ts; a manager's view of
   your card writes through app/actions/staff.ts. The GATES are different and
   belong at those two boundaries — your own ticket is intrinsic, somebody
   else's needs `team` — but the SQL behind them must not be, or the two would
   drift and one of them would be the one that forgets to advance the cache.

   Every function here takes an already-resolved (orgId, staffId): the caller
   has decided who may do this before anything below runs. Nothing here checks
   a capability, and nothing here reads a session. */

export type WriteResult = { ok: true } | { ok: false; error: string };

const TABLE = "staff_licences";
const TERMS = "staff_licence_records";

/** The licence, if it belongs to that person in that org. Null is "not yours
    to touch" and "gone" at once, which is the same answer to the caller. */
async function licenceIn(
  orgId: string,
  staffId: string,
  licenceId: string,
): Promise<{ id: string; typeName: string; expiry: string | null } | null> {
  const { data } = await supabaseAdmin
    .from(TABLE)
    .select("id, type_name, expiry_date")
    .eq("org_id", orgId)
    .eq("staff_profile_id", staffId)
    .eq("id", licenceId)
    .maybeSingle();
  if (!data) return null;
  return {
    id: String(data.id),
    typeName: String(data.type_name ?? ""),
    expiry: (data.expiry_date as string | null) ?? null,
  };
}

/* Adoption, on the codebase's standing contract: only the uploader's own,
   confirmed, still-unowned file of the RIGHT KIND may land. A file that
   refuses adoption must not be claimed by the term either, or the term would
   point at paperwork it does not own.

   `uploaderStaffId` is the person who UPLOADED, which is not always the person
   the licence belongs to: a manager can scan someone's ticket for them. */
async function adoptLicenceDocument(
  orgId: string,
  uploaderStaffId: string | null,
  licenceId: string,
  documentId: string,
  termId: string,
): Promise<void> {
  if (!uploaderStaffId) return;
  const { data } = await supabaseAdmin
    .from("documents")
    .update({ staff_licence_id: licenceId, licence_record_id: termId })
    .eq("org_id", orgId)
    .eq("id", documentId)
    .eq("uploaded_by", uploaderStaffId)
    .eq("kind", LICENCE_DOC_KIND)
    .not("uploaded_at", "is", null)
    .is("staff_licence_id", null)
    .select("id");
  if (!data || data.length === 0) {
    await supabaseAdmin.from(TERMS).update({ document_id: null }).eq("org_id", orgId).eq("id", termId);
  }
}

async function insertTerm(
  orgId: string,
  staffId: string,
  licenceId: string,
  uploaderStaffId: string | null,
  row: LicenceTermRow,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const { data, error } = await supabaseAdmin
    .from(TERMS)
    .insert({ org_id: orgId, licence_id: licenceId, staff_profile_id: staffId, ...row })
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: "Couldn't record that renewal." };

  const termId = String(data.id);
  if (row.document_id) await adoptLicenceDocument(orgId, uploaderStaffId, licenceId, row.document_id, termId);
  return { ok: true, id: termId };
}

/* RECORDING A RENEWAL never overwrites anything: a term is a new row, and the
   licence's two cached columns follow it only when it is genuinely newer.
   Filing a card you found in a drawer adds to the history without retiring the
   ticket the person actually holds. */
export async function recordTerm(
  orgId: string,
  staffId: string,
  uploaderStaffId: string | null,
  licenceId: string,
  input: LicenceTermInput,
): Promise<WriteResult> {
  const built = buildLicenceTermRow(input);
  if ("error" in built) return { ok: false, error: built.error };

  const licence = await licenceIn(orgId, staffId, licenceId);
  if (!licence) return { ok: false, error: "That licence is no longer on file." };

  const filed = await insertTerm(orgId, staffId, licenceId, uploaderStaffId, built.row);
  if (!filed.ok) return filed;

  if (!licence.expiry || built.row.expires_on > licence.expiry) {
    await supabaseAdmin
      .from(TABLE)
      .update({ expiry_date: built.row.expires_on, licence_number: built.row.number ?? null })
      .eq("org_id", orgId)
      .eq("staff_profile_id", staffId)
      .eq("id", licenceId);
    // and every reminder counting down to it counts down to the new date
    await rescheduleLicenceReminders(orgId, licenceId, built.row.expires_on);
  }
  return { ok: true };
}

/** Adding a licence WITH its first term — the card and the ticket in one save,
    the way scanning a certificate on the way in should work. The licence row
    itself is inserted by the caller (it is the caller's allowlisted shape);
    this files the term against it and seeds the cache. */
export async function seedFirstTerm(
  orgId: string,
  staffId: string,
  uploaderStaffId: string | null,
  licenceId: string,
  row: LicenceTermRow,
): Promise<void> {
  await insertTerm(orgId, staffId, licenceId, uploaderStaffId, row);
}

/** Filing another document under a term after the fact. */
export async function attachTermDocument(
  orgId: string,
  staffId: string,
  uploaderStaffId: string | null,
  termId: string,
  documentId: string,
): Promise<WriteResult> {
  if (!uploaderStaffId) return { ok: false, error: "Only a staff member can file documents." };

  const { data: term } = await supabaseAdmin
    .from(TERMS)
    .select("id, licence_id")
    .eq("org_id", orgId)
    .eq("staff_profile_id", staffId)
    .eq("id", termId)
    .maybeSingle();
  if (!term) return { ok: false, error: "That term is no longer on file." };

  const { data } = await supabaseAdmin
    .from("documents")
    .update({ staff_licence_id: String(term.licence_id), licence_record_id: termId })
    .eq("org_id", orgId)
    .eq("id", documentId)
    .eq("uploaded_by", uploaderStaffId)
    .eq("kind", LICENCE_DOC_KIND)
    .not("uploaded_at", "is", null)
    .is("staff_licence_id", null)
    .select("id");
  if (!data || data.length === 0) return { ok: false, error: "That document couldn't be filed." };
  return { ok: true };
}

/* Removing a term. It exists because a scan can be filed against the wrong
   ticket, and a wrong expiry on the wrong ticket is worse than none: it
   silences the warning for the one that is actually lapsing. The cache is
   RECOMPUTED from what is left rather than assumed — deleting the current term
   must hand the licence back to the one underneath it, not leave it pointing
   at a date that no longer exists. */
export async function removeTerm(
  orgId: string,
  staffId: string,
  termId: string,
): Promise<WriteResult> {
  const { data: term } = await supabaseAdmin
    .from(TERMS)
    .select("id, licence_id")
    .eq("org_id", orgId)
    .eq("staff_profile_id", staffId)
    .eq("id", termId)
    .maybeSingle();
  if (!term) return { ok: true };
  const licenceId = String(term.licence_id);

  const { error } = await supabaseAdmin
    .from(TERMS)
    .delete()
    .eq("org_id", orgId)
    .eq("staff_profile_id", staffId)
    .eq("id", termId);
  if (error) return { ok: false, error: "Couldn't remove that term." };

  const { data: rest } = await supabaseAdmin
    .from(TERMS)
    .select("expires_on, number")
    .eq("org_id", orgId)
    .eq("licence_id", licenceId)
    .order("expires_on", { ascending: false })
    .limit(1);

  const top = (rest ?? [])[0] as Record<string, unknown> | undefined;
  await supabaseAdmin
    .from(TABLE)
    .update({
      expiry_date: (top?.expires_on as string) ?? null,
      licence_number: (top?.number as string) ?? null,
    })
    .eq("org_id", orgId)
    .eq("staff_profile_id", staffId)
    .eq("id", licenceId);
  return { ok: true };
}

/* "Remind me 30 days before my ARC licence expires" is a TASK, on the same
   terms as a vehicle renewal and a business policy — and deliberately not a
   second reminders system.

   PERSONAL TO THE VIEWER, whoever they are looking at. A manager who wants
   thirty days' warning on Bob's ticket gets their OWN task about it; Bob
   turning his off does not silence the manager's, and neither of them is
   creating work for the other. `subject` is the name that goes in the title —
   null when it is your own card, because a bell that says "Renew ARC licence"
   about you needs no name on it. */
export async function setLicenceReminder(
  orgId: string,
  viewerStaffId: string | null,
  staffId: string,
  licenceId: string,
  subject: string | null,
  leadDays: number,
  on: boolean,
): Promise<WriteResult> {
  if (!viewerStaffId) return { ok: false, error: "Only a staff member can set a reminder." };
  if (!isReminderLead(leadDays)) return { ok: false, error: "Couldn't set that reminder." };

  const licence = await licenceIn(orgId, staffId, licenceId);
  if (!licence) return { ok: false, error: "That licence is no longer on file." };

  if (!on) {
    const { error } = await supabaseAdmin
      .from("tasks")
      .delete()
      .eq("org_id", orgId)
      .eq("assigned_to", viewerStaffId)
      .eq("staff_licence_id", licenceId)
      .eq("lead_days", leadDays)
      .eq("status", "open");
    if (error) return { ok: false, error: "Couldn't clear that reminder." };
    return { ok: true };
  }

  const expiresOn = licence.expiry?.slice(0, 10) ?? null;
  if (!expiresOn) {
    return { ok: false, error: "Record the renewal first — a reminder needs an expiry to count from." };
  }

  // already on: the chip is derived from this row, so a second press is a no-op
  const { data: existing } = await supabaseAdmin
    .from("tasks")
    .select("id")
    .eq("org_id", orgId)
    .eq("assigned_to", viewerStaffId)
    .eq("staff_licence_id", licenceId)
    .eq("lead_days", leadDays)
    .eq("status", "open")
    .limit(1);
  if (existing && existing.length > 0) return { ok: true };

  const dueDate = reminderDueDate(expiresOn, leadDays);
  const [tz, day] = await Promise.all([getSm8Timezone(orgId), workdayHours(orgId, viewerStaffId)]);
  const { error } = await supabaseAdmin.from("tasks").insert({
    org_id: orgId,
    title: licenceReminderTitle(licence.typeName, subject),
    detail: licenceReminderDetail(expiresOn, leadDays),
    assigned_to: viewerStaffId,
    created_by: viewerStaffId,
    due_date: dueDate,
    status: "open",
    // the morning of the day — the person's own start, on the workspace's clock
    remind_at: remindAtFrom(dueDate, day.start, tz),
    remind_kind: "at",
    staff_licence_id: licenceId,
    lead_days: leadDays,
  });
  if (error) return { ok: false, error: "Couldn't set that reminder." };
  return { ok: true };
}

/** A recorded renewal moves the expiry, so every reminder counting down to it
    moves with it — EVERYONE's, not just the person who filed it.
    `reminder_emailed_at` is cleared: the letter that went out named the old
    date, so the new one has not been delivered. */
async function rescheduleLicenceReminders(
  orgId: string,
  licenceId: string,
  expiresOn: string,
): Promise<void> {
  const { data } = await supabaseAdmin
    .from("tasks")
    .select("id, assigned_to, lead_days")
    .eq("org_id", orgId)
    .eq("staff_licence_id", licenceId)
    .eq("status", "open");
  if (!data || data.length === 0) return;

  const tz = await getSm8Timezone(orgId);
  for (const t of data as Record<string, unknown>[]) {
    const lead = Math.max(0, Math.round(Number(t.lead_days)) || 0);
    const dueDate = reminderDueDate(expiresOn, lead);
    const day = await workdayHours(orgId, typeof t.assigned_to === "string" ? t.assigned_to : null);
    await supabaseAdmin
      .from("tasks")
      .update({
        due_date: dueDate,
        remind_at: remindAtFrom(dueDate, day.start, tz),
        detail: licenceReminderDetail(expiresOn, lead),
        reminder_emailed_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq("org_id", orgId)
      .eq("id", String(t.id));
  }
}
