"use client";

import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Button, IconButton } from "@/components/parts/button";
import { Fade } from "@/components/parts/fade";
import { StateWord, type Tone } from "@/components/parts/state";
import { Icon } from "@/components/shell/icon";
import { TiffGlyph } from "@/components/notes/tiff-mark";
import { appendSpoken, useDictation } from "@/components/notes/dictation";
import { CvBox } from "@/components/conversations/box";
import {
  AlsoSm8,
  NoteDoors,
  withMentions,
  type DiaryNotesSm8,
  type Doors,
  type NoteEntry,
} from "@/components/workboard/board/job-diary-face";
import type { Conversation, ModalTurn } from "@/components/tiff/modal/use-conversation";
import type { PlanRowView } from "@/components/tiff/modal/plan-view";
import { deleteDocument } from "@/app/actions/documents";
import { uploadFile } from "@/lib/documents/upload-client";
import { RECEIPT_ACCEPT } from "@/lib/expenses/claim";
import { fmtAuTime } from "@/lib/au-dates";
import { fmtAud } from "@/lib/workboard/project-money";
import { removeJobNote, saveJobNote } from "@/app/actions/job-notes";
import type { OurJobNote } from "@/lib/workboard/job-notes-query";
import { WindowsContext } from "@/components/records/records-context";
import { filterStory, fmtStoryMinutes, type StoryEntry, type StoryFilter } from "@/lib/workboard/job-story";
import { conversationDays, stampClock, todoTone, type FeedTodo, type JobConversationRead, type JobNoteTalk, type QuoteChat, type MadeCard, type MadeKind, type RailTask } from "@/lib/jobs/job-conversation";
import { Tick } from "@/components/parts/tick";
import { useTiff } from "@/components/tiff/modal/tiff-context";
import type { FlagState } from "@/lib/integrations/sm8-note-plan";
import type { NoteSender } from "@/lib/integrations/links";
import { JobSection } from "./job-section";
import { CommsView, CustomerSendRow, CustomerThreadView, FileDoor } from "./customer-thread";
import { pairClaims, withoutEchoes, type CommsThread, type CustomerItem } from "@/lib/jobs/customer-messages";

/* THE JOB'S ACTIVITY FEED (v2, step 6, slice A; the board JC-1; laid out
   again on Isaac's refined Overview A, 25 October 2026): the right column
   of a job's Overview, a section like the others, green with a bubble as
   Home's Your feed, its soft tabs (All, Notes, Photos) on the head's right.

   TIFF'S BOX FIRST, under the head, then the feed, NEWEST FIRST, a 12/500
   grey line between the days ("Today", "Yesterday", "Tue 20 Oct"). What
   you said in the box just now stands at the top, in the order it was
   said, as one exchange reads. A note is a 32 disc, the name in bold and
   the time in grey, then the words at 16; any other entry is a 32 row: a
   grey icon, the bold words, a grey line, at most one quiet button at the
   far right, and a photo entry its thumbnails under it.

   WHAT IT SHOWS:
     - every entry of the job's diary (lib/workboard/job-story, unchanged):
       a note as a message, with the person's initials, their name and the
       time, then the words; a visit, a booking, photos, money and the
       job's milestones as small cards in their place;
     - a note said by voice as a card, "Note from voice", round the words;
     - under a note somebody told Tiff, what she said back and a card for
       each thing she made, with Undo where `undoNote` would still take it
       back (lib/jobs/job-conversation; the note's own row says it);
     - a line between the days, "Today" for today's.

   The filter is the soft tabs', over what is already read.

   THE BOX IS THE ROUTER'S OWN DOOR. Send hands the words to the Tiff
   modal's conversation (components/tiff/modal/use-conversation), held
   here on the page rather than in the modal, aimed at this job: the same
   route, questions, filing and Undo, drawn where JC-1 draws them. A
   question she asks with answers to pick shows them as second buttons
   that answer. Save is the diary pen's path (`addJobNote`): the words kept
   word for word as a note on the job, Tiff filing nothing (Isaac, 24
   October 2026: "Instead of keep as typed, just hit save"). The ⓘ that
   said what each does went on the walk of 25 October 2026 (no hint text).

   ADD PHOTO, the box's second button as JC-1 draws it. A photo picked or
   taken uploads at once, as the expense form uploads a receipt
   (`uploadFile(file, "receipt")`, my-expenses-face), and sits in the box
   as a small chip with a clear. Send hands its id to the router with the
   words as `receiptId`, and the cost lane reads it with today's receipt
   reader (note-cost-file). Nothing in the router puts a photo on a job's
   note or its photos today, so a photo that isn't a receipt goes nowhere
   else, and Tiff says nothing of it. Save keeps the words only: the photo
   stays in the box for Send.

   NOTHING THE DIARY DID IS LOST: its filters are the soft tabs at the
   head; a note's line and doors (Remove, Send to ServiceM8, Mark done,
   Reply) are the diary's own `NoteDoors`; the Also in ServiceM8 tick is
   the pen's; a flagged note an attention row sent you to is lit and
   brought into view; the strip's Reply opens its box. */

/** The feed's views: the diary's, and Comms, every text and email with the
    customer as a phone shows them, and nothing else (Isaac, 26 October
    2026: "Yes, build the Comms tab as mocked"; it was Customer). */
type FeedFilter = Extract<StoryFilter, "all" | "notes" | "photos"> | "comms" | "todo" | "tiff";

const NONE: CustomerItem[] = [];
const NO_COMMS: CommsThread[] = [];

/* All, To do, Comms, Notes, Photos, Tiff (Isaac, 14 November 2026: "Put it
   next to all", mock D); To do and Tiff always show, so the row never shifts
   and a job's first To do has somewhere to be added */
const FILTERS: { key: FeedFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "todo", label: "To do" },
  { key: "comms", label: "Comms" },
  { key: "notes", label: "Notes" },
  { key: "photos", label: "Photos" },
  { key: "tiff", label: "Tiff" },
];

/** The box's words on each tab: none on Comms, where a thread's own Reply answers a customer (call 18). */
const BOX_WORDS: Partial<Record<FeedFilter, string>> = {
  all: "Write a note on this job",
  notes: "Write a note on this job",
  photos: "Write a note on this job",
  todo: "Add a to do",
  tiff: "Ask Tiff about this job",
};

