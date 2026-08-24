import { revalidatePath } from "next/cache";
import { auth0 } from "@/lib/auth0";
import { can } from "@/lib/permissions-server";
import { listVehicles } from "@/lib/fleet/query";
import { runFleetValuation, type FleetAiVehicle } from "@/lib/fleet/valuation";
import {
  claimValuationLease,
  persistValuations,
  releaseValuationLease,
  valuationRunning,
} from "@/lib/fleet/valuation-store";
import { STATUS_LABEL, parseValuations } from "@/components/fleet/logic";

/* A ROUTE HANDLER FOR THE SAME REASON THE OCR AND INGEST ONES ARE: valuing the
   fleet against live listings is a web_search turn plus however many resumes it
   takes, which is tens of seconds and sometimes minutes. `maxDuration` is a
   route-segment option — as a server action this would have inherited the
   assets page's ceiling, and raising THAT would raise it for every other action
   on the screen.

   THE ROUTE OWNS THE RESULT (issue #502). This used to return the valuations
   for the register component to save, and Isaac watched what that costs: a
   page navigation mid-run unmounted the component, the response arrived to
   nobody, and a full run's spend produced nothing — no error, no trace. Now
   the route reads the fleet itself, runs the valuation, and PERSISTS before
   responding; the client is a viewer. For the same reason the request takes
   NO BODY — a route that writes what a browser posted would be trusting the
   client twice.

   ONE RUN AT A TIME. Each press bills real money, so a second press while one
   is in flight is refused via the lease (fleet_valuation_leases), not merely a
   disabled button. GET reports the lease so a freshly-loaded page can show
   "Tiff is valuing…" and wait for a run it didn't start.

   GATED `assets_all`, the register capability, restated here because a route
   handler is reachable directly. Fleet value is deliberately NOT on a pay
   capability: it's an asset fact, not a financial. */

export const maxDuration = 300;

async function orgOf(): Promise<string | null> {
  const session = await auth0.getSession();
  return (session?.orgId as string | undefined) ?? null;
}

export async function GET() {
  const orgId = await orgOf();
  if (!orgId || !(await can("assets_all"))) {
    return Response.json({ running: false }, { status: 403 });
  }
  return Response.json({ running: await valuationRunning(orgId) });
}

export async function POST() {
  const orgId = await orgOf();
  if (!orgId || !(await can("assets_all"))) {
    return Response.json(
      { ok: false, reason: "Valuations need access to the fleet register." },
      { status: 403 },
    );
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return Response.json({ ok: false, reason: "Tiff is offline — no API key configured." });
  }

  // Claim before spending anything. The loser of a race is told to watch the
  // winner's run, not that something went wrong.
  if (!(await claimValuationLease(orgId))) {
    return Response.json(
      { ok: false, running: true, reason: "Tiff is already valuing the fleet." },
      { status: 409 },
    );
  }

  try {
    const { vehicles } = await listVehicles(orgId);
    const working = vehicles.filter((v) => v.status !== "sold");
    const payload: FleetAiVehicle[] = working.map((v) => ({
      id: v.id,
      make: v.make,
      model: v.model,
      year: v.year,
      odometerKm: v.odometer,
      status: STATUS_LABEL[v.status],
      purchasePriceAud: v.purchasePrice || null,
      ageYears: v.purchaseDateDays ? Math.round((v.purchaseDateDays / 365.25) * 10) / 10 : null,
      notes: v.notes,
    }));

    const res = await runFleetValuation(payload);
    if (!res.ok) return Response.json(res);

    await persistValuations(orgId, parseValuations(res, working));
    revalidatePath("/dashboard/assets");
    revalidatePath("/dashboard/my-vehicle");
    return Response.json({ ok: true, searched: res.searched });
  } finally {
    await releaseValuationLease(orgId);
  }
}
