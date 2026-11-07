import { supabaseAdmin } from "@/lib/supabase-server";
import { LOCAL_ORG, PLANS_BUCKET, isLocal, notHere } from "../../local";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  if (!isLocal()) return notHere();
  const ref = new URL(request.url).searchParams.get("ref") ?? "";
  if (!ref.startsWith(`org/${LOCAL_ORG}/`)) return Response.json({ error: "not this workspace's" }, { status: 400 });
  const { data, error } = await supabaseAdmin.storage.from(PLANS_BUCKET).createSignedUrl(ref, 3600);
  if (error || !data) return Response.json({ error: error?.message ?? "no url" }, { status: 500 });
  return Response.json({ url: data.signedUrl });
}