/** The job's To dos as the feed draws them (Isaac, 14 November 2026, mock D). */
export type FeedTodos = {
  tasks: RailTask[];
  done: NonNullable<JobConversationRead["done"]>;
  /** read: empty means none, not not-yet */
  read: boolean;
  onTick: (task: RailTask) => void;
  /** a To do's own form, over the page */
  onOpen?: (taskId: string) => void;
  /** What's open on the job, an ask in a note or a flag: it heads Open. */
  open?: ReactNode;
  openCount?: number;
  /** Save on the To do tab: the words as written, a To do for you on the job. */
  onAdd?: (words: string) => Promise<boolean>;
};

/** The diary's doors and what the card holds for them. */
export type ConversationDiary = {
  onOpenClaim: (remoteId: string) => void;
  onPhotos: () => void;
  onRemoveNote?: (id: string) => void;
  sender: NoteSender | null;
  notesSm8: DiaryNotesSm8 | null;
  flags: Record<string, FlagState>;
  flagsBusy: ReadonlySet<string>;
  focusFlagged?: boolean;
  replyFor?: string | null;
  onReplyShown?: () => void;
  onReply?: Doors["onReply"];
  onSendCopy?: Doors["onSendCopy"];
  onTakeBack?: Doors["onTakeBack"];
  onMarkDone?: Doors["onMarkDone"];
  onUndoDone?: Doors["onUndoDone"];
  onConfirm?: Doors["onConfirm"];
  /** A note saved with Save, and the same note taken back by the toast's
      Undo. Activity is drawn from the card's own notes, not from this
      conversation, so the card is told of each (Isaac's walk of 9 November
      2026: a saved note didn't show until a reload). */
  onNoteSaved?: (note: OurJobNote) => void;
  onNoteUndone?: (id: string) => void;
  /** The Quote tab, from a Quote sent entry. */
  onQuote?: () => void;
  /** The job's number, for that entry's button: "Open quote #3385". */
  jobNumber?: string | null;
  /** How the page opens one of the job's files by its ServiceM8 uuid, in
      the viewer its Documents and Photos use; null where it can't. */
  openFile?: (id: string) => (() => void) | null;
};

const NO_FILE = () => null;

/** A flag's tone, in the state words' own (rule 17). */
const FLAG_TONE: Record<string, Tone> = { ok: "good", warn: "look", bad: "wrong" };

const MADE_ICON: Record<MadeKind, string> = {
  task: "listCheck",
  flag: "alert",
  issue: "alert",
  bring: "box",
  line: "note",
  library: "library",
  gone: "minus",
};

const LANE_ICON: Record<PlanRowView["lane"], string> = {
  tasks: "listCheck",
  flags: "alert",
  issueEntries: "alert",
  bringItems: "box",
  progressBullets: "note",
  commissioningEntries: "note",
  kbEntries: "library",
  calendar: "calendar",
  visits: "calendar",
  costs: "receipt",
  variations: "file",
};

