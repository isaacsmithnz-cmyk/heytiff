import { fmtAuWeekdayDayMonth } from "@/lib/au-dates";
import { plusDays } from "@/lib/workboard/dates";
import { clock12 } from "@/lib/dashboard/task-record";
import type { StoryEntry } from "@/lib/workboard/job-story";
import type { BookedEntry } from "@/lib/workboard/all-jobs-query";
import type { JobSummaryRead } from "@/lib/workboard/job-summary";
import type { AppliedRecord } from "@/lib/workboard/note-applied";
import type { EarlierTurn } from "@/lib/workboard/note-turns";
import type { Tone } from "@/components/parts/state";
import type { SummaryGroup } from "./job-summary-rows";
import type { CustomerItem } from "./customer-messages";

/* A JOB'S OVERVIEW AS ITS CONVERSATION (v2, step 6, slice A; the board
   JC-1) — pure. What the job's page draws on Overview, decided here where
   a test can see it. Nothing here reads a clock: `today` is handed in,
   read on the server on the account's own clock.

   THE ACTIVITY FEED is the job's diary turned into a conversation. This
   builds it oldest first, day by day; the feed draws it the other way up,
   newest first under the box (Isaac's refined Overview A, 25 October
   2026). Every entry the diary held is still in
   it (lib/workboard/job-story builds them, unchanged): ServiceM8's notes
   and ours as messages, each with its person and time; the visits, photos,
   bookings, money and milestones as small cards in their place. A "Today"
   line separates the days.

   A note somebody told Tiff carries what she said back and what she made
   from it (`JobNoteTalk`): her words, then a card for each thing, with
   Undo where `undoNote` would still take it back. Those come from the
   note's own row (journal-query's `listJobDiaryEntries`), never from the
   router again.

   THE RAIL is three groups: where the job is up to (the stored summary),
   its open tasks, and its next visit. */

/** One thing Tiff made from a note: what it is, its name, a grey line. */
export type MadeKind = "task" | "flag" | "issue" | "bring" | "line" | "library" | "gone";

export type MadeCard = { key: string; kind: MadeKind; name: string; line: string };

/** A note of ours on this job, as the conversation reads it. */
export type JobNoteTalk = {
  id: string;
  authorId: string | null;
  authorName: string | null;
  /** The words as they were said or typed. */
  said: string;
  /** "2026-10-13 10:05", naive, on the account's clock. */
  stamp: string;
  day: string;
  spoken: boolean;
  /** What followed the words: Tiff's lines, and any answers to her. */
  replies: EarlierTurn[];
  made: MadeCard[];
  /** Undo would take back what it made, and the viewer may press it. */
  undo: boolean;
  /** Undo took it back: the words stay, with Tiff's line saying so. */
  undone: boolean;
};

/** One of the job's open tasks, for the rail. */
export type RailTask = { id: string; title: string; line: string; assigneeId: string | null };

/** Everything the Overview reads beyond the card's own record. */
export type JobConversationRead = {
  /** The account's today, ISO. */
  today: string;
  notes: JobNoteTalk[];
  tasks: RailTask[];
  /** The job's tasks ticked in the last fortnight, newest first, each with
      who ticked it and when (Isaac, 24 October 2026: "Completing a task
      shows by who and when"). */
  done?: { id: string; title: string; line: string }[];
  /** Who is looking: their staff card and their name. */
  viewer: { id: string | null; name: string | null };
  /** The Summary's groups from the job's quote in HeyTiff (job-summary-rows),
      no money in them; null when the quote can't say what the job is, and
      the Summary reads the description instead. */
  summary?: SummaryGroup[] | null;
  /** The customer's texts and emails with the team, as threads, and
      ServiceM8's own sends as rows (customer-messages), oldest first. */
  customer?: CustomerItem[];
};

/* ── days ── */

/** "Today", "Yesterday", or "Tue 13 Oct": the line between the days. */
export function dayLabel(day: string, today: string | null): string {
  if (today && day === today) return "Today";
  if (today && day === plusDays(today, -1)) return "Yesterday";
  return fmtAuWeekdayDayMonth(day) || day;
}

/** "10:05 am" off a naive stamp ("2026-10-13 10:05:12"); "" without a clock. */
export function stampClock(stamp: string | null | undefined): string {
  const m = /^\d{4}-\d{2}-\d{2}[ T](\d{2}):(\d{2})/.exec(stamp ?? "");
  return m ? clock12(Number(m[1]) * 60 + Number(m[2])) : "";
}

