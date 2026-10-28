"use client";

import { createContext, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
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
import { addMyNote, deleteMyNote } from "@/app/actions/my-notes";
import { WindowsContext } from "@/components/records/records-context";
import { emptyStoryLine, filterStory, fmtStoryMinutes, type StoryEntry, type StoryFilter } from "@/lib/workboard/job-story";
import { conversationDays, stampClock, type JobNoteTalk, type MadeCard, type MadeKind } from "@/lib/jobs/job-conversation";
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
type FeedFilter = Extract<StoryFilter, "all" | "notes" | "photos"> | "comms";

const NONE: CustomerItem[] = [];
const NO_COMMS: CommsThread[] = [];

const FILTERS: { key: FeedFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "comms", label: "Comms" },
  { key: "notes", label: "Notes" },
  { key: "photos", label: "Photos" },
];

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
  moneyVisible,
  diary,
  convo,
  canSend,
  viewerName,
  voiceEnabled,
  onUndoTalk,
  customer = NONE,
  comms = NO_COMMS,
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
  /** The customer's threads and ServiceM8's sends (customer-messages). */
  customer?: CustomerItem[];
  /** Every text and email with the customer, as Comms shows them. */
  comms?: CommsThread[];
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
  const shown = useMemo(() => (filter === "comms" ? [] : filterStory(unechoed, filter)), [unechoed, filter]);
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
  /* newest first: the days, and each day's entries, the other way up from
     the conversation's own order */
  const days = useMemo(
    () =>
      conversationDays(shown, filter === "comms" ? [] : talks, today, liveNotes, filter === "all" || filter === "notes", theirs)
        .reverse()
        .map((d) => ({ ...d, items: [...d.items].reverse() })),
    [shown, talks, today, liveNotes, filter, theirs],
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

  const send = () => {
    if (!canSend || !convo.draft.trim() || photo?.state === "up") return;
    stamp();
    if (photo?.state === "ready") {
      convo.sendWithReceipt(photo.id);
      /* the claim adopts it now: the chip goes, the document stays */
      picks.current++;
      show(null);
      setPhoto(null);
    } else convo.send();
  };

  /* MY NOTES ONLY: the words kept for you alone (Isaac, 26 October 2026:
     "Unless it's a private note, you just hit add to my notes instead"; the
     tick's name is his). ONE BUTTON, whose word says what it does, and Enter
     does the same: Send is the job's (Tiff files from the note, and the one
     tidied note goes to the job and to ServiceM8 by itself); ticked, it is
     Save to my notes, private, with nothing filed and nothing sent. The tick
     stays as you left it, here and next time: a private note sent by mistake
     is worse than a job note kept by mistake, and the button always says. */
  const host = useContext(WindowsContext);
  const [mineOnly, setMineOnly] = useMyNotesOnly();
  /* why your notes can't go to ServiceM8 yet, under the box */
  const sm8Why = !!diary.notesSm8;
  const [keeping, setKeeping] = useState(false);
  const keep = () => {
    const words = convo.draft.trim();
    if (!words || keeping) return;
    setKeeping(true);
    void addMyNote({ body: words, source: "text" })
      .catch(() => ({ ok: false as const, error: "Couldn't keep that note." }))
      .then((r) => {
        if (!r.ok) return host?.toast(r.error);
        convo.setDraft("");
        const id = r.id;
        host?.toast("Saved to My notes", id ? () => void deleteMyNote(id) : undefined);
      })
      .finally(() => setKeeping(false));
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
  const tabs =
    story.length > 0 || customer.length > 0 || comms.length > 0 ? (
      <div className="pt-vtabs jc-filter" role="group" aria-label="Show in the feed">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            className="pt-vtab"
            aria-pressed={filter === f.key}
            onClick={() => setFilter(f.key)}
          >
            <span className="pt-vtab-word">{f.label}</span>
          </button>
        ))}
      </div>
    ) : null;
  /* the box's own exchange stands under "Today" at the top; the day's
     older entries then follow without a second "Today" */
  const todayShown = live.length > 0 && filter !== "comms";

  return (
    <UndoTalk.Provider value={undoTalk ? { undo: undoTalk, busy: undoing } : null}>
    <FileDoor.Provider value={diary.openFile ?? NO_FILE}>
    <JobSection name="Activity feed" icon="chat" hue="green" className="jc-convo" action={tabs}>
      <div className="jc-foot">
        <CvBox
          value={convo.draft}
          onChange={convo.setDraft}
          onSubmit={mineOnly ? keep : send}
          label="Tell Tiff about this job"
          placeholder="Tell Tiff about this job"
          sendWord={mineOnly ? "Save to my notes" : "Send"}
          sendLabel={mineOnly ? "Save to my notes" : "Send to Tiff"}
          worded
          waiting={mineOnly ? keeping : working || !canSend || photo?.state === "up"}
          dict={voiceEnabled ? dict : null}
          voiceError={voiceErr}
          ranOut={ranOut}
          before={photo ? <PhotoChip photo={photo} onClear={clearPhoto} /> : null}
          lead={
            /* the + (a photo or a file, Isaac, 26 October 2026: "Add photo
               should be the plus button"), then My notes only, in the box's
               own bottom row; a photo goes with Send, so not with a private
               note */
            <span className="jc-lead">
              {!photo && !mineOnly && (
                <IconButton glyph="add" label="Add a photo or a file" size={32} disabled={!canSend} onClick={() => picker.current?.click()} />
              )}
              <label className="wb2-flcheck">
                <input type="checkbox" checked={mineOnly} onChange={(e) => setMineOnly(e.target.checked)} />
                My notes only
              </label>
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

      <div className="jc-feed">
        {loading && story.length === 0 ? (
          <p className="jov-none">Reading the job&rsquo;s notes from the mirror</p>
        ) : empty ? (
          <p className="jov-none">{emptyStoryLine(moneyVisible)}</p>
        ) : filter !== "all" && (filter === "comms" ? comms.length === 0 : shown.length === 0) ? (
          <p className="jov-none">Nothing of that kind on the job.</p>
        ) : null}

        {/* WHAT YOU SAID HERE JUST NOW, and what Tiff said back: the newest,
            at the top, in the order it was said */}
        {live.length > 0 && filter !== "comms" && (
          <div className="jc-day">
            <p className="jc-dayname">Today</p>
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

        {/* COMMS: the messages alone, oldest first, as a phone shows them */}
        {filter === "comms" && comms.length > 0 && <CommsView threads={comms} />}

        {days.map((day, i) => (
          <div className="jc-day" key={day.day}>
            {!(i === 0 && todayShown && day.label === "Today") && <p className="jc-dayname">{day.label}</p>}
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
              ) : null,
            )}
          </div>
        ))}
      </div>
    </JobSection>
    </FileDoor.Provider>
    </UndoTalk.Provider>
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

/* MY NOTES ONLY, remembered in this browser: read through the store hook so
   the server's first paint (unticked) and the browser's agree; blocked
   storage starts it unticked. */
const MINE_ONLY_KEY = "heytiff.box.myNotesOnly";
const mineOnlyListeners = new Set<() => void>();
const readMineOnly = () => {
  try {
    return localStorage.getItem(MINE_ONLY_KEY) === "1";
  } catch {
    return false;
  }
};
function useMyNotesOnly(): [boolean, (on: boolean) => void] {
  const on = useSyncExternalStore(
    (fire) => {
      mineOnlyListeners.add(fire);
      return () => mineOnlyListeners.delete(fire);
    },
    readMineOnly,
    () => false,
  );
  const set = (next: boolean) => {
    /* worked out before the try: the compiler takes no conditional inside one */
    const value = next ? "1" : "0";
    try {
      localStorage.setItem(MINE_ONLY_KEY, value);
    } catch {
      /* blocked storage: the tick lasts as long as the page */
    }
    for (const fire of mineOnlyListeners) fire();
  };
  return [on, set];
}

/** Undo on an earlier note's cards, from the conversation that reads it. */
const UndoTalk = createContext<{ undo: (noteId: string) => void; busy: ReadonlySet<string> } | null>(null);

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
function TiffTurn({ when, working = false, children }: { when: string; working?: boolean; children: ReactNode }) {
  return (
    <article className="jc-tiffturn">
      <p className="jc-tiffname">
        <TiffGlyph size={18} alive working={working} />
        <b>Tiff</b>
      </p>
      {children}
      {when && <p className="jc-bmtime">{when}</p>}
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
  const when = stampClock(talk.stamp);
  const last = talk.replies.map((r) => r.who).lastIndexOf("tiff");
  return (
    <>
      {talk.replies.map((r, i) =>
        r.who === "you" ? (
          <Bubble key={i} mine={mine} who={who} text={r.text} meta={<span>{when}</span>} />
        ) : (
          <TiffTurn key={i} when={when}>
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