export function JobConversation({
  story,
  talks,
  today,
  loading,
  diary,
  convo,
  canSend,
  viewerName,
  voiceEnabled,
  onUndoTalk,
  jobUuid = null,
  onSaved,
  customer = NONE,
  comms = NO_COMMS,
  todos = null,
  askTodo = 0,
  quoteChat = null,
}: {
  /** The diary's entries, newest first, as job-story builds them. */
  story: StoryEntry[];
  /** What Tiff said back to each note, and what she made. */
  talks: JobNoteTalk[];
  today: string | null;
  loading: boolean;
  moneyVisible: boolean;
  diary: ConversationDiary;
  /** The conversation the box drives (use-conversation). */
  convo: Conversation;
  /** The card knows which job this is. */
  canSend: boolean;
  viewerName: string | null;
  voiceEnabled: boolean;
  /** Undo on a note told to Tiff before: what it made is taken back
      (`undoNote`), and the conversation reads again. */
  onUndoTalk?: (noteId: string) => Promise<unknown>;
  /** The job Save files on. */
  jobUuid?: string | null;
  /** A note Save filed, or its Undo took back: the feed reads again. */
  onSaved?: () => void;
  /** The customer's threads and ServiceM8's sends (customer-messages). */
  customer?: CustomerItem[];
  /** Every text and email with the customer, as Comms shows them. */
  comms?: CommsThread[];
  /** The job's To dos, on their tab and in All on the day each was made. */
  todos?: FeedTodos | null;
  /** Bumped by Actions' Add › To do: the To do tab, its box ready to type in. */
  askTodo?: number;
  /** The quote's chat with Tiff, listed on the Tiff tab with Open in Price. */
  quoteChat?: QuoteChat | null;
}) {
  const [filter, setFilter] = useState<FeedFilter>("all");
  /* a row the customer's messages already say ("Quote sent") is said once */
  const unechoed = useMemo(() => withoutEchoes(story, customer), [story, customer]);
  /* an invoice's send and the claim raised for it are one row: the send's, with the claim's name and Open */
  const claims = useMemo(() => pairClaims(story, customer), [story, customer]);
  /* the days a quote's send stands in for the "Quote sent" row: it keeps that row's door */
  const quoteDays = useMemo(() => {
    const kept = new Set(unechoed);
    return new Set(story.flatMap((e) => (e.kind === "milestone" && e.label === "Quote sent" && !kept.has(e) ? [e.day] : [])));
  }, [story, unechoed]);
  /* the Tiff tab is the notes told to her, with what she said back */
  const toldTiff = useMemo(() => new Set(talks.filter((t) => t.replies.length > 0 || t.made.length > 0).map((t) => t.id)), [talks]);
  const shown = useMemo(
    () =>
      filter === "comms" || filter === "todo"
        ? []
        : filter === "tiff"
          ? unechoed.filter((e) => e.kind === "note" && !!e.id && toldTiff.has(e.id))
          : filterStory(unechoed, filter),
    [unechoed, filter, toldTiff],
  );
  /* TO DOS IN ALL, each on the day it was made (call 6), ticked or not */
  const feedTodos = useMemo<FeedTodo[]>(
    () =>
      todos
        ? [
            ...todos.tasks.map((t) => ({ ...t, done: false })),
            ...todos.done.map((t) => ({ id: t.id, title: t.title, line: t.line, assigneeId: null, forLine: t.line, by: t.by ?? null, day: t.day ?? null, at: t.at ?? null, time: t.time ?? null, done: true })),
          ]
        : [],
    [todos],
  );
  const tone = todos ? todoTone(todos.tasks) : null;
  /* Add › To do, and the strip's Reply or a flag's door: the feed goes where
     it was sent */
  const [askSeen, setAskSeen] = useState(askTodo);
  if (askTodo !== askSeen) {
    setAskSeen(askTodo);
    if (askTodo > 0) setFilter("todo");
  }
  const sentTo = diary.replyFor ?? (diary.focusFlagged ? "flagged" : null);
  const [sentSeen, setSentSeen] = useState<string | null>(null);
  if (sentTo !== sentSeen) {
    setSentSeen(sentTo);
    if (sentTo) setFilter("all");
  }
  /* the door a send keeps from the row it stands in for: the quote's, or the claim's Open */
  const sendDoor = (send: Extract<CustomerItem, { kind: "send" }>): { label: string; onOpen: () => void } | null => {
    const claim = claims.get(send.key);
    if (claim) return { label: "Open", onOpen: () => diary.onOpenClaim(claim.remoteId) };
    if (send.sort === "quote" && diary.onQuote && quoteDays.has(send.day)) {
      return { label: diary.jobNumber ? `Open quote #${diary.jobNumber}` : "Open the quote", onOpen: diary.onQuote };
    }
    return null;
  };
  const theirs = filter === "all" ? customer : NONE;
  const live = convo.turns;
  const liveNotes = useMemo(() => new Set(live.flatMap((t) => (t.noteId ? [t.noteId] : []))), [live]);
  /* LIKE A CHAT (Isaac, 14 November 2026, mock D): oldest at the top, the
     newest at the foot over the box */
  const days = useMemo(
    () =>
      conversationDays(
        shown,
        filter === "comms" || filter === "todo" ? [] : filter === "tiff" ? talks.filter((t) => toldTiff.has(t.id)) : talks,
        today,
        liveNotes,
        filter === "all" || filter === "notes" || filter === "tiff",
        theirs,
        filter === "all" ? feedTodos : [],
        filter === "tiff" ? quoteChat : null,
      )
        /* ALL SHOWS WHAT SHE SAVED, NOT THE CHAT (Isaac, 14 November 2026,
           mock E): a note told to her that only made To dos is those To dos,
           which stand on their own; any other stands as the note, with no
           chat under it. The chat is the Tiff tab's. */
        .map((d) =>
          filter !== "all"
            ? d
            : {
                ...d,
                items: d.items.flatMap((i) =>
                  i.talk && toldTiff.has(i.talk.id) && !i.talk.undone
                    ? i.talk.made.length > 0 && i.talk.made.every((m) => m.kind === "task")
                      ? []
                      : [{ ...i, talk: null }]
                    : [i],
                ),
              },
        )
        .filter((d) => d.items.length > 0),
    [shown, talks, today, liveNotes, filter, theirs, feedTodos, toldTiff, quoteChat],
  );
  const you = viewerName ?? "You";

  /* THE TIMES OF WHAT YOU SAY HERE, read in the press (never in render):
     the n-th of your turns below took the n-th. Tiff's answer wears the
     time of what it answers. */
  const [said, setSaid] = useState<string[]>([]);
  const stamp = () => setSaid((s) => [...s, fmtAuTime(new Date())]);

  /* the doors a note offers, the diary's own */
  const doors: Doors = {
    sender: diary.sender,
    notesSm8: diary.notesSm8,
    flags: diary.flags,
    flagsBusy: diary.flagsBusy,
    onReply: diary.onReply,
    onSendCopy: diary.onSendCopy,
    onTakeBack: diary.onTakeBack,
    onMarkDone: diary.onMarkDone,
    onUndoDone: diary.onUndoDone,
    onConfirm: diary.onConfirm,
    onRemoveNote: diary.onRemoveNote,
  };

  /* A FLAGGED NOTE an attention row sent you to, lit and brought into view;
     the strip's Reply opens its box there. One reply box at a time. */
  const flagKey = diary.focusFlagged
    ? (shown.find((e) => e.kind === "note" && e.actionRequired)?.key ?? null)
    : null;
  const [replying, setReplying] = useState<string | null>(null);
  const replyKey = diary.replyFor
    ? (shown.find((e) => e.kind === "note" && e.sm8Uuid === diary.replyFor)?.key ?? null)
    : null;
  const openKey = replyKey ?? replying;
  const openReply = (key: string | null) => {
    setReplying(key);
    if (diary.replyFor) diary.onReplyShown?.();
  };
  const litRef = useRef<HTMLElement | null>(null);
  const lit = replyKey ?? flagKey;
  useEffect(() => {
    if (lit) litRef.current?.scrollIntoView?.({ block: "center" });
  }, [lit]);

  /* the box's microphone: words said land in the box, and go as voice */
  const [voiceErr, setVoiceErr] = useState<string | null>(null);
  const [ranOut, setRanOut] = useState(false);
  const { setDraft, markSpoken } = convo;
  const dict = useDictation({
    onTranscript: (words, { capped }) => {
      setVoiceErr(null);
      setRanOut(capped);
      markSpoken();
      setDraft((prev) => appendSpoken(prev, words));
    },
    onError: setVoiceErr,
  });

  const working = convo.stage === "thinking" || convo.stage === "answering";

  /* ADD PHOTO: the receipt uploads as it is picked; Send carries its id */
  const [photo, setPhoto] = useState<BoxPhoto | null>(null);
  const picker = useRef<HTMLInputElement | null>(null);
  const picks = useRef(0);
  const previewUrl = useRef<string | null>(null);
  const show = (url: string | null) => {
    if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
    previewUrl.current = url;
  };
  useEffect(
    () => () => {
      const url = previewUrl.current;
      if (url) URL.revokeObjectURL(url);
    },
    [],
  );
  const pick = (file: File | undefined) => {
    if (picker.current) picker.current.value = "";
    if (!file) return;
    const mine = ++picks.current;
    show(null);
    setPhoto({ state: "up", name: file.name });
    void uploadFile(file, "receipt")
      .catch(() => ({ ok: false as const, error: "That photo didn't upload. Try it again." }))
      .then((up) => {
        if (picks.current !== mine) {
          /* cleared, or another picked, while it went up: it is nobody's now */
          if (up.ok) void deleteDocument(up.file.documentId).catch(() => undefined);
          return;
        }
        if (!up.ok) return setPhoto({ state: "bad", error: up.error });
        show(up.file.previewUrl);
        setPhoto({ state: "ready", id: up.file.documentId, name: up.file.fileName, preview: up.file.previewUrl });
      });
  };
  /** The chip's clear: the upload goes with it, as nothing will adopt it. */
  const clearPhoto = () => {
    picks.current++;
    if (photo?.state === "ready") void deleteDocument(photo.id).catch(() => undefined);
    show(null);
    setPhoto(null);
  };

  /* THE ARROW OPENS HER WINDOW (Isaac, 14 November 2026, mock E): the job's
     docked Tiff with only its ×, the words sent as it opens; she saves each
     decision as she makes it, with Undo, and closing lets her finish. On the
     To do tab the words go as said in a task list, so she makes it a To do
     and sets who and when (call 8). A photo still goes with the words here. */
  const tiff = useTiff();
  const boxRef = useRef<HTMLDivElement | null>(null);
  const send = () => {
    if (!canSend || !convo.draft.trim() || photo?.state === "up") return;
    if (!photo) {
      const from = (document.activeElement as HTMLElement | null) ?? boxRef.current;
      if (from && tiff.open({ from, words: convo.draft.trim(), room: filter === "todo" ? "tasks" : "diary", onJob: true })) {
        convo.setDraft("");
        return;
      }
    }
    stamp();
    convo.aimRoom(filter === "todo" ? "tasks" : null);
    if (photo?.state === "ready") {
      convo.sendWithReceipt(photo.id);
      /* the claim adopts it now: the chip goes, the document stays */
      picks.current++;
      show(null);
      setPhoto(null);
    } else convo.send();
  };

  /* SAVE: the words as written, on the job, with no Tiff, and on to
     ServiceM8 as any job note goes (Isaac, 6 November 2026: "Save creates a
     raw note, tiff processes it like she does today"). It took the place of
     My notes only: a note just for you is made in Notes ("have a my notes
     section, then add new note. It will stay contained to you there"). */
  const host = useContext(WindowsContext);
  /* why your notes can't go to ServiceM8 yet, under the box */
  const sm8Why = !!diary.notesSm8;
  const [saving, setSaving] = useState(false);
  const save = () => {
    const words = convo.draft.trim();
    if (!words || saving || !jobUuid) return;
    /* ON THE TO DO TAB Save adds it as written, a To do for you with no date
       (call 8); the toast's Undo is the To do's own */
    if (filter === "todo" && todos?.onAdd) {
      setSaving(true);
      void todos
        .onAdd(words)
        .then((ok) => {
          if (ok) convo.setDraft("");
        })
        .finally(() => setSaving(false));
      return;
    }
    setSaving(true);
    void saveJobNote(jobUuid, words, { id: crypto.randomUUID() })
      .then((note) => {
        convo.setDraft("");
        diary.onNoteSaved?.(note);
        onSaved?.();
        host?.toast("Saved", () =>
          void removeJobNote(note.id).then(() => {
            diary.onNoteUndone?.(note.id);
            onSaved?.();
          }),
        );
      })
      .catch(() => host?.toast("Couldn't save that note."))
      .finally(() => setSaving(false));
  };

  /* UNDO ON AN EARLIER NOTE: one press, one answer */
  const [undoing, setUndoing] = useState<ReadonlySet<string>>(new Set());
  const undoTalk = onUndoTalk
    ? (noteId: string) => {
        if (undoing.has(noteId)) return;
        setUndoing((s) => new Set(s).add(noteId));
        void onUndoTalk(noteId).finally(() =>
          setUndoing((s) => {
            const next = new Set(s);
            next.delete(noteId);
            return next;
          }),
        );
      }
    : null;
  const timeOf = (t: ModalTurn): string => {
    const i = live.indexOf(t);
    const mine = live.slice(0, i + 1).filter((x) => x.who === "you").length - 1;
    return said[Math.max(0, Math.min(mine, said.length - 1))] ?? "";
  };
  const lastTiff = [...live].reverse().find((t) => t.who === "tiff") ?? null;

  const empty = !loading && story.length === 0 && talks.length === 0 && live.length === 0 && customer.length === 0 && comms.length === 0;

  /* THE FILTER: the soft tabs' dress (rule 29), but buttons that say
     whether they are pressed, each its own stop for the keyboard (the walk
     of 25 October 2026: they were tabs with one stop between them) */
  const tabs = (
    <div className="pt-vtabs jc-filter" role="group" aria-label="Show in the feed">
      {FILTERS.map((f) => {
        /* To do's word: amber when one is due today, red when one is overdue (call 7) */
        const t = f.key === "todo" ? tone : null;
        return (
          <button
            key={f.key}
            type="button"
            className={t ? `pt-vtab pt-vtab--${t}` : "pt-vtab"}
            aria-pressed={filter === f.key}
            onClick={() => setFilter(f.key)}
          >
            <span className="pt-vtab-word">{f.label}</span>
            {t && <span className="pt-tabs-sr">, {t === "wrong" ? "one is overdue" : "one is due today"}</span>}
          </button>
        );
      })}
    </div>
  );
  const footRef = useRef<HTMLDivElement | null>(null);
  const toldTo = useRef(0);
  useEffect(() => {
    if (askTodo <= toldTo.current || filter !== "todo") return;
    toldTo.current = askTodo;
    footRef.current?.querySelector("textarea")?.focus();
  }, [askTodo, filter]);
  /* OPEN CHAT, on the Tiff tab: her window again with what was said, ready
     to carry on (mock E) */
  const openChat = (talk: JobNoteTalk) => {
    const from = (document.activeElement as HTMLElement | null) ?? boxRef.current;
    if (!from) return;
    tiff.open({ from, conversation: [{ who: "you", text: talk.said }, ...talk.replies], room: "diary", onJob: true });
  };

  /* the box's own exchange stands under "Today" at the foot, after the day's
     older entries, with no second "Today" */
  const liveShown = live.length > 0 && (filter === "all" || filter === "notes" || filter === "tiff");
  const todayDrawn = days.at(-1)?.label === "Today";

  /* THE FEED HOLDS ITS PLACE (the plan's rules): it opens at the newest; a
     new entry follows you down only while you're at the foot; a picture
     keeps its room while it loads, and one that grows above you moves
     nothing you're reading (the scroller's own anchoring) */
  const feedRef = useRef<HTMLDivElement | null>(null);
  const atFoot = useRef(true);
  const onFeedScroll = () => {
    const el = feedRef.current;
    if (el) atFoot.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
  };
  useLayoutEffect(() => {
    const el = feedRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    atFoot.current = true;
  }, [filter]);
  const grew = `${days.length}:${days.at(-1)?.items.length ?? 0}:${live.length}:${working}`;
  useLayoutEffect(() => {
    const el = feedRef.current;
    if (el && atFoot.current) el.scrollTop = el.scrollHeight;
  }, [grew]);
  /* the card taking its fitted height, or a picture at the foot loading,
     keeps you at the foot if that's where you were */
  useEffect(() => {
    const el = feedRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const keep = () => {
      if (atFoot.current) el.scrollTop = el.scrollHeight;
    };
    const seen = new ResizeObserver(keep);
    seen.observe(el);
    for (const child of Array.from(el.children)) seen.observe(child);
    return () => seen.disconnect();
  }, [grew, filter]);

  return (
    <OpenChat.Provider value={filter === "tiff" ? openChat : null}>
    <UndoTalk.Provider value={undoTalk ? { undo: undoTalk, busy: undoing } : null}>
    <FileDoor.Provider value={diary.openFile ?? NO_FILE}>
    <JobSection name="Activity feed" icon="chat" hue="green" className="jc-convo" action={tabs}>
      <div className="jc-feed" ref={feedRef} onScroll={onFeedScroll}>
        {/* TO DO (Isaac, 14 November 2026, mock D): Open, headed by what's
            open on the job, then Done */}
        {filter === "todo" && todos && <TodoTab todos={todos} />}

        {/* a job with nothing on it yet is an empty card down to its box,
            with no words in it (mock C; no hint text) */}
        {loading && story.length === 0 ? (
          <p className="jov-none">Reading the job&rsquo;s notes from the mirror</p>
        ) : empty || filter === "all" || filter === "todo" ? null : (filter === "comms" ? comms.length === 0 : shown.length === 0 && !(filter === "tiff" && liveShown)) ? (
          <p className="jov-none">Nothing of that kind on the job.</p>
        ) : null}

        {/* COMMS: the messages alone, oldest first, as a phone shows them */}
        {filter === "comms" && comms.length > 0 && <CommsView threads={comms} />}

        {days.map((day) => (
          <div className="jc-day" key={day.day}>
            <p className="jc-dayname">{day.label}</p>
            {day.items.map((item) =>
              item.customer ? (
                item.customer.kind === "thread" ? (
                  <CustomerThreadView key={item.key} thread={item.customer} />
                ) : (
                  <CustomerSendRow
                    key={item.key}
                    send={item.customer}
                    claim={claims.get(item.customer.key)?.title ?? null}
                    door={sendDoor(item.customer)}
                  />
                )
              ) : item.entry?.kind === "note" ? (
                <NoteMessage
                  key={item.key}
                  entry={item.entry}
                  talk={item.talk}
                  doors={doors}
                  you={you}
                  lit={item.key === lit}
                  litRef={item.key === lit ? litRef : undefined}
                  replyOpen={openKey === item.key}
                  onReplyOpen={(on) => openReply(on ? item.key : null)}
                />
              ) : item.entry ? (
                <EventCard
                  key={item.key}
                  entry={item.entry}
                  onOpenClaim={diary.onOpenClaim}
                  onPhotos={diary.onPhotos}
                  onQuote={diary.onQuote}
                  jobNumber={diary.jobNumber ?? null}
                />
              ) : item.talk ? (
                <div className="jc-entry" key={item.key}>
                  <TalkMessage talk={item.talk} you={you} />
                </div>
              ) : item.quote ? (
                <div className="jc-entry" key={item.key}>
                  <TiffTurn
                    when={item.quote.time}
                    doors={
                      diary.onQuote ? (
                        <button type="button" className="jc-bmdoor" onClick={diary.onQuote}>
                          Open in Price
                        </button>
                      ) : null
                    }
                  >
                    <div className="cv-text">
                      <p>{item.quote.text}</p>
                    </div>
                  </TiffTurn>
                </div>
              ) : item.todo && todos ? (
                <div className="jc-entry" key={item.key}>
                  <TodoRow todo={item.todo} todos={todos} inAll />
                </div>
              ) : null,
            )}
          </div>
        ))}

        {/* WHAT YOU SAID HERE JUST NOW, and what Tiff said back: the newest,
            at the foot, in the order it was said */}
        {liveShown && (
          <div className="jc-day">
            {!todayDrawn && <p className="jc-dayname">Today</p>}
            {live.map((t) =>
              t.who === "you" ? (
                <div className="jc-entry" key={t.key}>
                  <Bubble mine who={you} text={t.text} meta={<span>{timeOf(t)}</span>} />
                </div>
              ) : (
                <div className="jc-entry" key={t.key}>
                  <LiveTiff
                    turn={t}
                    when={timeOf(t)}
                    asking={convo.questionOpen && t === lastTiff}
                    onAnswer={(q) => {
                      stamp();
                      convo.answer(q);
                    }}
                    onUndo={(noteId) => void convo.undo(t.key, noteId)}
                    onAddOffer={() => void convo.addOffer(t.key)}
                  />
                </div>
              ),
            )}
            {working && (
              <div className="jc-entry">
                <TiffTurn working when="">
                  <p className="cv-now">Working through it</p>
                </TiffTurn>
              </div>
            )}
          </div>
        )}
      </div>
      {/* the job's box goes while her window is open: one place to type (call 17) */}
      {filter !== "comms" && !tiff.isOpen && (
        <div
          className="jc-foot"
          ref={(el) => {
            footRef.current = el;
            boxRef.current = el;
          }}
        >
          <CvBox
            value={convo.draft}
            onChange={convo.setDraft}
            onSubmit={send}
            label={BOX_WORDS[filter] ?? "Write a note on this job"}
            placeholder={BOX_WORDS[filter] ?? "Write a note on this job"}
            sendWord="Tiff"
            sendLabel="Send to Tiff"
            onSave={!photo && canSend ? save : undefined}
            saving={saving}
            waiting={working || !canSend || photo?.state === "up"}
            dict={voiceEnabled ? dict : null}
            voiceError={voiceErr}
            ranOut={ranOut}
            before={photo ? <PhotoChip photo={photo} onClear={clearPhoto} /> : null}
            lead={
              /* the + (a photo or a file, Isaac, 26 October 2026: "Add photo
                 should be the plus button"); a photo goes to Tiff, so Save
                 steps aside while one is on */
              <span className="jc-lead">
                {!photo && (
                  <button type="button" className="cv-rnd" aria-label="Add a photo or a file" disabled={!canSend} onClick={() => picker.current?.click()}>
                    <Icon name="plus" size={20} sw={2} />
                  </button>
                )}
              </span>
            }
          />
          <input
            ref={picker}
            type="file"
            accept={RECEIPT_ACCEPT}
            hidden
            aria-label="Add a photo or a file"
            onChange={(e) => pick(e.target.files?.[0])}
          />
          {/* why the tick can't send yet, and its Yes / Not me, under the box */}
          {sm8Why && <AlsoSm8 part="why" also={false} onTick={() => {}} sender={diary.sender} notesSm8={diary.notesSm8!} onConfirm={diary.onConfirm} />}
        </div>
      )}
    </JobSection>
    </FileDoor.Provider>
    </UndoTalk.Provider>
    </OpenChat.Provider>
  );
}

