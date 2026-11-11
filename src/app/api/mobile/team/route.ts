import { ok, requireMobile } from "@/lib/mobile/auth";
import { appUrlOf, readTeam } from "@/lib/mobile/team";

/* THE TEAM, for whoever may see it on the web (`team`): who's on HeyTiff and
   who isn't yet, with any invite (lib/mobile/team). */
export async function GET(request: Request) {
  const ctx = await requireMobile(request, "team");
  if (ctx instanceof Response) return ctx;
  return ok(await readTeam(ctx, appUrlOf(request)));
}
