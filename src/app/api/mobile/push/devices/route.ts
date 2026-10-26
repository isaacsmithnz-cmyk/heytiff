import { supabaseAdmin } from "@/lib/supabase-server";
import { ok, requireMobile } from "@/lib/mobile/auth";

/* THIS PHONE, FOR PUSH: the app sends Expo's token once it may notify
   (POST), and takes it back when it signs out (DELETE). A token belongs to
   one phone, so a phone signed in as someone else moves its row to them.
   Kept by the verified sign-in and workspace, never by a body field. */

const TOKEN = /^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]{10,200}\]$/;

const bad = (error: string) => Response.json({ error }, { status: 400, headers: { "cache-control": "no-store" } });

async function tokenOf(request: Request): Promise<{ token: string; platform: "android" | "ios" } | null> {
  const body = (await request.json().catch(() => null)) as { token?: unknown; platform?: unknown } | null;
  const token = typeof body?.token === "string" ? body.token.trim() : "";
  if (!TOKEN.test(token)) return null;
  const platform = body?.platform === "ios" ? "ios" : "android";
  return { token, platform };
}

export async function POST(request: Request) {
  const ctx = await requireMobile(request);
  if (ctx instanceof Response) return ctx;
  const t = await tokenOf(request);
  if (!t) return bad("That isn't a push token.");
  const { error } = await supabaseAdmin
    .from("mobile_push_devices")
    .upsert({ token: t.token, org_id: ctx.orgId, user_sub: ctx.userId, platform: t.platform, last_seen_at: new Date().toISOString() }, { onConflict: "token" });
  if (error) {
    console.error(`[push] couldn't keep a phone for org ${ctx.orgId}: ${error.message}`);
    return Response.json({ error: "HeyTiff couldn't keep this phone. Try again." }, { status: 503, headers: { "cache-control": "no-store" } });
  }
  return ok({ kept: true });
}

export async function DELETE(request: Request) {
  const ctx = await requireMobile(request);
  if (ctx instanceof Response) return ctx;
  const t = await tokenOf(request);
  if (!t) return bad("That isn't a push token.");
  /* only your own phone's row, in this workspace */
  await supabaseAdmin.from("mobile_push_devices").delete().eq("token", t.token).eq("org_id", ctx.orgId).eq("user_sub", ctx.userId);
  return ok({ gone: true });
}
