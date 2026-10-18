"use client";

import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/parts/button";
import { Fade } from "@/components/parts/fade";
import { Initials } from "@/components/parts/initials";
import { StateWord, type Tone } from "@/components/parts/state";
import { ViewTabs } from "@/components/parts/tabs";
import { Icon } from "@/components/shell/icon";
import { TiffGlyph } from "@/components/notes/tiff-mark";
import { appendSpoken, useDictation } from "@/components/notes/dictation";
import { CvBox } from "@/components/conversations/box";
import {
  AlsoSm8,
  NoteDoors,
  useAlsoSm8,
  withMentions,
  type DiaryNotesSm8,
  type Doors,
  type NoteEntry,
} from "@/components/workboard/board/job-diary-face";
import type { Conversation, ModalTurn } from "@/components/tiff/modal/use-conversation";
import type { PlanRowView } from "@/components/tiff/modal/plan-view";
import { fmtAuTime } from "@/lib/au-dates";
import { fmtAud } from "@/lib/workboard/project-money";
import { mintPressId } from "@/lib/workboard/press-id";
import { emptyStoryLine, filterStory, fmtStoryMinutes, type StoryEntry, type StoryFilter } from "@/lib/workboard/job-story";
import { conversationDays, stampClock, type JobNoteTalk, type MadeCard, type MadeKind } from "@/lib/jobs/job-conversation";
import type { FlagState } from "@/lib/integrations/sm8-note-plan";
import type { NoteSender } from "@/lib/integrations/links";

/* THE JOB'S CONVERSATION (v2, step 6, slice A; the board JC-1): the left
   column of a job's Overview.

   WHAT IT SHOWS, oldest at the top, the box at the foot:
     - every entry of the job's diary (lib/workboard/job-story, unchanged):
       a note as a message, with the person's initials, their name and the
       time, then the words; a visit, a booking, photos, money and the
       job's milestones as small cards in their place;
     - a note said by voice as a card, "Note from voice", round the words;
     - under a note somebody told Tiff, what she said back and a card for
       each thing she made, with Undo where `undoNote` would still take it
       back (lib/jobs/job-conversation; the note's own row says it);
     - a line between the days, "Today" for today's.

   THE BOX IS THE ROUTER'S OWN DOOR. Send hands the words to the Tiff
   modal's conversation (components/tiff/modal/use-conversation), held
   here on the page rather than in the modal, aimed at this job: the same
   route, questions, filing and Undo, drawn where JC-1 draws them. A
   question she asks with answers to pick shows them as second buttons
   that answer. Keep as typed is the diary pen's path (`addJobNote`): the
   words kept word for word as a note on the job, Tiff filing nothing.

   NOTHING THE DIARY DID IS LOST: its filters are the soft tabs at the
   head; a note's line and doors (Remove, Send to ServiceM8, Mark done,
   Reply) are the diary's own `NoteDoors`; the Also in ServiceM8 tick is
   the pen's; a flagged note an attention row sent you to is lit and
   brought into view; the strip's Reply opens its box. */

const FILTERS: { key: StoryFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "notes", label: "Notes" },
  { key: "photos", label: "Photos" },
  { key: "money", label: "Money" },
  { key: "visits", label: "Visits" },
];

