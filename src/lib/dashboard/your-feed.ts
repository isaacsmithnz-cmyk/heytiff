import { jobPageHref } from "@/lib/shell/links";
import { stampWhen } from "./diary-conversation";
import type { DiaryConversation, DiaryFeed } from "./diary-feed";
import type { FeedEvent } from "./feed-events";
import type { TodoAct, TodoRow } from "./todo";

/* YOUR FEED (Isaac, 20 October 2026, in place of Home's Activity; the board
   https://claude.ai/artifact/NzYjAQqzJJsgSgPPGCSJVq, built as mocked: the
   name Your feed, the filter All / To you / Jobs / Approvals, and a mention
   kept in To do as well). Everything that comes to you, newest first, in
   one column. Pure, so a test can hold every word.

   TO YOU leads it: a ServiceM8 note that @mentions you is a conversation
   (./diary-feed), and its newest message to you is an item you answer where
   it sits, through the job card's own reply (actions/job-note-sm8
   replyToJobNote), which closes the task the ask made. Work given to you,
   and a notice you haven't read, are to you too.
   JOBS: what came in from ServiceM8 (./feed-events-query) and anything
   ServiceM8 refused to take from HeyTiff.
   APPROVALS: leave, timesheets, expenses, claims, SWMS and certificate
   wording waiting on you.

   EVERY ITEM OPENS (Isaac, 24 October 2026: "Everything on that feed and
   notes should be interactive"): pressing it goes where it is about, its
   job, its approval, its notice, or opens the task it is. A field issue
   with nothing to open is answered where it sits: Make it a task, or Done.

   Anything waiting on you with no time of its own (an approval) stands at
   the time Home was read: it is current, so it sits with today's. */

export type FeedFilter = "all" | "you" | "jobs" | "approvals";
export const FEED_FILTERS: readonly { value: FeedFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "you", label: "To you" },
  { value: "jobs", label: "Jobs" },
  { value: "approvals", label: "Approvals" },
];

/** How far back a conversation stays in the feed after its last word to you. */
export const FEED_TALK_DAYS = 7;

export type FeedReply = {
  jobUuid: string;
  /** the message of theirs a reply answers */
  sourceNoteUuid: string;
  /** the task that message made, still open: the reply closes it */
  closesTaskId: string | null;
};

/** What pressing an item opens: a page, or a task's own form over Home. */
export type FeedOpen = { href: string } | { taskId: string } | null;

export type FeedItem = {
  key: string;
  filter: Exclude<FeedFilter, "all">;
  /** whose it is: a person by name, ServiceM8, or a thing waiting on you (an approval, a notice, work given) */
  who: { name: string; sm8: boolean; thing?: boolean };
  /** every note of theirs in it, so a Reply door naming any of them finds it */
  notes?: string[];
  /** "mentioned you on 2674 St Lukes" */
  what: string;
  /** their words, when there are words */
  said: string | null;
  /** your last word in it, under theirs */
  yours: string | null;
  /** "12:52 pm", "Mon 19 Oct, 9:10 am", or "" for what is waiting now */
  when: string;
  /** what it sorts by: the account's clock, "YYYY-MM-DD HH:MM" */
  at: string;
  /** new to you: theirs today and not yet answered */
  unread: boolean;
  act: TodoAct | null;
  reply: FeedReply | null;
  open: FeedOpen;
};

const APPROVAL_CHIPS = /^alert:(expenses|timesheet|claim|leave-queue|leave-declined|swms-issue|swms-template|cert-wording)/;
const JOB_CHIPS = /^alert:sm8-/;

function openOfAct(act: TodoAct | null): FeedOpen {
  if (!act) return null;
  switch (act.kind) {
    case "link":
    case "bookIn":
      return { href: act.href };
    case "task":
    case "later":
    case "gotit":
      return { taskId: act.taskId };
    case "issue":
      return null;
  }
}

function filterOfRow(r: TodoRow): FeedItem["filter"] {
  if (r.source === "timesheets" || APPROVAL_CHIPS.test(r.key)) return "approvals";
  if (JOB_CHIPS.test(r.key)) return "jobs";
  return "you";
}

/** An Activity row (todo.ts) as a feed item, waiting now. */
function rowItem(r: TodoRow, now: string): FeedItem {
  return {
    key: r.key,
    filter: filterOfRow(r),
    who: { name: r.name, sm8: JOB_CHIPS.test(r.key), thing: !JOB_CHIPS.test(r.key) },
    what: r.line,
    said: null,
    yours: null,
    when: "",
    at: now,
    unread: r.source === "assignment",
    act: r.act,
    reply: null,
    open: openOfAct(r.act),
  };
}

