import { ok, requireMobile } from "@/lib/mobile/auth";
import { readStock } from "@/lib/stock/stock-server";
import { stockPress, weekOf } from "@/lib/stock/stock-press";

/* STOCK for the phone (lib/stock/stock-server): the week as the web's Stock
   reads it (GET ?week=next|after|later), and (POST, by `do`, as
   lib/stock/stock-press reads it) "We've got N" of an item (`instock`), one
   item ordered (`order`), a supplier's lot sent (`ordered`), Later's bulk
   order (`bulk`), Already have them (`had`), Needed at (`needed`), an Undo
   (`back`), the option a client took (`option`) and a supplier's ordering
   site (`site`). Each POST hands back the week as it now stands. Behind
   `workboard`, as the web's is. */

const no = (error: string, status: number) => Response.json({ error }, { status, headers: { "cache-control": "no-store" } });

export async function GET(request: Request) {
  const ctx = await requireMobile(request, "workboard");
  if (ctx instanceof Response) return ctx;
  return ok(await readStock(ctx.orgId, weekOf(new URL(request.url).searchParams.get("week"))));
}

export async function POST(request: Request) {
  const ctx = await requireMobile(request, "workboard");
  if (ctx instanceof Response) return ctx;
  const b = ((await request.json().catch(() => null)) ?? {}) as Record<string, unknown>;
  const r = await stockPress(ctx.orgId, ctx.userId, b);
  if (!r) return no("What should happen?", 400);
  if (!r.ok) return no(r.reason, 409);
  return ok(await readStock(ctx.orgId, weekOf(b.week)));
}
