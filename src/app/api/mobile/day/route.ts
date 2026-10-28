import { sm8PressFromMobile } from "@/lib/integrations/sm8-press";
import { ok, requireMobile } from "@/lib/mobile/auth";
import { arriveAt, atOffice, changeStint, clockOffDay, clockOnDay, leave, readDay, rosteredDays, type DayAnswer } from "@/lib/mobile/day";
import { todayInAu } from "@/lib/au-dates";

/* YOUR DAY, from the phone: where it stands (GET, with `until` for the
   finish you're thinking of), and Clock on, Arrived, Left, At the office,
   a job's time changed or taken off, and Clock off (POST). The token check comes first and the press is minted from
   it alone; every rule is lib/mobile/day's. Your own day needs no grant
   beyond being a member. The phone says when you arrive and leave; it never
   sends where you are. */

const no = (status: number, error: string) => Response.json({ error }, { status, headers: { "cache-control": "no-store" } });

export async function GET(request: Request) {
  const ctx = await requireMobile(request);
  if (ctx instanceof Response) return ctx;
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
  } | null;
  let answer: DayAnswer;
  if (body?.do === "on") answer = await clockOnDay(ctx, body.at, body.where);
  else if (body?.do === "arrive") answer = await arriveAt(ctx, body.jobUuid, body.at);
  else if (body?.do === "leave") answer = await leave(ctx, body.jobUuid, body.at);
  else if (body?.do === "office") answer = await atOffice(ctx, body.at);
  else if (body?.do === "stint") answer = await changeStint(ctx, body.id, body.from, body.until, body.remove === true);
  else if (body?.do === "off") answer = await clockOffDay(ctx, await sm8PressFromMobile(ctx), body.at);
  else return no(400, "Say on, arrive, leave, office, stint or off.");
  if (!answer.ok) return no(answer.status, answer.error);
  return ok({ state: answer.state, said: answer.said });
}
