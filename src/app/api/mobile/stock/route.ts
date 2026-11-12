import { ok, requireMobile } from "@/lib/mobile/auth";
import { markOrdered, putMarksBack, readStock, setInStock, takeOption } from "@/lib/stock/stock-server";
import type { Week } from "@/lib/stock/stock";

/* STOCK for the phone (lib/stock/stock-server): the week as the web's Stock
   reads it (GET ?week=next|after), and (POST, by `do`) "We've got N" of an
   item (`instock`, `total` null for all of them), an order sent to a
   supplier (`ordered`), its Undo (`back`), and the option a client took
   (`option`). Each POST hands back the week as it now stands. Behind
   `workboard`, as the web's is. */

const no = (error: string, status: number) => Response.json({ error }, { status, headers: { "cache-control": "no-store" } });
const weekOf = (w: unknown): Week => (w === "after" ? "after" : "next");
const count = (n: unknown) => (typeof n === "number" && Number.isFinite(n) ? Math.max(0, Math.min(10_000, Math.round(n))) : null);

export async function GET(request: Request) {
  const ctx = await requireMobile(request, "workboard");
  if (ctx instanceof Response) return ctx;
  return ok(await readStock(ctx.orgId, weekOf(new URL(request.url).searchParams.get("week"))));
}

export async function POST(request: Request) {
  const ctx = await requireMobile(request, "workboard");
  if (ctx instanceof Response) return ctx;
  const b = ((await request.json().catch(() => null)) ?? {}) as Record<string, unknown>;
  const week = weekOf(b.week);
  const r =
    b.do === "instock" && typeof b.key === "string"
      ? await setInStock(ctx.orgId, ctx.userId, week, b.key, b.total === null ? null : count(b.total))
      : b.do === "ordered"
        ? await markOrdered(ctx.orgId, ctx.userId, week, typeof b.supplier === "string" && b.supplier ? b.supplier.slice(0, 40) : null)
        : b.do === "back" && Array.isArray(b.rows)
          ? await putMarksBack(
              ctx.orgId,
              (b.rows as Record<string, unknown>[])
                .slice(0, 500)
                .filter((x) => typeof x?.uuid === "string" && typeof x?.key === "string")
                .map((x) => ({ uuid: String(x.uuid), key: String(x.key).slice(0, 120), inStock: count(x.inStock) ?? 0, ordered: count(x.ordered) ?? 0 })),
            )
          : b.do === "option" && typeof b.job === "string"
            ? await takeOption(ctx.orgId, ctx.userId, b.job, count(b.option) ?? 0)
            : null;
  if (!r) return no("What should happen?", 400);
  if (!r.ok) return no(r.reason, 409);
  return ok(await readStock(ctx.orgId, week));
}
