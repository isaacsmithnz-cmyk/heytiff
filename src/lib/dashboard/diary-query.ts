/* THE DIARY'S READS — one call for the new Home's Diary tab. Server only.

   Your own entries always (journal-query's listDiaryEntries, person-scoped:
   only the author reads a diary), and the ServiceM8 notes that @mention you
   when there is a you to mention: `workboard`, a staff card, and a link in
   integration_links. Without any of those the diary is your own entries,
   on Sydney's day when there is no ServiceM8 clock to use, which is what
   the diary has always been. Where the deployment sends notes, a reply of
   yours from HeyTiff goes into the conversation holding the note it
   answers, rather than standing on its own (./diary-reply).

   Built for Home's loader (desk-data's `loadDesk`). The context is the
   loader's own; this takes the part of it it needs. */

import { sm8NotesAllowed } from "@/lib/integrations/sm8-kinds";
import type { Capability } from "@/lib/permissions";
import { supabaseAdmin } from "@/lib/supabase-server";
import { plusDays } from "@/lib/workboard/dates";
import { naiveInZone } from "@/lib/workboard/job-story";
import {
  DIARY_ENTRY_LIMIT,
  MENTION_DAYS,
  diaryFeed,
  sortStamp,
  type DiaryConversation,
  type DiaryFeed,
  type OurReply,
} from "./diary-feed";
import { repliesPutAway, unhidden } from "./diary-hidden";
import type { DiaryEntry } from "./journal";
import { listDiaryEntries, listDiaryReplies, replyViewerOf } from "./journal-query";
import { listMyMentions } from "./mentions-query";

/** What the diary needs from the new Home's loader context. */
export type DiaryFeedContext = {
  orgId: string;
  viewerStaffId: string | null;
  caps: ReadonlySet<Capability>;
  /** The ServiceM8 account's zone, or null (Sydney). */
  tz: string | null;
  /** Today on that clock. */
  railDay: string;
  /** Which ServiceM8 person integration_links says the viewer is. */
  mineUuid: string | null;
};

/** When the mirror last finished a sync — the row sm8SyncIsStale reads. */
export async function mirrorSyncedAt(orgId: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from("sm8_sync_runs")
    .select("last_finished_at")
    .eq("org_id", orgId)
    .maybeSingle();
  return (data as { last_finished_at: string | null } | null)?.last_finished_at ?? null;
}

/** The conversations this person hid from their diary, and when, on the
    account's clock (actions/diary's `hideConversation`). A read that fails
    — or a database without the table yet — hides nothing: every
    conversation shows, as it did before there was a Hide. */
export async function hiddenConversations(
  orgId: string,
  staffId: string,
  tz: string | null,
): Promise<Map<string, string>> {
  const { data, error } = await supabaseAdmin
    .from("diary_hidden")
    .select("conversation_key, hidden_at")
    .eq("org_id", orgId)
    .eq("staff_id", staffId);
  const hidden = new Map<string, string>();
  if (error) return hidden;
  for (const r of (data ?? []) as { conversation_key: string; hidden_at: string }[]) {
    const at = naiveInZone(r.hidden_at, tz);
    if (at) hidden.set(r.conversation_key, at);
  }
  return hidden;
}

/** The Diary tab: your entries and your conversations, newest first, with
    Today split off. A mention read that fails leaves the diary showing
    your own entries rather than taking Home down. A conversation you hid
    stays out until its asker writes again, or you reply in it from
    HeyTiff, and your replies in it stay out with it (./diary-hidden). */
