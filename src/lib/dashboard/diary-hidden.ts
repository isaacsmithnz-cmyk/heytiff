/* THE CONVERSATIONS YOU HID — pure. Isaac, 2026-09-26: "the option to
   hide/archive other peoples" in the diary, which come back when they
   write again (actions/diary's `hideConversation`, and docs/migrations/
   diary_hidden.sql).

   A conversation is keyed as the diary keys it, `${jobUuid}:${askerUuid}`
   (./diary-feed's `DiaryConversation.key`). It stays out of the diary
   while its asker's newest message is no newer than the minute you hid it:
   an answer, or a new ask on the same job, brings it back. Both stamps are
   the account's own clock, naive, so they compare as text — to the
   minute, since that is all `naiveInZone` says of the hiding.

   YOUR REPLIES IN IT (two-way phase 2, ./diary-reply): a reply you sent
   from a job card, or a task's Done, is threaded in the conversation
   holding the note it answers, so it goes out of the diary with it and
   comes back with it — never left behind as an entry of its own
   (`repliesPutAway`). One saved after you hid it is you writing in it
   again, and brings it back as their writing does: a reply of yours is an
   entry of your diary, and never goes out of it unseen. An answer you
   wrote in ServiceM8 was never an entry of yours, and leaves it hidden. */

import type { DiaryConversation } from "./diary-feed";

const PART = /^[\w-]{1,80}$/;

/** The shape of a conversation's key: two ids and a colon. */
export function isConversationKey(key: unknown): key is string {
  if (typeof key !== "string") return false;
  const parts = key.split(":");
  return parts.length === 2 && parts.every((p) => PART.test(p));
}

/** The conversations still in the diary: all but those hidden since their
    asker last wrote, or you last replied in them from HeyTiff. `hidden`
    maps a key to when it was hidden, naive on the account's clock
    ("2026-09-26 14:05"). */
export function unhidden(
  conversations: readonly DiaryConversation[],
  hidden: ReadonlyMap<string, string>,
): DiaryConversation[] {
  if (hidden.size === 0) return [...conversations];
  return conversations.filter((c) => {
    const at = hidden.get(c.key)?.slice(0, 16);
    return (
      at === undefined ||
      c.lastTheirs.slice(0, 16) > at ||
      c.messages.some((m) => !!m.ours && m.at.slice(0, 16) > at)
    );
  });
}

/** Your replies from HeyTiff in the conversations the diary leaves out
    (`all` less `shown`): they went with them, and are not drawn on their
    own (./diary-feed's diaryFeed, `putAway`). */
export function repliesPutAway(
  all: readonly DiaryConversation[],
  shown: readonly DiaryConversation[],
): Set<string> {
  const on = new Set(shown.map((c) => c.key));
  return new Set(
    all.filter((c) => !on.has(c.key)).flatMap((c) => c.messages.filter((m) => !!m.ours).map((m) => m.id)),
  );
}
