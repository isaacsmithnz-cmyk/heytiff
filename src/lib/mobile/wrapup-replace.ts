import "server-only";
import { takeBackJobNote } from "@/app/actions/job-note-sm8";
import { staffProfileIdFor } from "@/lib/fleet/query";
import { sm8NotesAllowed } from "@/lib/integrations/sm8-kinds";
import { actAsPhoneUser, type MobileCtx } from "@/lib/mobile/auth";
import { supabaseAdmin } from "@/lib/supabase-server";
import { filedNote, headOfNote } from "./day-writeup";

/* A WRAP-UP NOTE, CHANGED (Isaac, 11 November 2026: "I accidentally tapped
   something on what did you do on the job, and I couldn't go back to it to
   edit it"). Going back in the wrap-up and changing a note that's already in
   must not leave two on the job, in HeyTiff or ServiceM8: the one in for
   this stretch (your own note on the job, since the day worked, opening
   with the same who and when) is taken back the way the job sheet's Remove
   takes one back, and the changed words go in as the note. Found here by
   its first line, so it works whoever filed it: Save, Tiff, or an earlier
   sitting of the wrap-up. */

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** `same`: the note in is these very words, nothing to do. `replaced`: it's
    taken back, write the new one. `none`: nothing was in for this stretch. */
export async function replaceWrapupNote(ctx: MobileCtx, jobUuid: string, body: string, on: string): Promise<"same" | "replaced" | "none"> {
  const head = headOfNote(body);
  if (!DAY.test(on) || !head.includes(" to ")) return "none";
  const staffId = await staffProfileIdFor(ctx.orgId, ctx.userId).catch(() => null);
  if (!staffId) return "none";
  /* a day's wrap-up is filed on that day or after it; 14 hours covers every clock the day could be on */
  const since = new Date(Date.parse(`${on}T00:00:00Z`) - 14 * 3_600_000).toISOString();
  const { data } = await supabaseAdmin
    .from("workboard_notes")
    .select("id, target_id, transcript, created_at")
    .eq("org_id", ctx.orgId)
    .eq("author_id", staffId)
    .eq("target_kind", "job")
    .in("target_id", [...new Set([jobUuid, jobUuid.toLowerCase()])])
    .gte("created_at", since)
    .is("removed_at", null)
    .order("created_at", { ascending: false });
  const rows = ((data ?? []) as { id: string; target_id: string; transcript: string | null; created_at: string }[]).map((r) => ({ ...r, at: r.created_at, text: (r.transcript ?? "").trim() }));
  const hit = filedNote(head, rows);
  if (!hit) return "none";
  if (hit.text === body.trim()) return "same";

  if (sm8NotesAllowed()) {
    await actAsPhoneUser(ctx, () => takeBackJobNote({ jobUuid: hit.target_id, noteId: hit.id })).catch(() => null);
  } else {
    /* a deployment that sends no notes: nothing of it is anywhere else */
    await supabaseAdmin.from("workboard_notes").update({ removed_at: new Date().toISOString() }).eq("org_id", ctx.orgId).eq("id", hit.id).is("removed_at", null);
  }
  /* taken back, or the changed words would be a second note */
  const { data: now } = await supabaseAdmin.from("workboard_notes").select("removed_at").eq("org_id", ctx.orgId).eq("id", hit.id).maybeSingle();
  if (now && !(now as { removed_at: string | null }).removed_at) throw new Error("Couldn't change that note. Try again.");
  return "replaced";
}
