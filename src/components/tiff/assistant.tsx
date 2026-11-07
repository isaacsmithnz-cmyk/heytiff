"use client";

import { useCallback, useEffect, useEffectEvent, useId, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { withoutPlaceTag } from "@/lib/brain/place-tag";
import { Icon } from "@/components/shell/icon";
import { TiffGlyph } from "@/components/notes/tiff-mark";
import { useHydrated } from "@/lib/use-hydrated";
import { kbDocUrl } from "@/app/actions/kb";
import type { AskSourceItem, AskTurn } from "@/lib/tiff/ask-client";
import { askBrain } from "@/lib/brain/ask-client";
import { consumeAskHandoff, type AskHandoff, type AskScope } from "@/lib/tiff/ask-handoff";
import { loadThreads, STORE_KEY, type TiffMsg, type TiffThread } from "@/lib/tiff/threads";
import { pullThreads, pushThreads } from "@/lib/tiff/thread-sync";
import { categoryHue, clockOf, dayKeyOf, dayLabel, isEmailThread, threadWhen } from "@/lib/tiff/conversations";
import { Button } from "@/components/parts/button";
import { ConfirmDialog, Dialog } from "@/components/parts/dialog";
import { Field, TextInput } from "@/components/parts/field";
import { Empty, Wrong } from "@/components/parts/states";
import { Fade } from "@/components/parts/fade";
import { Dot } from "@/components/parts/state";
import { CvBox } from "@/components/conversations/box";
import { CvList } from "@/components/conversations/list";
import { KB_CATEGORIES } from "./kb";
import { appendSpoken, useDictation } from "@/components/notes/dictation";

/* THE HANDOFF IS READ ONCE PER MOUNT, as a store rather than in an effect.

   It is a client-only note and what it decides — the opener in the box — has
   to diverge from the HTML the server sent, which used to mean `setInput`
   inside a mount effect and a `react-hooks/set-state-in-effect` disable. One
   disable makes React Compiler skip the whole component, whatever the rule
   and however good the reason (see studio/canvas.tsx), and this is the
   biggest component on the screen.

   `consumeAskHandoff` READS AND TEARS UP the note, so it cannot be called
   again for a second snapshot — hence the latch. React asks for the first
   client snapshot once hydration is done, which is where the note is eaten;
   the latch is dropped on unmount so a remount finds an empty box, which is
   the behaviour the "eats the note" test walks. */
let latchedHandoff: AskHandoff | undefined;

const NO_HANDOFF: AskHandoff = { text: null, doc: null };

export const askHandoffAtMount = () => {
  if (latchedHandoff === undefined) latchedHandoff = consumeAskHandoff();
  return latchedHandoff;
};
const forgetAskHandoff = () => {
  latchedHandoff = undefined;
};
export const noAskHandoff = () => NO_HANDOFF;
export const noHandoffSubscription = () => () => {};

/* CONVERSATIONS' TIFF: your chats with her, and the open one (v2, the board
   v2-board-conversations; components/conversations lays the place out).

   The assistant makes two halves, the list of threads and the open
   conversation with its box at the foot, and hands them to `frame`, which
   puts them on the page beside whatever else the place shows (its title, its
   views), so an answer still arriving keeps arriving while another view is
   up. It used to have a second layout, the Library's own ask with its
   landing, its shelves and the search lines drawn between them; nothing drew
   that one any more, and it went.

   SHE IS THE ONE TIFF. The box asks the brain Home, a job and the Tiff
   button ask (/api/brain/ask), so a chat begun on Home goes on here as the
   same Tiff, as the phone's do.

   THE ANSWER ARRIVES AS IT IS WRITTEN. `askBrain` reads the stream and this
   component appends its words to one live message, which is committed to the
   thread when the stream ends. */

/* A message and a thread are lib/tiff/threads.ts's, which the server's copy
   shares (docs/migrations/tiff_threads.sql, NOT YET APPLIED). Threads live in
   localStorage under `STORE_KEY`, a bumped key: messages carry sources and
   whether they were researched (older answers do, from when the Library's ask
   searched the shelves), and v1 rows have neither. v1 rows are ignored rather
   than migrated: they are preview-era replies from a model that wasn't
   connected. With the table applied the server keeps a copy that follows the
   person to other devices (lib/tiff/thread-sync.ts); without it, this
   device's copy is the only one. */

type Msg = TiffMsg;
type Thread = TiffThread;

/** Prior turns sent as context. The route caps this again on its side. */
const HISTORY_TURNS = 8;

/** A thread title somebody typed. Long enough to describe a job, short enough
    to read in the two-column list without wrapping. */
const TITLE_MAX = 60;

/** What the pane says while she works and no word of the answer has come. */
const THINKING = "Thinking";

const plural = (count: number, one: string, many = `${one}s`) => (count === 1 ? one : many);

/* The clock and the dice, kept at module scope on purpose: everything inside
   the component is analysed as render code, and `Date.now()` / `Math.random()`
   sitting in a handler there reads to the compiler's purity rule as a value
   that could change on a re-render. */
const nowMs = (): number => Date.now();

const newThreadId = (at: number): string =>
  `t-${at.toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;

/* ── what an answer is allowed to look like ──────────────────────────────── */

export type AnswerBlock =
  | { kind: "p"; text: string }
  | { kind: "ul"; items: string[] }
  /** A procedure. Ordered because the order is the instruction. */
  | { kind: "ol"; items: string[] }
  /** Pressures, resistances, capacities — the shape trade data actually has. */
  | { kind: "table"; head: string[]; rows: string[][] };

const ORDERED = /^(\d{1,2})[.)]\s+(.*)$/;
const isRule = (cells: string[]) => cells.every((c) => /^:?-{2,}:?$/.test(c.trim()));

/** `| a | b |` → ["a","b"], tolerating the optional outer pipes. */
function tableCells(line: string): string[] | null {
  if (!line.includes("|")) return null;
  const inner = line.replace(/^\s*\|/, "").replace(/\|\s*$/, "");
  if (!inner.includes("|")) return null;
  return inner.split("|").map((c) => c.trim());
}

/* The grammar an answer is allowed to use: paragraphs on blank lines, "- "
   bullets, "1. " steps, and pipe tables.

   THE LAST TWO ARE HERE BECAUSE THE TRADE NEEDS THEM. A thermistor resistance
   curve, a running-pressure range by ambient, a commissioning procedure —
   these are a table and a numbered list, and flattening them into prose is
   how a number ends up read against the wrong row. The system prompt asks for
   exactly this grammar and nothing else, so anything richer still arrives as
   its literal characters: an honest failure rather than a silent one.

   A TABLE IS ONLY A TABLE ONCE ITS RULE ROW ARRIVES. Mid-stream, the header
   line alone is indistinguishable from a sentence containing a pipe, so it is
   held as a paragraph until the `|---|` confirms it — which also stops a
   half-arrived table from flickering into a one-row grid while it streams. */
export function answerBlocks(raw: string): AnswerBlock[] {
  const text = withoutPlaceTag(String(raw ?? ""));
  const blocks: AnswerBlock[] = [];
  let para: string[] = [];
  let bullets: string[] = [];
  let steps: string[] = [];

  const flushPara = () => {
    if (para.length) blocks.push({ kind: "p", text: para.join(" ") });
    para = [];
  };
  const flushBullets = () => {
    if (bullets.length) blocks.push({ kind: "ul", items: bullets });
    bullets = [];
  };
  const flushSteps = () => {
    if (steps.length) blocks.push({ kind: "ol", items: steps });
    steps = [];
  };
  const flushAll = () => {
    flushBullets();
    flushSteps();
    flushPara();
  };

  const lines = String(text ?? "").split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) {
      flushAll();
      continue;
    }

    const cells = tableCells(line);
    const next = tableCells((lines[i + 1] ?? "").trim());
    if (cells && next && isRule(next)) {
      flushAll();
      const rows: string[][] = [];
      let j = i + 2;
      for (; j < lines.length; j++) {
        const row = tableCells(lines[j].trim());
        if (!row || isRule(row)) break;
        // ragged rows are padded rather than dropped: a missing cell is a gap
        // in the data, and hiding the row hides that
        rows.push(Array.from({ length: cells.length }, (_, k) => row[k] ?? ""));
      }
      blocks.push({ kind: "table", head: cells, rows });
      i = j - 1;
      continue;
    }

    const step = ORDERED.exec(line);
    if (step) {
      flushBullets();
      flushPara();
      if (step[2].trim()) steps.push(step[2].trim());
      continue;
    }

    if (line.startsWith("- ") || line === "-") {
      flushSteps();
      flushPara();
      const item = line.slice(1).trim();
      if (item) bullets.push(item);
      continue;
    }

    flushBullets();
    flushSteps();
    para.push(line);
  }

  flushAll();
  return blocks;
}

function AnswerText({ text }: { text: string }) {
  const blocks = useMemo(() => answerBlocks(text), [text]);
  return (
    <>
      {blocks.map((b, i) => {
        if (b.kind === "ul")
          return (
            <ul key={i}>
              {b.items.map((item, j) => (
                <li key={j}>{item}</li>
              ))}
            </ul>
          );
        if (b.kind === "ol")
          return (
            <ol key={i} className="tk-steps">
              {b.items.map((item, j) => (
                <li key={j}>{item}</li>
              ))}
            </ol>
          );
        if (b.kind === "table")
          return (
            /* The scroller is the table's own, not the answer's: a wide
               pressure table scrolls sideways inside the sheet instead of
               widening it and pushing the whole conversation about. */
            <div className="tk-tw" key={i}>
              <table className="tk-tbl">
                <thead>
                  <tr>
                    {b.head.map((h, j) => (
                      <th key={j}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {b.rows.map((row, j) => (
                    <tr key={j}>
                      {row.map((cell, k) => (
                        <td key={k}>{cell}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        return <p key={i}>{b.text}</p>;
      })}
    </>
  );
}

/* ── the screen ──────────────────────────────────────────────────────────── */

/* What the assistant hands `frame`: the same threads, the same ask and the
   same stream, as a list and an open conversation, for the place to lay out
   beside its title and its views. Nothing about asking is written twice. */
export type ConversationParts = {
  /** The threads, newest first: a title in bold over its time in grey. */
  list: ReactNode;
  /** The open conversation, or a new one, with the box at its foot. */
  pane: ReactNode;
};

/** An email open in the Inbox: its own head and what Tiff read, then anything
    asked about it, in its thread. */
export type OpenEmail = {
  threadId: string;
  title: string;
  /** the thread for someone who has none of their own; null until it's read */
  seed: TiffThread | null;
  head: ReactNode;
  read: ReactNode;
};

/** What was said after Tiff's read of an email. */
const afterRead = (messages: Msg[]) => messages.slice(messages.findIndex((m) => m.email) + 1);

export function TiffAssistant({
  canManage = false,
  docTitles = {},
  voiceEnabled = false,
  frame,
  initialThreadId = null,
  onOpenChange,
  you = "You",
  email = null,
  onMove,
}: {
  canManage?: boolean;
  /** Every document's current name, by id — what the cards of what she read
      prefer over the title stored alongside the answer. */
  docTitles?: Record<string, string>;
  /** ELEVENLABS_API_KEY is set on this deployment. No key, no mic — the box
      is a plain text field either way. */
  voiceEnabled?: boolean;
  /** Lays the list and the open conversation out on the page. */
  frame: (parts: ConversationParts) => ReactNode;
  /** The thread the address opened. */
  initialThreadId?: string | null;
  /** The open thread changed, so the page can say so in the address. */
  onOpenChange?: (id: string | null) => void;
  /** The asker's name, beside their own turns. */
  you?: string;
  /** The email open in the Inbox, in place of a chat. */
  email?: OpenEmail | null;
  /** Tiff opened a screen (`/dashboard/…`): go there. */
  onMove?: (href: string) => void;
}) {
  const hydrated = useHydrated();
  // null = "not touched yet": until the first send, render straight from storage
  const [threadState, setThreadState] = useState<Thread[] | null>(null);
  const [activeId, setActiveId] = useState<string | null>(initialThreadId);
  const handoff = useSyncExternalStore(noHandoffSubscription, askHandoffAtMount, noAskHandoff);
  const prefill = handoff.text;
  /* THE DOCUMENT THIS CONVERSATION IS ABOUT, when a library row sent us here.
     It is a control, not a sentence: the row used to type `In “…”, ` into the
     box, and the only trace of the choice was words that filtered nothing.
     Shown as a chip you can clear, and cleared is the whole library again. */
  const [scope, setScope] = useState<AskScope | null>(() => handoff.doc);
  /* null until the box is touched: until then the handoff's opener IS the box,
     and with no handoff that is the empty string it always was. */
  const [typed, setTyped] = useState<string | null>(null);
  const input = typed ?? prefill ?? "";
  const [peek, setPeek] = useState<SourceDoc | null>(null);

  /* The thread being renamed, and the one being removed. Held as the row
     itself rather than an id so a modal can name the thread even in the frame
     where it has just left the list. */
  const [renaming, setRenaming] = useState<Thread | null>(null);
  const [removing, setRemoving] = useState<Thread | null>(null);

  /* The answer being written. Held apart from the thread rather than mutated
     into it, so a delta doesn't rewrite localStorage sixty times a second; it
     is committed once, when the stream ends. */
  type Live = {
    threadId: string;
    text: string;
    /** What she did before answering: her readers' own words. */
    steps: string[];
  };
  const [live, setLive] = useState<Live | null>(null);
  const liveRef = useRef<Live | null>(null);

  /* The failed ask, kept whole so Retry re-sends exactly what was sent —
     including the history as it was THEN, which is not the same as the history
     now that a partial answer has been kept in the thread. */
  const [failure, setFailure] = useState<{
    threadId: string;
    message: string;
    question: string;
    history: AskTurn[];
  } | null>(null);

  const boxRef = useRef<HTMLTextAreaElement>(null);
  const focusBox = () => boxRef.current?.focus();
  /* The clock the times are read against, once per visit: a "Today" that
     turned into "Yesterday" mid-read would be the page moving under you. */
  const [now] = useState(nowMs);
  const chatRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  /* Whether the transcript is pinned to its bottom edge. True until the reader
     scrolls up — a stream should follow itself, but not fight somebody who has
     gone back to re-read a table while the rest of the answer arrives. */
  const followRef = useRef(true);

  const threads = threadState ?? (hydrated ? loadThreads() : []);
  /* An email's thread lives in the Inbox; Chats is your own talk with her. */
  const chats = threads.filter((t) => !isEmailThread(t.id));
  /* CONVERSATIONS ONLY KEEPS THEM (Isaac, 20 October: "Conversations are just
     where conversations are stored"; they start on Home). With none named, it
     opens the newest, unless a document handed a question over to ask. */
  const shownId =
    activeId ?? (!prefill && !scope && !handoff.ask ? ([...chats].sort((a, b) => b.updatedAt - a.updatedAt)[0]?.id ?? null) : null);
  const active = email ? (threads.find((t) => t.id === email.threadId) ?? email.seed) : (threads.find((t) => t.id === shownId) ?? null);

  const streaming = live !== null;

  /* SPEAKING TO TIFF IS JUST TYPING WITH YOUR VOICE.

     Everything said to the box is a question, so there is no sieve, no
     routing and no review — the words land in the box, the caret comes back,
     and you still press send. That is the whole difference between this mic
     and the token's: the token has to work out what your words BECOME, and
     this one already knows. It is also why the box is not wrapped in a note
     scope; there is no target for a note that is never taken.

     The ENGINE is the token's, imported unchanged: one engine, and the
     clothes belong to the box it sits in. */
  const [voiceErr, setVoiceErr] = useState<string | null>(null);
  /** The last recording stopped at the two-minute ceiling. Appending is
      already the right answer for a question, so nothing changes about where
      the words go — this only earns a line saying why the mic let go. */
  const [ranOut, setRanOut] = useState(false);
  const dict = useDictation({
    onTranscript: (spoken, { capped }) => {
      setVoiceErr(null);
      setRanOut(capped);
      setTyped((prev) => appendSpoken(prev ?? prefill ?? "", spoken));
    },
    onError: setVoiceErr,
  });

  const listening = dict.recording || dict.transcribing;

  /* `working` is the whole flight, not just the silence before the first
     word: an answer still arriving is still work, and a box that stopped
     waiting mid-stream would claim it had finished. */
  const working = Boolean(live) && !listening;

  /* The caret comes back when the mic lets go. Focusing inside `onTranscript`
     misses every time: the box is still disabled at that moment, because the
     engine clears `transcribing` in a `finally` AFTER the callback — and
     focus() on a disabled box does nothing at all. */
  const wasListening = useRef(false);
  useEffect(() => {
    if (wasListening.current && !listening) focusBox();
    wasListening.current = listening;
  }, [listening]);

  useEffect(() => () => abortRef.current?.abort(), []);

  /* Follow the stream — unless the reader has left the bottom. The handler on
     the transcript keeps `followRef` honest; this effect only acts on it. */
  useEffect(() => {
    const el = chatRef.current;
    /* an open email starts at its top, where the decision and her read are */
    if (el && followRef.current && (!email || streaming)) el.scrollTop = el.scrollHeight;
  }, [active?.messages.length, live?.text, streaming, email]);

  const onChatScroll = () => {
    const el = chatRef.current;
    if (!el) return;
    /* Within a message of the bottom still counts as following: the pin
       shouldn't release because the browser rounded a subpixel. */
    followRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  /* Arriving with words left behind (the Fault Finder's question about a
     code): they are picked up here.

     NOTHING IS SENT. The opener goes in the box and the caret sits at the end
     waiting for the actual question. A prefill that asked itself would be
     putting words in somebody's mouth and spending a question they never
     asked. Read-once, so a refresh doesn't hand it over again. */
  useEffect(() => {
    if (prefill) focusBox();
  }, [prefill]);
  /* The latch belongs to this mount — see askHandoffAtMount. */
  useEffect(() => forgetAskHandoff, []);

  const persist = useCallback((next: Thread[]) => {
    setThreadState(next);
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(next));
    } catch {
      /* storage full/blocked — threads just won't survive a refresh */
    }
    pushThreads();
  }, []);

  /* THE SERVER'S COPY, once per visit (lib/tiff/thread-sync.ts). Until
     docs/migrations/tiff_threads.sql is applied this comes back empty-handed
     and nothing changes: the threads stay on this device. With it, threads
     from the person's other devices come down, and on the first visit this
     browser's own go up, once. */
  const [kept, setKept] = useState(false);
  useEffect(() => {
    let here = true;
    void pullThreads().then((merged) => {
      if (!here || !merged) return;
      setThreadState(merged);
      setKept(true);
    });
    return () => {
      here = false;
    };
  }, []);

  const appendTo = useCallback(
    (threadId: string, msg: Msg) => {
      setThreadState((prev) => {
        const base = prev ?? loadThreads();
        const next = base.map((t) =>
          t.id === threadId ? { ...t, updatedAt: msg.at, messages: [...t.messages, msg] } : t
        );
        try {
          localStorage.setItem(STORE_KEY, JSON.stringify(next));
        } catch {}
        return next;
      });
      pushThreads();
    },
    []
  );

  const setLiveBoth = (next: Live | null) => {
    liveRef.current = next;
    setLive(next);
  };

  const patchLive = (patch: (prev: Live) => Live) => {
    const prev = liveRef.current;
    if (!prev) return;
    setLiveBoth(patch(prev));
  };

  /** The live answer as a stored message. Partial text still counts — an
      answer that was cut off is worth more in the thread than nothing. */
  const commitLive = (state: Live) => {
    if (!state.text.trim()) return;
    appendTo(state.threadId, {
      role: "tiff",
      text: state.text,
      at: nowMs(),
      ...(state.steps.length ? { steps: state.steps } : {}),
    });
  };

  /* CONVERSATIONS ASKS THE ONE TIFF (Isaac, 7 November 2026: "Fix all of
     those", Tiff asked two ways): the brain Home, a job and the Tiff button
     ask (/api/brain/ask), with her readers and her moves, so a chat begun on
     Home goes on here as the same Tiff, as the phone's do. What she reaches
     for is her steps; a screen she opens is the end of the turn. */
  const run = (threadId: string, question: string, history: AskTurn[]) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setFailure(null);
    setLiveBoth({ threadId, text: "", steps: [] });

    let moved: string | null = null;
    let over = false;
    const finish = () => {
      if (over) return;
      over = true;
      const state = liveRef.current;
      if (state) commitLive(state);
      setLiveBoth(null);
      if (moved) onMove?.(moved);
    };
    void askBrain(
      {
        question,
        screen: "Conversations",
        history: history.map((t) => ({ who: t.role === "assistant" ? ("tiff" as const) : ("you" as const), text: t.text })),
        signal: controller.signal,
      },
      {
        onDelta: (text) => {
          if (controller.signal.aborted) return;
          patchLive((prev) => ({ ...prev, text: prev.text + text }));
        },
        onTool: (label) => {
          if (controller.signal.aborted || !label) return;
          patchLive((prev) => (prev.steps[prev.steps.length - 1] === label ? prev : { ...prev, steps: [...prev.steps, label] }));
        },
        onScreen: (href) => {
          if (controller.signal.aborted) return;
          moved = href;
          finish();
        },
        onDone: () => {
          if (controller.signal.aborted) return;
          finish();
        },
        onError: (message) => {
          if (controller.signal.aborted || over) return;
          over = true;
          const state = liveRef.current;
          if (state) commitLive(state);
          setLiveBoth(null);
          setFailure({ threadId, message, question, history });
        },
      }
    );
  };

  /** The last few turns, text only — what the route replays as context. */
  const historyOf = (messages: Msg[]): AskTurn[] =>
    messages.slice(-HISTORY_TURNS).map((m) => ({
      role: m.role === "tiff" ? ("assistant" as const) : ("user" as const),
      text: m.text,
    }));

  const send = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;

    const at = nowMs();
    const msg: Msg = { role: "user", text: trimmed, at };
    let threadId = active?.id ?? activeId;
    let next: Thread[];

    if (active) {
      next = threads.some((t) => t.id === active.id)
        ? threads.map((t) => (t.id === active.id ? { ...t, updatedAt: at, messages: [...t.messages, msg] } : t))
        : [{ ...active, updatedAt: at, messages: [...active.messages, msg] }, ...threads];
    } else {
      threadId = newThreadId(at);
      const title = trimmed.length > 52 ? `${trimmed.slice(0, 52).trimEnd()}…` : trimmed;
      next = [{ id: threadId, title, updatedAt: at, messages: [msg] }, ...threads];
      setActiveId(threadId);
      /* the page names the open thread in its address (`?open=`), so a link
         or a refresh opens it again */
      onOpenChange?.(threadId);
    }

    persist(next);
    setTyped("");
    followRef.current = true;
    run(threadId!, trimmed, historyOf(active?.messages ?? []));
  };

  const retry = () => {
    const id = active?.id ?? activeId;
    if (!failure || !id) return;
    const { question, history } = failure;
    setFailure(null);
    run(id, question, history);
  };

  /* ── leaving a conversation ─────────────────────────────────────────────
     Every exit owes the same debts: stop the stream, drop the live answer and
     drop the failure. A half-written answer is not kept (opening another
     thread, deleting this one). */
  const leaveThread = () => {
    abortRef.current?.abort();
    setLiveBoth(null);
    setFailure(null);
    setActiveId(null);
  };

  const openThread = (id: string) => {
    leaveThread();
    followRef.current = true;
    setActiveId(id);
    onOpenChange?.(id);
  };

  /* Renaming touches the title and nothing else — `updatedAt` orders the list
     by when the conversation last MOVED, and retitling it is not a turn. */
  const renameThread = (id: string, title: string) => {
    const clean = title.trim().slice(0, TITLE_MAX).trim();
    if (!clean) return;
    persist(threads.map((t) => (t.id === id ? { ...t, title: clean } : t)));
    setRenaming(null);
  };

  /* Deleting the conversation you are IN leaves no transcript of a thread
     that no longer exists on screen, and takes the stream and the failure
     with it. */
  const deleteThread = (id: string) => {
    if (active?.id === id) {
      leaveThread();
      onOpenChange?.(null);
    }
    persist(threads.filter((t) => t.id !== id));
    setRemoving(null);
  };

  /* A QUESTION HANDED OVER WHOLE (the Library's box, ask-handoff's
     writeAskQuestion) is asked once the threads are in, in a conversation of
     its own: before then a send would write over the threads it can't see. */
  const askedHandoff = useRef(false);
  const askHandedOver = useEffectEvent((question: string) => send(question));
  useEffect(() => {
    if (!handoff.ask || askedHandoff.current || !hydrated) return;
    askedHandoff.current = true;
    askHandedOver(handoff.ask);
  }, [handoff.ask, hydrated]);

  const dialogs = (
    <>
      {peek && <SourcePeek source={peek} onClose={() => setPeek(null)} />}
      {renaming && (
        <RenameThread
          thread={renaming}
          onSave={(title) => renameThread(renaming.id, title)}
          onClose={() => setRenaming(null)}
        />
      )}
      {removing && (
        <DeleteThread
          thread={removing}
          kept={kept}
          onConfirm={() => deleteThread(removing.id)}
          onClose={() => setRemoving(null)}
        />
      )}
    </>
  );

  /* ── the list and the open conversation ─────────────────────────────────
     The board v2-board-conversations. The list is every thread, newest
     first. The pane is the open one under a "Today" divider: each turn with
     the asker's initials or Tiff's mark, the name and the time, then the
     words; her steps ticked in grey; what she read as cards with an Open;
     where the answer came from in grey; and the box at the foot. Nothing
     before hydration: the threads are this browser's, so the server has
     nothing to draw, and a loading list is nothing for half a second
     anyway (rule 41). */
  const sorted = [...chats].sort((a, b) => b.updatedAt - a.updatedAt);
  const list = !hydrated ? null : sorted.length > 0 ? (
    <CvList
      label="Your chats with Tiff"
      rows={sorted.map((t) => ({ id: t.id, title: t.title, when: threadWhen(t.updatedAt, now) }))}
      openId={active?.id ?? null}
      onOpen={openThread}
    />
  ) : (
    <Empty
      what="No chats yet"
      line="Talk to Tiff on Home and the chat is kept here."
      action={
        <Button kind="second" size={32} href="/dashboard">
          Go to Home
        </Button>
      }
    />
  );
  const messages = active?.messages ?? [];
  /* in an email, her read is drawn by the Inbox; what was asked after it is
     a chat like any other */
  const shown = email ? afterRead(messages) : messages;
  const pane = (
    <section className="cv-pane" aria-label={email ? email.title : active ? active.title : "New conversation"}>
      {email ? (
        email.head
      ) : (
        <div className="cv-pane-head">
          {active && (
            <>
              <Button kind="quiet" size={32} aria-label={`Rename “${active.title}”`} onClick={() => setRenaming(active)}>
                Rename
              </Button>
              <Button kind="delete" size={32} aria-label={`Delete “${active.title}”`} onClick={() => setRemoving(active)}>
                Delete
              </Button>
            </>
          )}
        </div>
      )}
      <div className="cv-scroll" key={email?.threadId} ref={chatRef} onScroll={onChatScroll}>
        {active || email ? (
          <div className="cv-msgs">
            {email?.read}
            {shown.map((m, i) => (
              <CvTurn
                key={i}
                m={m}
                day={!email && (i === 0 || dayKeyOf(shown[i - 1].at) !== dayKeyOf(m.at)) ? dayLabel(m.at, now) : null}
                you={you}
                titles={docTitles}
                canManage={canManage}
                onPeek={setPeek}
              />
            ))}
            {live && live.threadId === active?.id && (
              <article className="jc-tiffturn" aria-busy="true">
                <p className="jc-tiffname">
                  <TiffGlyph size={18} alive working />
                  <b>Tiff</b>
                </p>
                {live.steps.length > 0 && <CvSteps steps={live.steps} />}
                {live.text ? (
                  <div className="cv-text">
                    <AnswerText text={live.text} />
                  </div>
                ) : (
                  /* what she is doing now, in ink, under the steps she has done */
                  <p className="cv-now" role="status">
                    {THINKING}
                  </p>
                )}
              </article>
            )}
            {failure && failure.threadId === active?.id && (
              <div className="cv-fail">
                <Wrong
                  word="No answer"
                  means={failure.message}
                  action={
                    <Button kind="second" size={32} icon="rotate" onClick={retry}>
                      Try again
                    </Button>
                  }
                />
              </div>
            )}
          </div>
        ) : null}
      </div>
      {(active || prefill || scope) && (
      <CvBox
        value={input}
        onChange={setTyped}
        onSubmit={() => send(input)}
        label="Ask Tiff"
        placeholder={email ? "Ask Tiff about this email" : active ? "Reply to Tiff" : "Ask Tiff about this document"}
        sendWord="Send"
        waiting={working}
        dict={voiceEnabled ? dict : null}
        voiceError={voiceErr}
        ranOut={ranOut}
        boxRef={boxRef}
        before={
          scope ? (
            <p className="cv-scope">
              <Icon name="library" size={14} />
              <Fade className="cv-scope-doc">{scope.title.trim() || "One document"}</Fade>
              <Button kind="quiet" size={32} onClick={() => setScope(null)}>
                Ask the whole library
              </Button>
            </p>
          ) : undefined
        }
      />
      )}
    </section>
  );
  return (
    <>
      {frame({ list, pane })}
      {dialogs}
    </>
  );
}

/* ── one turn, its steps, what she read, where it came from ──────────────── */

function CvTurn({
  m,
  day,
  you,
  titles,
  canManage,
  onPeek,
}: {
  m: Msg;
  /** The day's divider, on the first turn of each day. */
  day: string | null;
  you: string;
  titles: Record<string, string>;
  canManage: boolean;
  onPeek: (d: SourceDoc) => void;
}) {
  const docs = m.sources?.length ? groupSources(m.sources, titles) : [];
  const mine = m.role === "user";
  return (
    <>
      {day && (
        <div className="cv-day">
          <span>{day}</span>
        </div>
      )}
      {mine ? (
        <div className="jc-talk">
          <article className="jc-bm jc-bm--you jc-bm--first jc-bm--last">
            <p className="jc-bmname">{you}</p>
            <div className="jc-bubble">
              <span className="jc-bubwords">{m.text}</span>
            </div>
            <p className="jc-bmtime">{clockOf(m.at)}</p>
          </article>
        </div>
      ) : (
        <article className="jc-tiffturn">
          <p className="jc-tiffname">
            <TiffGlyph size={18} alive />
            <b>Tiff</b>
          </p>
          {m.steps && m.steps.length > 0 && <CvSteps steps={m.steps} />}
          <div className="cv-text">
            <AnswerText text={m.text} />
          </div>
          {m.truncated && <p className="cv-aside">That answer ran to its limit and stops mid-thought. Ask for the rest.</p>}
          {docs.length > 0 && <CvResults docs={docs} onPeek={onPeek} />}
          <CvSource m={m} docs={docs} canManage={canManage} />
          <p className="jc-bmtime">{clockOf(m.at)}</p>
        </article>
      )}
    </>
  );
}

/** What she did before she answered, each ticked in grey. */
function CvSteps({ steps }: { steps: string[] }) {
  return (
    <ul className="cv-steps" aria-label="What Tiff did">
      {steps.map((step) => (
        <li key={step}>
          <Icon name="check" size={14} />
          <span>{step}</span>
        </li>
      ))}
    </ul>
  );
}

/* WHAT SHE READ, as the board draws a result: a card with its dot, its
   name, a grey line and an Open (rule 35: a card is something you act on).
   The dot is the kind of document, snapped to the eight, beside the kind's
   own word on the grey line. Open shows the passages she read, with the way
   to the page itself. */
function CvResults({ docs, onPeek }: { docs: SourceDoc[]; onPeek: (d: SourceDoc) => void }) {
  return (
    <ul className="cv-results" aria-label="What Tiff read">
      {docs.map((d) => {
        const kind = KB_CATEGORIES.find((c) => c.key === d.category)?.label ?? "Document";
        return (
          <li key={d.docId} className="cv-result">
            <Dot hue={categoryHue(d.category)} />
            <span className="cv-result-id">
              <Fade className="cv-result-name">{d.title}</Fade>
              <Fade className="cv-result-line">{`${kind}, ${pagesLabel(d)}`}</Fade>
            </span>
            <button type="button" className="cv-open" aria-label={`Open ${d.title}, ${pagesLabel(d)}`} onClick={() => onPeek(d)}>
              Open
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/* WHERE THE ANSWER CAME FROM, in grey under every answer: your documents,
   the rest of the library when the one you named covered nothing, or
   general knowledge, said as such. The first three are older answers', from
   when the Library's ask searched the shelves; they are still drawn as they
   were kept. */
function CvSource({ m, docs, canManage }: { m: Msg; docs: SourceDoc[]; canManage: boolean }) {
  let words: string;
  let icon = "file";
  if (m.widenedFrom !== undefined) {
    words = m.widenedFrom.trim()
      ? `Nothing in “${m.widenedFrom.trim()}” covered this, so the answer is from the rest of your library`
      : "Nothing in that document covered this, so the answer is from the rest of your library";
  } else if (m.researched) {
    words =
      docs.length === 1
        ? `From ${docs[0].title}, in your library`
        : docs.length > 1
          ? `From ${docs.length} documents in your library`
          : "From your library";
  } else if (m.missed) {
    icon = "info";
    words = canManage
      ? "General knowledge: nothing in your library covered this. Add the manual that does and ask again."
      : "General knowledge: nothing in your library covered this. Ask a manager to add the manual that does.";
  } else {
    icon = "info";
    words = "General knowledge, not from your documents";
  }
  return (
    <p className="cv-source">
      <Icon name={icon} size={14} />
      <span>{words}</span>
    </p>
  );
}

/* ── what you can do to a conversation (brief §4A) ───────────────────────── */

/* RENAME THIS CHAT (the old-modals mock, 27 October 2026): the Dialog part
   at 400, one field, a form so Enter commits. */
function RenameThread({
  thread,
  onSave,
  onClose,
}: {
  thread: Thread;
  onSave: (title: string) => void;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(thread.title);
  const clean = title.trim();
  const formId = useId();

  return (
    <Dialog
      heading="Rename this chat"
      onClose={onClose}
      foot={
        <>
          <Button kind="quiet" onClick={onClose}>
            Cancel
          </Button>
          <Button kind="main" type="submit" form={formId} disabled={!clean}>
            Save name
          </Button>
        </>
      }
    >
      {/* a form, so Enter commits — the only key anybody presses in a
          one-field dialog */}
      <form
        id={formId}
        onSubmit={(e) => {
          e.preventDefault();
          if (clean) onSave(clean);
        }}
      >
        <Field label="Title">
          <TextInput value={title} maxLength={TITLE_MAX} data-autofocus onChange={(e) => setTitle(e.target.value)} />
        </Field>
      </form>
    </Dialog>
  );
}

/* DELETE A CHAT: ConfirmDialog, which names what goes. Keep it takes focus. */
function DeleteThread({
  thread,
  kept = false,
  onConfirm,
  onClose,
}: {
  thread: Thread;
  /** The server keeps this person's threads, so it goes from their other devices too. */
  kept?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const n = thread.messages.length;
  return (
    <ConfirmDialog
      heading={`Delete “${thread.title}”?`}
      /* THE BUTTON SAYS THE VERB, NOT THE TITLE AGAIN: the heading names the
         thread; this says what pressing it does. */
      confirm="Delete chat"
      onConfirm={onConfirm}
      onClose={onClose}
    >
      <p>
        {n > 0 && `${n} ${plural(n, "message")} ${n === 1 ? "goes" : "go"} with it. `}
        {kept
          ? "It goes from your other devices too, and there is no undo."
          : "Threads live on this device only, so there is no copy elsewhere and no undo."}
      </p>
    </ConfirmDialog>
  );
}

/* ── citations ───────────────────────────────────────────────────────────── */

const pagesOf = (s: { pageFrom: number; pageTo: number }): string =>
  s.pageTo > s.pageFrom ? `p.${s.pageFrom}–${s.pageTo}` : `p.${s.pageFrom}`;

/* A source is a DOCUMENT; its passages are what the peek is for. The chips
   used to render one per passage, and the live walk's E4 answer put "Daikin
   VRV Diagnosis Manual" on screen six times in three wrapped rows — the same
   citation shouting over itself, with the pages the only part that changed.
   One card per document, wearing every page it was read at. */
export type SourceDoc = {
  /** 1-based document order — first appearance in the ranked passage list. */
  n: number;
  docId: string;
  title: string;
  category: AskSourceItem["category"];
  /** Every passage cited from this document, in the retriever's rank order. */
  items: AskSourceItem[];
};

/* `titles` is the library's CURRENT name for each document, read on the
   server. A citation is a pointer, not a memento: the title travelled into
   localStorage with the answer, so a document renamed afterwards left every
   older answer citing a name the library had stopped using — a thread was
   found live still saying "545846862 Daikin Vrv Diagnosis Manual" for a
   document since retitled. The stored copy stays as the fallback, because a
   document that has been DELETED still has to be named somehow, and the name
   it was cited under is the only honest one left. */
export function groupSources(
  sources: AskSourceItem[],
  titles: Record<string, string> = {}
): SourceDoc[] {
  const docs: SourceDoc[] = [];
  const byId = new Map<string, SourceDoc>();
  for (const item of sources) {
    const seen = byId.get(item.docId);
    if (seen) {
      seen.items.push(item);
      continue;
    }
    const doc: SourceDoc = {
      n: docs.length + 1,
      docId: item.docId,
      title: titles[item.docId] ?? item.title,
      category: item.category,
      items: [item],
    };
    byId.set(item.docId, doc);
    docs.push(doc);
  }
  return docs;
}

/** The card's page list: passages in page order, identical ranges said once. */
const pagesLabel = (doc: SourceDoc): string => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of [...doc.items].sort((a, b) => a.pageFrom - b.pageFrom)) {
    const label = pagesOf(item);
    if (seen.has(label)) continue;
    seen.add(label);
    out.push(label);
  }
  return out.join(", ");
};

/* THE PEEK (the old-modals mock, 27 October 2026): the Dialog part at 560.
   The document is the title; under it its category's dot and the pages
   Tiff read, then each passage as she read it, in page order, at 16. */
function SourcePeek({ source, onClose }: { source: SourceDoc; onClose: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const open = async () => {
    setError(null);
    setBusy(true);
    // opened synchronously so the pop-up blocker sees the click; the signed
    // URL is a round trip away and would arrive too late to be trusted
    const tab = typeof window === "undefined" ? null : window.open("", "_blank");
    const res = await kbDocUrl(source.docId);
    setBusy(false);
    if (!res.ok) {
      tab?.close();
      setError(res.error);
      return;
    }
    // the top-RANKED passage's page, not the lowest-numbered: rank 1 is the
    // page the answer leaned on hardest, which is what "open it" means here
    const url = `${res.url}#page=${source.items[0].pageFrom}`;
    if (tab) {
      tab.opener = null;
      tab.location.href = url;
    } else if (typeof window !== "undefined") {
      window.open(url, "_blank", "noopener,noreferrer");
    }
  };

  // read top to bottom in the peek, whatever order retrieval ranked them
  const passages = [...source.items].sort((a, b) => a.pageFrom - b.pageFrom);
  const category = KB_CATEGORIES.find((c) => c.key === source.category);

  return (
    <Dialog
      heading={source.title}
      width={560}
      onClose={onClose}
      foot={
        <>
          <Button kind="quiet" onClick={onClose}>
            Close
          </Button>
          <Button kind="main" disabled={busy} onClick={open}>
            {busy ? "Opening the document" : "Open document"}
          </Button>
        </>
      }
    >
      <div className="tk-pk">
        <p className="tk-pkline">
          <Dot hue={category?.hue ?? "grey"} />
          {category?.label ?? "Document"}, {pageWords(passages)}
        </p>
        {error && <p className="tk-pkerr">{error}</p>}
        <ul className="tk-pks" aria-label="What Tiff read">
          {passages.map((item) => (
            <li key={item.chunkId} className="tk-pkq">
              {passages.length > 1 && <span className="tk-pkqp">{pageWord(item)}</span>}
              {item.excerpt}
            </li>
          ))}
        </ul>
      </div>
    </Dialog>
  );
}

/** "Page 14", "Pages 12–14": one passage's pages, as the peek labels it. */
const pageWord = (s: { pageFrom: number; pageTo: number }): string =>
  s.pageTo > s.pageFrom ? `Pages ${s.pageFrom}–${s.pageTo}` : `Page ${s.pageFrom}`;

/** "page 14", "pages 14 and 22", "pages 12–14": every page the peek shows, once. */
function pageWords(items: readonly { pageFrom: number; pageTo: number }[]): string {
  const seen: string[] = [];
  for (const i of items) {
    const one = i.pageTo > i.pageFrom ? `${i.pageFrom}–${i.pageTo}` : `${i.pageFrom}`;
    if (!seen.includes(one)) seen.push(one);
  }
  const many = seen.length > 1 || seen[0]?.includes("–");
  const list = seen.length < 2 ? (seen[0] ?? "") : `${seen.slice(0, -1).join(", ")} and ${seen[seen.length - 1]}`;
  return `${many ? "pages" : "page"} ${list}`;
}
