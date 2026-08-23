import { can } from "@/lib/permissions-server";
import { runFleetValuation, type FleetAiVehicle } from "@/lib/fleet/valuation";

/* A ROUTE HANDLER FOR THE SAME REASON THE OCR AND INGEST ONES ARE: valuing the
   fleet against live listings is a web_search turn plus however many resumes it
   takes, which is tens of seconds and sometimes minutes. `maxDuration` is a
   route-segment option — as a server action this would have inherited the
   assets page's ceiling, and raising THAT would raise it for every other action
   on the screen.

   ONE PRESS, ONE RUN. `MAX_SEARCHES` and `MAX_RESUMES` in the valuation module
   bound what a click can spend; there is no retry loop here.

   GATED `assets_all`, the register capability — the same gate the action had,
   restated because a route handler is reachable directly. Fleet value is
   deliberately NOT on a pay capability: it's an asset fact, not a financial. */

export const maxDuration = 300;

export async function POST(request: Request) {
  if (!(await can("assets_all"))) {
    return Response.json(
      { ok: false, reason: "Valuations need access to the fleet register." },
      { status: 403 },
    );
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json({ ok: false, reason: "Tiff is offline — no API key configured." });
  }

  let vehicles: FleetAiVehicle[];
  try {
    const body = (await request.json()) as { vehicles?: unknown };
    if (!Array.isArray(body.vehicles)) throw new Error("no vehicles");
    vehicles = body.vehicles as FleetAiVehicle[];
  } catch {
    return Response.json({ ok: false, reason: "Nothing to value." }, { status: 400 });
  }

  return Response.json(await runFleetValuation(vehicles));
}
