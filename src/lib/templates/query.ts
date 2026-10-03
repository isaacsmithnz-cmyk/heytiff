import { supabaseAdmin } from "@/lib/supabase-server";
import { standardTemplates, templatesFrom, type OrgTemplates } from "./settings";

/** The business's templates: its own where it has changed one, the
    standard wording where it hasn't. A failed read is the standard wording,
    never an error: a quote or a project shouldn't stop for this. */
export async function orgTemplates(orgId: string): Promise<OrgTemplates> {
  const { data, error } = await supabaseAdmin.from("org_templates").select("key, value, updated_at").eq("org_id", orgId);
  if (error || !data) return standardTemplates();
  return templatesFrom(data as { key: string; value: unknown; updated_at: string }[]);
}
