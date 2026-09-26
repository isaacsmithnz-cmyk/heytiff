/* A CONVERSATION IN THE DIARY, SAID — pure. What the new Home's Diary tab
   writes over, in and under a ServiceM8 conversation (./diary-feed builds
   them; the face is components/dashboard/home-diary-conversation), decided
   here where a test can see it. Nothing here reads a clock.

   OVER THE ASK, who asked and when: "Luke Ingold to you, Mon 21 Sept,
   1:42 pm", on the ask's own date whatever came after it — the
   conversation sorts by his newest message, and the header still says
   when he asked.

   IN THE THREAD, each later message and who it was to: "You to Luke, Tue
   22 Sept, 3:10 pm"; "Luke Ingold to you, 8:15 am" when he answers you
   today; just "Luke Ingold, Fri 11 Sept, 9:42 am" over his note on the job
   that names nobody, which was not written to you. A time alone is today;
   a date and a time is before.

   UNDER IT, the doors. The job, by its number and suburb ("2041
   Wollstonecraft"), which opens the desk's one card; Reply, which opens
   the job in ServiceM8, in a new tab, where an answer reaches the one who
   asked (Isaac, 2026-09-25: until HeyTiff writes notes into ServiceM8, a
   reply is made there, and threads back here on the next sync); then
   where it came from, "A job note in ServiceM8.". A job its business has
   deleted keeps its conversation, but is no door and gets no Reply —
   nothing goes to a deleted job (#809) — and says so, in #809's words.

   LIT, his reply: when the asker's newest message is today and you haven't
   answered it (`fresh`), that message stands on the diary's wash — the
   whole conversation when that message is the ask itself. */

import { fmtAuWeekdayDayMonth } from "@/lib/au-dates";
import { sm8JobUrl } from "@/lib/integrations/sm8-links";
import type { DeskFocusKind } from "./desk-focus";
import type { DiaryConversation, DiaryFeed, DiaryMessage } from "./diary-feed";
import { clock12 } from "./task-record";

/** Who, in bold, then the rest of the line after it. */
export type Said = { who: string; rest: string };

export const SOURCE_LINE = "A job note in ServiceM8.";

/** "1:42 pm" on `today`, "Mon 21 Sept, 1:42 pm" before it — from a naive
    stamp on the account's clock ("2026-09-21 13:42:10"). */
export function stampWhen(stamp: string, today: string): string {
  const m = stamp.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}):(\d{2})/);
  if (!m) return "";
  const time = clock12(Number(m[2]) * 60 + Number(m[3]));
  if (m[1] === today) return time;
  const day = fmtAuWeekdayDayMonth(m[1]);
  return day ? `${day}, ${time}` : time;
}

/** "Luke Ingold" + " to you, Mon 21 Sept, 1:42 pm": the ask's date, always. */
export function conversationHead(c: DiaryConversation, today: string): Said {
  return { who: c.asker.name, rest: ` to you, ${stampWhen(c.openedAt, today)}` };
}

/** Over a message in the thread. */
export function messageHead(m: DiaryMessage, c: DiaryConversation, today: string): Said {
  const when = stampWhen(m.at, today);
  return m.from === "you"
    ? { who: "You", rest: ` to ${c.asker.first}, ${when}` }
    : { who: c.asker.name, rest: `${m.addressed ? " to you" : ""}, ${when}` };
}

/** The message the diary lights: the asker's newest, while it is fresh.
    `head` when it is the ask itself, and the whole conversation is new. */
export function litMessage(c: DiaryConversation): { head: true } | { head: false; id: string } | null {
  if (!c.fresh) return null;
  const theirs = c.messages.filter((m) => m.from === "them");
  const newest = theirs[theirs.length - 1];
  if (!newest) return null;
  return newest.id === c.messages[0]?.id ? { head: true } : { head: false, id: newest.id };
}

export type ConversationUnder = {
  /** The job's door, or null for a job its business deleted. */
  job: { uuid: string; label: string } | null;
  /** Reply: the job in ServiceM8, or null where there is nowhere to go. */
  reply: string | null;
  /** Sentences, each with its full stop. */
  lines: string[];
};

export function conversationUnder(c: DiaryConversation): ConversationUnder {
  if (!c.jobLive) {
    return {
      job: null,
      reply: null,
      lines: [SOURCE_LINE, `${c.jobLabel ?? "That job"} isn't in ServiceM8's copy any more.`],
    };
  }
  return {
    job: { uuid: c.jobUuid, label: c.jobLabel ?? "The job" },
    reply: sm8JobUrl(c.jobUuid),
    lines: [SOURCE_LINE],
  };
}

/** The item a door from another face names (desk-focus's `DeskFocus`), by
    its key in the feed: an entry by its id, a conversation by any of its
    notes — the ask a task was made from, or a later message in it. Null
    when the diary holds none: a conversation older than the mentions
    reach, or deleted in ServiceM8. */
export function diaryItemOf(feed: DiaryFeed, door: { kind: DeskFocusKind; ids: readonly string[] }): string | null {
  const id = door.ids[0];
  if (id === undefined) return null;
  for (const item of [...feed.today, ...feed.earlier]) {
    if (door.kind === "entry" && item.kind === "entry" && item.entry.id === id) return item.key;
    if (
      door.kind === "conversation" &&
      item.kind === "conversation" &&
      item.conversation.messages.some((m) => m.id === id)
    )
      return item.key;
  }
  return null;
}