/** The diary's doors and what the card holds for them. */
export type ConversationDiary = {
  onOpenClaim: (remoteId: string) => void;
  onPhotos: () => void;
  /** Keep as typed: the pen's write. Absent until the card knows the job. */
  onWrite?: (body: string, alsoSm8: boolean, composeId: string) => void | Promise<unknown>;
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
};

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
}) {
  const [filter, setFilter] = useState<StoryFilter>("all");
  const shown = useMemo(() => filterStory(story, filter), [story, filter]);
  const live = convo.turns;
  const liveNotes = useMemo(() => new Set(live.flatMap((t) => (t.noteId ? [t.noteId] : []))), [live]);
  const days = useMemo(
    () => conversationDays(shown, talks, today, liveNotes, filter === "all" || filter === "notes"),
    [shown, talks, today, liveNotes, filter],
  );
  const filters = FILTERS.filter((f) => f.key !== "money" || moneyVisible);
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

  /* THE NEWEST IS AT THE FOOT, by the box: the list opens scrolled to it,
     and follows what lands while you are there. */
  const scroller = useRef<HTMLDivElement | null>(null);
  const size = shown.length + talks.length + live.length;
  useEffect(() => {
    const el = scroller.current;
    if (el && !lit) el.scrollTop = el.scrollHeight;
  }, [size, lit]);

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
  const send = () => {
    if (!canSend || !convo.draft.trim()) return;
    stamp();
    convo.send();
  };

  /* KEEP AS TYPED: the words as they are, a note on the job, and nothing
     filed from them. The pen's own write and its Also in ServiceM8. */
  const [also, tick] = useAlsoSm8();
  const [keeping, setKeeping] = useState(false);
  const keep = () => {
    const words = convo.draft.trim();
    if (!words || !diary.onWrite || keeping) return;
    const sending = !!diary.notesSm8 && diary.sender?.state === "ready" && also;
    setKeeping(true);
    convo.setDraft("");
    void Promise.resolve(diary.onWrite(words, sending, mintPressId())).finally(() => setKeeping(false));
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

  const empty = !loading && story.length === 0 && talks.length === 0 && live.length === 0;

  return (
    <UndoTalk.Provider value={undoTalk ? { undo: undoTalk, busy: undoing } : null}>
    <section className="jc-convo" aria-label="The job's conversation">
      {story.length > 0 && (
        <ViewTabs
          items={filters.map((f) => ({ key: f.key, label: f.label }))}
          current={filter}
          onGo={(k) => setFilter(k as StoryFilter)}
          ariaLabel="Show in the conversation"
          idPrefix="jcf"
          panelPrefix="jcfp"
        />
      )}
      <div className="jc-scroll" ref={scroller} id={`jcfp-${filter}`} role="tabpanel" aria-labelledby={story.length > 0 ? `jcf-${filter}` : undefined}>
        {loading && story.length === 0 ? (
          <p className="cv-aside">Reading the job&rsquo;s notes from the mirror</p>
        ) : empty ? (
          <p className="cv-aside">{emptyStoryLine(moneyVisible)}</p>
        ) : shown.length === 0 && filter !== "all" ? (
          <p className="cv-aside">Nothing of that kind on the job.</p>
        ) : null}
        <div className="cv-msgs">
          {days.map((day) => (
            <div className="jc-day" key={day.day}>
              <div className="cv-day">
                <span>{day.label}</span>
              </div>
              {day.items.map((item) =>
                item.entry?.kind === "note" ? (
                  <NoteMessage
                    key={item.key}
                    entry={item.entry}
                    talk={item.talk}
                    doors={doors}
                    lit={item.key === lit}
                    litRef={item.key === lit ? litRef : undefined}
                    replyOpen={openKey === item.key}
                    onReplyOpen={(on) => openReply(on ? item.key : null)}
                  />
                ) : item.entry ? (
                  <EventCard key={item.key} entry={item.entry} onOpenClaim={diary.onOpenClaim} onPhotos={diary.onPhotos} />
                ) : item.talk ? (
                  <TalkMessage key={item.key} talk={item.talk} />
                ) : null,
              )}
            </div>
          ))}

          {/* WHAT YOU SAID HERE JUST NOW, and what Tiff said back */}
          {live.length > 0 && (
            <div className="jc-day">
              {days.at(-1)?.label !== "Today" && (
                <div className="cv-day">
                  <span>Today</span>
                </div>
              )}
              {live.map((t) =>
                t.who === "you" ? (
                  <Message key={t.key} who={you} when={timeOf(t)}>
                    <div className="cv-text cv-text--mine">
                      <p>{t.text}</p>
                    </div>
                  </Message>
                ) : (
                  <LiveTiff
                    key={t.key}
                    turn={t}
                    when={timeOf(t)}
                    asking={convo.questionOpen && t === lastTiff}
                    onAnswer={(q) => {
                      stamp();
                      convo.answer(q);
                    }}
                    onUndo={(noteId) => void convo.undo(t.key, noteId)}
                  />
                ),
              )}
              {working && (
                <Message who="Tiff" tiff working when="">
                  <p className="cv-now">Working through it</p>
                </Message>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="jc-foot">
        <CvBox
          value={convo.draft}
          onChange={convo.setDraft}
          onSubmit={send}
          label="Tell Tiff about this job"
          placeholder="Tell Tiff about this job"
          sendWord="Send"
          sendLabel="Send to Tiff"
          waiting={working || !canSend}
          dict={voiceEnabled ? dict : null}
          voiceError={voiceErr}
          ranOut={ranOut}
          extra={
            diary.onWrite && convo.draft.trim() ? (
              <Button kind="second" size={36} className="jc-keep" disabled={keeping} onClick={keep}>
                {keeping ? "Keeping it" : "Keep as typed"}
              </Button>
            ) : null
          }
        />
        {diary.notesSm8 && diary.onWrite && (
          <AlsoSm8 also={also} onTick={tick} sender={diary.sender} notesSm8={diary.notesSm8} onConfirm={diary.onConfirm} />
        )}
      </div>
    </section>
    </UndoTalk.Provider>
  );
}

/** Undo on an earlier note's cards, from the conversation that reads it. */
const UndoTalk = createContext<{ undo: (noteId: string) => void; busy: ReadonlySet<string> } | null>(null);

/* ── a message ── */

function Message({
  who,
  when,
  tiff = false,
  working = false,
  lit = false,
  litRef,
  head,
  children,
}: {
  who: string;
  when: string;
  tiff?: boolean;
  working?: boolean;
  lit?: boolean;
  litRef?: React.Ref<HTMLElement>;
  /** what the name line says after the time: a state, where it is */
  head?: ReactNode;
  children: ReactNode;
}) {
  return (
    <article className={`cv-msg${lit ? " jc-lit" : ""}`} ref={litRef}>
      <span className="cv-avatar">{tiff ? <TiffGlyph size={24} working={working} /> : <Initials name={who} size={32} beside />}</span>
      <div className="cv-body">
        <p className="cv-meta">
          <b>{who}</b>
          {when && <span>{when}</span>}
          {head}
        </p>
        {children}
      </div>
    </article>
  );
}

/** The words of a note: a card round them when they were said. */
function Words({ text, spoken }: { text: string; spoken: boolean }) {
  const words = (
    <div className="cv-text cv-text--mine">
      <p>{withMentions(text)}</p>
    </div>
  );
  if (!spoken) return words;
  return (
    <div className="jc-voice">
      <p className="jc-voice-head">
        <Icon name="mic" size={14} />
        Note from voice
      </p>
      {words}
    </div>
  );
}

/** A note on the job: ServiceM8's or ours, then what Tiff said back. */
function NoteMessage({
  entry,
  talk,
  doors,
  lit,
  litRef,
  replyOpen,
  onReplyOpen,
}: {
  entry: NoteEntry;
  talk: JobNoteTalk | null;
  doors: Doors;
  lit: boolean;
  litRef?: React.Ref<HTMLElement>;
  replyOpen: boolean;
  onReplyOpen: (on: boolean) => void;
}) {
  const ours = entry.origin === "heytiff";
  const flag = !ours && entry.sm8Uuid ? (doors.flags[entry.sm8Uuid] ?? null) : null;
  const who = entry.author?.trim() || talk?.authorName || (ours ? "Someone on the team" : "ServiceM8");
  const head = (
    <>
      {flag ? (
        <StateWord tone={FLAG_TONE[flag.tone ?? ""] ?? "info"}>{flag.text}</StateWord>
      ) : entry.actionRequired ? (
        <StateWord tone="look">Action required</StateWord>
      ) : null}
      {entry.fromClaim && <span>{`On #${entry.fromClaim}`}</span>}
      {/* one of ours that never went to ServiceM8 says so, in grey */}
      {ours && !entry.state && <span>In HeyTiff</span>}
    </>
  );
  return (
    <>
      <Message who={who} when={stampClock(entry.at)} lit={lit} litRef={litRef} head={head}>
        <Words text={entry.text} spoken={!!talk?.spoken} />
        <div className="jc-doors">
          <NoteDoors entry={entry} doors={doors} replyOpen={replyOpen} onReplyOpen={onReplyOpen} />
        </div>
      </Message>
      {talk && <Replies talk={talk} who={who} />}
    </>
  );
}

/** A note Undo took back: the words, and Tiff's line saying so. */
function TalkMessage({ talk }: { talk: JobNoteTalk }) {
  const who = talk.authorName ?? "Someone on the team";
  return (
    <>
      <Message who={who} when={stampClock(talk.stamp)}>
        <Words text={talk.said} spoken={talk.spoken} />
      </Message>
      <Replies talk={talk} who={who} />
    </>
  );
}

/** What followed a note's words: Tiff's lines and any answers to her. What
    she made hangs under her last line, with Undo where it still applies. */
function Replies({ talk, who }: { talk: JobNoteTalk; who: string }) {
  const undo = useContext(UndoTalk);
  const when = stampClock(talk.stamp);
  const last = talk.replies.map((r) => r.who).lastIndexOf("tiff");
  return (
    <>
      {talk.replies.map((r, i) =>
        r.who === "you" ? (
          <Message key={i} who={who} when={when}>
            <div className="cv-text cv-text--mine">
              <p>{r.text}</p>
            </div>
          </Message>
        ) : (
          <Message key={i} who="Tiff" tiff when={when}>
            <div className="cv-text">
              <p>{r.text}</p>
            </div>
            {i === last && talk.made.length > 0 && (
              <MadeList cards={talk.made.map((c) => ({ ...c, icon: MADE_ICON[c.kind] }))} undo={talk.undo && undo ? { noteId: talk.id, busy: undo.busy.has(talk.id), onUndo: undo.undo } : null}
              />
            )}
          </Message>
        ),
      )}
    </>
  );
}

/** Undo for a note's cards: the conversation's own, so its line follows. */
type UndoAsk = { noteId: string; busy?: boolean; onUndo?: (noteId: string) => void };

function MadeList({ cards, undo }: { cards: (Omit<MadeCard, "kind"> & { icon: string })[]; undo: UndoAsk | null }) {
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
}: {
  turn: ModalTurn;
  when: string;
  asking: boolean;
  onAnswer: (q: NonNullable<ModalTurn["quick"]>[number]) => void;
  onUndo: (noteId: string) => void;
}) {
  const rows = (turn.rows ?? []).filter((r) => !r.off);
  const cards = turn.filed
    ? rows.length
      ? rows.map((r) => ({ key: r.key, icon: LANE_ICON[r.lane], name: r.text, line: r.lead }))
      : (turn.doors ?? []).map((d) => ({ key: d.kind, icon: "check", name: d.label, line: "Filed on the job" }))
    : [];
  const quick = asking ? (turn.quick ?? []) : [];
  return (
    <Message who="Tiff" tiff when={when}>
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
      {quick.length > 0 && (
        <div className="jc-quick" role="group" aria-label="Answers">
          {quick.map((q) => (
            <Button key={q.label} kind="second" size={36} onClick={() => onAnswer(q)}>
              {q.label}
            </Button>
          ))}
        </div>
      )}
    </Message>
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
}: {
  entry: Exclude<StoryEntry, { kind: "note" }>;
  onOpenClaim: (remoteId: string) => void;
  onPhotos: () => void;
}) {
  const card = (icon: string, name: string, line: string | null, act?: ReactNode, more?: ReactNode) => (
    <div className="jc-event">
      <span className="jc-made-icon" aria-hidden="true">
        <Icon name={icon} size={16} />
      </span>
      <span className="cv-result-id">
        <span className="cv-result-name">{name}</span>
        {line && <span className="cv-result-line">{line}</span>}
        {more}
      </span>
      {act}
    </div>
  );
  switch (entry.kind) {
    case "booking": {
      const clock = stampClock(entry.start);
      return card("calendar", clock ? `Visit booked for ${clock}` : "Visit booked", entry.crew.join(", ") || "Nobody named");
    }
    case "visit": {
      const open = new Set(entry.leftOpen);
      const crew = entry.crew.map((n) => (open.has(n) ? `${n}, check-in left open` : n)).join(open.size ? "; " : ", ");
      return card("clock", entry.minutes > 0 ? `On site, ${fmtStoryMinutes(entry.minutes)}` : "On site", crew || "Nobody named");
    }
    case "photos":
      return card(
        "cam",
        entry.count === 1 ? "1 photo" : `${entry.count} photos`,
        null,
        <Button kind="quiet" size={32} onClick={onPhotos}>
          See the photos
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
        <button type="button" className="cv-open" onClick={() => onOpenClaim(entry.remoteId)}>
          Open
        </button>,
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
      return card(MILESTONE_ICON[entry.label] ?? "check", entry.label, null);
  }
}
