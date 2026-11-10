import "server-only";

import { supabaseAdmin } from "@/lib/supabase-server";

/* A TASK TIFF MADE FROM YOUR WORDS RINGS ITS PERSON'S PHONE, as one given
   with Add task does (actions/dashboard ringTheirPhone). Before, a note's task
   for someone else waited in their To do for the next time they opened the
   app (Isaac, 10 November 2026: "Can you let Luke know that Jay Matthews' job
   is ready to book in?"). Your own task is yours already: no ring. After the
   answer, and never in the way of the task being made. */
export async function ringForTasks(orgId: string, giver: string | null, tasks: readonly { assigned_to: string | null; title: string }[]): Promise<void> {
  const theirs = tasks.filter((t) => t.assigned_to && t.assigned_to !== giver);
  if (theirs.length === 0) return;
  try {
    const [{ after }, { pushToStaff }] = await Promise.all([import("next/server"), import("@/lib/mobile/push")]);
    after(async () => {
      const { data: who } = giver
        ? await supabaseAdmin.from("staff_profiles").select("full_name").eq("org_id", orgId).eq("id", giver).maybeSingle()
        : { data: null };
      const name = (who as { full_name: string | null } | null)?.full_name?.trim();
      for (const t of theirs) {
        await pushToStaff(orgId, [t.assigned_to!], { title: name ? `${name} gave you a task` : "A task for you", body: t.title || null });
      }
    });
  } catch (err) {
    console.error(`[push] couldn't ring the phone for a note's task in org ${orgId}: ${err instanceof Error ? err.message : String(err)}`);
  }
}
