import { staffIdFor } from "@/lib/workboard/projects-query";
import { eventPayload } from "@/lib/dashboard/event-mobile";
import { answerEvent } from "@/lib/dashboard/event-answer";
import { revalidateHome } from "@/lib/shell/revalidate-home";
import { ok, requireMobile } from "@/lib/mobile/auth";

/* AN EVENT on the phone (Isaac, 6 November 2026, "Build" on the events mock):
   GET draws it as its screen does; POST is your answer, your allergies, or
   both, and hands back the event as it now stands. You answer for yourself
   alone, found by the token's own user; a membership is enough, as on the
   web's noticeboard. */

const no = (status: number, error: string) => Response.json({ error }, { status, headers: { "cache-control": "no-store" } });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: Request) {
  const ctx = await requireMobile(request);
  if (ctx instanceof Response) return ctx;
  const id = new URL(request.url).searchParams.get("id") ?? "";
  if (!UUID.test(id)) return no(400, "Ask for an event by its id.");
  const staffId = await staffIdFor(ctx.orgId, ctx.userId);
  const event = await eventPayload(ctx.orgId, staffId, id);
  return event ? ok(event) : no(404, "That event no longer exists.");
}

export async function POST(request: Request) {
  const ctx = await requireMobile(request);
  if (ctx instanceof Response) return ctx;
  const body = (await request.json().catch(() => null)) as { id?: unknown; answer?: unknown; diet?: unknown } | null;
  const id = typeof body?.id === "string" ? body.id : "";
  if (!UUID.test(id)) return no(400, "Say which event.");
  const staffId = await staffIdFor(ctx.orgId, ctx.userId);
  if (!staffId) return no(404, "There's no staff card for you here yet.");

  const change: { answer?: string | null; diet?: string | null } = {};
  if (body && "answer" in body) {
    if (body.answer !== null && typeof body.answer !== "string") return no(400, "That isn't an answer to this event.");
    change.answer = body.answer as string | null;
  }
  if (body && "diet" in body) {
    if (body.diet !== null && typeof body.diet !== "string") return no(400, "Write it as words.");
    change.diet = body.diet as string | null;
  }
  if (change.answer === undefined && change.diet === undefined) return no(400, "Nothing to change.");

  /* an answer first, then what you wrote, so "Me + 1" and the allergies can go in one press */
  if (change.answer !== undefined) {
    const r = await answerEvent(ctx.orgId, staffId, id, { answer: change.answer });
    if (!r.ok) return no(409, r.error);
  }
  if (change.diet !== undefined && change.answer !== null) {
    const r = await answerEvent(ctx.orgId, staffId, id, { diet: change.diet });
    if (!r.ok) return no(409, r.error);
  }
  revalidateHome();
  const event = await eventPayload(ctx.orgId, staffId, id);
  return event ? ok(event) : no(404, "That event no longer exists.");
}
