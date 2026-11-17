import { ok, requireMobile } from "@/lib/mobile/auth";
import { keepPosition } from "@/lib/mobile/where";

/* WHERE YOU ARE, from the phone, while you're clocked on: kept only where
   the business has its team's location on (lib/mobile/where). The answer
   says whether it was kept, so a phone on a business with it off stops
   asking for a while. */
export async function POST(request: Request) {
  const ctx = await requireMobile(request);
  if (ctx instanceof Response) return ctx;
  const body = await request.json().catch(() => null);
  return ok({ kept: await keepPosition(ctx, body).catch(() => false) });
}
