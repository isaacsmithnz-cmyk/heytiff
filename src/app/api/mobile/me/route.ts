import { supabaseAdmin } from "@/lib/supabase-server";
import { sm8StaffLinkMap } from "@/lib/integrations/links";
import { ok, requireMobile } from "@/lib/mobile/auth";
import { deleteUser } from "@/lib/integrations/auth0-management";
import { setupNeeds } from "@/lib/mobile/setup-needs";

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

  /* The first run the phone still owes them (lib/mobile/onboarding): read
     here so the phone knows on its first call whether to open it. */
  const setup = await setupNeeds(ctx).catch(() => ({ business: false, details: false }));
  return ok({
    setup,
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

/* DELETING YOUR OWN ACCOUNT (More, Delete account): the App Store asks that an
   app which makes accounts can delete them in the app, 5.1.1(v) (Isaac, 26
   November 2026). WHOSE is the verified token's `sub` and nothing else; the
   request carries no id.

   AN OWNER IS TOLD, NOT DELETED. Their seat is the business's, so the answer
   is a 409 naming each business they own, and nothing is touched.

   THE LOGIN GOES FIRST. If Auth0 refuses, nothing here has changed and the
   phone says try again. Once the login is gone nobody can sign in as them, and
   delete_account (docs/migrations/account_delete.sql) takes what is only
   theirs and sets their staff card Inactive; the business keeps its records.
   If that second step fails the login is already gone, so it is said loudly
   in the log, to be finished by hand: the person has nothing left to retry
   with. */
export async function DELETE(request: Request) {
  const ctx = await requireMobile(request);
  if (ctx instanceof Response) return ctx;

  const [seats, primary] = await Promise.all([
    supabaseAdmin.from("memberships").select("org_id").eq("user_id", ctx.userId).eq("role", "owner"),
    supabaseAdmin.from("organizations").select("id").eq("primary_owner_user_id", ctx.userId),
  ]);
  if (seats.error || primary.error) return refuse(503, "HeyTiff couldn't be reached. Try again.");
  const owned = [
    ...new Set([
      ...((seats.data ?? []) as { org_id: string }[]).map((r) => r.org_id),
      ...((primary.data ?? []) as { id: string }[]).map((r) => r.id),
    ]),
  ];
  if (owned.length > 0) {
    const { data } = await supabaseAdmin.from("organizations").select("trading_name").in("id", owned);
    const owns = ((data ?? []) as { trading_name: string | null }[]).map((o) => o.trading_name ?? "A business");
    return Response.json(
      { error: `You own ${owns.join(" and ")}. Make someone else the owner first, or write to us and we'll close it.`, owns },
      { status: 409, headers: { "cache-control": "no-store" } },
    );
  }

  const login = await deleteUser(ctx.userId);
  if (!login.ok) {
    console.error(`[mobile] account delete: Auth0 refused (${login.error}) for ${ctx.userId}`);
    return refuse(503, "Your account couldn't be deleted just now. Try again in a minute.");
  }

  const { data, error } = await supabaseAdmin.rpc("delete_account", { p_user: ctx.userId });
  if (error || data !== "deleted") {
    console.error(`[mobile] account delete: login gone but delete_account said ${error?.message ?? data} for ${ctx.userId}; finish by hand`);
  }
  return ok({ deleted: true });
}

const refuse = (status: number, error: string): Response =>
  Response.json({ error }, { status, headers: { "cache-control": "no-store" } });
