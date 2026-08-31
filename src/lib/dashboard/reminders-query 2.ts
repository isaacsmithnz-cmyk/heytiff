import { normalHours } from "@/components/timepay/logic";
import { supabaseAdmin } from "@/lib/supabase-server";
import { getPaySettings, shiftDefaultsFor } from "@/lib/timepay/query";
import { toHHMM, type DueReminder } from "./reminders";

/* The bell's reminder read. Org-scoped and PERSON-scoped: a reminder is
   something you asked for, so there is no team view of one and no capability
   that widens it. `keepNoteForMe` is the same posture — your own words, your
   own eyes.

   DERIVED, NOT DELIVERED. Nothing records that a reminder fired; the question
   is simply "is its time in the past", asked fresh on every read. That is why
   this feature needs no scheduler: there is no state for one to maintain.

   TOLERANT OF ITS OWN MIGRATION. A named column that doesn't exist fails the
   whole select, and this select sits behind the bell on every screen in the
   app — so a workspace whose database hasn't taken task_reminders.sql yet gets
   an empty list rather than a broken topbar. Same tolerance, and the same
   reason, as `shiftDefaultsFor` in lib/timepay/query. */

const COLUMNS = "id, title, detail, remind_at";

/** Your open tasks whose nudge time has passed, soonest-set first.

    Ordered by `remind_at` ascending, so the one you asked for first is the one
    you read first — a list of reminders sorted newest-first would put this
    morning's above last Tuesday's, which is backwards for anything overdue. */
export async function dueReminders(
  orgId: string,
  staffProfileId: string,
  now: Date = new Date(),
): Promise<DueReminder[]> {
  const { data, error } = await supabaseAdmin
    .from("tasks")
    .select(COLUMNS)
    .eq("org_id", orgId)
    .eq("assigned_to", staffProfileId)
    .eq("status", "open")
    .not("remind_at", "is", null)
    .lte("remind_at", now.toISOString())
    .order("remind_at", { ascending: true });

  if (error) return [];

  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    taskId: String(r.id),
    title: String(r.title),
    detail: typeof r.detail === "string" && r.detail ? r.detail : null,
    remindAt: String(r.remind_at),
  }));
}

/** One task's reminder facts, scoped to the org — the read a snooze does
    before it writes, so a task id from another workspace can never be moved. */
export async function reminderTask(
  orgId: string,
  taskId: string,
): Promise<{ assignedTo: string; status: string; dueDate: string | null } | null> {
  const { data } = await supabaseAdmin
    .from("tasks")
    .select("assigned_to, status, due_date")
    .eq("org_id", orgId)
    .eq("id", taskId)
    .maybeSingle();
  if (!data) return null;
  return {
    assignedTo: String(data.assigned_to),
    status: String(data.status),
    dueDate: data.due_date ? String(data.due_date).slice(0, 10) : null,
  };
}

/* ── the working day a vague time resolves against ────────────────────── */

/** When this person's day starts and finishes, as "HH:MM".

    Composed rather than stored: `normalHours` already knows that a person's
    own hours beat the workspace's and that half an override is not an
    override, and Time & Pay is where both live. Reading them here rather than
    restating the rule is what stops "morning" meaning 7:00 to the router and
    6:30 to the timesheet for the same installer.

    Falls back to the workspace default on any failure — a reminder must still
    be settable in an org that has never opened Time & Pay. */
export async function workdayHours(
  orgId: string,
  staffProfileId: string | null,
): Promise<{ start: string; end: string }> {
  const [{ settings }, own] = await Promise.all([
    getPaySettings(orgId),
    staffProfileId
      ? shiftDefaultsFor(orgId, [staffProfileId])
      : Promise.resolve({ hours: new Map(), workDays: new Map() }),
  ]);
  const hours = normalHours(settings, staffProfileId ? own.hours.get(staffProfileId) : null);
  return { start: toHHMM(hours.start) || "07:00", end: toHHMM(hours.end) || "15:00" };
}
