import { sm8PressFromMobile } from "@/lib/integrations/sm8-press";
import { sm8LeaveAllowed } from "@/lib/integrations/sm8-kinds";
import { readSm8WriteState } from "@/lib/integrations/sm8-writes";
import { ok, requireMobile, type MobileCtx } from "@/lib/mobile/auth";
import { staffUuidOf } from "@/lib/mobile/clock";
import { supabaseAdmin } from "@/lib/supabase-server";
import { staffProfileIdFor } from "@/lib/fleet/query";
import { createBlock } from "@/lib/schedule/blocks-store";
import { minutesOf } from "@/lib/schedule/blocks";

/* BLOCK OUT TIME FROM THE PHONE (Isaac, 6 November 2026: "How do I do this
   on mobile? Add + , something?", then "Build it" on the phone's New, Block
   out time): there's no dragging on a phone, so the form puts a block
   straight onto a person's day: what, where, who, the day, from and to.

   Behind the Schedule's own `workboard` grant. Anyone on it may block out
   their own time; someone who runs the board (`workboard_manage`, or the
   owner) may block out anyone's, as they book anyone. Who is a ServiceM8
   person, as the Schedule's rows are.

   GET: who the form offers, and who you are. POST: the block. */

const no = (error: string, status = 400) => Response.json({ error }, { status, headers: { "cache-control": "no-store" } });

const runsBoard = (ctx: MobileCtx) => ctx.role === "owner" || ctx.caps.has("workboard_manage");

type Person = { uuid: string; name: string };

/** The people a block can go on: everyone active in ServiceM8, or just you. */
async function peopleFor(ctx: MobileCtx): Promise<{ people: Person[]; me: string | null }> {
  const tenant = (await readSm8WriteState(ctx.orgId).catch(() => null))?.tenantId ?? null;
  const me = await staffUuidOf(ctx, tenant).catch(() => null);
  const { data } = await supabaseAdmin.from("sm8_staff").select("uuid, first, last").eq("org_id", ctx.orgId).eq("active", 1);
  const all = ((data ?? []) as { uuid: string; first: string | null; last: string | null }[])
    .map((s) => ({ uuid: s.uuid, name: [s.first, s.last].filter(Boolean).join(" ").trim() }))
    .filter((s) => s.name)
    .sort((a, b) => a.name.localeCompare(b.name));
  const low = (u: string | null) => (u ?? "").toLowerCase();
  return { people: runsBoard(ctx) ? all : all.filter((p) => low(p.uuid) === low(me)), me };
}

export async function GET(request: Request) {
  const ctx = await requireMobile(request, "workboard");
  if (ctx instanceof Response) return ctx;
  return ok(await peopleFor(ctx));
}

export async function POST(request: Request) {
  const ctx = await requireMobile(request, "workboard");
  if (ctx instanceof Response) return ctx;
  const b = (await request.json().catch(() => null)) as { what?: unknown; where?: unknown; staff?: unknown; day?: unknown; from?: unknown; to?: unknown } | null;
  if (!b) return no("Say what to block out.");

  const staff = typeof b.staff === "string" ? b.staff.trim() : "";
  const { people } = await peopleFor(ctx);
  if (!people.some((p) => p.uuid.toLowerCase() === staff.toLowerCase())) return no(runsBoard(ctx) ? "Choose who." : "You can only block out your own time.", 403);

  const from = minutesOf(b.from);
  const to = minutesOf(b.to);
  if (from === null || to === null) return no("Choose from and to.");
  if (to <= from) return no("It has to end after it starts.");

  const press = sm8LeaveAllowed() ? await sm8PressFromMobile(ctx).catch(() => null) : null;
  const by = await staffProfileIdFor(ctx.orgId, ctx.userId).catch(() => null);
  const r = await createBlock(
    ctx.orgId,
    by,
    { what: b.what, where: b.where, minutes: to - from, place: { staffUuid: staff, day: typeof b.day === "string" ? b.day : "", startMin: from } },
    press,
  );
  if (!r.ok) return no(r.error);
  return ok({ id: r.id, note: r.note });
}
