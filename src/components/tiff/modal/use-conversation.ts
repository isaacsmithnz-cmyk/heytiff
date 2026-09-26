"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";
import { appendSpoken, useDictation } from "@/components/notes/dictation";
import { GATHER_MS } from "@/components/ui/dot-field";
import { askBrain } from "@/lib/brain/ask-client";
import { looksLikeQuestion } from "@/lib/brain/intent";
import {
  continueNote,
  dismissNote,
  fileNote,
  keepWords,
  publishNoteKb,
  routeNote,
  undoNote,
  type FileResult,
  type KeepResult,
  type NoteTarget,
  type PublishKbResult,
  type RouteResult,
  type UndoResult,
} from "@/app/actions/workboard-notes";
import {
  fileCalendarLine,
  noteOnCalendarEvents,
  undoCalendarLine,
  type CalendarLineResult,
  type CalendarResult,
} from "@/app/actions/calendar";
import type { NoteProposal, NoteStaff } from "@/lib/workboard/note-brain";
import type { NoteDoor, NoteDoorKind } from "@/lib/workboard/note-applied";
import { KEPT_AS_SAID, WHICH_JOB, earlierTurns, type EarlierTurn, type TiffRoom } from "@/lib/workboard/note-turns";
import { notedLine } from "@/lib/calendar/line";
import { askLine, calendarRows, lastTiff, planView, tiffSince, type PlanRowView } from "./plan-view";
import type { TiffLanded } from "./tiff-context";

/* ONE CONVERSATION WITH TIFF — the modal's state, once.

   It replaced the review card's flow (`useNoteFlow`, which went with the
   old capture UI on 2026-09-27). There is no Talk/Type door and no
   review: opening means listening (Isaac, 2026-09-25, "opening means
   listening, from every Tiff button"), your words become a turn, Tiff
   answers with what she will file, asks only what she cannot work out, and
   files the moment nothing is left to ask, with Undo on what landed.

   WHERE A REPLY GOES, decided in one place (`submit`):
     a note waiting on an answer   continueNote, the whole note routed again
     it reads as a question        the ask stream, with the turns before it
     anything else                 a new note in the same conversation,
                                   read by the turns before it

   THE CALENDAR'S ROOM IS ITS OWN (the Calendar's box and its Tiff button,
   H22). What is said there is a line for the calendar, never a note, so it
   goes to the calendar's reader rather than the note router, which is left
   exactly as it was:
     waiting on "Which day?"       the line again, with every answer since
     it reads as a question        the ask stream, as anywhere
     after she has filed           kept on what she filed, as its note
     anything else                 a line for the calendar, read and filed
   The day the box adds to rides with every line (`opening.day`, Isaac,
   2026-09-26): a line whose words name no day goes on it, and "Which day?"
   is asked only where there is none. A line she could not read at all is
   kept in the diary as said, the way a note that could not be routed is.

   THE WAITS HAVE FLOORS, and they are motion, not padding. The dots gather
   from the button you pressed for GATHER_MS, and the cloud Tiff thinks in
   turns for at least CLOUD_MS before it falls — a result that came back
   sooner is held until then, or every moving dot jumps (the prototype's
   film, 2026-09-24). Under reduced motion nothing travels and nothing is
   held. A keyboard press is not reduced motion: nothing flies from the
   button (law 8), but Tiff's thinking is state, not the press, and its
   cloud keeps its floor.

   NOTHING RUNS AFTER YOU LEAVE. Every server answer checks that the modal
   is still here; a note that was waiting when you closed it is set aside
   (keep the words, apply none of it), as the capture flow always did. */

/** The cloud's floor before it may fall. */
export const CLOUD_MS = 1850;
/** How far into the fall the face zone starts to close: the dots are most of
    the way down, so the zone eats the last of them rather than a blank. */
export const FOLD_MS = 520;

/** When the words never reached the server at all. */
export const NOT_REACHED = "That didn't reach Tiff. Try again.";
/** An ask that ended with nothing to say. */
const NO_ANSWER = "That couldn't be answered just now.";

export type Stage = "listening" | "editing" | "thinking" | "asking" | "answering" | "filed" | "failed";

export type Point = { x: number; y: number };

