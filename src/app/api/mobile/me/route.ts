import { supabaseAdmin } from "@/lib/supabase-server";
import { sm8StaffLinkMap } from "@/lib/integrations/links";
import { ok, requireMobile } from "@/lib/mobile/auth";

/* WHO THE PHONE IS SIGNED IN AS: the person, the workspace it's reading
   (and any others they belong to, to switch between), what they may do
   there, and which ServiceM8 person they are, so the phone can narrow the
   day to their own bookings the way Home's rail does. That last one comes
   only from integration_links (never a name match), and only for someone
   who can see the board; null otherwise, which the phone reads as "can't
   narrow", not "nothing booked". */
export async function GET(request: Request) {
  const ctx = await requireMobile(request);
  if (ctx instanceof Response) return ctx;

  const [card, orgs] = await Promise.all([
    supabaseAdmin
      .from("staff_profiles")
      .select("id, full_name")
      .eq("org_id", ctx.orgId)
      .eq("user_id", ctx.userId)
      .maybeSingle(),
    supabaseAdmin.from("organizations").select("id, trading_name").in("id", ctx.orgIds),
  ]);
  const staff = card.data as { id: string; full_name: string | null } | null;
  const named = new Map(((orgs.data ?? []) as { id: string; trading_name: string | null }[]).map((o) => [o.id, o.trading_name]));

  let sm8StaffUuid: string | null = null;
  if (staff && ctx.caps.has("workboard")) {
    const links = await sm8StaffLinkMap(ctx.orgId).catch(() => new Map<string, string>());
    sm8StaffUuid = [...links.entries()].find(([, staffId]) => staffId === staff.id)?.[0] ?? null;
  }

  return ok({
    userId: ctx.userId,
    name: staff?.full_name ?? null,
    staffId: staff?.id ?? null,
    sm8StaffUuid,
    role: ctx.role,
    capabilities: [...ctx.caps].sort(),
    org: { id: ctx.orgId, name: named.get(ctx.orgId) ?? null },
    orgs: ctx.orgIds.map((id) => ({ id, name: named.get(id) ?? null })),
  });
}