/** A To do: its tick, its words the door to its own form, who it's for and
    when it's due under them, red once it's overdue (call 7). In All it reads
    like a note: who made it above, the time below (call 6, mock D). */
function TodoRow({ todo, todos, inAll = false }: { todo: FeedTodo; todos: FeedTodos; inAll?: boolean }) {
  const task = todos.tasks.find((t) => t.id === todo.id) ?? null;
  const line = todo.done ? todo.line : (todo.forLine ?? todo.line);
  return (
    <article className={`jc-todo${todo.done ? " jc-todo--done" : ""}`}>
      {inAll && todo.by && <p className="jc-bmname">{todo.by}</p>}
      <div className="jc-todorow">
        {todo.done ? (
          <Tick checked onChange={() => {}} disabled label={<span className="sr-only">Done, {todo.title}</span>} />
        ) : (
          <Tick checked={false} onChange={() => task && todos.onTick(task)} label={<span className="sr-only">Done, {todo.title}</span>} />
        )}
        <button type="button" className="jc-task jov-taskopen" onClick={() => todos.onOpen?.(todo.id)}>
          <span className="jc-task-name">{todo.title}</span>
          <span className={`jc-task-line${todo.tone === "wrong" && !todo.done ? " jc-task-line--late" : ""}`}>{line}</span>
        </button>
      </div>
      {inAll && todo.time && <p className="jc-bmtime">{todo.time}</p>}
    </article>
  );
}