/** One thing in the conversation: a diary entry, a note's talk, or both. */
export type ConvItem = { key: string; entry: StoryEntry | null; talk: JobNoteTalk | null; customer?: CustomerItem | null };

export type ConvDay = { day: string; label: string; items: ConvItem[] };

/** The conversation, oldest first, day by day (the feed turns it newest first).

    `story` is the diary's own list (newest first, as job-story builds it),
    already filtered. Each of our notes in it finds its talk by id. A note
    Undo took back is no longer in the diary's read, so it comes from its
    talk alone and stands where its stamp puts it. `hide` names notes the
    page is drawing elsewhere: the ones said in the box just now, which the
    live conversation under the days already shows. `withTaken` says whether
    taken-back notes belong in what is shown (the Notes and All filters). */
export function conversationDays(
  story: readonly StoryEntry[],
  talks: readonly JobNoteTalk[],
  today: string | null,
  hide: ReadonlySet<string> = new Set(),
  withTaken = true,
  customer: readonly CustomerItem[] = [],
): ConvDay[] {
  const byId = new Map(talks.map((t) => [t.id, t]));
  const items: (ConvItem & { day: string; at: string | null })[] = [];
  for (const e of [...story].reverse()) {
    if (e.kind === "note" && e.id && hide.has(e.id)) continue;
    const talk = e.kind === "note" && e.id ? (byId.get(e.id) ?? null) : null;
    items.push({ key: e.key, entry: e, talk, day: e.day, at: e.at });
  }
  if (withTaken) {
    const shown = new Set(story.flatMap((e) => (e.kind === "note" && e.id ? [e.id] : [])));
    for (const t of talks) {
      if (!t.undone || shown.has(t.id) || hide.has(t.id)) continue;
      const at = items.findIndex((i) => i.day > t.day || (i.day === t.day && !!i.at && i.at > t.stamp));
      const item = { key: `talk:${t.id}`, entry: null, talk: t, day: t.day, at: t.stamp };
      if (at < 0) items.push(item);
      else items.splice(at, 0, item);
    }
  }
  /* the customer's messages and ServiceM8's sends, each where its latest moment puts it */
  for (const c of customer) {
    const at = items.findIndex((i) => i.day > c.day || (i.day === c.day && !!i.at && i.at > c.at));
    const item = { key: c.key, entry: null, talk: null, customer: c, day: c.day, at: c.at };
    if (at < 0) items.push(item);
    else items.splice(at, 0, item);
  }
  const days: ConvDay[] = [];
  for (const { key, entry, talk, customer: c, day } of items) {
    const it: ConvItem = c ? { key, entry, talk, customer: c } : { key, entry, talk };
    const cur = days.at(-1);
    if (cur && cur.day === day) cur.items.push(it);
    else days.push({ day, label: dayLabel(day, today), items: [it] });
  }
  return days;
}

/** What follows a note's own words: every turn after the first of yours.
    A note filed before Tiff talked back says nothing, and one that made
    something says so: "Done.". */
export function repliesOf(turns: readonly EarlierTurn[], made: number): EarlierTurn[] {
  const first = turns.findIndex((t) => t.who === "you");
  const rest = first < 0 ? turns.filter((t) => t.who === "tiff") : turns.slice(first + 1);
  if (rest.length === 0 && made > 0) return [{ who: "tiff", text: "Done." }];
  return rest;
}

/* ── what a note made ── */

/** A task as a card's grey line, or a rail row's: who, then when.
    "Lyle, today by 12:30 pm"; "Lyle, Fri 16 Oct"; "Today by 12:30 pm". */
export function taskLine(
  t: { who: string | null; dueDate: string | null; time: string | null; by: boolean; done?: boolean },
  today: string | null,
): string {
  const when = t.dueDate ? dueWords(t.dueDate, today) : "";
  const clock = t.time ? `${t.by ? " by" : ","} ${t.time}` : "";
  const due = when ? `${when}${clock}` : "";
  const parts = [t.who, due].filter((p): p is string => !!p);
  const line = parts.length ? parts.join(", ") : "Nobody on it yet";
  const said = line.charAt(0).toUpperCase() + line.slice(1);
  return t.done ? `${said}. Done` : said;
}

function dueWords(day: string, today: string | null): string {
  if (today && day === today) return "today";
  if (today && day === plusDays(today, 1)) return "tomorrow";
  return fmtAuWeekdayDayMonth(day) || day;
}

/** The rows a filed record names, as they read now. A row not handed in
    has been deleted since. */
