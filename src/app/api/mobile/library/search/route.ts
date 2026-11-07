import { searchLibrary } from "@/lib/mobile/library-search";
import { ok, requireMobile } from "@/lib/mobile/auth";

/* SEARCHING EVERY MANUAL from the phone's Library box as you type, behind
   the Library's own `tiff` grant: the manuals whose names say it and the
   pages that say it (lib/mobile/library-search). No model, nothing spent. */
export async function GET(request: Request) {
  const ctx = await requireMobile(request, "tiff");
  if (ctx instanceof Response) return ctx;
  const params = new URL(request.url).searchParams;
  /* from a brand's own page: that brand's manuals only */
  const brand = params.get("brand")?.trim().slice(0, 120) || null;
  return ok(await searchLibrary(ctx.orgId, params.get("q") ?? "", brand));
}