export type QuickAnswer = { label: string; target?: NoteTarget };

/** A door under Tiff's line: what a note filed, or what went on the calendar. */
export type TurnDoor = Omit<NoteDoor, "kind"> & { kind: NoteDoorKind | "events" };

export type ModalTurn = {
  key: string;
  who: "you" | "tiff";
  text: string;
  /** Arrived after the modal opened, so it grows in by its own box. */
  enter: boolean;
  /** Tiff's plan, as rows. */
  rows?: PlanRowView[];
  /** Answers you can tap, under her question. */
  quick?: QuickAnswer[];
  /** What landed, once filed. */
  doors?: TurnDoor[];
  /** The note this turn is about: Undo, the rows' crosses, the Library. */
  noteId?: string;
  /** The calendar events this turn put on: what its Undo takes off. */
  events?: string[];
  undo?: "ready" | "busy";
  /** This turn filed its note, and Undo has not taken it back. */
  filed?: boolean;
  /** An ask's answer, still arriving. */
  streaming?: boolean;
};

/** The turn your words are arriving in. `said` is what they were when you
    pressed Done, held on screen until the transcript lands. */
export type LiveTurn = { key: string; said: string | null; enter: boolean };

export type Face = {
  stage: "mark" | "cloud" | null;
  /** A new key is a new field: a voice turn gathers again from its button. */
  key: number;
  origin: Point | null;
};

export type Opening = {
  words?: string;
  /** A conversation already had (a diary entry's): on screen from the
      start, and what you say next is read by it. */
  conversation?: readonly EarlierTurn[];
  room?: TiffRoom;
  /** The day a line for the calendar goes on when its words name none: the
      day the Calendar's box adds to (./tiff-context). */
  day?: string;
  /** The pressed button's centre; the dots gather from it. None for a
      keyboard press, which moves nothing (law 8). */
  origin: Point | null;
  /** Reduced motion, read when it opened: nothing travels, nothing is held. */
  still: boolean;
  /** When it opened (ms), read in the click, never in render. */
  at: number;
};

export type Closed = { changed: boolean; landed: TiffLanded | null };

type Note = {
  id: string;
  proposal: NoteProposal;
  staff: NoteStaff[];
  /** Tiff asked and is waiting on an answer. */
  waiting: boolean;
  /** A call on this note is out. */
  busy: boolean;
  /** A filing's answer was lost, so whether it landed is unknown. A note in
      that state is never set aside: it may be filed. */
  lost: boolean;
};

/** A calendar line Tiff asked "Which day?" about, and the answers since. */
type DayAsk = { line: string; source: "voice" | "text"; answers: string[] };

/** What the last calendar line put on, for a reply to be kept on. */
type OnCalendar = { ids: string[]; about: string };

const NONE: NoteTarget = { kind: "none" };

