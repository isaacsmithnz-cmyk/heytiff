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
   nothing goes to a deleted job (#809) — and says so, in #809's words
   exactly, "That job isn't in ServiceM8's copy any more.".

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

/** #809's words, the ones the desk's card says for a job that has gone. */
export const JOB_GONE_LINE = "That job isn't in ServiceM8's copy any more.";

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

/** A door to the tasks the asks made, which the frame shows as rows (the
    list beside the diary, or the Tasks tab). */
export type TaskDoor = { text: string; ids: string[] };

export type ConversationUnder = {
  /** The job's door, or null for a job its business deleted. */
  job: { uuid: string; label: string } | null;
  /** The doors to the tasks the asks made, one per person they are on;
      none when there is nothing to open. */
  tasks: TaskDoor[];
  /** Reply: the job in ServiceM8, or null where there is nowhere to go. */
  reply: string | null;
  /** Sentences, each with its full stop. */
  lines: string[];
};

/** Whose tasks need no name, and what to call everyone else (as under an
    entry: ./diary-doors' `ownerNames`). */
export type TaskWho = { viewerStaffId: string | null; names: Readonly<Record<string, string>> };

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/* WHAT THE ASKS BECAME (H18: each ask is ONE task for you, made by Tiff
   when it arrives; lib/dashboard/mention-asks). The doors count the ones
   still open, by whose they are, as an entry's do: "1 task for you", and
   "1 task for you, this afternoon" while your reply's words for when are
   still true; "1 task for Leo" for one given to Leo since (a task whose
   card the workspace no longer names is just "1 task"). When none is
   open, "Task done". A task since deleted is a sentence, "1 task
   removed.", as an entry says it. And as under an entry, a door whose
   tasks no row on the page holds (`onPage`) is said as a sentence
   instead: a door that opened on nothing would be worse than none. */
function askTasks(
  c: DiaryConversation,
  who: TaskWho,
  onPage: ReadonlySet<string> | undefined,
): { doors: TaskDoor[]; lines: string[] } {
  const there = c.tasks.filter((t): t is typeof t & { taskId: string } => t.taskId !== null);
  const open = there.filter((t) => !t.done);
  const removed = c.tasks.length - there.length;
  const lines: string[] = [];
  let doors: TaskDoor[] = [];
  if (open.length > 0) {
    /* one door per staff card, standing where its first task stood; yours
       (or nobody's) first of all, as the ask was yours */
    const byOwner = new Map<string, typeof open>();
    for (const t of open) {
      const key = t.ownerId === null || t.ownerId === who.viewerStaffId ? "" : t.ownerId;
      byOwner.set(key, [...(byOwner.get(key) ?? []), t]);
    }
    const owners = [...byOwner.keys()].sort((a, b) => (a === "" ? -1 : b === "" ? 1 : 0));
    doors = owners.map((owner) => {
      const ts = byOwner.get(owner) ?? [];
      const name = owner === "" ? "you" : (who.names[owner] ?? null);
      const said = owner === "" && ts.length === 1 ? ts[0].dueSaid : null;
      return {
        text: `${plural(ts.length, "task", "tasks")}${name ? ` for ${name}` : ""}${said ? `, ${said}` : ""}`,
        ids: ts.map((t) => t.taskId),
      };
    });
  } else if (there.length > 0) {
    doors = [{ text: there.length === 1 ? "Task done" : `${there.length} tasks done`, ids: there.map((t) => t.taskId) }];
  }
  if (onPage) {
    doors = doors.filter((d) => {
      if (d.ids.some((id) => onPage.has(id))) return true;
      lines.push(`${d.text}.`);
      return false;
    });
  }
  if (removed > 0) lines.push(`${plural(removed, "task", "tasks")} removed.`);
  return { doors, lines };
}

/** What goes under a conversation. `who` is whose tasks need no name, and
    what to call everyone else; `onPage`, when given, is every task a row
    on this page holds: a task door none of whose tasks is there is said as
    a sentence instead. */
export function conversationUnder(c: DiaryConversation, who: TaskWho, onPage?: ReadonlySet<string>): ConversationUnder {
  const asks = askTasks(c, who, onPage);
  if (!c.jobLive) {
    return {
      job: null,
      tasks: asks.doors,
      reply: null,
      lines: [...asks.lines, SOURCE_LINE, JOB_GONE_LINE],
    };
  }
  return {
    job: { uuid: c.jobUuid, label: c.jobLabel ?? "The job" },
    tasks: asks.doors,
    reply: sm8JobUrl(c.jobUuid),
    lines: [...asks.lines, SOURCE_LINE],
  };
}

/** What a door from another face can land on in the diary: its entries
    by id, and every note in its conversations. The page's journal, which
    the list and the Tasks tab find an entry in, is your sixty newest
    entries whatever their age, while the diary reaches back only as far as
    its ONE HORIZON (./diary-feed) — MENTION_DAYS once it reads ServiceM8.
    And an ask ServiceM8 deleted leaves its task behind with no
    conversation. So the desk offers a door into the diary only for what is
    here, and none opens the diary on nothing. No diary holds nothing. */
export function diaryHolds(feed: DiaryFeed | null): { entries: ReadonlySet<string>; notes: ReadonlySet<string> } {
  const entries = new Set<string>();
  const notes = new Set<string>();
  for (const item of feed ? [...feed.today, ...feed.earlier] : []) {
    if (item.kind === "entry") entries.add(item.entry.id);
    else for (const m of item.conversation.messages) notes.add(m.id);
  }
  return { entries, notes };
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
