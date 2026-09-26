/* THE DIARY — pure. What the new Home's Diary tab holds, decided here where
   a test can see it: your own entries and the ServiceM8 notes that @mention
   you, in one column, newest first, with Today split off the top.

   A MENTION IS A CONVERSATION, not a row. Luke's "@isaacsmith please call
   Mary" is the first message; everything either of you writes to the other
   on that job after it threads under it, in time order. One conversation per
   job per person who asked: two people asking you on the same job are two
   conversations, and the same person asking on two jobs is two as well.

   WHO JOINS. After it opens, a note on the same job joins when
     - the asker wrote it and it mentions you,
     - you wrote it and it mentions the asker, or
     - the asker wrote it, it mentions nobody, you haven't answered since
       they last mentioned you, and it came within FOLLOW_ON_DAYS of that
       mention (his follow-up with Holly's number, two days after his ask,
       named nobody and is plainly part of it). Measured from the mention,
       not from his previous message, so a status note every day or two
       can't chain on for ever; and once you have answered, his next note
       that names nobody is a note on the job, not a new ask of you — the
       same reason yours that name nobody never join. A note that names
       somebody else is to somebody else.
   Your notes that name nobody don't join: you write job notes all day, and
   a note on the job is not an answer to Luke unless it says it is to him.

   WHAT A MESSAGE SAYS is the note as written, less its addressing
   (sm8-mentions' quotedNote): the handles it opens with, and the one
   naming the other side of this conversation. Anybody else it names is
   said by first name (the whole name when two people share the first), so
   "can you ask @michaeldiamond to bring the ladder" still asks for Michael.

   WHERE IT SORTS is the asker's newest message, so your reply never moves
   it and his answer brings the whole conversation up into Today. Its header
   keeps the date of the ask.

   TIMES are naive stamps on the ServiceM8 account's clock — ServiceM8's own
   are written that way, and the journal's are converted to it by the read
   (journal-query's listDiaryEntries) — so the two sort together as text.
   "Today" is that clock's today. Nothing here reads a clock.

   ONE HORIZON. Mentions reach back MENTION_DAYS; your entries reach back
   as far as their read's limit. The column shows only what both cover, so
   no stretch of it holds one source alone and looks like the other said
   nothing: nothing older than MENTION_DAYS when mentions were read, and
   nothing older than your oldest entry when the entry read stopped at its
   limit. */

import { plusDays } from "@/lib/workboard/dates";
import { mentionedHandles, quotedNote } from "@/lib/workboard/sm8-mentions";
import type { Sm8Person } from "@/lib/workboard/job-notes-query";
import type { DiaryEntry } from "./journal";

/** How far back a mention is read. */
export const MENTION_DAYS = 60;

/** How long after the asker last mentioned you a note of theirs that names
    nobody still belongs to the conversation — while you haven't answered. */
export const FOLLOW_ON_DAYS = 3;

/** The most entries the diary reads (journal-query's listDiaryEntries). */
export const DIARY_ENTRY_LIMIT = 60;

/** One live ServiceM8 job note, as the read hands it over: text trimmed,
    stamp as ServiceM8 wrote it. HeyTiff's own echoes are already out. */
export type MentionNote = {
  uuid: string;
  jobUuid: string;
  text: string;
  /** edit_by_staff_uuid — ServiceM8 keeps the LAST editor, not the first. */
  author: string | null;
  /** "2026-09-21 13:42:10", the account's clock. */
  at: string;
};

export type DiaryMessage = {
  /** The ServiceM8 note's uuid. */
  id: string;
  from: "them" | "you";
  /** It names the other side of the conversation: "Luke Ingold to you".
      Always so for yours (a note of yours joins only when it names the
      asker) and for his that mention you; not for his follow-on that
      names nobody, which was written on the job, not to you. */
  addressed: boolean;
  /** Their words less the addressing; anybody else named, by name
      (quotedNote). */
  text: string;
  at: string;
};

export type DiaryConversation = {
  /** `${jobUuid}:${askerUuid}`. */
  key: string;
  jobUuid: string;
  /** "2041 Wollstonecraft", or null when the mirror has no such job. */
  jobLabel: string | null;
  /** Live in ServiceM8. A deleted job keeps its conversation and gets no
      Reply: nothing goes to a job its business deleted (#809). */
  jobLive: boolean;
  asker: { uuid: string; name: string; first: string; handle: string };
  /** The note that opened it — the ask. */
  askNoteUuid: string;
  /** The ask's stamp: the header's date, whatever came after. */
  openedAt: string;
  /** Oldest first; the first is the ask. */
  messages: DiaryMessage[];
  /** The asker's newest message: what the conversation sorts by. */
  lastTheirs: string;
  /** Your newest message, or null. */
  lastYours: string | null;
  /** You have written since the asker last did. */
  answered: boolean;
  /** The asker's newest message is today and you haven't answered it —
      the highlight. */
  fresh: boolean;
  /** The tasks Tiff made of this conversation's asks of you, oldest ask
      first (mention_asks, ./mention-asks). Empty until the read that knows
      them fills it in: an ask not read yet, or read as asking nothing, has
      none. */
  tasks: AskTask[];
};

