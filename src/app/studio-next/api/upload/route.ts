import { supabaseAdmin } from "@/lib/supabase-server";
import { newId } from "@/lib/studio/document";
import { LOCAL_ORG, PLANS_BUCKET, isLocal, notHere } from "../../local";

export const runtime = "nodejs";

/* a page raster or the uploaded set, stored where the app stores plans */
export async function POST(request: Request): Promise<Response> {
  if (!isLocal()) return notHere();
  const ext = new URL(request.url).searchParams.get("ext") ?? "png";
  if (!/^(png|jpeg|pdf)$/.test(ext)) return Response.json({ error: "png, jpeg or pdf" }, { status: 400 });
  const ref = `org/${LOCAL_ORG}/${newId("plan")}.${ext}`;
  const bytes = Buffer.from(await request.arrayBuffer());
  const { error } = await supabaseAdmin.storage
    .from(PLANS_BUCKET)
    .upload(ref, bytes, { contentType: request.headers.get("content-type") ?? "application/octet-stream" });
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ref });
}
