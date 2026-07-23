import { supabaseAdmin } from "@/lib/supabase-server";
import type { DashTask, NoticeWithRead } from "./tasks";

/* Queries for the task list and noticeboard. Org-scoped throughout.

   These carry no wages — a task is a title and a due date — so there is no money
   projection. The scoping that matters is WHOSE: the *mine* read is filtered to
   the viewer's own assignments; the *team* read (management) returns the org's.
   Notices are org-wide by design (that's what a noticeboard is), so everyone
   reads them; the join tells each viewer which they've acknowledged. */

/** id → display name for every staff member in the org. */
async function staffNames(orgId: string): Promise<Map<string, string>> {
  const { data } = await supabaseAdmin
    .from("staff_profiles")
    .select("id, full_name, preferred_name")
    .eq("org_id", orgId);
  const map = new Map<string, string>();
  for (const r of data ?? [])
    map.set(
      r.id as string,
      (((r.preferred_name as string) || (r.full_name as string) || "Unnamed").trim() || "Unnamed"),
    );
  return map;
}

const TASK_COLUMNS =
  "id, title, detail, assigned_to, created_by, due_date, status, created_at";

function toTask(r: Record<string, unknown>, name: (id: string) => string): DashTask {
  const assigneeId = String(r.assigned_to);
  return {
    id: String(r.id),
    title: String(r.title),
    detail: typeof r.detail === "string" && r.detail ? r.detail : null,
    assigneeId,
    assigneeName: name(assigneeId),
    dueDate: r.due_date ? String(r.due_date).slice(0, 10) : null,
    status: r.status === "done" ? "done" : "open",
    createdBy: (r.created_by as string) ?? null,
    createdAt: String(r.created_at),
  };
}

/** Your own open tasks. */
export async function myTasks(orgId: string, staffProfileId: string): Promise<DashTask[]> {
  const [{ data }, names] = await Promise.all([
    supabaseAdmin
      .from("tasks")
      .select(TASK_COLUMNS)
      .eq("org_id", orgId)
      .eq("assigned_to", staffProfileId)
      .eq("status", "open"),
    staffNames(orgId),
  ]);
  return ((data ?? []) as Record<string, unknown>[]).map((r) => toTask(r, (id) => names.get(id) ?? "Unnamed"));
}

/** Every open task across the org — the `team` management view. */
export async function teamTasks(orgId: string): Promise<DashTask[]> {
  const [{ data }, names] = await Promise.all([
    supabaseAdmin
      .from("tasks")
      .select(TASK_COLUMNS)
      .eq("org_id", orgId)
      .eq("status", "open"),
    staffNames(orgId),
  ]);
  return ((data ?? []) as Record<string, unknown>[]).map((r) => toTask(r, (id) => names.get(id) ?? "Unnamed"));
}

/** Recent notices with the viewer's read state joined in. Newest-ish out of the
    DB (we cap the list); ordering/pinning is applied by sortNotices at the edge. */
export async function listNotices(
  orgId: string,
  staffProfileId: string | null,
  limit = 20,
): Promise<NoticeWithRead[]> {
  const [{ data }, names, reads] = await Promise.all([
    supabaseAdmin
      .from("notices")
      .select("id, title, body, pinned, posted_by, created_at")
      .eq("org_id", orgId)
      .order("created_at", { ascending: false })
      .limit(limit),
    staffNames(orgId),
    readIds(orgId, staffProfileId),
  ]);
  return ((data ?? []) as Record<string, unknown>[]).map((r) => {
    const id = String(r.id);
    const poster = (r.posted_by as string) ?? null;
    return {
      id,
      title: String(r.title),
      body: typeof r.body === "string" && r.body ? r.body : null,
      pinned: r.pinned === true,
      postedByName: poster ? names.get(poster) ?? null : null,
      createdAt: String(r.created_at),
      read: reads.has(id),
    };
  });
}

/** The set of notice ids this staff member has acknowledged. */
async function readIds(orgId: string, staffProfileId: string | null): Promise<Set<string>> {
  if (!staffProfileId) return new Set();
  const { data } = await supabaseAdmin
    .from("notice_reads")
    .select("notice_id")
    .eq("org_id", orgId)
    .eq("staff_profile_id", staffProfileId);
  return new Set(((data ?? []) as Record<string, unknown>[]).map((r) => String(r.notice_id)));
}