/** The To do tab: Open, headed by what's open on the job (an ask in a note,
    a flag, with their own doors), then Done, ticked in the last fortnight. */
function TodoTab({ todos }: { todos: FeedTodos }) {
  const open = todos.tasks.map((t) => ({ ...t, done: false }));
  const done = todos.done.map((t) => ({ id: t.id, title: t.title, line: t.line, assigneeId: null, done: true }) as FeedTodo);
  const asks = todos.open && (todos.openCount ?? 0) > 0;
  if (!asks && open.length === 0 && done.length === 0)
    return <p className="jov-none">{todos.read ? "Nothing to do on it." : "Reading the job's to dos"}</p>;
  return (
    <>
      {(asks || open.length > 0) && (
        <div className="jc-day">
          <p className="jc-dayname">Open</p>
          {asks && <div className="jc-entry jov-asks">{todos.open}</div>}
          {open.map((t) => (
            <div className="jc-entry" key={t.id}>
              <TodoRow todo={t} todos={todos} />
            </div>
          ))}
        </div>
      )}
      {done.length > 0 && (
        <div className="jc-day">
          <p className="jc-dayname">Done</p>
          {done.map((t) => (
            <div className="jc-entry" key={t.id}>
              <TodoRow todo={t} todos={todos} />
            </div>
          ))}
        </div>
      )}
    </>
  );
}

