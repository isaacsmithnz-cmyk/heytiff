import { ok, requireMobile } from "@/lib/mobile/auth";
import { readPhoneFleet } from "@/lib/mobile/vehicles";
import { addVehicle, logService, paperLand, paperSlot, readPaper, renewPaper } from "@/lib/mobile/vehicle-papers";

/* EVERY VEHICLE, for whoever sees the register on the web (`assets_all`):
   those that need a look first, then the rest (lib/mobile/vehicles; Isaac,
   17 November 2026, bug 8: "I should be able to see all vehicles"). */
export async function GET(request: Request) {
  const ctx = await requireMobile(request, "assets_all");
  if (ctx instanceof Response) return ctx;
  return ok(await readPhoneFleet(ctx));
}

/* THE REGISTER'S PAPERS FROM THE PHONE (lib/mobile/vehicle-papers; Isaac, 18
   November 2026: "add a new vehicle and update vehicle documents on the
   app"). By `do`: a paper's slot and its landing, Tiff's read of it, then
   Add a vehicle, a renewal, or a service, each the web's own save. */
const RUN = { slot: paperSlot, land: paperLand, read: readPaper, add: addVehicle, renew: renewPaper, service: logService } as const;

export async function POST(request: Request) {
  const ctx = await requireMobile(request, "assets_all");
  if (ctx instanceof Response) return ctx;
  const body = ((await request.json().catch(() => null)) ?? {}) as Record<string, unknown>;
  const run = typeof body.do === "string" && Object.hasOwn(RUN, body.do) ? RUN[body.do as keyof typeof RUN] : null;
  if (!run) return Response.json({ error: "What should happen?" }, { status: 400, headers: { "cache-control": "no-store" } });
  const r = await run(ctx, body);
  if (!r.ok) return Response.json({ error: r.error }, { status: r.status, headers: { "cache-control": "no-store" } });
  return ok(r.value ?? { ok: true });
}
