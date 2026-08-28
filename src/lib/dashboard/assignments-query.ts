/* The bell's assignment read. Org-scoped and PERSON-scoped, the same posture
   as the reminders beside it: work you were given is yours to see, so there
   is no team view of it and no capability that widens it.

   DERIVED, NOT DELIVERED. Nothing records that an alert was sent; the
   question is simply "is this open, mine, somebody else's doing, and
   unanswered" — asked fresh on every read. No scheduler has any state to
   maintain, which is the same reason the reminders need none.

   TOLERANT OF ITS OWN MIGRATION. A named column that doesn't exist fails the
   whole select, and this select sits behind the bell on every screen in the
   app — so a workspace whose database hasn't taken task_acknowledged.sql yet
   gets an empty list rather than a broken topbar. Same tolerance, and the
   same reason, as `dueReminders` above it. */

import { supabaseAdmin } from "@/lib/supabase-server";
import { displayNameOf } from "@/lib/staff/name";
import { NAME_COLUMNS } from "./tasks-query";
import type { NewAssignment } from "./assignments";

const COLUMNS = "id, title, detail, created_by, due_date, created_at";

/** How many the bell will read. Well above what anyone will ever have
    unanswered, and a bound rather than a promise: a person returning from
    leave to sixty new tasks gets the newest twenty-five and the Tasks panel
    for the rest. */
const CAP = 25;

/** Open tasks somebody else gave you and you haven't acknowledged, newest
    first — the newest is the one you are least likely to know about. */
export async function newAssignments(
  orgId: string,
  staffProfileId: string
): Promise<NewAssignment[]> {
  const { data, error } = await supabaseAdmin
    .from("tasks")
    .select(COLUMNS)
    .eq("org_id", orgId)
    .eq("assigned_to", staffProfileId)
    .eq("status", "open")
    .is("acknowledged_at", null)
    /* A SELF-TASK NEVER RINGS. You were there when it was made, and a bell
       that tells you what you just typed is noise that teaches people to
       ignore the bell. `neq` leaves a NULL creator IN, which is right: a task
       whose author has no staff card is still work somebody gave you. */
    .neq("created_by", staffProfileId)
    .order("created_at", { ascending: false })
    .limit(CAP);

  if (error) return [];

  const rows = (data ?? []) as Record<string, unknown>[];
  if (rows.length === 0) return [];

  const names = await giverNames(
    orgId,
    rows.map((r) => (typeof r.created_by === "string" ? r.created_by : null))
  );

  return rows.map((r) => ({
    taskId: String(r.id),
    title: String(r.title),
    detail: typeof r.detail === "string" && r.detail ? r.detail : null,
    fromName:
      typeof r.created_by === "string" ? names.get(r.created_by) ?? null : null,
    dueDate: typeof r.due_date === "string" ? r.due_date.slice(0, 10) : null,
    createdAt: String(r.created_at),
  }));
}

/** One read for every name on the list. Tolerant: a giver with no readable
    staff card resolves to null and the row simply says "Assigned to you". */
async function giverNames(
  orgId: string,
  ids: readonly (string | null)[]
): Promise<Map<string, string>> {
  const wanted = [...new Set(ids.filter((i): i is string => !!i))];
  const map = new Map<string, string>();
  if (wanted.length === 0) return map;
  const { data } = await supabaseAdmin
    .from("staff_profiles")
    .select(NAME_COLUMNS)
    .eq("org_id", orgId)
    .in("id", wanted);
  for (const r of (data ?? []) as Record<string, unknown>[]) {
    const name = displayNameOf(r as Parameters<typeof displayNameOf>[0], "");
    if (name) map.set(String(r.id), name);
  }
  return map;
}

/** The one task an acknowledgement is about, scoped to the org — the read the
    write does first, so a task id from another workspace, or another person's
    task, can never be stamped. */
export async function assignmentTask(
  orgId: string,
  taskId: string
): Promise<{ assignedTo: string; status: string } | null> {
  const { data } = await supabaseAdmin
    .from("tasks")
    .select("assigned_to, status")
    .eq("org_id", orgId)
    .eq("id", taskId)
    .maybeSingle();
  if (!data) return null;
  return { assignedTo: String(data.assigned_to), status: String(data.status) };
}
