import { libraryPacks, libraryUnits } from "@/lib/library/packs-server";
import { combine } from "@/lib/library/data-pack";
import { ok, requireMobile } from "@/lib/mobile/auth";

/* DATA PACK'S COMBINE from the phone: an outdoor unit and the heads chosen
   for it, port by port, checked as the system builder checks them (the
   Studio's own multi rule and combination table, or a split's pair). Says
   which heads the outdoor takes, so only those are offered. Body:
   { outdoor: "o:<brand>:<model>", heads: ["i:<brand>:<model>", ...] }. */
export async function POST(request: Request) {
  const ctx = await requireMobile(request, "tiff");
  if (ctx instanceof Response) return ctx;
  const body = (await request.json().catch(() => null)) as { outdoor?: unknown; heads?: unknown } | null;
  const outdoor = typeof body?.outdoor === "string" ? body.outdoor.slice(0, 200) : "";
  const heads = Array.isArray(body?.heads) ? body.heads.filter((h): h is string => typeof h === "string").slice(0, 16) : [];
  const [packs, units] = await Promise.all([libraryPacks(), libraryUnits()]);
  const combined = combine(packs, units, outdoor, heads);
  if (!combined) return Response.json({ error: "That outdoor unit isn't in the data packs." }, { status: 404 });
  return ok(combined);
}