/** The photo in the box: going up, ready to go with Send, or refused. */
type BoxPhoto =
  | { state: "up"; name: string }
  | { state: "ready"; id: string; name: string; preview: string | null }
  | { state: "bad"; error: string };

/** The photo's chip in the box, with its clear. A refused upload says why
    in its place, and the clear takes it away. */
function PhotoChip({ photo, onClear }: { photo: BoxPhoto; onClear: () => void }) {
  if (photo.state === "bad") {
    return (
      <div className="jc-photo jc-photo--bad">
        <p className="jc-photo-why" role="alert">
          <StateWord tone="wrong">{photo.error}</StateWord>
        </p>
        <IconButton glyph="clear" label="Clear the photo" size={32} onClick={onClear} />
      </div>
    );
  }
  return (
    <div className="jc-photo" role="group" aria-label="The photo going with your words">
      {photo.state === "ready" && photo.preview ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img className="jc-photo-thumb" src={photo.preview} alt="" />
      ) : (
        <span className="jc-photo-thumb" aria-hidden="true">
          <Icon name="cam" size={16} />
        </span>
      )}
      {photo.state === "up" ? (
        <span className="jc-photo-name" role="status">
          Uploading the photo
        </span>
      ) : (
        <Fade className="jc-photo-name">{photo.name}</Fade>
      )}
      <IconButton glyph="clear" label="Clear the photo" size={32} onClick={onClear} />
    </div>
  );
}

/** Undo on an earlier note's cards, from the conversation that reads it. */
const UndoTalk = createContext<{ undo: (noteId: string) => void; busy: ReadonlySet<string> } | null>(null);

/** Open chat, on the Tiff tab: the chat had about a note, in her window again. */
const OpenChat = createContext<((talk: JobNoteTalk) => void) | null>(null);

/* ── the conversation's sides (Isaac, 26 October 2026) ──
   Your words on the right and everyone else's on the left, both in the
   light grey; Tiff on the left with no bubble, her mark turning slowly
   beside her name ("She can turn slowly, given that you won't have an extra
   one down the bottom of the page"). Green stays the customer's thread's
   alone, so a green bubble is always a text the customer got. */

/** One person's words, in a bubble on their side, with its time and doors
    under it (`meta`), and anything that hangs off the words (`after`). */
function Bubble({
  mine,
  who,
  text,
  lit = false,
  litRef,
  after,
  meta,
}: {
  mine: boolean;
  who: string;
  text: string;
  lit?: boolean;
  litRef?: React.Ref<HTMLElement>;
  after?: ReactNode;
  meta?: ReactNode;
}) {
  return (
    <div className="jc-talk">
      <article className={["jc-bm", mine ? "jc-bm--you" : "jc-bm--them", "jc-bm--first", "jc-bm--last", lit ? "jc-lit" : ""].filter(Boolean).join(" ")} ref={litRef}>
        <p className="jc-bmname">{who}</p>
        <div className="jc-bubble">
          <span className="jc-bubwords">{withMentions(text)}</span>
        </div>
        {after}
        {meta && <div className="jc-bmtime jc-bmmeta">{meta}</div>}
      </article>
    </div>
  );
}

