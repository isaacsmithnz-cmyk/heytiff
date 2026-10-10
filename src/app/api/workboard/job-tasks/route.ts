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
  editOf,
  makeTasksFromQuote,
  pastBookedDays,
  quotePlan,
  quotedHours,
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

type Who = { orgId: string; userId: string; userName: string | null; manage: boolean };

async function gate(): Promise<Who | Response> {
  const session = await auth0.getSession();
  const orgId = (session?.orgId as string | undefined) ?? null;
  const userId = (session?.user?.sub as string | undefined) ?? null;
  if (!orgId || !userId || !(await can("workboard"))) {
    return Response.json({ ok: false, reason: "The job's tasks need Workboard access." }, { status: 403 });
  }
  return { orgId, userId, userName: (session?.user?.name as string | undefined) ?? null, manage: await can("workboard_manage") };
}

const jobOf = (v: unknown) => (typeof v === "string" ? v.trim().slice(0, 80) : "");

async function answer(orgId: string, cardId: string, manage: boolean, note: string | null = null) {
  const [list, today, plan] = await Promise.all([readJobTasks(orgId, cardId), accountToday(orgId), quotePlan(orgId, cardId).catch(() => null)]);
  const booked = await pastBookedDays(orgId, cardId, today).catch(() => []);
  return {
    ok: true as const,
    ...list,
    today,
    booked,
    quoted: quotedHours(plan),
    /* Make the tasks: a manager, a job with an accepted quote and no tasks yet */
    canMake: manage && list.tasks.length === 0 && !!plan,
    manage,
    note,
  };
}

export async function GET(req: Request) {
  const who = await gate();
  if (who instanceof Response) return who;
  const job = jobOf(new URL(req.url).searchParams.get("job"));
  if (!job) return Response.json({ ok: false, reason: "No job named." }, { status: 400 });
  const target = await resolveJobCard(who.orgId, job);
  return Response.json(await answer(who.orgId, target.parentRemoteId, who.manage));
}

/** {job, make: true}: the accepted quote's tasks, or Tiff's list from it
    when it has none of its own (makeTasksFromQuote). */
export async function POST(req: Request) {
  const who = await gate();
  if (who instanceof Response) return who;
  if (!who.manage) return Response.json({ ok: false, reason: "Making the task list needs Workboard manage access." }, { status: 403 });
  const body = (await req.json().catch(() => ({}))) as { job?: unknown; make?: unknown };
  const job = jobOf(body.job);
  if (!job || body.make !== true) return Response.json({ ok: false, reason: "No job named." }, { status: 400 });
  const target = await resolveJobCard(who.orgId, job);
  const made = await makeTasksFromQuote(who.orgId, who.userId, target.parentRemoteId);
  if (!made.ok) return Response.json(made);
  return Response.json(await answer(who.orgId, target.parentRemoteId, who.manage));
}

/** {job, edit}: one edit — a tick or how far it got, a photo, or a change to the list. */
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
  const done = await applyTaskEdit(who.orgId, target.parentRemoteId, { userId: who.userId, name: await nameOf(who) }, edit);
  if (!done.ok) return Response.json(done);
  return Response.json(await answer(who.orgId, target.parentRemoteId, who.manage, done.note ?? null));
}

/** The person's own name, for the line their update leaves. */
async function nameOf(who: Who): Promise<string | null> {
  const staffId = await staffIdFor(who.orgId, who.userId).catch(() => null);
  if (staffId) {
    const { data } = await supabaseAdmin.from("staff_profiles").select(NAME_COLUMNS).eq("org_id", who.orgId).eq("id", staffId).maybeSingle();
    const name = data ? displayNameOf(data as Parameters<typeof displayNameOf>[0], "") : "";
    if (name) return name;
  }
  return who.userName;
}
