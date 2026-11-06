import { ok, requireMobile } from "@/lib/mobile/auth";
import { markInfoRead, readInfoRead } from "@/lib/tiff/info-read-server";

/* The little i on Tiff's arrow, from the phone: the same mark as the web's
   (api/tiff/info-read), for the person the phone's token check verified.
   GET reads it (`read: null` where it isn't kept); POST marks it read. */

export async function GET(request: Request) {
  const ctx = await requireMobile(request);
  if (ctx instanceof Response) return ctx;
  return ok({ read: await readInfoRead(ctx.userId) });
}

export async function POST(request: Request) {
  const ctx = await requireMobile(request);
  if (ctx instanceof Response) return ctx;
  return ok({ ok: await markInfoRead(ctx.userId) });
}
