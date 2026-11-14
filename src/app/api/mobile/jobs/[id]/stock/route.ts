import { ok, requireMobile } from "@/lib/mobile/auth";
import { readJobEquipment } from "@/lib/stock/stock-server";

/* A JOB'S EQUIPMENT for the phone's job card (lib/stock): each unit and
   control its quote needs, when it's wanted and where it's up to, behind the
   job's own `workboard` grant, as the web's Overview shows it. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireMobile(request, "workboard");
  if (ctx instanceof Response) return ctx;
  const id = (await params).id.trim().slice(0, 80);
  return ok({ rows: await readJobEquipment(ctx.orgId, id) });
}
