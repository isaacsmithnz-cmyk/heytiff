import { supabaseAdmin } from "@/lib/supabase-server";

/* Contribution recording — a lib on purpose, NOT a server action. It trusts
   the org/user the caller hands it (the save action derives both from its own
   session), so exporting it from a "use server" file made "write a
   contribution into any org as anyone" a public POST endpoint. Keeping it out
   of the action surface is the fix; only the reads stay actions. */

/** Record that `userId` just worked on this design. Called on save.
    first_at survives — only last_at moves — so the list keeps its order. */
export async function recordContribution(
  orgId: string,
  designId: string,
  userId: string
): Promise<void> {
  const now = new Date().toISOString();
  const { error } = await supabaseAdmin
    .from("studio_design_contributors")
    .upsert(
      { org_id: orgId, design_id: designId, user_id: userId, first_at: now, last_at: now },
      { onConflict: "org_id,design_id,user_id", ignoreDuplicates: false }
    );
  // A contribution is a footnote, never the point of the save — see the
  // caller, which deliberately swallows this.
  if (error) throw new Error(error.message);
}