export type MadeLookups = {
  tasks: ReadonlyMap<string, { title: string; line: string }>;
  flags: ReadonlyMap<string, { message: string; active: boolean }>;
  issues: ReadonlyMap<string, string>;
};

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** A card for each thing a note made, in the order it was filed. The words
    it kept on the job are the message itself, so they are not a card. What
    has gone since is counted once, never named: it really was made, and it
    really isn't there now. */
export function madeCards(record: AppliedRecord, found: MadeLookups): MadeCard[] {
  const cards: MadeCard[] = [];
  let goneTasks = 0;
  for (const id of record.taskIds) {
    const t = found.tasks.get(id);
    if (t) cards.push({ key: `task:${id}`, kind: "task", name: t.title, line: t.line });
    else goneTasks++;
  }
  if (goneTasks) cards.push({ key: "gone:tasks", kind: "gone", name: count(goneTasks, "task", "tasks"), line: "Removed since" });
  for (const id of record.flagIds) {
    const f = found.flags.get(id);
    if (f) cards.push({ key: `flag:${id}`, kind: "flag", name: f.message, line: f.active ? "A flag on the job" : "Cleared" });
  }
  for (const id of record.issueIds) {
    const s = found.issues.get(id);
    if (s) cards.push({ key: `issue:${id}`, kind: "issue", name: s, line: "An issue logged" });
  }
  record.bringItems.forEach((b, i) => cards.push({ key: `bring:${i}`, kind: "bring", name: b, line: "To bring" }));
  record.entryLines.forEach((l, i) => cards.push({ key: `line:${i}`, kind: "line", name: l, line: "On the job" }));
  if (record.entryIds.length)
    cards.push({ key: "lines", kind: "line", name: count(record.entryIds.length, "line", "lines"), line: "On the project's journal" });
  record.kbTitles.forEach((k, i) => cards.push({ key: `kb:${i}`, kind: "library", name: k, line: "In the Library" }));
  return cards;
}

/* ── the rail ── */

/** Where it's up to, as one paragraph: the stored summary's points, or its
    one sentence. Null when nothing has been written yet. */
export function whereUpTo(summary: JobSummaryRead | null | undefined): string | null {
  if (!summary) return null;
  const points = summary.points.map((p) => p.trim()).filter(Boolean);
  const said = points.length ? points.map((p) => (/[.!?]$/.test(p) ? p : `${p}.`)).join(" ") : summary.lead.trim();
  return said || null;
}

export type NextVisit = {
  /** "Fri 16 Oct, 2:00 pm", or "Today, 7:00 am". */
  when: string;
  /** Who is booked, by name. */
  who: string | null;
  /** Where the time isn't settled: a word in orange. */
  state: { word: string; tone: Tone } | null;
};

/** The first visit ahead: everyone booked at the same start is its crew
    (the Visits face's own rule). A booking with no clock time is a day
    with its time to confirm; one of ours ServiceM8 doesn't hold yet says
    so. A leftover booking on a finished job is not a next visit. */
export function nextVisitOf(
  input: {
    booked?: readonly BookedEntry[] | null;
    nextBooking?: { start: string; end: string | null; staffName: string | null } | null;
  },
  today: string | null,
): NextVisit | null {
  const standing = (input.booked ?? []).filter((b) => !b.leftover);
  const first = standing[0] ?? null;
  const start = first?.start ?? (input.booked ? null : (input.nextBooking?.start ?? null));
  if (!start) return null;
  const end = first ? first.end : (input.nextBooking?.end ?? null);
  const crew = first
    ? standing.filter((b) => b.start === first.start && b.end === first.end)
    : [{ staffName: input.nextBooking?.staffName ?? null, ourRow: null, bookedOn: undefined }];
  const names = [...new Set(crew.map((b) => b.staffName?.trim()).filter((n): n is string => !!n))];
  const day = start.slice(0, 10);
  const dayWords = today && day === today ? "Today" : today && day === plusDays(today, 1) ? "Tomorrow" : fmtAuWeekdayDayMonth(day) || day;
  const noClock = /^\d{4}-\d{2}-\d{2}(?:[ T]00:00(?::00)?)?$/.test(start) && !end;
  const clock = noClock ? "" : stampClock(start);
  const unsent = crew.some((b) => !!b.ourRow && b.bookedOn === null);
  return {
    when: clock ? `${dayWords}, ${clock}` : dayWords,
    who: names.length ? andList(names) : null,
    state: noClock
      ? { word: "Time to confirm", tone: "look" }
      : unsent
        ? { word: "Not in ServiceM8 yet", tone: "look" }
        : null,
  };
}

