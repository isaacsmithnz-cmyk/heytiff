import { revalidateHome } from "@/lib/shell/revalidate-home";
import { addOwnTask } from "@/lib/dashboard/task-actions";
import { ok, requireMobile } from "@/lib/mobile/auth";
import { phoneActor, phoneTasks } from "@/lib/mobile/tasks";

/* YOUR TO DO, from the phone's Today: your open tasks (GET), and a task for
   yourself (POST), as Save on the web's Home makes one, with a due date
   where you picked one. Your own to-do needs no grant beyond being a member. */

const no = (status: number, error: string) => Response.json({ error }, { status, headers: { "cache-control": "no-store" } });

export async function GET(request: Request) {
  const ctx = await requireMobile(request);
  if (ctx instanceof Response) return ctx;
  const actor = await phoneActor(ctx);
  if (!actor?.staffId) return ok({ tasks: [] });
  return ok({ tasks: await phoneTasks(ctx.orgId, actor.staffId) });
}

export async function POST(request: Request) {
  const ctx = await requireMobile(request);
  if (ctx instanceof Response) return ctx;
  const actor = await phoneActor(ctx);
  if (!actor) return no(403, "You need a staff card in HeyTiff to have tasks.");
  const body = (await request.json().catch(() => null)) as { title?: unknown; dueDate?: unknown } | null;
  const title = typeof body?.title === "string" ? body.title : "";
  const dueDate = typeof body?.dueDate === "string" ? body.dueDate : null;
  const r = await addOwnTask(actor, title, dueDate);
  if (!r.ok) return no(400, r.error);
  revalidateHome();
  return ok({ id: r.taskId });
}