export function useConversation({
  opening,
  voiceEnabled,
  target: aimTarget,
  targetLabel: aimLabel,
}: {
  opening: Opening;
  voiceEnabled: boolean;
  target: NoteTarget;
  targetLabel?: string;
}) {
  /* THE TAG IS A SUGGESTION: the screen you opened this from rides along and
     the note lands there, until you take it off for this conversation. */
  const [aimDropped, setAimDropped] = useState(false);
  const aimed = aimTarget.kind !== "none" && !!aimTarget.id && !aimDropped;
  const target = aimed ? aimTarget : NONE;
  const targetLabel = aimed ? aimLabel : undefined;

  const still = opening.still;
  const room = opening.room;
  const day = opening.day;
  const words0 = opening.words?.trim() ?? "";
  /* OPENED AGAIN ON A CONVERSATION (a diary entry's Tiff line): what was
     said is on screen from the start, Tiff has already answered so her face
     has fallen, and the modal waits on the reply box. It is a door to what
     was said, not a Tiff button, so the microphone stays shut until the
     box's own Tiff button is pressed. */
  const [had] = useState<ModalTurn[]>(() =>
    (opening.conversation ?? []).map((t, i) => ({ key: `had${i}`, who: t.who, text: t.text, enter: false }))
  );
  const resumed = had.length > 0 && !words0;
  const listensFirst = !words0 && !resumed && voiceEnabled;

  const [stage, setStage] = useState<Stage>(words0 ? "thinking" : listensFirst ? "listening" : "editing");
  const [turns, setTurns] = useState<ModalTurn[]>(() =>
    words0 ? [...had, { key: "you0", who: "you", text: words0, enter: false }] : had
  );
  const [live, setLive] = useState<LiveTurn | null>(
    listensFirst ? { key: "you0", said: null, enter: false } : null
  );
  const [draft, setDraft] = useState("");
  const [fixing, setFixing] = useState(false);
  const [face, setFace] = useState<Face>(
    resumed ? { stage: null, key: 0, origin: null } : { stage: "mark", key: 0, origin: still ? null : opening.origin }
  );
  const [faceOpen, setFaceOpen] = useState(!resumed);
  /** Any of the words being composed arrived by voice. */
  const [spoke, setSpoke] = useState(listensFirst);
  /** A complaint about the microphone, not something Tiff said. */
  const [error, setError] = useState<string | null>(null);
  /** THE WORDS YOU CLICKED INTO, held while their read-back is out. The live
      words stop arriving the moment the mic stops and the transcript is
      seconds behind them, so without this the words you clicked would vanish
      under your cursor. Nothing can be typed until it lands: typing then
      would put your words in front of the ones you said. */
  const [reading, setReading] = useState<string | null>(null);

  const seq = useRef(0);
  const alive = useRef(true);
  const timers = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());
  const fold = useRef<ReturnType<typeof setTimeout> | null>(null);
  const gatherUntil = useRef(!still && !resumed && opening.origin ? opening.at + GATHER_MS : 0);
  const cloudAt = useRef(0);
  const note = useRef<Note | null>(null);
  const leave = useRef<string[]>([]);
  const changed = useRef(false);
  /** Everything this conversation filed: a note's rows, or a calendar
      line's events, which have no note. */
  const filed = useRef<{ noteId?: string; ids: string[] }[]>([]);
  const awaitingVoice = useRef(false);
  const asking = useRef<AbortController | null>(null);
  const sent = useRef(false);
  const dayAsk = useRef<DayAsk | null>(null);
  const onCalendar = useRef<OnCalendar | null>(null);
  const calendar = room === "calendar";

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const nextKey = (who: string) => `${who}${++seq.current}`;

  /** A timer that does nothing once the modal has gone. */
  const later = (ms: number, fn: () => void) => {
    const t = setTimeout(() => {
      timers.current.delete(t);
      if (alive.current) fn();
    }, ms);
    timers.current.add(t);
    return t;
  };

  const addTurn = (t: Omit<ModalTurn, "enter" | "key"> & { key?: string }) => {
    const key = t.key ?? nextKey(t.who);
    setTurns((ts) => [...ts, { ...t, key, enter: true }]);
  };
  const patchTurn = (key: string, patch: (t: ModalTurn) => Partial<ModalTurn>) =>
    setTurns((ts) => ts.map((t) => (t.key === key ? { ...t, ...patch(t) } : t)));

  /* ── the face ── */

  const stopFold = () => {
    if (fold.current) clearTimeout(fold.current);
    fold.current = null;
  };
  const toCloud = () =>
    setFace((f) => (f.stage ? { ...f, stage: "cloud" } : { stage: "cloud", key: f.key + 1, origin: null }));

  /** Tiff has the words: the face opens if it had closed, and the mark goes
      to the cloud once its dots have landed. */
  const think = () => {
    setStage("thinking");
    setError(null);
    stopFold();
    setFaceOpen(true);
    const wait = still ? 0 : gatherUntil.current - Date.now();
    if (wait > 0) {
      cloudAt.current = gatherUntil.current;
      later(wait, toCloud);
    } else {
      cloudAt.current = Date.now();
      toCloud();
    }
  };

  /** Hold what came back until the cloud has had its floor. */
  const settle = (fn: () => void) => {
    if (!alive.current) return;
    const wait = still ? 0 : cloudAt.current + CLOUD_MS - Date.now();
    if (wait > 0) later(wait, fn);
    else fn();
  };

  /** Tiff answers: the cloud falls, then the face zone closes. */
  const fall = () => {
    setFace((f) => ({ ...f, stage: null }));
    stopFold();
    if (still) setFaceOpen(false);
    else
      fold.current = later(FOLD_MS, () => {
        fold.current = null;
        setFaceOpen(false);
      });
  };

  const tiffSays = (text: string, next: Stage, more: Partial<ModalTurn> = {}) => {
    addTurn({ who: "tiff", text, ...more });
    setStage(next);
    fall();
  };

  /* ── the server ── */

  /** The note was left waiting after you went: keep the words, file none. */
  const walkAway = (noteId: string) => void dismissNote(noteId);

  const asks = (n: Note, text: string, quick: QuickAnswer[]) => {
    const gone = new Set(leave.current);
    const rows = planView(n.proposal, n.staff, true).filter((r) => !gone.has(r.key));
    tiffSays(text, "asking", { rows, quick, noteId: n.id });
  };

  const file = async (n: Note, opts: { retarget?: NoteTarget; answer?: string }) => {
    n.busy = true;
    let r: FileResult;
    try {
      r = await fileNote(n.id, { leaveOut: [...leave.current], ...opts });
    } catch {
      /* Whether it filed is unknown — the answer was lost, not the call — so
         nothing sets the note aside from here on, closing included: that
         could write over a filed one. A reply still goes to the note, and
         the server refuses it if it did file. */
      n.busy = false;
      n.lost = true;
      return settle(() => tiffSays(NOT_REACHED, "failed"));
    }
    n.busy = false;
    const res = r;
    if (!alive.current) {
      /* Refused means nothing was filed: the note is set aside, as a note
         left waiting is. */
      if (!res.ok) walkAway(n.id);
      return;
    }
    if (res.ok) {
      n.waiting = false;
      changed.current = true;
      filed.current = [...filed.current, { noteId: n.id, ids: res.doors.flatMap((d) => d.ids) }];
      const gone = new Set(leave.current);
      const rows = planView(n.proposal, n.staff, false).filter((row) => !gone.has(row.key));
      return settle(() =>
        tiffSays(lastTiff(res.turns) || "Done.", "filed", {
          rows,
          doors: res.doors,
          noteId: n.id,
          undo: "ready",
          filed: true,
        })
      );
    }
    if (res.ask) {
      n.waiting = true;
      const ask = res.ask;
      return settle(() => asks(n, tiffSince(res.turns) || ask.question, ask.options));
    }
    return settle(() => tiffSays(res.error, "failed"));
  };

  /** A routed note: ask what is unclear, or file it now. */
  const read = (r: Extract<RouteResult, { ok: true }>) => {
    const n: Note = { id: r.noteId, proposal: r.proposal, staff: r.staff, waiting: false, busy: false, lost: false };
    note.current = n;
    leave.current = [];
    const c = r.proposal.clarify;
    /* "Which job?" is the one question a pick answers, and `fileNote` asks
       it with the jobs attached; every other question is a reply. */
    if (c && c.question !== WHICH_JOB) {
      n.waiting = true;
      return settle(() => asks(n, askLine(r.proposal.say, c.question), c.options.map((label) => ({ label }))));
    }
    void file(n, {});
  };

  /** Words the server never got: filed as said, so nothing is lost. */
  const keep = async (words: string) => {
    let k: KeepResult;
    try {
      k = await keepWords(words, room);
    } catch {
      return settle(() => tiffSays(NOT_REACHED, "failed"));
    }
    const res = k;
    if (!alive.current) return;
    if (res.ok) {
      changed.current = true;
      filed.current = [...filed.current, { noteId: res.noteId, ids: [] }];
      return settle(() => tiffSays(KEPT_AS_SAID, "filed"));
    }
    return settle(() => tiffSays(res.error, "failed"));
  };

  /** The turns a question or a new note is read by: what was said, not what
      is still arriving. */
  const spoken = (ts: readonly ModalTurn[]) =>
    ts.filter((t) => t.text.trim() && !t.streaming).map((t) => ({ who: t.who, text: t.text }));

  const route = async (words: string, source: "voice" | "text", before: readonly ModalTurn[]) => {
    /* A new note after Tiff has already answered or filed something is read
       by what came before it ("and the same for Smith St"); a first note is
       sent exactly as it always was. */
    const prior = earlierTurns(spoken(before));
    const input: Parameters<typeof routeNote>[0] = { transcript: words, target, source, room };
    if (prior.length) input.before = prior;
    let r: RouteResult;
    try {
      r = await routeNote(input);
    } catch {
      return keep(words);
    }
    const res = r;
    if (!alive.current) {
      if (res.ok) walkAway(res.noteId);
      return;
    }
    if (!res.ok) {
      /* `kept`: routing failed and the server filed the words as said — a
         note the diary lands lit on close, like any other it filed. */
      if (res.kept) changed.current = true;
      if (res.kept && res.noteId) filed.current = [...filed.current, { noteId: res.noteId, ids: [] }];
      return settle(() => tiffSays(res.error, res.kept ? "filed" : "failed"));
    }
    read(res);
  };

  const reply = async (n: Note, words: string) => {
    n.busy = true;
    let r: RouteResult;
    try {
      r = await continueNote(n.id, words, [...leave.current]);
    } catch {
      n.busy = false;
      if (!alive.current) return walkAway(n.id);
      return settle(() => tiffSays(NOT_REACHED, "asking"));
    }
    n.busy = false;
    const res = r;
    if (!alive.current) return walkAway(n.id);
    if (!res.ok) return settle(() => tiffSays(res.error, "asking"));
    read(res);
  };

  const ask = (question: string, before: readonly ModalTurn[]) => {
    asking.current?.abort();
    const ctl = new AbortController();
    asking.current = ctl;
    const key = nextKey("tiff");
    const run = { text: "", shown: false, pending: false, done: false };
    const on = () => alive.current && !ctl.signal.aborted;
    const show = () => {
      run.shown = true;
      tiffSays(run.text || (run.done ? NO_ANSWER : ""), run.done ? "editing" : "answering", {
        key,
        streaming: !run.done,
      });
    };
    void askBrain(
      {
        question,
        target,
        targetLabel,
        history: spoken(before),
        signal: ctl.signal,
      },
      {
        onDelta: (t) => {
          if (!on()) return;
          run.text += t;
          if (run.shown) patchTurn(key, () => ({ text: run.text }));
          else if (!run.pending) {
            run.pending = true;
            settle(show);
          }
        },
        onTool: () => {},
        onError: (message) => {
          if (!on()) return;
          run.done = true;
          if (run.shown) {
            patchTurn(key, () => ({ streaming: false }));
            tiffSays(message, "failed");
          } else settle(() => tiffSays(message, "failed"));
        },
        onDone: () => {
          if (!on()) return;
          run.done = true;
          if (run.shown) {
            patchTurn(key, () => ({ streaming: false, text: run.text || NO_ANSWER }));
            setStage("editing");
          } else if (!run.pending) {
            run.pending = true;
            settle(show);
          }
        },
      }
    );
  };

  /* ── the calendar's room ── */

  /** Everything said for a line that is kept as said: the line and its answers. */
  const saidAll = (a: DayAsk) => [a.line, ...a.answers].join("\n");

  /** A line for the calendar: read, and on the calendar at once, or asked
      about. It files live, as a note does, with Undo on what landed. The
      box's day goes with it, for a line that names none. */
  const fileLine = async (a: DayAsk) => {
    dayAsk.current = null;
    let r: CalendarLineResult;
    try {
      r = await fileCalendarLine(a.line, a.source, a.answers, day);
    } catch {
      /* Whether it went on is unknown; the words are kept, where a second
         copy costs nothing, rather than risk the calendar twice. */
      return keep(saidAll(a));
    }
    const res = r;
    if (!alive.current) {
      /* Closed before she answered: what she put on comes off again, as a
         note left waiting is set aside and files nothing (`walkAway`). The
         turn that would have said so, and its Undo, went with the modal, so
         nothing would ever have told the page it landed. */
      if (res.ok) void undoCalendarLine(res.ids).catch(() => {});
      return;
    }
    if (res.ok) {
      changed.current = true;
      onCalendar.current = { ids: res.ids, about: res.about };
      filed.current = [...filed.current, { ids: res.ids }];
      const door: TurnDoor = { kind: "events", count: res.ids.length, label: res.door, ids: res.ids };
      return settle(() =>
        tiffSays(res.say, "filed", {
          rows: calendarRows(res.plan),
          doors: [door],
          events: res.ids,
          undo: "ready",
          filed: true,
        })
      );
    }
    if ("ask" in res) {
      dayAsk.current = a;
      return settle(() => tiffSays(res.ask, "asking"));
    }
    /* Never read: the words go in the diary as said, as a note's would. */
    if (res.unread) return keep(saidAll(a));
    return settle(() => tiffSays(res.error, "failed"));
  };

  /** A reply after she filed: kept on what she filed, as its note. */
  const noteOn = async (on: OnCalendar, words: string) => {
    let r: CalendarResult;
    try {
      r = await noteOnCalendarEvents(on.ids, words);
    } catch {
      return settle(() => tiffSays(NOT_REACHED, "filed"));
    }
    const res = r;
    if (!alive.current) return;
    if (!res.ok) return settle(() => tiffSays(res.error, "filed"));
    changed.current = true;
    settle(() => tiffSays(notedLine(on.about), "filed"));
  };

  /** Where words said in the calendar's room go (see the header). */
  const toCalendar = (words: string, source: "voice" | "text", before: readonly ModalTurn[]) => {
    const waiting = dayAsk.current;
    if (waiting) return void fileLine({ ...waiting, answers: [...waiting.answers, words] });
    if (looksLikeQuestion(words)) return ask(words, before);
    const on = onCalendar.current;
    if (on) return void noteOn(on, words);
    void fileLine({ line: words, source, answers: [] });
  };

  /** Where a reply goes. `before` is the conversation ahead of these words. */
  const submit = (words: string, source: "voice" | "text", before: readonly ModalTurn[]) => {
    if (calendar) return toCalendar(words, source, before);
    const n = note.current;
    if (n?.waiting) return void reply(n, words);
    if (looksLikeQuestion(words)) return ask(words, before);
    void route(words, source, before);
  };

  /** Your words become a turn — the live one, if they arrived there. */
  const commit = (words: string, source: "voice" | "text") => {
    const key = live?.key ?? nextKey("you");
    const enter = live ? live.enter : true;
    const before = turns;
    setTurns((ts) => [...ts, { key, who: "you", text: words, enter }]);
    setLive(null);
    setDraft("");
    setFixing(false);
    setSpoke(false);
    submit(words, source, before);
  };

  /* ── the microphone ── */

  const dict = useDictation({
    onTranscript: (transcript, { capped }) => {
      if (!alive.current) return;
      setReading(null);
      const words = appendSpoken(draft, transcript);
      if (awaitingVoice.current) {
        awaitingVoice.current = false;
        return commit(words, "voice");
      }
      /* Clicked into your words, or the two-minute ceiling: the words wait
         in the turn to be fixed and sent. */
      setDraft(words);
      if (capped) {
        setStage("editing");
        setFixing(true);
      }
    },
    onError: (message) => {
      if (!alive.current) return;
      setReading(null);
      if (awaitingVoice.current) {
        /* Done, and nothing came back: the reply box, and why. */
        awaitingVoice.current = false;
        setLive(null);
        setStage("editing");
        setFixing(false);
        fall();
      } else if (stage === "listening") {
        /* The microphone would not open (blocked, or none): a modal with no
           microphone opens on the reply box, so this one goes to it. */
        setLive(null);
        setStage("editing");
      }
      setError(message);
    },
  });

  /* OPENING MEANS LISTENING. The microphone is asked for as the modal
     arrives, and let go if it leaves — an effect rather than the click, so a
     strict-mode remount gives the recording back rather than keeping two. */
  const micOn = useEffectEvent(() => dict.start());
  const micOff = useEffectEvent(() => dict.cancel());
  useEffect(() => {
    if (!listensFirst) return;
    micOn();
    return () => micOff();
  }, [listensFirst]);

  /* OPENED ON TYPED WORDS ("Sort it out"): they go at once, and the mark
     turns to the cloud once its dots have landed. Sent once, whatever a
     remount does. */
  const sendOpening = useEffectEvent(() => {
    if (sent.current || !words0) return;
    sent.current = true;
    const wait = still ? 0 : gatherUntil.current - Date.now();
    cloudAt.current = wait > 0 ? gatherUntil.current : Date.now();
    later(Math.max(0, wait), toCloud);
    submit(words0, "text", had);
  });
  useEffect(() => {
    if (words0) sendOpening();
  }, [words0]);

  /* ── what the person does ── */

  /** Done: stop listening and send what was said. False when there was
      nothing to send, which closes the modal.

      ONCE, AND ONLY WHILE LISTENING. A second press lands on a dock that is
      folding away, after the mic has stopped and before the read-back has
      put the words anywhere, so it would read as "nothing was said" and
      close the modal on them. It does nothing instead. */
  const done = (): boolean => {
    if (awaitingVoice.current || stage !== "listening") return true;
    if (dict.recording) {
      awaitingVoice.current = true;
      const said = appendSpoken(draft, dict.interim);
      setLive((l) => (l ? { ...l, said } : l));
      think();
      dict.stop();
      return true;
    }
    if (dict.arming) dict.stop();
    if (!draft.trim()) return false;
    send();
    return true;
  };

  /** Send the words in the composer — typed, or fixed by hand. */
  const send = () => {
    const words = draft.trim();
    if (!words) return;
    /* A read-back still in the air would land in the next box. */
    if (dict.transcribing) dict.cancel();
    think();
    commit(words, spoke ? "voice" : "text");
  };

  /** "Clear what you said": start that one again. */
  const clear = () => {
    setDraft("");
    setError(null);
    if (stage === "listening") {
      if (dict.recording) dict.restart();
      else if (!dict.arming) dict.start();
      return;
    }
    if (fixing) {
      if (dict.transcribing || reading !== null) dict.cancel();
      setReading(null);
      setFixing(false);
      if (voiceEnabled) {
        setStage("listening");
        dict.start();
      }
    }
  };

  /** Clicking into your words stops the mic and keeps them for typing —
      on screen, as they were, until the read-back replaces them. */
  const fix = () => {
    if (stage !== "listening") return;
    /* Held only when there are live words: with none, the engine may bin a
       silent take unheard, and no read-back would ever come to end it. */
    const heard = dict.interim.trim() ? appendSpoken(draft, dict.interim) : null;
    dict.handOver();
    setReading(heard);
    setStage("editing");
    setFixing(true);
  };

  /** The reply box's Tiff button: listen again, the dots gathering from it —
      unless it was pressed from the keyboard, which moves nothing (law 8). */
  const talk = (from: HTMLElement | null, keyboard = false) => {
    if (!voiceEnabled || stage === "listening" || stage === "thinking" || stage === "answering") return;
    const r = from?.getBoundingClientRect();
    const origin = !still && !keyboard && r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null;
    stopFold();
    gatherUntil.current = origin ? Date.now() + GATHER_MS : 0;
    setFace((f) => ({ stage: "mark", key: f.key + 1, origin }));
    setFaceOpen(true);
    setLive({ key: nextKey("you"), said: null, enter: true });
    setSpoke(true);
    setFixing(false);
    setError(null);
    setStage("listening");
    dict.start();
  };

  /** A quick answer, tapped: a job files straight past its question; a
      person or anything else is a reply. */
  const answer = (q: QuickAnswer) => {
    const n = note.current;
    if (!n || stage !== "asking") return;
    addTurn({ who: "you", text: q.label });
    think();
    /* the words you picked go too, so the note keeps them as your turn */
    if (q.target) void file(n, { retarget: q.target, answer: q.label });
    else void reply(n, q.label);
  };

  /** A row's cross: off the plan, and named to the server on the next call. */
  const clearRow = (turnKey: string, rowKey: string) => {
    if (!leave.current.includes(rowKey)) leave.current = [...leave.current, rowKey];
    patchTurn(turnKey, (t) => ({ rows: t.rows?.map((r) => (r.key === rowKey ? { ...r, off: true } : r)) }));
  };

  const undo = async (turnKey: string, noteId: string) => {
    patchTurn(turnKey, () => ({ undo: "busy" }));
    let r: UndoResult;
    try {
      r = await undoNote(noteId);
    } catch {
      if (!alive.current) return;
      patchTurn(turnKey, () => ({ undo: "ready" }));
      return addTurn({ who: "tiff", text: NOT_REACHED });
    }
    const res = r;
    if (!alive.current) return;
    if (res.ok) {
      changed.current = true;
      filed.current = filed.current.filter((f) => f.noteId !== noteId);
      patchTurn(turnKey, () => ({ undo: undefined, doors: [], filed: false }));
      return addTurn({ who: "tiff", text: res.summary });
    }
    /* Refused: someone acted on a row, and it will not come right later. */
    patchTurn(turnKey, () => ({ undo: undefined }));
    addTurn({ who: "tiff", text: res.error });
  };

  /** Undo on a calendar line: what it put on comes off. `ids` are the
      turn's own, so its filing is the one whose first row they start with. */
  const undoEvents = async (turnKey: string, ids: string[]) => {
    patchTurn(turnKey, () => ({ undo: "busy" }));
    let r: Awaited<ReturnType<typeof undoCalendarLine>>;
    try {
      r = await undoCalendarLine(ids);
    } catch {
      if (!alive.current) return;
      patchTurn(turnKey, () => ({ undo: "ready" }));
      return addTurn({ who: "tiff", text: NOT_REACHED });
    }
    const res = r;
    if (!alive.current) return;
    if (res.ok) {
      changed.current = true;
      filed.current = filed.current.filter((f) => f.noteId || f.ids[0] !== ids[0]);
      /* A reply is kept on what is on the calendar, and this no longer is. */
      if (onCalendar.current && onCalendar.current.ids[0] === ids[0]) onCalendar.current = null;
      patchTurn(turnKey, () => ({ undo: undefined, doors: [], filed: false }));
      return addTurn({ who: "tiff", text: res.summary });
    }
    patchTurn(turnKey, () => ({ undo: undefined }));
    addTurn({ who: "tiff", text: res.error });
  };

  /** "Add to the Library": the one row that waits for a press. */
  const publishKb = async (turnKey: string, noteId: string, index: number) => {
    const mark = (kb: PlanRowView["kb"]) =>
      patchTurn(turnKey, (t) => ({
        rows: t.rows?.map((r) => (r.lane === "kbEntries" && r.index === index ? { ...r, kb } : r)),
      }));
    mark("busy");
    let r: PublishKbResult;
    try {
      r = await publishNoteKb(noteId, index);
    } catch {
      r = { ok: false, error: NOT_REACHED };
    }
    const res = r;
    if (!alive.current) return;
    if (res.ok) {
      changed.current = true;
      return mark("added");
    }
    mark("ready");
    addTurn({ who: "tiff", text: res.error });
  };

  /** Leaving. Nothing that comes back afterwards does anything. */
  const close = (): Closed => {
    alive.current = false;
    for (const t of timers.current) clearTimeout(t);
    timers.current.clear();
    asking.current?.abort();
    /* Escape or × while listening routes nothing: the recording is binned. */
    if (dict.recording || dict.arming || dict.transcribing) dict.cancel();
    /* A note Tiff was waiting on is set aside — unless a call on it is still
       out. A picked job files straight past its question, and setting the
       note aside under a filing in flight would race it; the call's own
       answer sets it aside if it comes back unfiled. Nor one whose filing's
       answer was lost: it may have landed. */
    const n = note.current;
    if (n?.waiting && !n.busy && !n.lost) walkAway(n.id);
    const landed = filed.current.length
      ? {
          noteIds: filed.current.flatMap((f) => (f.noteId ? [f.noteId] : [])),
          ids: filed.current.flatMap((f) => f.ids),
        }
      : null;
    return { changed: changed.current, landed };
  };

  return {
    stage,
    turns,
    live,
    draft,
    setDraft,
    fixing,
    /** The words you clicked into, while their read-back is out. */
    reading,
    face,
    faceOpen,
    error,
    /** The words arriving while you talk. */
    interim: live && live.said === null && stage === "listening" ? dict.interim : "",
    seconds: dict.seconds,
    voiceEnabled,
    aimed,
    targetLabel,
    dropAim: () => setAimDropped(true),
    done,
    send,
    clear,
    fix,
    talk,
    answer,
    clearRow,
    undo,
    undoEvents,
    publishKb,
    close,
  };
}

export type Conversation = ReturnType<typeof useConversation>;