/** The newest message of theirs written to you, and the task it made if still open. */
function lastAsk(c: DiaryConversation) {
  const theirs = [...c.messages].reverse().find((m) => m.from === "them" && m.addressed) ?? c.messages.find((m) => m.from === "them");
  if (!theirs) return null;
  const task = c.tasks.find((t) => t.noteId === theirs.id && t.taskId && !t.done) ?? null;
  return { message: theirs, taskId: task?.taskId ?? null };
}

function conversationItem(c: DiaryConversation, today: string): FeedItem | null {
  const ask = lastAsk(c);
  if (!ask) return null;
  const mine = c.lastYours ? [...c.messages].reverse().find((m) => m.from === "you") : null;
  const job = c.jobLabel ?? "a job";
  return {
    key: `talk:${c.key}`,
    filter: "you",
    who: { name: c.asker.name, sm8: false },
    notes: c.messages.filter((m) => m.from === "them").map((m) => m.id),
    what: c.messages[0]?.id === ask.message.id ? `mentioned you on ${job}` : `wrote to you on ${job}`,
    said: ask.message.text,
    yours: mine && c.answered ? mine.text : null,
    when: stampWhen(c.lastTheirs, today),
    at: c.lastTheirs,
    unread: c.fresh && !c.answered,
    act: c.jobLabel ? { kind: "link", label: "Open the job", href: jobPageHref(c.jobUuid) } : null,
    reply: c.jobLive ? { jobUuid: c.jobUuid, sourceNoteUuid: ask.message.id, closesTaskId: ask.taskId } : null,
    open: c.jobLabel ? { href: jobPageHref(c.jobUuid) } : null,
  };
}

function eventItem(e: FeedEvent, today: string): FeedItem {
  const base = {
    key: `event:${e.key}`,
    filter: "jobs" as const,
    yours: null,
    when: stampWhen(e.at, today),
    at: e.at,
    unread: false,
    reply: null,
    open: { href: jobPageHref(e.jobUuid, e.kind === "photos" ? "photos" : undefined) },
  };
  switch (e.kind) {
    case "new-job":
      return { ...base, who: { name: "New job", sm8: true }, what: e.job, said: e.said, act: { kind: "link", label: "Open", href: jobPageHref(e.jobUuid) } };
    case "work-order":
      return { ...base, who: { name: "Now a work order", sm8: true }, what: e.job, said: null, act: { kind: "link", label: "Open", href: jobPageHref(e.jobUuid) } };
    case "check-in":
      return { ...base, who: { name: e.by ?? "Someone", sm8: false }, what: `checked in at ${e.job}`, said: null, act: null };
    case "photos":
      return {
        ...base,
        who: { name: e.by ?? "Someone", sm8: false },
        what: `added ${e.count === 1 ? "a photo" : `${e.count} photos`} to ${e.job}`,
        said: null,
        act: { kind: "link", label: "See them", href: jobPageHref(e.jobUuid, "photos") },
      };
  }
}

const dayOf = (stamp: string) => stamp.slice(0, 10);

/** Your feed: newest first. `now` is the account's clock when Home was read. */
export function yourFeed(input: {
  rows: readonly TodoRow[];
  diary: DiaryFeed | null;
  events: readonly FeedEvent[];
  today: string;
  now: string;
  /** the oldest day a conversation stays in, FEED_TALK_DAYS back */
  since: string;
}): FeedItem[] {
  const talk = input.diary
    ? [...input.diary.today, ...input.diary.earlier]
        .flatMap((i) => (i.kind === "conversation" ? [i.conversation] : []))
        .filter((c) => dayOf(c.lastTheirs) >= input.since)
        .map((c) => conversationItem(c, input.today))
        .filter((x): x is FeedItem => x !== null)
    : [];
  const items = [
    ...input.rows.map((r) => rowItem(r, input.now)),
    ...talk,
    ...input.events.map((e) => eventItem(e, input.today)),
  ];
  /* newest first; what waits now sits at now, and to you leads a tie */
  const rank = { you: 0, approvals: 1, jobs: 2 } as const;
  return items.sort((a, b) => (a.at !== b.at ? (a.at < b.at ? 1 : -1) : rank[a.filter] - rank[b.filter]));
}

export const inFilter = (items: readonly FeedItem[], f: FeedFilter) => (f === "all" ? items : items.filter((i) => i.filter === f));
