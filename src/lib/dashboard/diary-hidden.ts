/* THE CONVERSATIONS YOU HID — pure. Isaac, 2026-09-26: "the option to
   hide/archive other peoples" in the diary, which come back when they
   write again (actions/diary's `hideConversation`, and docs/migrations/
   diary_hidden.sql).

   A conversation is keyed as the diary keys it, `${jobUuid}:${askerUuid}`
   (./diary-feed's `DiaryConversation.key`). It stays out of the diary
   while its asker's newest message is no newer than the minute you hid it:
   an answer, or a new ask on the same job, brings it back. Both stamps are
   the account's own clock, naive, so they compare as text — to the
   minute, since that is all `naiveInZone` says of the hiding. */

import type { DiaryConversation } from "./diary-feed";

const PART = /^[\w-]{1,80}$/;

/** The shape of a conversation's key: two ids and a colon. */
export function isConversationKey(key: unknown): key is string {
  if (typeof key !== "string") return false;
  const parts = key.split(":");
  return parts.length === 2 && parts.every((p) => PART.test(p));
}

/** The conversations still in the diary: all but those hidden since their
    asker last wrote. `hidden` maps a key to when it was hidden, naive on
    the account's clock ("2026-09-26 14:05"). */
export function unhidden(
  conversations: readonly DiaryConversation[],
  hidden: ReadonlyMap<string, string>,
): DiaryConversation[] {
  if (hidden.size === 0) return [...conversations];
  return conversations.filter((c) => {
    const at = hidden.get(c.key);
    return at === undefined || c.lastTheirs.slice(0, 16) > at.slice(0, 16);
  });
}
