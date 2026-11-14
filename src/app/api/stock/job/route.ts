import { auth0 } from "@/lib/auth0";
import { can } from "@/lib/permissions-server";
import { readJobEquipment } from "@/lib/stock/stock-server";

/* A JOB'S EQUIPMENT for its Overview (Stock, lib/stock): each unit and
   control its quote needs, when it's wanted, and where it's up to, so the
   crew knows what's coming to site and when (Isaac, 13 November 2026, board 9
   of https://claude.ai/artifact/MpMUX46rk45j6dP6ZYnEsu, "Build it"). A route,
   as the job tracker is: the card's server actions run one at a time. Behind
   `workboard`, as Stock is. */
export async function GET(req: Request) {
  const session = await auth0.getSession();
  const orgId = (session?.orgId as string | undefined) ?? null;
  if (!orgId || !(await can("workboard"))) return Response.json({ ok: false, reason: "Equipment needs access to Jobs." }, { status: 403 });
  const job = (new URL(req.url).searchParams.get("job") ?? "").trim().slice(0, 80);
  if (!job) return Response.json({ ok: false, reason: "No job named." }, { status: 400 });
  return Response.json({ ok: true, rows: await readJobEquipment(orgId, job) }, { headers: { "cache-control": "no-store" } });
}
