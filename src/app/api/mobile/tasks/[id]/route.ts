import { revalidateHome } from "@/lib/shell/revalidate-home";
import { moveTaskDue, removeTask, tickTask, untickTask } from "@/lib/dashboard/task-actions";
import { sm8PressFromMobile } from "@/lib/integrations/sm8-press";
import { sendTaskDoneAs, takeBackTaskDoneAs } from "@/app/actions/task-sm8";
import { ok, requireMobile } from "@/lib/mobile/auth";
import { phoneActor } from "@/lib/mobile/tasks";

/* ONE OF YOUR TASKS, from the phone's To do: tick it (`done`), Undo the tick
   (`reopen`), move its date (`due`), or DELETE it — the web's own rules
   (lib/dashboard/task-actions). A tick is a person's, on a screen made for
   ticking, so it files the task's Done as the web's To do does, and Undo
   takes it back (actions/task-sm8): only with the Workboard, and only where
   the deployment sends notes. The token check comes first, and the press is
   minted from it alone. */

const no = (status: number, error: string) => Response.json({ error }, { status, headers: { "cache-control": "no-store" } });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireMobile(request);
  if (ctx instanceof Response) return ctx;
  const { id } = await params;
  if (!UUID.test(id)) return no(404, "That task no longer exists.");
  const actor = await phoneActor(ctx);
  if (!actor) return no(403, "You need a staff card in HeyTiff to have tasks.");
  const body = (await request.json().catch(() => null)) as { do?: unknown; dueDate?: unknown } | null;

  if (body?.do === "done") {
    const r = await tickTask(actor, id);
    if (!r.ok) return no(409, r.error);
    if (ctx.caps.has("workboard")) {
      const press = await sm8PressFromMobile(ctx);
      if (press) {
        await sendTaskDoneAs(press, { taskId: id }).catch((err: unknown) => {
          console.error(`[sm8] the Done for task ${id} threw: ${err instanceof Error ? err.message : String(err)}`);
        });
      }
    }
    revalidateHome();
    return ok({ done: true });
  }
  if (body?.do === "reopen") {
    const r = await untickTask(actor, id);
    if (!r.ok) return no(409, r.error);
    let note: string | undefined;
    if (ctx.caps.has("workboard")) {
      const press = await sm8PressFromMobile(ctx);
      const back = press
        ? await takeBackTaskDoneAs(press, { taskId: id }).catch((err: unknown) => {
            console.error(`[sm8] taking back the Done of task ${id} threw: ${err instanceof Error ? err.message : String(err)}`);
            return null;
          })
        : null;
      note = back ? (back.ok ? back.note : back.error) : undefined;
    }
    revalidateHome();
    return ok({ open: true, ...(note ? { note } : {}) });
  }
  if (body?.do === "due") {
    const dueDate = body.dueDate === null ? null : typeof body.dueDate === "string" ? body.dueDate : undefined;
    if (dueDate === undefined) return no(400, "Check the due date.");
    const r = await moveTaskDue(actor, id, dueDate);
    if (!r.ok) return no(409, r.error);
    revalidateHome();
    return ok({ dueDate });
  }
  return no(400, "Say what to do with the task.");
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireMobile(request);
  if (ctx instanceof Response) return ctx;
  const { id } = await params;
  if (!UUID.test(id)) return no(404, "That task is already gone.");
  const actor = await phoneActor(ctx);
  if (!actor) return no(403, "You need a staff card in HeyTiff to have tasks.");
  const r = await removeTask(actor, id);
  if (!r.ok) return no(409, r.error);
  revalidateHome();
  return ok({ deleted: true });
}
