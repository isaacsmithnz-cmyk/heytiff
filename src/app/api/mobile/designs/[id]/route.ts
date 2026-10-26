import { readDesign } from "@/lib/mobile/designs";
import { ok, requireMobile } from "@/lib/mobile/auth";

/* ONE DESIGN, as the phone draws it (lib/mobile/designs): its floors'
   plans, rooms and units, and its headline figures. Behind `studio`; only
   ever read inside the verified workspace, so an id from another business
   is "not here". */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireMobile(request, "studio");
  if (ctx instanceof Response) return ctx;
  const { id } = await params;
  const design = await readDesign(ctx.orgId, id.trim().slice(0, 80));
  if (!design) return Response.json({ error: "That design isn't here." }, { status: 404, headers: { "cache-control": "no-store" } });
  return ok(design);
}