function andList(names: readonly string[]): string {
  return names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

/** The job's open tasks for the rail, each once: the ones Tiff made from
    its notes and the ones New › Task put on it, soonest due first, then the
    order they came in. */
export function railTasksOf(
  rows: readonly { id: string; title: string; status: string; dueDate: string | null; line: string; assigneeId: string | null }[],
): RailTask[] {
  const seen = new Set<string>();
  const open: (typeof rows)[number][] = [];
  for (const r of rows) {
    if (r.status !== "open" || seen.has(r.id)) continue;
    seen.add(r.id);
    open.push(r);
  }
  return open
    .map((r, i) => ({ r, i }))
    .sort((a, b) => {
      const ad = a.r.dueDate ?? "9999";
      const bd = b.r.dueDate ?? "9999";
      return ad < bd ? -1 : ad > bd ? 1 : a.i - b.i;
    })
    .map(({ r }) => ({ id: r.id, title: r.title, line: r.line, assigneeId: r.assigneeId }));
}

/* ── money held back (decision 15) ── */

/* MONEY IN A JOB'S THREAD IS HELD BACK ON THE SERVER for whoever has no
   money access (`workboard_money`, the gate the job card's Billing and the
   diary's claims and payments already stand behind). What Tiff said and
   what she made can carry a figure: the cost lane's "Claimed: $85.00 at
   Reece", a cost that became a task, "Claim $85.00 at Reece", a total she
   gave from a quote. For a reader without the right each figure becomes
   words, never a blank, so the line still says what happened: "Claimed: a
   cost at Reece, fittings."

   WHAT A PERSON TYPED STAYS AS TYPED. A note's own words, and the answers
   its speaker gave Tiff, are that person's message to the job: the reader
   sees them word for word, figures included, as they would see the same
   words in ServiceM8. Only Tiff's side is rewritten. */

/** A dollar figure as Tiff writes one: "$85", "$1,240.50", "A$85", "$12k",
    with its GST said or not: "$85.00 plus GST". Or said in words: "85
    dollars". */
const FIGURE = String.raw`\d(?:[\d,]*\d)?(?:\.\d+)?`;
const AMOUNT = String.raw`(?:(?:A|AU)?\$\s?${FIGURE}(?:[kKmM]\b)?|\b${FIGURE}\s(?:dollars|bucks)\b)(?:\s(?:plus|inc|incl|including|ex|excl|excluding)\.?\s?GST)?`;

/** "The receipt says $92.40, so that's what I used.": a sentence that is
    only there to give the figure goes with it. */
const RECEIPT_FIGURE = new RegExp(String.raw`\s*The receipt says ${AMOUNT}, so that's what I used\.`, "g");
const AT_SUPPLIER = new RegExp(String.raw`${AMOUNT}(?=\s+at\s)`, "g");
const ANY_AMOUNT = new RegExp(AMOUNT, "g");
const PCT_BEFORE = /\b(?:an?\s)?\d+(?:\.\d+)?\s?%\s(margin|markup)\b/gi;
const PCT_AFTER = /\b((?:margin|markup|profit)(?:\s(?:of|is|was|at)|:)?\s)\d+(?:\.\d+)?\s?%/gi;
const SENTENCE_START = /(^|[.!?]\s+)(a cost|an amount|a margin|a markup)/g;

/** Tiff's words with every figure of money said as words: "$85 at Reece"
    is "a cost at Reece", any other figure "an amount", a margin "a margin".
    Words with no money in them come back as they were. */
export function withoutMoney(text: string): string {
  const out = text
    .replace(RECEIPT_FIGURE, "")
    .replace(AT_SUPPLIER, "a cost")
    .replace(ANY_AMOUNT, "an amount")
    .replace(PCT_BEFORE, (_m, what: string) => `a ${what.toLowerCase()}`)
    .replace(PCT_AFTER, (_m, lead: string) => `${lead}an amount`)
    .replace(SENTENCE_START, (_m, lead: string, words: string) => `${lead}${words[0]!.toUpperCase()}${words.slice(1)}`);
  return out;
}

/** A note's talk as a reader without money access gets it: Tiff's lines
    and the cards she made with their figures said in words; the speaker's
    own words, and their answers to her, as they were typed. */
export function talkWithoutMoney(talk: JobNoteTalk): JobNoteTalk {
  return {
    ...talk,
    /* `said` is the speaker's own message: it stays as typed */
    replies: talk.replies.map((r) => (r.who === "tiff" ? { ...r, text: withoutMoney(r.text) } : r)),
    made: talk.made.map((c) => ({ ...c, name: withoutMoney(c.name), line: withoutMoney(c.line) })),
  };
}
