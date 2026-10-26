import { readScene } from "@/lib/mobile/designs";
import { ok, requireMobile } from "@/lib/mobile/auth";

/* ONE DESIGN IN 3D, for the phone to hand to the web's own 3D view
   (lib/mobile/designs, app/phone/3d). Behind `studio`, inside the verified
   workspace, like the design it is of. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireMobile(request, "studio");
  if (ctx instanceof Response) return ctx;
  const { id } = await params;
  const scene = await readScene(ctx.orgId, id.trim().slice(0, 80));
  if (!scene) return Response.json({ error: "That design isn't here." }, { status: 404, headers: { "cache-control": "no-store" } });
  return ok(scene);
}