/** Spoken, not typed: a mic beside the time. */
const Spoken = () => (
  <span className="jc-bmmic" role="img" aria-label="Said aloud">
    <Icon name="mic" size={12} />
  </span>
);

/** One of Tiff's turns: her mark and her name, her words with no bubble,
    then whatever she made and the time. */
function TiffTurn({ when, working = false, doors = null, children }: { when: string; working?: boolean; doors?: ReactNode; children: ReactNode }) {
  return (
    <article className="jc-tiffturn">
      <p className="jc-tiffname">
        <TiffGlyph size={18} alive working={working} />
        <b>Tiff</b>
      </p>
      {children}
      {(when || doors) && (
        <p className="jc-bmtime jc-bmmeta">
          {when && <span>{when}</span>}
          {doors}
        </p>
      )}
    </article>
  );
}

/** A note on the job: ServiceM8's or ours, then what Tiff said back. A note
    Tiff tidied keeps the words as they were said behind As said. */
function NoteMessage({
  entry,
  talk,
  doors,
  you,
  lit,
  litRef,
  replyOpen,
  onReplyOpen,
}: {
  entry: NoteEntry;
  talk: JobNoteTalk | null;
  doors: Doors;
  /** the viewer's name, for a note read without the diary's `mine` */
  you: string;
  lit: boolean;
  litRef?: React.Ref<HTMLElement>;
  replyOpen: boolean;
  onReplyOpen: (on: boolean) => void;
}) {
  const ours = entry.origin === "heytiff";
  const flag = !ours && entry.sm8Uuid ? (doors.flags[entry.sm8Uuid] ?? null) : null;
  const who = entry.author?.trim() || talk?.authorName || (ours ? "Someone on the team" : "ServiceM8");
  const mine = ours && (entry.mine ?? who === you);
  const said = talk?.said.trim() ?? "";
  const tidied = !!said && said !== entry.text.trim();
  const [asSaid, setAsSaid] = useState(false);
  return (
    <div className="jc-entry">
      <Bubble
        mine={mine}
        who={who}
        text={entry.text}
        lit={lit}
        litRef={litRef}
        after={tidied && asSaid ? <p className="jc-said">{said}</p> : null}
        meta={
          <>
            <span>{stampClock(entry.at)}</span>
            {talk?.spoken && <Spoken />}
            {flag ? (
              <StateWord tone={FLAG_TONE[flag.tone ?? ""] ?? "info"}>{flag.text}</StateWord>
            ) : entry.actionRequired ? (
              <StateWord tone="look">Action required</StateWord>
            ) : null}
            {entry.fromClaim && <span>{`On #${entry.fromClaim}`}</span>}
            {/* one of ours that never went to ServiceM8 says so, in grey */}
            {ours && !entry.state && <span>In HeyTiff</span>}
            {tidied && (
              <button type="button" className="jc-bmdoor" aria-expanded={asSaid} onClick={() => setAsSaid((v) => !v)}>
                {asSaid ? "Hide" : "As said"}
              </button>
            )}
            <NoteDoors entry={entry} doors={doors} replyOpen={replyOpen} onReplyOpen={onReplyOpen} />
          </>
        }
      />
      {talk && <Replies talk={talk} who={who} mine={mine} />}
    </div>
  );
}

/** A note Undo took back: the words, and Tiff's line saying so. */
function TalkMessage({ talk, you }: { talk: JobNoteTalk; you: string }) {
  const who = talk.authorName ?? "Someone on the team";
  const mine = who === you;
  return (
    <>
      <Bubble
        mine={mine}
        who={who}
        text={talk.said}
        meta={
          <>
            <span>{stampClock(talk.stamp)}</span>
            {talk.spoken && <Spoken />}
          </>
        }
      />
      <Replies talk={talk} who={who} mine={mine} />
    </>
  );
}

/** What followed a note's words: Tiff's lines and any answers to her. What
    she made hangs under her last line, with Undo where it still applies. */
function Replies({ talk, who, mine }: { talk: JobNoteTalk; who: string; mine: boolean }) {
  const undo = useContext(UndoTalk);
  const openChat = useContext(OpenChat);
  const when = stampClock(talk.stamp);
  const last = talk.replies.map((r) => r.who).lastIndexOf("tiff");
  return (
    <>
      {talk.replies.map((r, i) =>
        r.who === "you" ? (
          <Bubble key={i} mine={mine} who={who} text={r.text} meta={<span>{when}</span>} />
        ) : (
          <TiffTurn
            key={i}
            when={when}
            doors={
              i === last && openChat ? (
                <button type="button" className="jc-bmdoor" onClick={() => openChat(talk)}>
                  Open chat
                </button>
              ) : null
            }
          >
            <div className="cv-text">
              <p>{r.text}</p>
            </div>
            {i === last && talk.made.length > 0 && (
              <MadeList cards={talk.made.map((c) => ({ ...c, icon: MADE_ICON[c.kind] }))} undo={talk.undo && undo ? { noteId: talk.id, busy: undo.busy.has(talk.id), onUndo: undo.undo } : null}
              />
            )}
          </TiffTurn>
        ),
      )}
    </>
  );
}

/** Undo for a note's cards: the conversation's own, so its line follows. */
type UndoAsk = { noteId: string; busy?: boolean; onUndo?: (noteId: string) => void };

/** `open`: where the thing a card names opens, a variation's quote page. */
function MadeList({ cards, undo }: { cards: (Omit<MadeCard, "kind"> & { icon: string; open?: string })[]; undo: UndoAsk | null }) {
  const one = cards.length === 1;
  const press = undo?.onUndo
    ? (
        <button
          type="button"
          className="jc-undo"
          disabled={undo.busy}
          aria-label={one ? undefined : "Undo, taking back everything Tiff made from this note"}
          onClick={() => undo.onUndo!(undo.noteId)}
        >
          Undo
        </button>
      )
    : null;
  return (
    <>
      <ul className="cv-results">
        {cards.map((c) => (
          <li key={c.key} className="cv-result">
            <span className="jc-made-icon" aria-hidden="true">
              <Icon name={c.icon} size={16} />
            </span>
            <span className="cv-result-id">
              <Fade className="cv-result-name">{c.name}</Fade>
              <span className="cv-result-line">{c.line}</span>
            </span>
            {c.open && (
              <Button kind="quiet" size={32} href={c.open}>
                Open
              </Button>
            )}
            {one && press}
          </li>
        ))}
      </ul>
      {!one && press && <p className="jc-undoall">{press}</p>}
    </>
  );
}

