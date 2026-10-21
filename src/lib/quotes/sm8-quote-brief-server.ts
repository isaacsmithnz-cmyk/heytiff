import "server-only";
import { supabaseAdmin } from "@/lib/supabase-server";
import { sm8QuoteBrief } from "./sm8-quote-brief";

/* The quote ServiceM8 holds for a job, read from HeyTiff's mirror — its
   scope as written and its live line items — as the brief a new version
   starts from (sm8-quote-brief.ts says what's kept). Reads only: nothing
   goes to ServiceM8. Service role, by org; the route gates. */

export async function readSm8QuoteBrief(orgId: string, jobUuid: string): Promise<string | null> {
  const [{ data: job }, { data: lines }] = await Promise.all([
    supabaseAdmin.from("sm8_jobs").select("work_done_description").eq("org_id", orgId).eq("uuid", jobUuid).maybeSingle(),
    supabaseAdmin
      .from("sm8_job_materials")
      .select("name, quantity, price, active, sort_order")
      .eq("org_id", orgId)
      .eq("job_uuid", jobUuid)
      .order("sort_order", { ascending: true }),
  ]);
  const scope = (job as { work_done_description: string | null } | null)?.work_done_description ?? null;
  const live = ((lines ?? []) as { name: string | null; quantity: string | number | null; price: string | number | null; active: number | boolean | null }[])
    .filter((l) => l.active !== 0 && l.active !== false)
    .map((l) => {
      const n = Number(l.quantity);
      /* the sign kept: a negative line is billing (dropped) or something taken off */
      const price = Number(l.price);
      return { name: l.name ?? "", quantity: Number.isFinite(n) && n !== 0 ? n : null, priceCents: Number.isFinite(price) && price > 0 ? Math.round(price * 100) : null };
    });
  return sm8QuoteBrief({ scope, lines: live });
}
