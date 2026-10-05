import { auth0 } from "@/lib/auth0";
import { can } from "@/lib/permissions-server";
import { supabaseAdmin } from "@/lib/supabase-server";
import { NAME_COLUMNS } from "@/lib/dashboard/tasks-query";
import { displayNameOf } from "@/lib/staff/name";
import { resolveJobCard } from "@/lib/workboard/all-jobs-query";
import { staffIdFor } from "@/lib/workboard/projects-query";
import {
  LIST_EDITS,
  accountToday,
  applyTaskEdit,
  canMakeTasks,
  editOf,
  makeTasksFromQuote,
  readJobTasks,
} from "@/lib/workboard/visit-tasks-server";

/* The job card's Installation: a job's tasks, by visit (visit-tasks.ts).

   WHO DOES WHAT. Anyone on the board ticks a task and says how far it got —
   that's the crew on site. Changing the list (adding, moving, renaming,
   taking one off) and having Tiff make it from the quote — a paid call —
   is running the board: workboard_manage.

   A ROUTE, as the quote's are: the card's server actions run one at a
   time, and a tick can't wait behind them. */

export const maxDuration = 300;

async function gate(): Promise<{ orgId: string; userId: string; manage: boolean } | Response> {
  const session = await auth0.getSession();
  const orgId = (session?.orgId as string | undefined) ?? null;
  const userId = (session?.user?.sub as string | undefined) ?? null;
  if (!orgId || !userId || !(await can("workboard"))) {
    return Response.json({ ok: false, reason: "The job's tasks need Workboard access." }, { status: 403 });
  }
  return { orgId, userId, manage: await can("workboard_manage") };
}

const jobOf = (v: unknown) => (typeof v === "string" ? v.trim().slice(0, 80) : "");

async function answer(orgId: string, cardId: string, manage: boolean) {
  const [list, today] = await Promise.all([readJobTasks(orgId, cardId), accountToday(orgId)]);
  /* whether Make the tasks is offered: only to a manager, on a job with an
     accepted quote and no tasks yet */
  const canMake = manage && list.tasks.length === 0 ? await canMakeTasks(orgId, cardId) : false;
  return { ok: true as const, ...list, today, canMake, manage };
}

export async function GET(req: Request) {
  const who = await gate();
  if (who instanceof Response) return who;
  const job = jobOf(new URL(req.url).searchParams.get("job"));
  if (!job) return Response.json({ ok: false, reason: "No job named." }, { status: 400 });
  const target = await resolveJobCard(who.orgId, job);
  return Response.json(await answer(who.orgId, target.parentRemoteId, who.manage));
}

/** {job, make: true}: Tiff's task list from the accepted quote. */
export async function POST(req: Request) {
  const who = await gate();
  if (who instanceof Response) return who;
  if (!who.manage) return Response.json({ ok: false, reason: "Making the task list needs Workboard manage access." }, { status: 403 });
  if (!process.env.ANTHROPIC_API_KEY) return Response.json({ ok: false, reason: "Tiff is offline: no API key is configured." });
  const body = (await req.json().catch(() => ({}))) as { job?: unknown; make?: unknown };
  const job = jobOf(body.job);
  if (!job || body.make !== true) return Response.json({ ok: false, reason: "No job named." }, { status: 400 });
  const target = await resolveJobCard(who.orgId, job);
  const made = await makeTasksFromQuote(who.orgId, who.userId, target.parentRemoteId);
  if (!made.ok) return Response.json(made);
  return Response.json(await answer(who.orgId, target.parentRemoteId, who.manage));
}

/** {job, edit}: one edit — a tick or how far it got, or a change to the list. */
export async function PUT(req: Request) {
  const who = await gate();
  if (who instanceof Response) return who;
  const body = (await req.json().catch(() => ({}))) as { job?: unknown; edit?: unknown };
  const job = jobOf(body.job);
  const edit = editOf(body.edit);
  if (!job || !edit) return Response.json({ ok: false, reason: "That edit couldn't be read." }, { status: 400 });
  if (LIST_EDITS.has(edit.kind) && !who.manage) {
    return Response.json({ ok: false, reason: "Changing the task list needs Workboard manage access." }, { status: 403 });
  }
  const target = await resolveJobCard(who.orgId, job);
  const done = await applyTaskEdit(who.orgId, target.parentRemoteId, { userId: who.userId, name: await nameOf(who.orgId, who.userId) }, edit);
  if (!done.ok) return Response.json(done);
  return Response.json(await answer(who.orgId, target.parentRemoteId, who.manage));
}

/** The person's own name, for the line their update leaves. */
async function nameOf(orgId: string, userId: string): Promise<string | null> {
  const staffId = await staffIdFor(orgId, userId).catch(() => null);
  if (staffId) {
    const { data } = await supabaseAdmin.from("staff_profiles").select(NAME_COLUMNS).eq("org_id", orgId).eq("id", staffId).maybeSingle();
    const name = data ? displayNameOf(data as Parameters<typeof displayNameOf>[0], "") : "";
    if (name) return name;
  }
  const session = await auth0.getSession();
  return (session?.user?.name as string | undefined) ?? null;
}
