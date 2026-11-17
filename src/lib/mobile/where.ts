import "server-only";

import { supabaseAdmin } from "@/lib/supabase-server";
import type { MobileCtx } from "./auth";
import { readFix } from "./where-fix";

/* WHERE THE TEAM IS, for Home's map (Isaac, 17 November 2026: "add it, i
   will give notice. we will just have a disclaimer if future businesses
   want to activate"). A business turns it on in Settings, Business
   (`organizations.live_location`, off by default). While someone is
   clocked on, their phone sends where it is every two minutes; HeyTiff
   keeps only the LAST place, one row a person (`staff_positions`), and
   drops it when they clock off. Nothing is kept for a business with it
   off, or for anyone not clocked on, and the phone is told so it stops
   asking for a while. */

export async function keepPosition(ctx: MobileCtx, body: unknown, now: number = Date.now()): Promise<boolean> {
  const fix = readFix(body, now);
  if (!fix) return false;
  const [{ data: org }, { data: day }] = await Promise.all([
    supabaseAdmin.from("organizations").select("live_location").eq("id", ctx.orgId).maybeSingle(),
    supabaseAdmin.from("staff_days").select("id").eq("org_id", ctx.orgId).eq("user_id", ctx.userId).is("off_at", null).maybeSingle(),
  ]);
  if (!(org as { live_location?: boolean } | null)?.live_location || !day) return false;
  const { error } = await supabaseAdmin.from("staff_positions").upsert(
    { org_id: ctx.orgId, user_id: ctx.userId, lat: fix.lat, lng: fix.lng, accuracy_m: fix.accuracy, at: fix.at, updated_at: new Date(now).toISOString() },
    { onConflict: "org_id,user_id" },
  );
  return !error;
}

/** Clock off: where you were is forgotten. */
export async function forgetPosition(orgId: string, userId: string): Promise<void> {
  await supabaseAdmin.from("staff_positions").delete().eq("org_id", orgId).eq("user_id", userId);
}