export async function loadDiaryFeed(ctx: DiaryFeedContext): Promise<DiaryFeed> {
  const mineUuid = ctx.caps.has("workboard") && ctx.viewerStaffId ? ctx.mineUuid : null;
  /* YOUR REPLIES FROM HEYTIFF, and a task's Done (two-way phase 2,
     ./diary-reply), are threaded where the note each answers is — only
     where the deployment sends notes and there are conversations to hold
     them. With files only, every read here is asked exactly as before. */
  const staffId = mineUuid && sm8NotesAllowed() ? ctx.viewerStaffId : null;
  /* who you are to ServiceM8, read once for both reads of your replies */
  const viewer = staffId ? replyViewerOf(ctx.orgId, staffId) : null;

  const entryRead = !ctx.viewerStaffId
    ? Promise.resolve([] as DiaryEntry[])
    : viewer
      ? listDiaryEntries(ctx.orgId, ctx.viewerStaffId, ctx.tz, DIARY_ENTRY_LIMIT, viewer)
      : listDiaryEntries(ctx.orgId, ctx.viewerStaffId, ctx.tz);
  /* Your replies over the mentions' reach, on their own: one older than
     your newest DIARY_ENTRY_LIMIT entries is still in its thread, and one
     you took back is there while something of it may be in ServiceM8. */
  const replyRead =
    staffId && viewer
      ? listDiaryReplies(ctx.orgId, staffId, ctx.tz, plusDays(ctx.railDay, -MENTION_DAYS), viewer).catch(
          (err: unknown): DiaryEntry[] => {
            console.error(
              `[diary] couldn't read org ${ctx.orgId}'s replies: ${err instanceof Error ? err.message : String(err)}`
            );
            return [];
          },
        )
      : null;
  /* handed to the mentions read as the two come back, so the reads still
     run side by side; a read that failed leaves its replies out */
  const replies = replyRead
    ? Promise.all([entryRead.then(repliesIn, () => []), replyRead.then(repliesIn)]).then(([a, b]) => onceEach([...a, ...b]))
    : null;

  const [entries, conversations, syncedAt, hidden, yours] = await Promise.all([
    entryRead,
    mineUuid
      ? /* with the tasks the viewer's asks made (mention_asks) */
        listMyMentions(
          ctx.orgId,
          mineUuid,
          ctx.railDay,
          replies ? { staffId: ctx.viewerStaffId, replies } : { staffId: ctx.viewerStaffId },
        ).catch(
          (err: unknown): DiaryConversation[] => {
            console.error(
              `[diary] couldn't read the mentions for org ${ctx.orgId}: ${err instanceof Error ? err.message : String(err)}`
            );
            return [];
          },
        )
      : Promise.resolve([] as DiaryConversation[]),
    mineUuid ? mirrorSyncedAt(ctx.orgId).catch(() => null) : Promise.resolve(null),
    mineUuid && ctx.viewerStaffId
      ? hiddenConversations(ctx.orgId, ctx.viewerStaffId, ctx.tz).catch(() => new Map<string, string>())
      : Promise.resolve(new Map<string, string>()),
    replyRead ?? Promise.resolve([] as DiaryEntry[]),
  ]);

  /* listDiaryEntries reads DIARY_ENTRY_LIMIT; a full read may have left
     older entries unread, and the column stops where they do. */
  const cut = entries.length >= DIARY_ENTRY_LIMIT;
  const shown = unhidden(conversations, hidden);
  return diaryFeed({
    entries: [...entries, ...takenBackIn(yours, entries, cut)],
    conversations: shown,
    day: ctx.railDay,
    mentions: mineUuid !== null,
    entriesCut: cut,
    syncedAt,
    putAway: repliesPutAway(conversations, shown),
  });
}

/** Your entries that are replies to a ServiceM8 note, as a conversation
    threads them. */
function repliesIn(entries: readonly DiaryEntry[]): OurReply[] {
  return entries.flatMap((e) =>
    e.reply
      ? [
          {
            id: e.id,
            to: e.reply.to,
            jobUuid: e.reply.jobUuid,
            words: e.reply.words,
            at: e.reply.at,
            savedAt: e.reply.savedAt,
            line: e.reply.line,
            ...(e.reply.takenBack ? { takenBack: true as const } : {}),
          },
        ]
      : [],
  );
}

/** Each reply once, as the first read to hand it in has it. */
function onceEach(replies: readonly OurReply[]): OurReply[] {
  const seen = new Set<string>();
  const out: OurReply[] = [];
  for (const r of replies) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    out.push(r);
  }
  return out;
}

/** A reply you took back that may still be in ServiceM8 is no entry of the
    entry read, which reads nothing taken back. It is drawn in its thread;
    for when no conversation on the page holds it, it is one of your
    entries too (diaryFeed draws only what no conversation holds) — within
    the stretch the entry read covers, so the column still reaches back
    only as far as both sources do. */
function takenBackIn(replies: readonly DiaryEntry[], entries: readonly DiaryEntry[], cut: boolean): DiaryEntry[] {
  const ids = new Set(entries.map((e) => e.id));
  const reach = cut ? entries.map((e) => sortStamp(e.stamp)).reduce((min, s) => (s && s < min ? s : min), "~") : "";
  return replies.filter((e) => e.reply?.takenBack && !ids.has(e.id) && sortStamp(e.stamp) >= reach);
}
