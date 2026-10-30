import { searchLibrary } from "@/lib/mobile/library-search";
import { ok, requireMobile } from "@/lib/mobile/auth";

/* SEARCHING EVERY MANUAL from the phone's Library box as you type, behind
   the Library's own `tiff` grant: the manuals whose names say it and the
   pages that say it (lib/mobile/library-search). No model, nothing spent. */
export async function GET(request: Request) {
  const ctx = await requireMobile(request, "tiff");
  if (ctx instanceof Response) return ctx;
  return ok(await searchLibrary(ctx.orgId, new URL(request.url).searchParams.get("q") ?? ""));
}
