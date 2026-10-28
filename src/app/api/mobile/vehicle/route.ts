import { ok, requireMobile } from "@/lib/mobile/auth";
import { logFuel } from "@/lib/mobile/expenses";
import { fixEntry, logReading, readPhoneVehicle, reportIssue } from "@/lib/mobile/vehicle";

/* YOUR VEHICLE for the phone (lib/mobile/vehicle): yours as its driver
   sees it, and the vehicles you may log against (GET); and (POST, by `do`)
   fuel, a reading, an issue, or a correction of your own entry, each the
   web's own action run as you. Ungated, as the web's own vehicle is. */
export async function GET(request: Request) {
  const ctx = await requireMobile(request);
  if (ctx instanceof Response) return ctx;
  return ok(await readPhoneVehicle(ctx));
}

export async function POST(request: Request) {
  const ctx = await requireMobile(request);
  if (ctx instanceof Response) return ctx;
  const body = ((await request.json().catch(() => null)) ?? {}) as Record<string, unknown>;
  const run = body.do === "fuel" ? logFuel : body.do === "odo" ? logReading : body.do === "issue" ? reportIssue : body.do === "fix" ? fixEntry : null;
  if (!run) return Response.json({ error: "What should happen?" }, { status: 400, headers: { "cache-control": "no-store" } });
  const r = await run(ctx, body);
  if (!r.ok) return Response.json({ error: r.error }, { status: r.status, headers: { "cache-control": "no-store" } });
  return ok(r.value ?? { ok: true });
}
