import { supabaseAdmin } from "@/lib/supabase-server";
import { LOCAL_ORG, PLANS_BUCKET, isLocal, notHere } from "../../local";

export const runtime = "nodejs";

/* a plan sent up early for a design that was never made (new-design.tsx) */
export async function POST(request: Request): Promise<Response> {
  if (!isLocal()) return notHere();
  const { ref } = (await request.json()) as { ref?: string };
  if (!ref || !new RegExp(`^org/${LOCAL_ORG}/plan_[a-z0-9]+\\.(png|jpeg|pdf)$`).test(ref))
    return Response.json({ error: "not one of this section's plans" }, { status: 400 });
  const { error } = await supabaseAdmin.storage.from(PLANS_BUCKET).remove([ref]);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ ok: true });
}
