import { ok, requireMobile } from "@/lib/mobile/auth";
import { resolveJobCard } from "@/lib/workboard/all-jobs-query";
import { applyTaskEdit, pastBookedDays, readJobTasks } from "@/lib/workboard/visit-tasks-server";
import { dayFor } from "@/lib/mobile/used";
import { staffProfileIdFor } from "@/lib/fleet/query";
import { supabaseAdmin } from "@/lib/supabase-server";
import { fromQuote, tasksToTick, visitOn, type WrapTask } from "@/lib/mobile/wrap-tasks-plan";

/* A JOB'S TASKS IN THE WRAP-UP (lib/mobile/wrap-tasks-plan): GET is what to
   tick for the day's visit and how far the quote is; POST ticks one, or
   takes its tick off, as the job card's own Installation does
   (applyTaskEdit, its day's update kept first). The crew's own tier,
   `workboard`: ticking is the work, the list is the office's. */

const no = (status: number, error: string) => Response.json({ error }, { status, headers: { "cache-control": "no-store" } });
const nextDay = (day: string) => new Date(Date.parse(`${day}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

async function read(orgId: string, card: string, day: string) {
  const [{ tasks }, booked] = await Promise.all([readJobTasks(orgId, card), pastBookedDays(orgId, card, nextDay(day)).catch(() => [])]);
  const all: WrapTask[] = tasks.map((t) => ({ id: t.id, name: t.name, stage: t.stage, visit: t.visit, progress: t.progress, hours: t.hours ?? null }));
  const visit = visitOn(booked.map((b) => b.day), day);
  const shown = tasksToTick(all, visit);
  return { tasks: shown, fromQuote: fromQuote(all, visit, shown) };
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireMobile(request, "workboard");
  if (ctx instanceof Response) return ctx;
  const id = (await params).id.trim().slice(0, 80);
  if (!id) return no(400, "Which job?");
  const day = await dayFor(ctx.orgId, new URL(request.url).searchParams.get("day"));
  if (!day) return no(400, "Which day?");
  const { parentRemoteId } = await resolveJobCard(ctx.orgId, id);
  return ok(await read(ctx.orgId, parentRemoteId, day));
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireMobile(request, "workboard");
  if (ctx instanceof Response) return ctx;
  const id = (await params).id.trim().slice(0, 80);
  const body = (await request.json().catch(() => null)) as { task?: unknown; done?: unknown; day?: unknown } | null;
  const task = typeof body?.task === "string" ? body.task : "";
  if (!id || !/^[0-9a-f-]{36}$/i.test(task) || typeof body?.done !== "boolean") return no(400, "Which task?");
  const day = await dayFor(ctx.orgId, body.day);
  if (!day) return no(400, "Which day?");
  const { parentRemoteId } = await resolveJobCard(ctx.orgId, id);
  const staff = await staffProfileIdFor(ctx.orgId, ctx.userId).catch(() => null);
  const { data } = staff ? await supabaseAdmin.from("staff_profiles").select("first_name, full_name").eq("org_id", ctx.orgId).eq("id", staff).maybeSingle() : { data: null };
  const person = data as { first_name: string | null; full_name: string | null } | null;
  const name = person?.full_name?.trim() || person?.first_name?.trim() || null;
  const r = await applyTaskEdit(ctx.orgId, parentRemoteId, { userId: ctx.userId, name }, { kind: "progress", id: task, to: body.done ? 100 : 0, note: "" });
  if (!r.ok) return no(409, r.reason);
  return ok(await read(ctx.orgId, parentRemoteId, day));
}
