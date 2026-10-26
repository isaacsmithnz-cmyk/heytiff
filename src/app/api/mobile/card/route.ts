import { getStaff } from "@/lib/staff/query";
import { staffIdFor } from "@/lib/workboard/projects-query";
import { orgExpiryWindow } from "@/lib/org/query";
import { getOwnVehicle } from "@/lib/fleet/query";
import { ok, requireMobile } from "@/lib/mobile/auth";

/* YOUR CARD for the phone: who you are on the team, as your own profile
   page reads it (getStaff), and the vehicle assigned to you. Your own card
   is yours to see, so it takes no capability, only a membership; and never
   anyone else's: the card is found by the token's own user in its own
   workspace, with no id handed in at all.

   No pay and no notes (getStaff's `pay` and `notes` stay off), so those
   columns are never even selected. */
export async function GET(request: Request) {
  const ctx = await requireMobile(request);
  if (ctx instanceof Response) return ctx;

  const staffId = await staffIdFor(ctx.orgId, ctx.userId);
  if (!staffId) return Response.json({ error: "There's no staff card for you here yet." }, { status: 404, headers: { "cache-control": "no-store" } });

  const expiry = await orgExpiryWindow(ctx.orgId);
  const [staff, vehicle] = await Promise.all([
    getStaff(ctx.orgId, staffId, { pay: false, notes: false }, expiry.warnDays),
    getOwnVehicle(ctx.orgId, staffId).catch(() => null),
  ]);
  if (!staff) return Response.json({ error: "There's no staff card for you here yet." }, { status: 404, headers: { "cache-control": "no-store" } });

  const p = staff.profile;
  const text = (k: string) => (typeof p[k] === "string" && (p[k] as string).trim() ? (p[k] as string) : null);
  return ok({
    name: staff.row.name,
    initials: staff.row.initials,
    title: staff.row.role,
    employmentType: staff.row.employmentType,
    started: staff.row.started,
    years: staff.row.years,
    status: staff.row.status,
    compliance: staff.row.compliance,
    email: staff.row.email || null,
    phone: text("phone"),
    birthday: text("birthday"),
    state: text("state"),
    emergency: text("emergency_name")
      ? {
          name: text("emergency_name"),
          relationship: text("emergency_relationship"),
          phone: text("emergency_phone"),
          altPhone: text("emergency_alt_phone"),
        }
      : null,
    licences: staff.licences,
    vehicle: vehicle
      ? { name: vehicle.name || null, make: vehicle.make, model: vehicle.model, plate: vehicle.plate, plateState: vehicle.plateState }
      : null,
  });
}
