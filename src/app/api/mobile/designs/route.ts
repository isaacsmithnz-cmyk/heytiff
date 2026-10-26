import { listDesigns } from "@/lib/mobile/designs";
import { ok, requireMobile } from "@/lib/mobile/auth";

/* THE DESIGNS, newest first, for the phone's Design (lib/mobile/designs):
   behind `studio`, as the studio is, in the verified workspace. `q` narrows
   by name, job number or client. */
export async function GET(request: Request) {
  const ctx = await requireMobile(request, "studio");
  if (ctx instanceof Response) return ctx;
  const q = new URL(request.url).searchParams.get("q")?.slice(0, 120) ?? "";
  return ok({ designs: await listDesigns(ctx.orgId, q) });
}
