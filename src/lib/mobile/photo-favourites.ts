import "server-only";

import { supabaseAdmin } from "@/lib/supabase-server";
import { listJobPhotoFavourites, setJobPhotoFavourite } from "@/app/actions/job-photo-favourites";
import { resolveJobCard } from "@/lib/workboard/all-jobs-query";
import { actAsPhoneUser, type MobileCtx } from "./auth";

/* A JOB'S FAVOURITE PHOTOS FROM THE PHONE (Isaac, 11 November 2026, of the
   phone's gallery: "allow me to add as favorites"). The web's own stars
   (actions/job-photo-favourites), as the phone user, so the board and the
   phone star the same photos.

   A star is kept on ServiceM8's copy of a photo. One taken with the phone
   shows as ours (`doc:<id>`) and is starred by the copy we sent it as (the
   attachment write's `remote_uuid`); one that hasn't reached ServiceM8 yet
   can't be starred yet. */

const DOC = "doc:";

/** Our photo's ServiceM8 copy, once it's there. */
async function copyOf(orgId: string, documentId: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from("sm8_writes")
    .select("remote_uuid")
    .eq("org_id", orgId)
    .eq("kind", "attachment")
    .eq("subject", `document:${documentId}`)
    .eq("status", "sent")
    .not("remote_uuid", "is", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as { remote_uuid: string | null } | null)?.remote_uuid ?? null;
}

/** The phone's ids of the starred photos on this job: ServiceM8's own, and ours by our id. */
export async function readPhoneFavourites(ctx: MobileCtx, jobId: string): Promise<string[]> {
  const { parentRemoteId } = await resolveJobCard(ctx.orgId, jobId);
  const stars = await actAsPhoneUser(ctx, () => listJobPhotoFavourites(parentRemoteId));
  const uuids = stars.map((s) => s.remoteId);
  if (uuids.length === 0) return [];
  const { data } = await supabaseAdmin
    .from("sm8_writes")
    .select("subject, remote_uuid")
    .eq("org_id", ctx.orgId)
    .eq("kind", "attachment")
    .in("remote_uuid", uuids);
  const ours = new Map<string, string>();
  for (const r of (data ?? []) as { subject: string | null; remote_uuid: string | null }[])
    if (r.remote_uuid && r.subject?.startsWith("document:")) ours.set(r.remote_uuid, `${DOC}${r.subject.slice("document:".length)}`);
  return uuids.flatMap((u) => [u, ...(ours.has(u) ? [ours.get(u)!] : [])]);
}

export type PhoneStar = { ok: boolean; starred: boolean; error: string | null };

/** Star or unstar one of the job's photos. */
export async function setPhoneFavourite(ctx: MobileCtx, jobId: string, remoteId: string, starred: boolean): Promise<PhoneStar> {
  const id = remoteId.trim().slice(0, 120);
  if (!id) return { ok: false, starred: !starred, error: "Which photo?" };
  const uuid = id.startsWith(DOC) ? await copyOf(ctx.orgId, id.slice(DOC.length)) : id;
  if (!uuid) return { ok: false, starred: !starred, error: "That photo can be a favourite once it's in ServiceM8." };
  const { parentRemoteId } = await resolveJobCard(ctx.orgId, jobId);
  const r = await actAsPhoneUser(ctx, () => setJobPhotoFavourite(parentRemoteId, uuid, starred));
  return { ok: r.ok, starred: r.starred, error: r.ok ? null : "That didn't save. Try it again." };
}
