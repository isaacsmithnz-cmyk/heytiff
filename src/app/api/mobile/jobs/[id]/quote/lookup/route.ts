import { requireMobile } from "@/lib/mobile/auth";
import { phoneLookup } from "@/lib/mobile/phone-quote-server";

/* THE BOOK, SEARCHED FOR A SWAP FROM THE PHONE (6 November 2026): the web's
   own lookup as the token's person, so it needs what the web's needs, Make
   and change jobs and Money on jobs. `?q=return air&size=400`. */

export async function GET(request: Request) {
  const ctx = await requireMobile(request, "workboard");
  if (ctx instanceof Response) return ctx;
  const p = new URL(request.url).searchParams;
  const size = Number(p.get("size"));
  return phoneLookup(ctx, (p.get("q") ?? "").slice(0, 120), Number.isFinite(size) && size > 0 && size < 2000 ? size : null);
}
