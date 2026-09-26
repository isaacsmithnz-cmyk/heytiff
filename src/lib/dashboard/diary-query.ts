/* THE DIARY'S READS — one call for the new Home's Diary tab. Server only.

   Your own entries always (journal-query's listDiaryEntries, person-scoped:
   only the author reads a diary), and the ServiceM8 notes that @mention you
   when there is a you to mention: `workboard`, a staff card, and a link in
   integration_links. Without any of those the diary is your own entries,
   on Sydney's day when there is no ServiceM8 clock to use, which is what
   the diary has always been.

   Built for the new Home's loader (desk-data's `loadDesk`), which runs only
   for a viewer the HOME_DESK flag gives the new Home, so nobody on today's
   Home pays for a read here. The context is the loader's own; this takes
   the part of it it needs. */

import type { Capability } from "@/lib/permissions";
import { supabaseAdmin } from "@/lib/supabase-server";
import { naiveInZone } from "@/lib/workboard/job-story";
import { DIARY_ENTRY_LIMIT, diaryFeed, type DiaryConversation, type DiaryFeed } from "./diary-feed";
import { unhidden } from "./diary-hidden";
import { listDiaryEntries } from "./journal-query";
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
    stays out until its asker writes again (./diary-hidden). */
export async function loadDiaryFeed(ctx: DiaryFeedContext): Promise<DiaryFeed> {
  const mineUuid = ctx.caps.has("workboard") && ctx.viewerStaffId ? ctx.mineUuid : null;

  const [entries, conversations, syncedAt, hidden] = await Promise.all([
    ctx.viewerStaffId ? listDiaryEntries(ctx.orgId, ctx.viewerStaffId, ctx.tz) : Promise.resolve([]),
    mineUuid
      ? /* with the tasks the viewer's asks made (mention_asks) */
        listMyMentions(ctx.orgId, mineUuid, ctx.railDay, { staffId: ctx.viewerStaffId }).catch(
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
  ]);

  return diaryFeed({
    entries,
    conversations: unhidden(conversations, hidden),
    day: ctx.railDay,
    mentions: mineUuid !== null,
    /* listDiaryEntries reads DIARY_ENTRY_LIMIT; a full read may have left
       older entries unread, and the column stops where they do. */
    entriesCut: entries.length >= DIARY_ENTRY_LIMIT,
    syncedAt,
  });
}
