import { notificationsFor } from "@/lib/mobile/notifications";
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
