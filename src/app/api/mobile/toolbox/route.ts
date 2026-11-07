import { ok, requireMobile } from "@/lib/mobile/auth";
import { faultTrees, heatLoad, pressures, toolboxOptions } from "@/lib/mobile/toolbox";
import { kbCategoryCounts } from "@/lib/tiff/query";

/* THE TOOLBOX for the phone (lib/mobile/toolbox), behind the web's own
   `toolbox` gate. GET hands over what the tools offer and the Fault Finder's
   trees, with whether a code can be taken to the Library (the web's rule:
   only with Tiff, and only with something in it); POST works one sum. */
export async function GET(request: Request) {
  const ctx = await requireMobile(request, "toolbox");
  if (ctx instanceof Response) return ctx;
  let library: "ready" | "empty" | "off" = "off";
  if (ctx.caps.has("tiff")) {
    const counts = await kbCategoryCounts(ctx.orgId).catch(() => ({}) as Record<string, number>);
    library = Object.values(counts).reduce((sum, n) => sum + n, 0) > 0 ? "ready" : "empty";
  }
  return ok({ ...toolboxOptions(), trees: faultTrees(), library });
}

export async function POST(request: Request) {
  const ctx = await requireMobile(request, "toolbox");
  if (ctx instanceof Response) return ctx;
  const body = ((await request.json().catch(() => null)) ?? {}) as Record<string, unknown>;
  if (body.tool === "heat") return ok(heatLoad(body));
  if (body.tool === "pressures") return ok(pressures(body));
  return Response.json({ error: "Say which tool." }, { status: 400, headers: { "cache-control": "no-store" } });
}
