import { sm8PressFromMobile } from "@/lib/integrations/sm8-press";
import { ok, requireMobile } from "@/lib/mobile/auth";
import { clockOff, clockOn, readClock, sendLastAgain, type ClockAnswer } from "@/lib/mobile/clock";

/* YOUR CLOCK, from the phone: where it stands (GET), and Clock on, Clock off
   at the time you picked, or Try again on your last stint's time (POST). The
   token check comes first and the press is minted from it alone; every rule
   is lib/mobile/clock's. Your own time needs no grant beyond being a member. */

const no = (status: number, error: string) => Response.json({ error }, { status, headers: { "cache-control": "no-store" } });

export async function GET(request: Request) {
  const ctx = await requireMobile(request);
  if (ctx instanceof Response) return ctx;
  return ok(await readClock(ctx));
}

export async function POST(request: Request) {
  const ctx = await requireMobile(request);
  if (ctx instanceof Response) return ctx;
  const press = await sm8PressFromMobile(ctx);
  const body = (await request.json().catch(() => null)) as { do?: unknown; jobUuid?: unknown; at?: unknown } | null;
  let answer: ClockAnswer;
  if (body?.do === "on") answer = await clockOn(ctx, press, body.jobUuid);
  else if (body?.do === "off") answer = await clockOff(ctx, press, body.at);
  else if (body?.do === "send") answer = await sendLastAgain(ctx, press);
  else return no(400, "Say on, off or send.");
  if (!answer.ok) return no(answer.status, answer.error);
  return ok({ state: answer.state, said: answer.said });
}
