import { supabaseAdmin } from "@/lib/supabase-server";
import { remindAtFrom } from "@/lib/dashboard/reminders";
import { workdayHours } from "@/lib/dashboard/reminders-query";
import { getSm8Timezone } from "@/lib/workboard/query";
import { isReminderLead, reminderDueDate } from "@/lib/fleet/reminders";
import {
  WORK_RIGHTS_DOC_KIND,
  buildWorkRightsCheckRow,
  workRightsReminderDetail,
  workRightsReminderTitle,
  type WorkRightsCheckInput,
  type WorkRightsCheckRow,
} from "./work-rights-records";

/* THE WRITES BEHIND A PERSON'S RIGHT-TO-WORK CHECKS — the I/O half, shared.

   Same arrangement as lib/staff/licence-writes.ts and for the same reason:
   your own card writes through app/actions/profile.ts and a manager's view
   through app/actions/staff.ts, the GATES differ and belong at those two
   boundaries, and the SQL must not.

   Every function takes an already-resolved (orgId, staffId). Nothing here
   checks a capability and nothing here reads a session.

   THE CACHE IS RECOMPUTED, NEVER ADVANCED. The licence writer only moves a
   ticket's cached expiry forward, because a licence's current term is the
   latest expiry. Work rights' current record is the latest CHECK, and a check
   can say the entitlement got WORSE — a bridging visa, a cancellation. So
   every write here re-derives the five cached columns from whatever the newest
   check now is, which is one rule that is always right instead of two that
   have to agree. */

export type WriteResult = { ok: true } | { ok: false; error: string };

const TABLE = "staff_work_rights_records";
const PROFILES = "staff_profiles";

/** The person, if they are in that org. Null is "not yours to touch" and
    "gone" at once, which is the same answer to the caller. */
async function personIn(orgId: string, staffId: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from(PROFILES)
    .select("id")
    .eq("org_id", orgId)
    .eq("id", staffId)
    .maybeSingle();
  return Boolean(data);
}

/* THE FIVE CACHED COLUMNS, re-derived from the newest check.

   `vevo_checked_at` takes the check date whatever the source was. The column
   keeps the VEVO name because that is the register a check is made against,
   but what the app means by it — and what every form has always written into
   it — is "when did somebody last establish this". See lib/staff/derive.ts,
   which reads it as exactly that. */
async function syncCache(orgId: string, staffId: string): Promise<void> {
  const { data } = await supabaseAdmin
    .from(TABLE)
    .select("status, visa_type, hours_condition, expires_on, checked_on, created_at")
    .eq("org_id", orgId)
    .eq("staff_profile_id", staffId)
    .order("checked_on", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1);

  const top = (data ?? [])[0] as Record<string, unknown> | undefined;
  await supabaseAdmin
    .from(PROFILES)
    .update({
      work_rights_status: (top?.status as string) ?? null,
      visa_type: (top?.visa_type as string) ?? null,
      hours_condition: (top?.hours_condition as string) ?? null,
      visa_expiry: (top?.expires_on as string) ?? null,
      vevo_checked_at: (top?.checked_on as string) ?? null,
    })
    .eq("org_id", orgId)
    .eq("id", staffId);
}

/* Adoption, on the codebase's standing contract: only the uploader's own,
   confirmed, still-unowned document OF THE RIGHT KIND may land. A file that
   refuses adoption must not be claimed by the record either.

   `uploaderStaffId` is who uploaded, which is not always who the evidence is
   about — a manager can scan a grant notice on someone's behalf. */
