import { supabaseAdmin } from "@/lib/supabase-server";

/* A TASK'S HISTORY — the write. docs/migrations/task_events.sql says what
   each kind is for and why the row alone cannot say it.

   BEST-EFFORT, AND ONLY AFTER THE CHANGE. Every caller has already made its
   own update when it gets here, and the change is what the person asked for:
   a history line that failed to write costs the Tasks face one sentence,
   while an action that failed because its history did would cost them the
   change itself. So this is awaited (the page that refreshes next should
   see the line) and never throws, whatever the database says — a missing
   table before the migration runs included.

   Not a server action: this lives outside the "use server" module on
   purpose, so nothing in the browser can post an event of its own. */

/** Every kind the table's CHECK allows. A kind written here and missing
    there is a failed insert nobody sees — task-events-kinds.test.ts reads
    the migration and holds the two to each other. */
export const TASK_EVENT_KINDS = ["created", "due", "given", "done", "reopened"] as const;
export type TaskEventKind = (typeof TASK_EVENT_KINDS)[number];

/** What one change says, by kind. The columns a kind does not use stay null,
    which is what the table's own checks ask for. */
export type TaskEventWrite =
  | { kind: "created"; to: string }
  | { kind: "due"; from: string | null; to: string | null }
  | { kind: "given"; from: string | null; to: string }
  | { kind: "done" }
  | { kind: "reopened" };

/** The row as it is inserted: pure, so what each kind writes is pinned
    without a database. */
export function taskEventRow(
  orgId: string,
  taskId: string,
  by: string | null,
  e: TaskEventWrite,
): Record<string, unknown> {
  return {
    org_id: orgId,
    task_id: taskId,
    kind: e.kind,
    by_staff: by,
    due_from: e.kind === "due" ? e.from : null,
    due_to: e.kind === "due" ? e.to : null,
    from_staff: e.kind === "given" ? e.from : null,
    to_staff: e.kind === "created" || e.kind === "given" ? e.to : null,
  };
}

const missingTable = (code: unknown) => code === "PGRST205" || code === "42P01";

/** Record one change to a task. Never throws; see the note at the top. */
export async function logTaskEvent(
  orgId: string,
  taskId: string,
  by: string | null,
  e: TaskEventWrite,
): Promise<void> {
  try {
    const { error } = await supabaseAdmin.from("task_events").insert(taskEventRow(orgId, taskId, by, e));
    /* Before the migration runs the table is simply not there: expected, and
       said nothing about. Anything else is worth a line in the log. */
    if (error && !missingTable((error as { code?: unknown }).code)) {
      console.warn(`task_events: ${e.kind} for ${taskId} not recorded: ${error.message}`);
    }
  } catch (err) {
    console.warn(`task_events: ${e.kind} for ${taskId} not recorded:`, err);
  }
}
