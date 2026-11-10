import { ok, requireMobile } from "@/lib/mobile/auth";
import { workspacePeople } from "@/lib/staff/people-query";

/* THE NAMES THE PHONE KNOWS (Isaac, 10 November 2026: "saying a person's name
   turned their name a different color to register that it was connected to
   someone else in the organization"). Each active person on the workspace, by
   the words that name them (lib/staff/people-named): their full name, first
   name, preferred name and the nicknames Tiff has learned (staff_aliases).
   Names only, nothing to reach them by. The phone colours these as they're
   typed or said; the note flow still decides who a task is for. Any member
   may read it. The web's box reads the same list from api/people. */

export async function GET(request: Request) {
  const ctx = await requireMobile(request);
  if (ctx instanceof Response) return ctx;
  return ok({ people: await workspacePeople(ctx.orgId) });
}
