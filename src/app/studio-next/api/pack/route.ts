import { latestInstalledPack } from "@/lib/studio/packs/server";
import { loadPackWithOverrides } from "@/lib/studio/packs/overrides-server";
import { isLocal, notHere } from "../../local";

export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  if (!isLocal()) return notHere();
  const latest = await latestInstalledPack("mitsubishi-electric");
  if (!latest) return Response.json(null);
  const { pack } = await loadPackWithOverrides("mitsubishi-electric", latest.version);
  return Response.json({ pack, version: latest.version });
}
