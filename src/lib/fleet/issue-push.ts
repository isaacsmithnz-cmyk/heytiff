import "server-only";

import { supabaseAdmin } from "@/lib/supabase-server";
import { afterResponse } from "@/lib/mobile/after-response";
import { staffHolding } from "@/lib/mobile/holders";
import { pushToStaff } from "@/lib/mobile/push";

/* AN ISSUE REPORTED ON A VEHICLE (Isaac, 28 October 2026, "Yes, build it"
   on the phone's Your vehicle): whoever looks after the fleet (`assets_all`)
   hears on their phone, the vehicle and the words; never the person who
   reported it. After the answer, never in its way. */
export function pushIssueReported(orgId: string, issue: { staffId: string | null; vehicleId: string; note: string | null }): void {
  afterResponse(async () => {
    const [keepers, vehicle, who] = await Promise.all([
      staffHolding(orgId, "assets_all", issue.staffId),
      supabaseAdmin.from("vehicles").select("plate, make, model").eq("org_id", orgId).eq("id", issue.vehicleId).maybeSingle(),
      issue.staffId
        ? supabaseAdmin.from("staff_profiles").select("first_name, preferred_name, full_name").eq("org_id", orgId).eq("id", issue.staffId).maybeSingle()
        : Promise.resolve({ data: null }),
    ]);
    if (!keepers.length) return;
    const v = vehicle.data as { plate: string | null; make: string | null; model: string | null } | null;
    const p = who.data as { first_name: string | null; preferred_name: string | null; full_name: string | null } | null;
    const name = (p?.preferred_name ?? p?.first_name ?? p?.full_name?.split(" ")[0] ?? "").trim() || "Someone";
    const label = [v?.plate?.trim().toUpperCase(), [v?.make, v?.model].filter(Boolean).join(" ")].filter(Boolean).join(", ") || "a vehicle";
    await pushToStaff(orgId, keepers, { title: `${name} reported an issue on ${label}`, body: issue.note?.trim() || null });
  }, "an issue's push");
}
