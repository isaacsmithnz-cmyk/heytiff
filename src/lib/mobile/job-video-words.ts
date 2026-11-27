import "server-only";
import { supabaseAdmin } from "@/lib/supabase-server";
import { DOCUMENTS_BUCKET } from "@/lib/documents/query";
import { isVideoMime } from "@/lib/documents/files";
import { spokenStaffNames } from "@/lib/staff/aliases-query";
import { transcribeTimed, TRADE_KEYTERMS } from "@/lib/voice/transcribe";
import { writeJobNote } from "@/lib/workboard/job-note-write";
import { getSm8Timezone } from "@/lib/workboard/query";
import { cuesOf, wordsRefOf, type VideoWords } from "@/lib/jobs/video-cues";

/* A JOB VIDEO'S WORDS, once it's in (lib/jobs/video-cues says why). After
   the phone's upload lands: the video goes to Scribe as it is, and what was
   said is kept twice, as captions beside the video in storage (the phone
   shows them as it plays) and as a note on the job's diary in HeyTiff,
   "From the video at 9:43: …", so the words are read and found like any
   note. The note's id is the video's own, so a second run is one note.

   Nothing said (a silent clip, or only noise) keeps nothing. Every failure is
   a log line and nothing else: the video itself is already on the job. The
   note stays in HeyTiff; ServiceM8 already has the video. */

const clockIn = (iso: string, zone: string | null) =>
  new Intl.DateTimeFormat("en-AU", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: zone ?? "Australia/Sydney" })
    .format(new Date(iso))
    .replace(/\s/g, " ")
    .toLowerCase();

export async function keepVideoWords(input: { orgId: string; userId: string; jobUuid: string; documentId: string }): Promise<"kept" | "nothing" | "failed"> {
  const { orgId, userId, jobUuid, documentId } = input;
  const { data } = await supabaseAdmin
    .from("documents")
    .select("kind, mime_type, storage_ref, uploaded_at, sm8_job_uuid")
    .eq("org_id", orgId)
    .eq("id", documentId)
    .maybeSingle();
  const doc = data as { kind: string; mime_type: string; storage_ref: string; uploaded_at: string | null; sm8_job_uuid: string | null } | null;
  if (!doc || doc.kind !== "job_photo" || !isVideoMime(doc.mime_type) || !doc.uploaded_at || doc.sm8_job_uuid !== jobUuid) return "nothing";

  const file = await supabaseAdmin.storage.from(DOCUMENTS_BUCKET).download(doc.storage_ref);
  if (file.error || !file.data) {
    console.error(`[video-words] ${documentId} couldn't be read: ${file.error?.message ?? "no bytes"}`);
    return "failed";
  }
  const names = await spokenStaffNames(orgId).catch(() => [] as string[]);
  const heard = await transcribeTimed(file.data, "video.mp4", { keyterms: [...names, ...TRADE_KEYTERMS] });
  if (!heard.ok) {
    /* "Nothing was said" is a silent clip, not a fault */
    if (/Nothing was said/.test(heard.error)) return "nothing";
    console.error(`[video-words] ${documentId}: ${heard.error}`);
    return "failed";
  }

  const words: VideoWords = { v: 1, text: heard.text, cues: cuesOf(heard.words) };
  const up = await supabaseAdmin.storage
    .from(DOCUMENTS_BUCKET)
    .upload(wordsRefOf(doc.storage_ref), JSON.stringify(words), { contentType: "text/plain", upsert: true });
  if (up.error) console.error(`[video-words] ${documentId} captions not kept: ${up.error.message}`);

  const zone = await getSm8Timezone(orgId).catch(() => null);
  try {
    await writeJobNote({ orgId, userId, jobUuid, body: `From the video at ${clockIn(doc.uploaded_at, zone)}: ${heard.text}`, composeId: documentId });
  } catch (e) {
    console.error(`[video-words] ${documentId} note not kept: ${e instanceof Error ? e.message : String(e)}`);
  }
  console.info(`[video-words] ${documentId} kept ${heard.text.length} chars, ${words.cues.length} captions`);
  return "kept";
}