/** One of Tiff's turns from the box just now: her words, the answers she
    offers while she waits on one, and, once filed, a card for each thing
    with Undo. */
function LiveTiff({
  turn,
  when,
  asking,
  onAnswer,
  onUndo,
  onAddOffer,
}: {
  turn: ModalTurn;
  when: string;
  asking: boolean;
  onAnswer: (q: NonNullable<ModalTurn["quick"]>[number]) => void;
  onUndo: (noteId: string) => void;
  /** her quick price onto the job's quote, as an option of its own */
  onAddOffer: () => void;
}) {
  const rows = (turn.rows ?? []).filter((r) => !r.off);
  const cards = turn.filed
    ? rows.length
      ? rows.map((r) => ({ key: r.key, icon: LANE_ICON[r.lane], name: r.text, line: r.lead, ...(r.open ? { open: r.open } : {}) }))
      : (turn.doors ?? []).map((d) => ({ key: d.kind, icon: "check", name: d.label, line: "Filed on the job" }))
    : [];
  const quick = asking ? (turn.quick ?? []) : [];
  return (
    <TiffTurn when={when}>
      {turn.text && (
        <div className="cv-text">
          <p>{turn.text}</p>
        </div>
      )}
      {cards.length > 0 && (
        <MadeList
          cards={cards}
          undo={turn.undo && turn.noteId ? { noteId: turn.noteId, busy: turn.undo === "busy", onUndo } : null}
        />
      )}
      {turn.offer && !turn.streaming && (
        <div className="jc-quick">
          {turn.offer.state === "added" ? (
            <span className="cv-result-line">{turn.offer.said}</span>
          ) : (
            <>
              <Button kind="second" size={36} disabled={turn.offer.state === "busy"} onClick={onAddOffer}>
                {turn.offer.state === "busy" ? "Adding to the quote" : "Add to quote"}
              </Button>
              {turn.offer.state === "failed" && <span className="cv-result-line">{turn.offer.said}</span>}
            </>
          )}
        </div>
      )}
      {quick.length > 0 && (
        <div className="jc-quick" role="group" aria-label="Answers">
          {quick.map((q) => (
            <Button key={q.label} kind="second" size={36} onClick={() => onAnswer(q)}>
              {q.label}
            </Button>
          ))}
        </div>
      )}
    </TiffTurn>
  );
}

/* ── the diary's other entries, as cards in their place ── */

const MILESTONE_ICON: Record<string, string> = {
  "Job raised": "plus",
  "Quote sent": "file",
  "Became a work order": "wrench",
  "Job completed": "check",
  "Invoice raised": "receipt",
};

function EventCard({
  entry,
  onOpenClaim,
  onPhotos,
  onQuote,
  jobNumber,
}: {
  entry: Exclude<StoryEntry, { kind: "note" }>;
  onOpenClaim: (remoteId: string) => void;
  onPhotos: () => void;
  onQuote?: () => void;
  jobNumber: string | null;
}) {
  /* a 32 row: the grey icon in its 32 column, the bold words and a grey
     line after them, at most one quiet button at the far right; what the
     entry carries (a photo's thumbnails) under the row */
  const card = (icon: string, name: string, line: string | null, act?: ReactNode, more?: ReactNode) => (
    <div className="jc-entry jc-event">
      <div className="jc-evrow">
        <span className="jc-made-icon" aria-hidden="true">
          <Icon name={icon} size={16} />
        </span>
        <span className="jc-evwords">
          <b className="cv-result-name">{name}</b>
          {line && (
            <>
              {" "}
              <span className="cv-result-line">{line}</span>
            </>
          )}
        </span>
        {act}
      </div>
      {more}
    </div>
  );
  switch (entry.kind) {
    case "booking": {
      const clock = stampClock(entry.start);
      return card("calendar", clock ? `Visit booked for ${clock}` : "Visit booked", entry.crew.join(", ") || "Nobody named");
    }
    case "visit": {
      const open = new Set(entry.leftOpen);
      const crew = entry.crew
        .map((n) => (open.has(n) ? `${n}, check-in left open` : entry.reasons?.[n] ? `${n}, ${entry.reasons[n]}` : n))
        .join(open.size || entry.reasons ? "; " : ", ");
      return card("clock", entry.minutes > 0 ? `On site, ${fmtStoryMinutes(entry.minutes)}` : "On site", crew || "Nobody named");
    }
    case "photos":
      return card(
        "cam",
        entry.count === 1 ? "1 photo" : `${entry.count} photos`,
        null,
        <Button kind="quiet" size={32} onClick={onPhotos}>
          See all
        </Button>,
        <span className="jc-photos">
          {entry.shown.map((p) =>
            p.url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={p.remoteId} src={p.url} alt={p.name} loading="lazy" />
            ) : (
              <span key={p.remoteId} className="jc-photo-wait" role="img" aria-label={p.name}>
                <Icon name="cam" size={14} />
              </span>
            ),
          )}
        </span>,
      );
    case "claim": {
      const amount = entry.amountCents !== null ? `, ${fmtAud(entry.amountCents)}` : "";
      return card(
        entry.event === "settled" ? "dollar" : "receipt",
        `${entry.title} ${entry.event}${amount}`,
        entry.jobNumber ? `Invoice #${entry.jobNumber}` : null,
        <Button kind="quiet" size={32} onClick={() => onOpenClaim(entry.remoteId)}>
          Open
        </Button>,
      );
    }
    case "payment": {
      const amount = entry.amountCents !== null ? `, ${fmtAud(entry.amountCents)}` : "";
      return card(
        "dollar",
        `${entry.isDeposit ? "Deposit received" : "Payment received"}${amount}`,
        [entry.method, entry.takenBy].filter(Boolean).join(", ") || "ServiceM8",
      );
    }
    case "tick":
      return card("check", `Checked off: ${entry.name}`, entry.by);
    case "design":
      return card("layers", `Studio design: ${entry.name}`, "Edited");
    case "push":
      return card("listCheck", `${entry.count} material ${entry.count === 1 ? "line" : "lines"} from the Studio`, "Put on the checklist");
    case "milestone":
      return card(
        MILESTONE_ICON[entry.label] ?? "check",
        entry.label,
        null,
        entry.label === "Quote sent" && onQuote ? (
          <Button kind="quiet" size={32} onClick={onQuote}>
            {jobNumber ? `Open quote #${jobNumber}` : "Open the quote"}
          </Button>
        ) : undefined,
      );
  }
}