/** The one task an ask of you became. */
export type AskTask = {
  /** The ask: the ServiceM8 note that asked. */
  noteId: string;
  /** Null when the task has since been deleted. */
  taskId: string | null;
  done: boolean;
  /** When your reply said you'd do it, in its words ("this afternoon"), or
      null. */
  dueSaid: string | null;
};

export type DiaryItem =
  | { kind: "entry"; key: string; sortAt: string; entry: DiaryEntry }
  | { kind: "conversation"; key: string; sortAt: string; conversation: DiaryConversation };

export type DiaryFeed = {
  /** Today on the account's clock — the day "Today" means. */
  day: string;
  /** Newest first. */
  today: DiaryItem[];
  /** Newest first; each item carries its own date. */
  earlier: DiaryItem[];
  /** Whether mentions were read at all. False without ServiceM8, without
      `workboard`, or for a viewer integration_links doesn't name — the
      diary is then your own entries only. */
  mentions: boolean;
  /** When the mirror last finished a sync (ISO), or null: what the diary's
      refresh decides by. */
  syncedAt: string | null;
};

/** "2041 Wollstonecraft" — the job number and the suburb, whichever exist. */
export function jobDoorLabel(generatedId: string | null, city: string | null): string | null {
  const parts = [generatedId, city].map((p) => (p ?? "").trim()).filter(Boolean);
  return parts.length ? parts.join(" ") : null;
}

const STAMP = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/;

/** A stamp in one shape, "yyyy-mm-dd hh:mm:ss", so a journal entry's minute
    and a ServiceM8 note's second compare as text. "" for anything that isn't
    a date, including ServiceM8's '0000-00-00'. */
export function sortStamp(s: string | null | undefined): string {
  const m = typeof s === "string" ? s.match(STAMP) : null;
  if (!m || m[1] === "0000") return "";
  return `${m[1]}-${m[2]}-${m[3]} ${m[4] ?? "00"}:${m[5] ?? "00"}:${m[6] ?? "00"}`;
}

/* Milliseconds for the gap between two stamps. The stamps carry no zone, so
   both are read as UTC: a daylight-saving hour can't matter to a gap
   measured in days. */
const msOf = (s: string) => {
  const m = sortStamp(s).match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/);
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) : NaN;
};

type Draft = Omit<DiaryConversation, "answered" | "fresh" | "tasks">;

/** handle → the word a quoted note says for them: a first name, unless two
    people share it. The diary's conversations and the Tasks face's quoted
    notes (task-record-query) name people by this one rule, so the two can
    never call the same person different things. */
export function handleWords(people: readonly Sm8Person[]): Map<string, string> {
  const firsts = new Map<string, number>();
  for (const p of people) firsts.set(p.first, (firsts.get(p.first) ?? 0) + 1);
  return new Map(people.map((p) => [p.handle, (firsts.get(p.first) ?? 0) > 1 ? p.name : p.first]));
}

/** The conversations in these notes, newest (by the asker's newest message)
    first. `me` is the viewer's ServiceM8 person; `people` is the account's
    roster (sm8Roster), which is also every handle there is. */