async function adoptEvidence(
  orgId: string,
  uploaderStaffId: string | null,
  staffId: string,
  documentId: string,
  recordId: string,
): Promise<void> {
  if (!uploaderStaffId) return;
  const { data } = await supabaseAdmin
    .from("documents")
    .update({ work_rights_staff_id: staffId, work_rights_record_id: recordId })
    .eq("org_id", orgId)
    .eq("id", documentId)
    .eq("uploaded_by", uploaderStaffId)
    .eq("kind", WORK_RIGHTS_DOC_KIND)
    .not("uploaded_at", "is", null)
    .is("work_rights_staff_id", null)
    .select("id");
  if (!data || data.length === 0) {
    await supabaseAdmin.from(TABLE).update({ document_id: null }).eq("org_id", orgId).eq("id", recordId);
  }
}

async function insertCheck(
  orgId: string,
  staffId: string,
  uploaderStaffId: string | null,
  row: WorkRightsCheckRow,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .insert({ org_id: orgId, staff_profile_id: staffId, ...row })
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: "Couldn't record that check." };

  const recordId = String(data.id);
  if (row.document_id) await adoptEvidence(orgId, uploaderStaffId, staffId, row.document_id, recordId);
  return { ok: true, id: recordId };
}

/** Record a check. Never overwrites: it is a new row, and the card's five
    columns are re-derived from whatever the newest check now is. */
export async function recordCheck(
  orgId: string,
  staffId: string,
  uploaderStaffId: string | null,
  input: WorkRightsCheckInput,
): Promise<WriteResult> {
  const built = buildWorkRightsCheckRow(input);
  if ("error" in built) return { ok: false, error: built.error };
  if (!(await personIn(orgId, staffId))) return { ok: false, error: "That staff member doesn't exist." };

  const filed = await insertCheck(orgId, staffId, uploaderStaffId, built.row);
  if (!filed.ok) return filed;

  await syncCache(orgId, staffId);
  await rescheduleWorkRightsReminders(orgId, staffId, built.row.expires_on);
  return { ok: true };
}

/** Filing more evidence under a check after the fact. */
export async function attachCheckDocument(
  orgId: string,
  staffId: string,
  uploaderStaffId: string | null,
  recordId: string,
  documentId: string,
): Promise<WriteResult> {
  if (!uploaderStaffId) return { ok: false, error: "Only a staff member can file documents." };

  const { data: record } = await supabaseAdmin
    .from(TABLE)
    .select("id")
    .eq("org_id", orgId)
    .eq("staff_profile_id", staffId)
    .eq("id", recordId)
    .maybeSingle();
  if (!record) return { ok: false, error: "That check is no longer on file." };

  const { data } = await supabaseAdmin
    .from("documents")
    .update({ work_rights_staff_id: staffId, work_rights_record_id: recordId })
    .eq("org_id", orgId)
    .eq("id", documentId)
    .eq("uploaded_by", uploaderStaffId)
    .eq("kind", WORK_RIGHTS_DOC_KIND)
    .not("uploaded_at", "is", null)
    .is("work_rights_staff_id", null)
    .select("id");
  if (!data || data.length === 0) return { ok: false, error: "That document couldn't be filed." };
  return { ok: true };
}

/** Removing a check — evidence filed against the wrong person, or a duplicate.
    The cache is re-derived from what is left, so removing the newest hands the
    card back to the one underneath it rather than leaving it describing a
    check that no longer exists. */
export async function removeCheck(
  orgId: string,
  staffId: string,
  recordId: string,
): Promise<WriteResult> {
  const { data: record } = await supabaseAdmin
    .from(TABLE)
    .select("id")
    .eq("org_id", orgId)
    .eq("staff_profile_id", staffId)
    .eq("id", recordId)
    .maybeSingle();
  if (!record) return { ok: true };

  const { error } = await supabaseAdmin
    .from(TABLE)
    .delete()
    .eq("org_id", orgId)
    .eq("staff_profile_id", staffId)
    .eq("id", recordId);
  if (error) return { ok: false, error: "Couldn't remove that check." };

  await syncCache(orgId, staffId);
  return { ok: true };
}

/* "Remind me 30 days before Bob's visa expires" is a TASK, on the same terms
   as every other reminder here, and PERSONAL TO THE VIEWER.

   KEYED ON THE PERSON, not on a check, because what you want warning about is
   "this person's right to work" and that survives the record that currently
   describes it — a new check replaces the record but not the question. */
