import { loadBrandPack } from "@/lib/studio/packs/design-packs-server";
import { isLocal, notHere } from "../../local";

export const runtime = "nodejs";

/* one brand's pack, as the Studio's loadStudioPack hands it: ?brand=daikin */
export async function GET(req: Request): Promise<Response> {
  if (!isLocal()) return notHere();
  const brand = new URL(req.url).searchParams.get("brand") ?? "";
  if (!/^[a-z0-9-]+$/.test(brand)) return Response.json(null);
  return Response.json(await loadBrandPack(brand));
}
