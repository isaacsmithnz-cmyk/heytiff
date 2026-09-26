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

   YOUR REPLY FROM HEYTIFF (two-way phase 2, ./diary-reply) joins by what
   it answers, not by its words: the conversation that holds the note it
   answers takes it, at the moment it was saved to the second (never before
   that note), as HeyTiff saved it — so it is there before the sync, it
   says where it stands with ServiceM8, and a plain "Done." with nobody
   named still goes where it belongs. ServiceM8's copy of it (`copies`) is
   the same message, and never joins beside it. One that answers a note no
   conversation holds stays one of your entries (diaryFeed leaves out only
   what a conversation holds, or one you hid took with it: ./diary-hidden).

   WHAT A MESSAGE SAYS is the note as written, less its addressing
   (sm8-mentions' quotedNote): the handles it opens with, and the one
   naming the other side of this conversation. Anybody else it names is
   said by first name (the whole name when two people share the first), so
   "can you ask @michaeldiamond to bring the ladder" still asks for Michael.
   What Tiff READS is the note with nothing taken out and every handle said
   by name, yours by your first (`named`): a note written to Luke and to you
   is two asks, and only the part in front of your name is yours.

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
import { mentionedHandles, namedNote, quotedNote } from "@/lib/workboard/sm8-mentions";
import type { Sm8Person } from "@/lib/workboard/job-notes-query";
import type { ReplyLine } from "./diary-reply";
import type { DiaryEntry } from "./journal";

/** How far back a mention is read. */
export const MENTION_DAYS = 60;

/** How long after the asker last mentioned you a note of theirs that names
    nobody still belongs to the conversation — while you haven't answered. */
export const FOLLOW_ON_DAYS = 3;

/** The most entries the diary reads (journal-query's listDiaryEntries). */
export const DIARY_ENTRY_LIMIT = 60;

/** The most replies of yours the conversations read, over the mentions'
    reach (journal-query's listDiaryReplies): each is one uuid in the URL
    of the reads of their queue rows and their copies, and a hundred keep
    those near 4 KB, as sm8-echo's ECHO_CHUNK keeps its own. */
export const DIARY_REPLY_LIMIT = 100;

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

/** A reply of yours as HeyTiff saved it, or a task's Done (./diary-reply):
    what the conversation holding the note it answers draws in its place. */
export type OurReply = {
  /** HeyTiff's row (workboard_notes): your entry's id. */
  id: string;
  /** The ServiceM8 note it answers. */
  to: string;
  /** The job its row is on: what a press on its line names. */
  jobUuid: string;
  /** Its words in the job's diary, with the handle it opens on. */
  words: string;
  /** When it was saved, to the second, on the account's clock. */
  at: string;
  /** When it was saved, as the database says it: the order of two saved
      in the same second. */
  savedAt: string;
  line: ReplyLine | null;
  /** Taken back, and drawn only while something of it may still be in
      ServiceM8 (./diary-reply): its line's Try again is its door. */
  takenBack?: true;
};

export type DiaryMessage = {
  /** The ServiceM8 note's uuid — or, for yours as HeyTiff saved it
      (`ours`), HeyTiff's row. */
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
  /** Their words with nothing taken out, everybody named by name and you
      by your first (namedNote): what Tiff reads, so she sees who each part
      of a note written to several people is to. */
  named: string;
  at: string;
  /** A reply of yours from HeyTiff, or a task's Done, drawn as HeyTiff
      saved it — ServiceM8's copy never joins beside it: the job its row is
      on, where it stands with ServiceM8, and whether it was taken back. */
  ours?: { jobUuid: string; line: ReplyLine | null; takenBack?: true };
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
  /** When your reply said you'd do it, in its words ("this afternoon"),
      while they are still true: today, and the day they named still the
      task's. Otherwise null. */
  dueSaid: string | null;
  /** The staff card it is on now: yours, or whoever it was given to since.
      Null when that isn't known (the task since deleted). */
  ownerId: string | null;
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
  /** Your replies as HeyTiff saved them, each threaded where the note it
      answers is (YOUR REPLY FROM HEYTIFF, above). */
  replies?: readonly OurReply[];
  /** The uuids ServiceM8's copies of those replies carry, lower case
      (sm8-echo's sm8CopiesOf): the same messages, never drawn twice. */
  copies?: ReadonlySet<string>;
}): DiaryConversation[] {
  const { me, today } = input;
  const byUuid = new Map(input.people.map((p) => [p.uuid, p]));
  const handles = input.people.map((p) => p.handle);
  const names = handleWords(input.people);
  /* What Tiff reads: the same words, and you always by your first name,
     the one her prompt says the note's ask of you is made to. */
  const readNames = new Map(names);
  const myFirst = byUuid.get(me.uuid)?.first;
  if (myFirst) readNames.set(me.handle, myFirst);

  const seen = new Set<string>();
  const copies = input.copies;
  const notes = input.notes
    .map((n) => ({ ...n, at: sortStamp(n.at) }))
    .filter((n) => {
      if (!n.at || !n.jobUuid || !n.text || seen.has(n.uuid)) return false;
      seen.add(n.uuid);
      return !copies?.has(n.uuid.toLowerCase());
    })
    .sort((a, b) => (a.at === b.at ? (a.uuid < b.uuid ? -1 : 1) : a.at < b.at ? -1 : 1));

  /* Your replies, each at the moment it was saved — but never before the
     note it answers: HeyTiff's clock and ServiceM8's are two clocks. */
  const noteAt = new Map(notes.map((n) => [n.uuid, n.at]));
  const replies = (input.replies ?? []).flatMap((r) => {
    const saved = sortStamp(r.at);
    if (!saved || !r.words.trim() || seen.has(r.id)) return [];
    seen.add(r.id);
    const source = noteAt.get(r.to) ?? "";
    return [{ ...r, at: source > saved ? source : saved }];
  });
  /* One stream in time order; a reply comes after a note at the same stamp,
     so the note it answers is always in before it, and two replies at the
     same stamp (two held to the note they answer, or two in one second)
     keep the order they were saved in. */
  type Step = { at: string; id: string; reply: { savedAt: string } | null };
  const inOrder = (a: Step, b: Step): number => {
    if (a.at !== b.at) return a.at < b.at ? -1 : 1;
    if (!a.reply !== !b.reply) return a.reply ? 1 : -1;
    if (a.reply && b.reply && a.reply.savedAt !== b.reply.savedAt) return a.reply.savedAt < b.reply.savedAt ? -1 : 1;
    return a.id < b.id ? -1 : 1;
  };
  const stream = [
    ...notes.map((note) => ({ at: note.at, id: note.uuid, note, reply: null })),
    ...replies.map((reply) => ({ at: reply.at, id: reply.id, note: null, reply })),
  ].sort(inOrder);

  const open = new Map<string, Draft>();
  /* conversation key → the asker's newest note that mentioned you */
  const askedAt = new Map<string, string>();
  /* message id → the first conversation that holds it: where a reply to it
     goes */
  const holder = new Map<string, Draft>();
  const say = (
    c: Draft,
    n: { id: string; text: string; at: string },
    from: DiaryMessage["from"],
    addressed = true,
    ours?: DiaryMessage["ours"],
  ) => {
    /* The other side of the conversation is who the note is addressed to. */
    const addressing = [from === "them" ? me.handle : c.asker.handle];
    c.messages.push({
      id: n.id,
      from,
      addressed,
      text: quotedNote(n.text, { names, addressing }),
      named: namedNote(n.text, readNames),
      at: n.at,
      ...(ours ? { ours } : {}),
    });
    if (!holder.has(n.id)) holder.set(n.id, c);
    if (from === "them") c.lastTheirs = n.at;
    else c.lastYours = n.at;
  };
  const followsOn = (c: Draft, at: string) => {
    const asked = askedAt.get(c.key);
    if (!asked || (c.lastYours !== null && c.lastYours >= asked)) return false;
    return msOf(at) - msOf(asked) <= FOLLOW_ON_DAYS * 86_400_000;
  };

  for (const step of stream) {
    if (step.reply) {
      const r = step.reply;
      /* where the note it answers is; nowhere, and it stays your entry */
      const c = holder.get(r.to);
      if (c)
        say(c, { id: r.id, text: r.words, at: r.at }, "you", true, {
          jobUuid: r.jobUuid,
          line: r.line,
          ...(r.takenBack ? { takenBack: true as const } : {}),
        });
      continue;
    }
    const n = { ...step.note, id: step.note.uuid };
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
      /* a reply held to the stamp of the note it answers came after it */
      const last = c.messages[c.messages.length - 1];
      const answered =
        c.lastYours !== null && (c.lastYours > c.lastTheirs || (c.lastYours === c.lastTheirs && !!last?.ours));
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
  /** Your replies in a conversation you hid (./diary-hidden's
      repliesPutAway): they went with it, so none is drawn on its own. */
  putAway?: ReadonlySet<string>;
}): DiaryFeed {
  /* The nearer of the two reaches. A bare day compares below every stamp
     on it, so the whole of that day is in. Every entry read marks how far
     back the entries reach, wherever it is drawn. */
  const entryStamps = input.entries.map((e) => sortStamp(e.stamp)).filter(Boolean);
  const horizon = [
    input.mentions ? plusDays(input.day, -MENTION_DAYS) : "",
    input.entriesCut && entryStamps.length ? entryStamps.reduce((min, s) => (s < min ? s : min)) : "",
  ].reduce((a, b) => (a > b ? a : b));
  const within = (i: DiaryItem) => i.sortAt !== "" && (!horizon || i.sortAt >= horizon);

  const conversations = input.conversations
    .map(
      (conversation): DiaryItem => ({
        kind: "conversation",
        key: `mention:${conversation.key}`,
        sortAt: sortStamp(conversation.lastTheirs),
        conversation,
      })
    )
    .filter(within);
  /* A reply of yours a conversation on the page holds is drawn there, and
     not again as an entry of its own. One whose conversation is past the
     reach is still your entry: never dropped. One whose conversation you
     hid went with it, and comes back with it. */
  const held = new Set([
    ...conversations.flatMap((i) => (i.kind === "conversation" ? i.conversation.messages : []).filter((m) => m.ours).map((m) => m.id)),
    ...(input.putAway ?? []),
  ]);
  const shown: DiaryItem[] = [
    ...input.entries
      .filter((entry) => !held.has(entry.id))
      .map((entry): DiaryItem => ({ kind: "entry", key: `entry:${entry.id}`, sortAt: sortStamp(entry.stamp), entry }))
      .filter(within),
    ...conversations,
  ].sort((a, b) => (a.sortAt === b.sortAt ? (a.key < b.key ? -1 : 1) : a.sortAt < b.sortAt ? 1 : -1));

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
