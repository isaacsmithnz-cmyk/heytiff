import "server-only";
import { supabaseAdmin } from "@/lib/supabase-server";

/** Whether a stored file is a job's plan: its source, one of its pages, or a
    page's small picture. A design made from a job's plans shows the job's own
    pages, so nothing a design does may delete one (Isaac, 14 November 2026:
    one set of plans, on the job). A lookup that fails says yes: a file left
    behind costs nothing, a plan deleted is gone. */
export async function planFileOnAJob(orgId: string, ref: string): Promise<boolean> {
  const rows = () => supabaseAdmin.from("job_plans").select("id").eq("org_id", orgId).limit(1);
  const asked = await Promise.all([rows().eq("source_ref", ref), rows().contains("pages", [{ ref }]), rows().contains("pages", [{ preview: ref }])]);
  return asked.some((a) => !!a.error || (a.data ?? []).length > 0);
}
