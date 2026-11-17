import { ok, requireMobile } from "@/lib/mobile/auth";
import { readPhoneFleet } from "@/lib/mobile/vehicles";

/* EVERY VEHICLE, for whoever sees the register on the web (`assets_all`):
   those that need a look first, then the rest (lib/mobile/vehicles; Isaac,
   17 November 2026, bug 8: "I should be able to see all vehicles"). */
export async function GET(request: Request) {
  const ctx = await requireMobile(request, "assets_all");
  if (ctx instanceof Response) return ctx;
  return ok(await readPhoneFleet(ctx));
}
