import { sm8PressFromMobile } from "@/lib/integrations/sm8-press";
import { ok, requireMobile } from "@/lib/mobile/auth";
import { changeSchedule, retryScheduleChange, type ScheduleChange } from "@/lib/mobile/schedule-change";

/* CHANGING THE DAY from the phone's Schedule: move, swap, change the time,
   take off, book — or Try again on what one left undone. The token check
   comes first, and the press is minted from it alone; every other gate and
   every write is lib/mobile/schedule-change's. `tell` pushes to the people
   moved. */
export async function POST(request: Request) {
  const ctx = await requireMobile(request, "workboard");
  if (ctx instanceof Response) return ctx;
  const press = await sm8PressFromMobile(ctx);

  const body = (await request.json().catch(() => null)) as { change?: unknown; tell?: unknown; retry?: unknown } | null;
  const answer = Array.isArray(body?.retry)
    ? await retryScheduleChange(ctx, press, body.retry.filter((r): r is string => typeof r === "string"))
    : body?.change && typeof body.change === "object"
      ? await changeSchedule(ctx, press, { change: body.change as ScheduleChange, tell: body.tell === true })
      : null;
  if (!answer) return Response.json({ error: "Say what to change." }, { status: 400, headers: { "cache-control": "no-store" } });
  if (!answer.ok) {
    return Response.json({ error: answer.error, ...(answer.retry ? { retry: answer.retry } : {}) }, { status: answer.status, headers: { "cache-control": "no-store" } });
  }
  return ok({ state: answer.state, said: answer.said, undo: answer.undo });
}
