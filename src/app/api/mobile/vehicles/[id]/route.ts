import { ok, requireMobile } from "@/lib/mobile/auth";
import { readPhoneFleetVehicle } from "@/lib/mobile/vehicles";

/* ONE VEHICLE of the fleet, as Your vehicle reads, with its driver, for
   whoever sees the register (`assets_all`; lib/mobile/vehicles). For
   looking: logging stays on Your vehicle, changes on the web. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireMobile(request, "assets_all");
  if (ctx instanceof Response) return ctx;
  const { id } = await params;
  const read = await readPhoneFleetVehicle(ctx, id);
  if (!read.vehicle) return Response.json({ error: "That vehicle isn't in the fleet." }, { status: 404, headers: { "cache-control": "no-store" } });
  return ok(read);
}
