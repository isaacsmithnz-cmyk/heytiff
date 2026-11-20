import { sm8PressFromMobile } from "@/lib/integrations/sm8-press";
import { ok, requireMobile } from "@/lib/mobile/auth";
import { addStint, arriveAt, atOffice, changeStint, clockOffDay, clockOnDay, finishStopped, holdDay, homeAt, leave, readDay, restartDay, rosteredDays, setReason, settleStopped, skipJob, undoClockOn, type DayAnswer } from "@/lib/mobile/day";
import { todayInAu } from "@/lib/au-dates";

/* YOUR DAY, from the phone: where it stands (GET, with `until` for the
   finish you're thinking of), and Clock on, Arrived, Left, At the office,
   a job's time changed or taken off, a job the phone missed added, and Clock off (POST); and the day clock's
   safeties (lib/mobile/day-stop): home, Still here's hold, Restart, a stopped day finished, Not this job. The token check comes first and the press is minted from
   it alone; every rule is lib/mobile/day's. Your own day needs no grant
   beyond being a member. The phone says when you arrive and leave here;
   where you are goes to /api/mobile/where, and only where the business has
   its team's location on. */

const no = (status: number, error: string) => Response.json({ error }, { status, headers: { "cache-control": "no-store" } });

export async function GET(request: Request) {
  const ctx = await requireMobile(request);
  if (ctx instanceof Response) return ctx;
  /* a day the clock stopped by itself goes to ServiceM8 and the timesheet with this phone's press, once Restart
     has had its two hours (lib/mobile/day-stop) */
  await settleStopped(ctx, await sm8PressFromMobile(ctx)).catch((err) => console.error(`[mobile] stopped days for org ${ctx.orgId} weren't sent on: ${err instanceof Error ? err.message : String(err)}`));
  const [state, startsOn] = await Promise.all([readDay(ctx, Date.now(), new URL(request.url).searchParams.get("until")), rosteredDays(ctx, todayInAu()).catch(() => [])]);
  /* `startsOn`: the coming mornings you're rostered on, for the phone's "Clock on for the day?" reminder */
  return ok({ ...state, startsOn });
}

export async function POST(request: Request) {
  const ctx = await requireMobile(request);
  if (ctx instanceof Response) return ctx;
  const body = (await request.json().catch(() => null)) as {
    do?: unknown;
    jobUuid?: unknown;
    at?: unknown;
    where?: unknown;
    id?: unknown;
    from?: unknown;
    until?: unknown;
    remove?: unknown;
    reason?: unknown;
    /** where the morning watch saw you arrive before you clocked on */
    arrived?: unknown;
    /** the stints joined onto the one being changed */
    joined?: unknown;
  } | null;
  let answer: DayAnswer;
  if (body?.do === "on") answer = await clockOnDay(ctx, body.at, body.where, Date.now(), body.arrived);
  else if (body?.do === "undo") answer = await undoClockOn(ctx);
  else if (body?.do === "arrive") answer = await arriveAt(ctx, body.jobUuid, body.at, Date.now(), body.reason);
  else if (body?.do === "leave") answer = await leave(ctx, body.jobUuid, body.at);
  else if (body?.do === "office") answer = await atOffice(ctx, body.at);
  else if (body?.do === "reason") answer = await setReason(ctx, body.jobUuid, body.reason);
  else if (body?.do === "stint") answer = await changeStint(ctx, body.id, body.from, body.until, body.remove === true, Date.now(), body.joined, await sm8PressFromMobile(ctx));
  else if (body?.do === "add") answer = await addStint(ctx, body.jobUuid, body.from, body.until, Date.now(), await sm8PressFromMobile(ctx));
  else if (body?.do === "off") answer = await clockOffDay(ctx, await sm8PressFromMobile(ctx), body.at);
  else if (body?.do === "home") answer = await homeAt(ctx, body.at);
  else if (body?.do === "hold") answer = await holdDay(ctx);
  else if (body?.do === "restart") answer = await restartDay(ctx, body.id);
  else if (body?.do === "finish") answer = await finishStopped(ctx, await sm8PressFromMobile(ctx), body.id, body.at);
  else if (body?.do === "skip") answer = await skipJob(ctx, body.jobUuid, body.at);
  else return no(400, "Say on, undo, arrive, leave, office, reason, stint, add, off, home, hold, restart, finish or skip.");
  if (!answer.ok) return no(answer.status, answer.error);
  return ok({ state: answer.state, said: answer.said });
}