export async function setWorkRightsReminder(
  orgId: string,
  viewerStaffId: string | null,
  staffId: string,
  subject: string | null,
  leadDays: number,
  on: boolean,
): Promise<WriteResult> {
  if (!viewerStaffId) return { ok: false, error: "Only a staff member can set a reminder." };
  if (!isReminderLead(leadDays)) return { ok: false, error: "Couldn't set that reminder." };

  const { data: person } = await supabaseAdmin
    .from(PROFILES)
    .select("id, visa_expiry")
    .eq("org_id", orgId)
    .eq("id", staffId)
    .maybeSingle();
  if (!person) return { ok: false, error: "That staff member doesn't exist." };

  if (!on) {
    const { error } = await supabaseAdmin
      .from("tasks")
      .delete()
      .eq("org_id", orgId)
      .eq("assigned_to", viewerStaffId)
      .eq("work_rights_staff_id", staffId)
      .eq("lead_days", leadDays)
      .eq("status", "open");
    if (error) return { ok: false, error: "Couldn't clear that reminder." };
    return { ok: true };
  }

  const expiresOn = (person.visa_expiry as string | null)?.slice(0, 10) ?? null;
  if (!expiresOn) {
    /* A citizen has no expiry and nothing to count down to. Saying so is the
       honest refusal — the alternative is a chip that looks armed and a task
       that never falls due. */
    return { ok: false, error: "There's no expiry to count from — record a check with one first." };
  }

  const { data: existing } = await supabaseAdmin
    .from("tasks")
    .select("id")
    .eq("org_id", orgId)
    .eq("assigned_to", viewerStaffId)
    .eq("work_rights_staff_id", staffId)
    .eq("lead_days", leadDays)
    .eq("status", "open")
    .limit(1);
  if (existing && existing.length > 0) return { ok: true };

  const dueDate = reminderDueDate(expiresOn, leadDays);
  const [tz, day] = await Promise.all([getSm8Timezone(orgId), workdayHours(orgId, viewerStaffId)]);
  const { error } = await supabaseAdmin.from("tasks").insert({
    org_id: orgId,
    title: workRightsReminderTitle(subject),
    detail: workRightsReminderDetail(expiresOn, leadDays),
    assigned_to: viewerStaffId,
    created_by: viewerStaffId,
    due_date: dueDate,
    status: "open",
    remind_at: remindAtFrom(dueDate, day.start, tz),
    remind_kind: "at",
    work_rights_staff_id: staffId,
    lead_days: leadDays,
  });
  if (error) return { ok: false, error: "Couldn't set that reminder." };
  return { ok: true };
}

/* A recorded check moves the expiry, so every reminder counting down to it
   moves with it — everyone's. `reminder_emailed_at` is cleared: the letter
   that went out named the old date.

   A check with NO expiry — the person became a permanent resident — CLOSES the
   open reminders instead of re-dating them. There is nothing left to count
   down to, and leaving a task due against a date that no longer exists would
   nag somebody forever about a question that has been answered. */
async function rescheduleWorkRightsReminders(
  orgId: string,
  staffId: string,
  expiresOn: string | null,
): Promise<void> {
  const { data } = await supabaseAdmin
    .from("tasks")
    .select("id, assigned_to, lead_days")
    .eq("org_id", orgId)
    .eq("work_rights_staff_id", staffId)
    .eq("status", "open");
  if (!data || data.length === 0) return;

  if (!expiresOn) {
    await supabaseAdmin
      .from("tasks")
      .delete()
      .eq("org_id", orgId)
      .eq("work_rights_staff_id", staffId)
      .eq("status", "open");
    return;
  }

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
        detail: workRightsReminderDetail(expiresOn, lead),
        reminder_emailed_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq("org_id", orgId)
      .eq("id", String(t.id));
  }
}
