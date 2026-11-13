import { notificationsFor } from "@/lib/mobile/notifications";
import { actOnNotification } from "@/lib/mobile/notification-acts";
import { ok, requireMobile } from "@/lib/mobile/auth";

/* WHAT THE PHONE TELLS YOU: the tasks given you, reminders come due,
   ServiceM8 notes that ask you something, notices you haven't read and
   declined leave, newest first, each with the phone screen it opens; and
   your reminders still to come, for the phone's own clock
   (lib/mobile/notifications). Yours alone, in your own workspace. */
export async function GET(request: Request) {
  const ctx = await requireMobile(request);
  if (ctx instanceof Response) return ctx;
  return ok(await notificationsFor(ctx));
}

/* A swipe on one: Clear, a notice read, a reminder snoozed, or the Undo of
   any of them (lib/mobile/notification-acts). */
export async function POST(request: Request) {
  const ctx = await requireMobile(request);
  if (ctx instanceof Response) return ctx;
  const body = ((await request.json().catch(() => null)) ?? {}) as Record<string, unknown>;
  const r = await actOnNotification(ctx, body);
  if (!r.ok) return Response.json({ error: r.error }, { status: r.status, headers: { "cache-control": "no-store" } });
  return ok(r.value);
}