export function buildConversations(input: {
  notes: readonly MentionNote[];
  me: { uuid: string; handle: string };
  people: readonly Sm8Person[];
  jobs: ReadonlyMap<string, { label: string | null; live: boolean }>;
  today: string;
}): DiaryConversation[] {
  const { me, today } = input;
  const byUuid = new Map(input.people.map((p) => [p.uuid, p]));
  const handles = input.people.map((p) => p.handle);
  const names = handleWords(input.people);

  const seen = new Set<string>();
  const notes = input.notes
    .map((n) => ({ ...n, at: sortStamp(n.at) }))
    .filter((n) => {
      if (!n.at || !n.jobUuid || !n.text || seen.has(n.uuid)) return false;
      seen.add(n.uuid);
      return true;
    })
    .sort((a, b) => (a.at === b.at ? (a.uuid < b.uuid ? -1 : 1) : a.at < b.at ? -1 : 1));

  const open = new Map<string, Draft>();
  /* conversation key → the asker's newest note that mentioned you */
  const askedAt = new Map<string, string>();
  const say = (c: Draft, n: MentionNote, from: DiaryMessage["from"], addressed = true) => {
    /* The other side of the conversation is who the note is addressed to. */
    const addressing = [from === "them" ? me.handle : c.asker.handle];
    c.messages.push({ id: n.uuid, from, addressed, text: quotedNote(n.text, { names, addressing }), at: n.at });
    if (from === "them") c.lastTheirs = n.at;
    else c.lastYours = n.at;
  };
  const followsOn = (c: Draft, at: string) => {
    const asked = askedAt.get(c.key);
    if (!asked || (c.lastYours !== null && c.lastYours >= asked)) return false;
    return msOf(at) - msOf(asked) <= FOLLOW_ON_DAYS * 86_400_000;
  };

  for (const n of notes) {
    const named = mentionedHandles(n.text, handles);

    if (n.author === me.uuid) {
      /* Yours joins every conversation on this job whose asker it names —
         one note can answer two people. Naming yourself is not an ask. */
      for (const c of open.values())
        if (c.jobUuid === n.jobUuid && named.includes(c.asker.handle)) say(c, n, "you");
      continue;
    }

    /* An author the roster can't name can't be answered or keyed. */
    const asker = n.author ? byUuid.get(n.author) : undefined;
    if (!asker) continue;
    const key = `${n.jobUuid}:${asker.uuid}`;
    const c = open.get(key);

    if (named.includes(me.handle)) {
      if (c) say(c, n, "them");
      else {
        const job = input.jobs.get(n.jobUuid);
        const draft: Draft = {
          key,
          jobUuid: n.jobUuid,
          jobLabel: job?.label ?? null,
          jobLive: job?.live ?? false,
          asker: { uuid: asker.uuid, name: asker.name, first: asker.first, handle: asker.handle },
          askNoteUuid: n.uuid,
          openedAt: n.at,
          messages: [],
          lastTheirs: n.at,
          lastYours: null,
        };
        say(draft, n, "them");
        open.set(key, draft);
      }
      askedAt.set(key, n.at);
    } else if (c && named.length === 0 && followsOn(c, n.at)) {
      say(c, n, "them", false);
    }
  }

  return [...open.values()]
    .map((c): DiaryConversation => {
      const answered = c.lastYours !== null && c.lastYours > c.lastTheirs;
      return { ...c, answered, fresh: c.lastTheirs.slice(0, 10) === today && !answered, tasks: [] };
    })
    .sort((a, b) => (a.lastTheirs === b.lastTheirs ? (a.key < b.key ? -1 : 1) : a.lastTheirs < b.lastTheirs ? 1 : -1));
}

/** Your entries and your conversations in one column, newest first, split
    at today, back as far as both reach (ONE HORIZON, above). An entry
    sorts by when it was said; a conversation by the asker's newest
    message. */
export function diaryFeed(input: {
  entries: readonly DiaryEntry[];
  conversations: readonly DiaryConversation[];
  day: string;
  mentions: boolean;
  /** The entry read stopped at its limit: older entries exist that it
      didn't read. */
  entriesCut: boolean;
  syncedAt: string | null;
}): DiaryFeed {
  const items: DiaryItem[] = [
    ...input.entries.map(
      (entry): DiaryItem => ({ kind: "entry", key: `entry:${entry.id}`, sortAt: sortStamp(entry.stamp), entry })
    ),
    ...input.conversations.map(
      (conversation): DiaryItem => ({
        kind: "conversation",
        key: `mention:${conversation.key}`,
        sortAt: sortStamp(conversation.lastTheirs),
        conversation,
      })
    ),
  ]
    .filter((i) => i.sortAt !== "")
    .sort((a, b) => (a.sortAt === b.sortAt ? (a.key < b.key ? -1 : 1) : a.sortAt < b.sortAt ? 1 : -1));

  /* The nearer of the two reaches. A bare day compares below every stamp
     on it, so the whole of that day is in. */
  const entryStamps = input.entries.map((e) => sortStamp(e.stamp)).filter(Boolean);
  const horizon = [
    input.mentions ? plusDays(input.day, -MENTION_DAYS) : "",
    input.entriesCut && entryStamps.length ? entryStamps.reduce((min, s) => (s < min ? s : min)) : "",
  ].reduce((a, b) => (a > b ? a : b));
  const shown = horizon ? items.filter((i) => i.sortAt >= horizon) : items;

  /* Newest first, so Today is a run off the top. A stamp past today (a
     clock ahead of ours) is still today's news, not history. */
  const split = shown.findIndex((i) => i.sortAt.slice(0, 10) < input.day);
  const cut = split === -1 ? shown.length : split;
  return {
    day: input.day,
    today: shown.slice(0, cut),
    earlier: shown.slice(cut),
    mentions: input.mentions,
    syncedAt: input.syncedAt,
  };
}
