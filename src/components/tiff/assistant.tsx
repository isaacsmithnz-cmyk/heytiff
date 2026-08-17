"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { Icon } from "@/components/shell/icon";
import { navHref } from "@/components/shell/nav";
import { Chevron } from "@/components/logo";
import { useHydrated } from "@/lib/use-hydrated";
import { kbDocUrl } from "@/app/actions/kb";
import { askTiff, type AskSourceItem, type AskTurn } from "@/lib/tiff/ask-client";
import { askPrefill, consumeAskHandoff } from "@/lib/tiff/ask-handoff";
import type { KbRecentDoc } from "@/lib/tiff/query";
import {
  cardNote,
  cardState,
  reduceViz,
  workingNote,
  IDLE_VIZ,
  type ResearchViz,
  type VizEvent,
} from "@/lib/tiff/research-viz";
import { ResearchLines } from "./research-lines";
import { KB_CATEGORIES, type KbCategoryKey } from "./kb";
import { appendSpoken, useDictation } from "@/components/notes/dictation";
import { RecordingCard } from "@/components/notes/recording-card";
import { DotField } from "@/components/ui/dot-field";
import { READING_BACK_NOTE } from "@/components/notes/waits";
import { Waiting } from "@/components/ui/orb";

/* The Library's asking surface, connected.

   TWO COLUMNS, AND THE RIGHT ONE IS THE POINT. The transcript sits beside the
   category cards rather than under them: the cards stay on screen while the
   answer grows (bottom cards scroll away mid-answer), they double as the way
   into the library when nothing is being asked, and the horizontal gap between
   composer and cards is where the search lines are drawn. Under 1100px they
   stack and nothing is lost.

   WHERE THE ANSWER COMES FROM IS A CHOICE, AND IT LOOKS LIKE ONE. "Answer
   from" offers two options under the box — your library, or general knowledge
   — with the live one lit. General knowledge answers from what Tiff already
   knows and says so; your library answers only from the company's own
   documents and cites the page. You can see which one you are about to get
   BEFORE you press send, and every answer carries the same distinction
   afterwards: a researched answer has chips under it, a general one has an
   offer to go and look. With no ready documents the library option is disabled
   and says why, because an option that finds nothing teaches you not to trust
   the feature.

   THE ANSWER ARRIVES AS IT IS WRITTEN. `askTiff` reads the NDJSON stream and
   this component appends deltas to one live message, which is committed to the
   thread when the stream ends. Threads live in localStorage as before, on a
   bumped key: messages now carry sources and whether they were researched, and
   v1 rows have neither.

   THE LINES SHOW WHERE IT IS LOOKING, AND THEY ARE NOT DECORATION. The
   overlay measures `.tk-stage`, `.tk-composer` and the `.tk-rcat` cards
   off the live DOM, and every state it draws comes from an event this
   component already receives: submit, the server's `trace` with its real hit
   counts and winners, `miss`, the first delta, done. The choreography itself
   is a pure machine in lib/tiff/research-viz.ts, so it can be proven in a test
   that cannot see a single coordinate. Nothing here waits to look busier. */

type Msg = {
  role: "user" | "tiff";
  text: string;
  at: number;
  /** True when this answer was drawn from the library rather than general knowledge. */
  researched?: boolean;
  /** True when research found nothing and the answer is general knowledge anyway. */
  missed?: boolean;
  /** True when the answer hit the token ceiling and stops mid-thought. */
  truncated?: boolean;
  sources?: AskSourceItem[];
};

type Thread = { id: string; title: string; updatedAt: number; messages: Msg[] };

/* v2: v1 rows are ignored rather than migrated. They are preview-era replies
   from a model that wasn't connected — there is nothing in them worth
   carrying, and the shape gained three fields. */
const STORE_KEY = "heytiff.tiff.threads.v2";

/** Prior turns sent as context. The route caps this again on its side. */
const HISTORY_TURNS = 8;

/** A thread title somebody typed. Long enough to describe a job, short enough
    to read in the two-column list without wrapping. */
const TITLE_MAX = 60;


/* THE QUICK-START PILLS ARE GONE, not restyled. Four canned questions — "R32
   running pressures at 35°C", "Size a VRF for a 3-storey office" — sat under
   the box on every visit and were, at best, a demo of what a question looks
   like to somebody who already asks them for a living. They cost a row of the
   landing, they taught nothing after the first read, and two of the four were
   about a category this workspace might hold nothing in. The box and its
   placeholder are the invitation. */

function loadThreads(): Thread[] {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function ago(ts: number): string {
  const s = Math.max(0, (Date.now() - ts) / 1000);
  if (s < 60) return "Just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 172800) return "Yesterday";
  return new Date(ts).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

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
export function answerBlocks(text: string): AnswerBlock[] {
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

export function TiffAssistant({
  counts = { install: 0, faults: 0, specs: 0, sops: 0, field: 0 },
  readyCount = 0,
  canManage = false,
  recentDocs = [],
  docTitles = {},
  voiceEnabled = false,
}: {
  counts?: Record<KbCategoryKey, number>;
  /** Ready documents across every shelf — nothing can be researched at zero. */
  readyCount?: number;
  canManage?: boolean;
  /** The last few documents to land, newest first. Read on the server. */
  recentDocs?: KbRecentDoc[];
  /** Every document's current name, by id — what the citation chips prefer
      over the title stored alongside the answer. */
  docTitles?: Record<string, string>;
  /** ELEVENLABS_API_KEY is set on this deployment. No key, no mic — the ask
      bar is a plain text field either way. */
  voiceEnabled?: boolean;
}) {
  const hydrated = useHydrated();
  // null = "not touched yet": until the first send, render straight from storage
  const [threadState, setThreadState] = useState<Thread[] | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  /* The switch starts where the headline points. "Ask the library" over a bar
     set to General knowledge shipped once — the first question of every visit
     answered from the wrong place and then offered to look properly, which is
     the headline's promise sold as an upsell. Library whenever it has anything
     in it; at zero the option is disabled and General is all there is. */
  const [research, setResearch] = useState(readyCount > 0);
  const [peek, setPeek] = useState<SourceDoc | null>(null);

  /* The thread being renamed, and the one being removed. Held as the row
     itself rather than an id so a modal can name the thread even in the frame
     where it has just left the list. */
  const [renaming, setRenaming] = useState<Thread | null>(null);
  const [removing, setRemoving] = useState<Thread | null>(null);

  /* THE FIRST QUESTION IS SEARCHED FROM THE BAR IT WAS ASKED IN.
     Sending used to switch to the transcript in the same tick, so by the
     first painted frame the hero bar had already become the reply bar at the
     foot of the column — and every run, on every question, appeared to leave
     the little bar. The landing's own composer never once had a pipe on it,
     which is the one place the mechanism is worth watching.

     So a NEW research thread is held: the row is written and the search runs,
     but the landing stays until the answer actually starts. The runs sweep
     out of the bar that was just typed in, and the page turns into a
     conversation when there is a conversation to show. A ref beside it
     because the release happens inside stream callbacks, which close over the
     state as it was when the request went out. */
  const [holdId, setHoldId] = useState<string | null>(null);
  const holdRef = useRef<string | null>(null);

  /* The answer being written. Held apart from the thread rather than mutated
     into it, so a delta doesn't rewrite localStorage sixty times a second; it
     is committed once, when the stream ends. */
  type Live = {
    threadId: string;
    question: string;
    research: boolean;
    text: string;
    missed: boolean;
    truncated: boolean;
    sources: AskSourceItem[];
  };
  const [live, setLive] = useState<Live | null>(null);
  const liveRef = useRef<Live | null>(null);

  /* The failed ask, kept whole so Retry re-sends exactly what was sent —
     including the history as it was THEN, which is not the same as the history
     now that a partial answer has been kept in the thread. */
  const [failure, setFailure] = useState<{
    message: string;
    question: string;
    research: boolean;
    history: AskTurn[];
  } | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const chatRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  /* Whether the transcript is pinned to its bottom edge. True until the reader
     scrolls up — a stream should follow itself, but not fight somebody who has
     gone back to re-read a table while the rest of the answer arrives. */
  const followRef = useRef(true);

  /* Whether WE put the extra history entry there. A ref, not `history.state`:
     the router replaceStates over the current entry on its own commits and can
     drop custom keys, so the entry survives but a marker on it may not. */
  const pushedRef = useRef(false);

  /* What the search lines and the category cards are doing. The refs below are
     the overlay's measuring points — the stage it draws inside, the composer
     every line leaves from, and the card each one arrives at. */
  const [viz, setViz] = useState<ResearchViz>(IDLE_VIZ);
  const stageRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLFormElement>(null);
  const cardRefs = useRef(new Map<KbCategoryKey, HTMLElement>());
  const showViz = (event: VizEvent) => setViz((prev) => reduceViz(prev, event));

  const threads = threadState ?? (hydrated ? loadThreads() : []);
  const active = threads.find((t) => t.id === activeId) ?? null;
  /* The held thread is written but not yet shown, so it must not appear in
     "Pick up where you left off" either — a card inviting you to resume the
     question you are watching being asked. */
  const recent = [...threads]
    .filter((t) => t.id !== holdId)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 8);

  const streaming = live !== null;
  const canResearch = readyCount > 0;

  /* SPEAKING TO TIFF IS JUST TYPING WITH YOUR VOICE.

     Everything said to the ask bar is a question, so there is no sieve, no
     routing and no review — the words land in the box, the caret comes back,
     and you still press send. That is the whole difference between this mic
     and the token's: the token has to work out what your words BECOME, and
     this one already knows. It is also why the box is not wrapped in a note
     scope; there is no target for a note that is never taken.

     The ENGINE is the token's, imported unchanged. The five controls PR #287
     collapsed were five copies of an engine wearing different clothes; this
     is the opposite and the shape the file asks for — one engine, and the
     clothes belong to the composer it sits in. */
  const [voiceErr, setVoiceErr] = useState<string | null>(null);
  /** The last recording stopped at the two-minute ceiling. Appending is
      already the right answer for a question, so nothing changes about where
      the words go — this only earns a line saying why the mic let go. */
  const [ranOut, setRanOut] = useState(false);
  const dict = useDictation({
    onTranscript: (spoken, { capped }) => {
      setVoiceErr(null);
      setRanOut(capped);
      setInput((typed) => appendSpoken(typed, spoken));
    },
    onError: setVoiceErr,
  });

  const listening = dict.recording || dict.transcribing;

  /* THE BAR IS WHERE THE EYE IS WHEN THE WAIT STARTS. You press send and then
     look at what you just pressed — but the only sign anything was happening
     lived elsewhere: three dots inside a sheet further up the transcript, and
     1.6px lanes out in the corridor. Between the press and the first word the
     composer said nothing at all, and the screen read as frozen (reported
     live, 2026-08-08).

     `working` is the whole flight, not just the silence before the first
     token: an answer still arriving is still work, and a spinner that stopped
     mid-stream would claim it had finished. The button stays ENABLED
     throughout — asking again mid-answer aborts the first and is a feature,
     not an accident — so this is a statement, never a lock. */
  const working = Boolean(live) && !listening;

  /* THE LIVE WORDS ARE NOT SHOWN IN THIS BOX ANY MORE, because the box is not
     on screen while the mic is open — the shared recording card has the space,
     and it joins the interim words onto what is already captured exactly the
     way this did (`sofar`, in notes/recording-card). The rule the join exists
     to keep is unchanged and now kept in one place: interim words are SHOWN,
     never HELD. Committing them would race the transcript that replaces them
     and leave the tail of a half-heard sentence behind if the recording were
     thrown away. */

  /* The caret comes back when the mic lets go. Focusing inside `onTranscript`
     misses every time: the box is still disabled at that moment, because the
     engine clears `transcribing` in a `finally` AFTER the callback — and
     focus() on a disabled input does nothing at all. */
  const wasListening = useRef(false);
  useEffect(() => {
    if (wasListening.current && !listening) inputRef.current?.focus();
    wasListening.current = listening;
  }, [listening]);

  useEffect(() => () => abortRef.current?.abort(), []);

  /* Follow the stream — unless the reader has left the bottom. The handler on
     the transcript keeps `followRef` honest; this effect only acts on it. */
  useEffect(() => {
    const el = chatRef.current;
    if (el && followRef.current) el.scrollTop = el.scrollHeight;
  }, [active?.messages.length, live?.text, streaming]);

  const onChatScroll = () => {
    const el = chatRef.current;
    if (!el) return;
    /* Within a message of the bottom still counts as following: the pin
       shouldn't release because the browser rounded a subpixel. */
    followRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  /* Arriving from "Ask Tiff" on a library row: the document left a
     sentence-opener behind, and this is where it is picked up.

     NOTHING IS SENT. The opener goes in the box, Research goes on because the
     question is about a document in the library, and the caret sits at the end
     waiting for the actual question. A prefill that asked itself would be
     putting words in somebody's mouth and spending a question they never
     asked. Read-once, so a refresh doesn't hand it over again. */
  useEffect(() => {
    const prefill = consumeAskHandoff();
    if (!prefill) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sessionStorage is client-only; must diverge from the SSR-safe initial render
    setInput(prefill);
    if (readyCount > 0) setResearch(true);
    inputRef.current?.focus();
  }, [readyCount]);

  const persist = useCallback((next: Thread[]) => {
    setThreadState(next);
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(next));
    } catch {
      /* storage full/blocked — threads just won't survive a refresh */
    }
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
    },
    []
  );

  const setLiveBoth = (next: Live | null) => {
    liveRef.current = next;
    setLive(next);
  };

  /* Let the held thread through. Called the moment there is something to READ
     — the first word, a miss, a failure, or an answer that finished without
     one — because until then the landing is showing the better view of what
     is happening. Idempotent: every stream ends through one of these doors
     and several can fire in the same breath. */
  const openHeld = () => {
    const id = holdRef.current;
    if (!id) return;
    holdRef.current = null;
    setHoldId(null);
    setActiveId(id);
    markOpened(id);
  };

  /* Give it up without opening it — leaving, starting over, or a question
     that replaced this one before it ever landed. */
  const dropHold = () => {
    holdRef.current = null;
    setHoldId(null);
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
      researched: state.research && !state.missed,
      ...(state.missed ? { missed: true } : {}),
      ...(state.truncated ? { truncated: true } : {}),
      ...(state.sources.length ? { sources: state.sources } : {}),
    });
  };

  const run = (threadId: string, question: string, researchMode: boolean, history: AskTurn[]) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setFailure(null);
    /* Only a research question has anywhere to look, so only a research
       question draws lines. A general one clears whatever the last answer left
       behind rather than leaving a stale rail under a new conversation. Every
       shelf performs — retrieval covers the whole library, and the sweep
       converging on the winner is the page's story (a stocked-shelves-only
       gate shipped once and reduced it to one line straight to the answer). */
    showViz({ t: researchMode ? "submit" : "reset" });
    setLiveBoth({
      threadId,
      question,
      research: researchMode,
      text: "",
      missed: false,
      truncated: false,
      sources: [],
    });

    void askTiff({
      question,
      research: researchMode,
      history,
      signal: controller.signal,
      onEvent: (event) => {
        if (controller.signal.aborted) return;
        switch (event.t) {
          case "trace":
            /* Where Tiff looked, with real numbers — the cards light from
               these and from nothing else. The winning card also names the
               document it ranked first, which is the one the citations under
               the answer are about to be checked against.

               Mapped over the category list rather than named one by one: the
               hand-written version listed four while the rail rendered five,
               so Field notes could win the search and still sit dark with "—"
               under it. Everything else on both sides of this already knew
               about the fifth. */
            showViz({
              t: "trace",
              winners: event.winners,
              hits: Object.fromEntries(
                KB_CATEGORIES.map((c) => [c.key, event.categories[c.key]?.hits])
              ),
              topDocs: Object.fromEntries(
                KB_CATEGORIES.map((c) => [c.key, event.categories[c.key]?.topDoc])
              ),
            });
            break;
          case "miss":
            showViz({ t: "miss" });
            patchLive((prev) => ({ ...prev, missed: true }));
            // the banner explaining the miss belongs in the thread, not here
            openHeld();
            break;
          case "delta":
            // the first word is when the search stops and the answer starts —
            // and when a held landing gives way to the conversation
            if (!liveRef.current?.text) {
              showViz({ t: "firstDelta" });
              openHeld();
            }
            patchLive((prev) => ({ ...prev, text: prev.text + event.text }));
            break;
          case "trunc":
            patchLive((prev) => ({ ...prev, truncated: true }));
            break;
          case "sources":
            patchLive((prev) => ({ ...prev, sources: event.items }));
            break;
          case "done": {
            const state = liveRef.current;
            if (state) commitLive(state);
            setLiveBoth(null);
            showViz({ t: "done" });
            // an answer that finished without a single word still has to land
            // somewhere a person can see it
            openHeld();
            break;
          }
          case "err": {
            const state = liveRef.current;
            if (state) commitLive(state);
            setLiveBoth(null);
            // a half-drawn search under a failure message is decoration on
            // top of bad news
            showViz({ t: "error" });
            setFailure({ message: event.message, question, research: researchMode, history });
            // bad news is read in the thread, with Try again under it
            openHeld();
            break;
          }
        }
      },
    });
  };

  /** The last few turns, text only — what the route replays as context. */
  const historyOf = (messages: Msg[]): AskTurn[] =>
    messages.slice(-HISTORY_TURNS).map((m) => ({
      role: m.role === "tiff" ? ("assistant" as const) : ("user" as const),
      text: m.text,
    }));

  const send = (text: string, researchMode: boolean = research) => {
    const trimmed = text.trim();
    if (!trimmed) return;

    const at = nowMs();
    const msg: Msg = { role: "user", text: trimmed, at };
    let threadId = activeId;
    let next: Thread[];

    if (active) {
      next = threads.map((t) =>
        t.id === active.id ? { ...t, updatedAt: at, messages: [...t.messages, msg] } : t
      );
    } else {
      threadId = newThreadId(at);
      const title = trimmed.length > 52 ? `${trimmed.slice(0, 52).trimEnd()}…` : trimmed;
      next = [{ id: threadId, title, updatedAt: at, messages: [msg] }, ...threads];
      /* A research question is HELD on the landing while it searches, so the
         runs leave the bar it was typed in; a general one has nothing to draw
         and opens straight away. Either way the row is already written — the
         hold is a view, not a delay in recording anything. */
      if (researchMode) {
        holdRef.current = threadId;
        setHoldId(threadId);
      } else {
        setActiveId(threadId);
        // the landing→thread transition, whichever door it came through
        markOpened(threadId);
      }
    }

    persist(next);
    setInput("");
    followRef.current = true;
    run(threadId!, trimmed, researchMode, historyOf(active?.messages ?? []));
  };

  const retry = () => {
    if (!failure || !activeId) return;
    const { question, research: mode, history } = failure;
    setFailure(null);
    run(activeId, question, mode, history);
  };

  const researchThis = (question: string) => {
    setResearch(true);
    send(question, true);
  };

  /* A document from the "Recently added" strip. The SAME opener the library's
     "Ask Tiff" writes into session storage — but nothing is stored here,
     because the composer is already on screen: the sentence goes straight in
     the box with the caret after it. Research goes on for the same reason it
     does on the handoff — the question is about a document in the library —
     and nothing is sent. A prefill that asked itself would be putting words in
     somebody's mouth. */
  const askAboutDoc = (title: string) => {
    const opener = askPrefill(title);
    if (!opener) return;
    setInput(opener);
    if (readyCount > 0) setResearch(true);
    inputRef.current?.focus();
  };

  /* ── leaving a conversation, every way there is ─────────────────────────
     One bundle, because every exit owes the same debts: stop the stream, drop
     the live answer, drop the failure, give the rail back to the screen
     (`reset` — it belongs to the question that was asked), and land on the
     landing. `commit` is the one choice: a NAVIGATION keeps a half-written
     answer in the thread (goHome, browser back — the reader is coming back),
     while starting over does not (New chat, delete — the old behaviour). */
  const leaveThread = (commit: boolean) => {
    const state = liveRef.current;
    if (commit && state) commitLive(state);
    abortRef.current?.abort();
    setLiveBoth(null);
    setFailure(null);
    showViz({ t: "reset" });
    dropHold();
    setActiveId(null);
  };

  /* Opening a thread owns one history entry, so the browser's own back button
     closes the chat instead of leaving the page. The URL is deliberately
     UNCHANGED: the router only dispatches on a pushState that carries a url,
     so a bare entry is invisible to it — no refetch, no remount. */
  const markOpened = (id: string) => {
    try {
      window.history.pushState({ tiffChat: id }, "");
      pushedRef.current = true;
    } catch {
      /* a history that refuses the push just means back leaves the page */
    }
  };

  /* Closing from ON-SCREEN consumes the entry we pushed, so the stack never
     grows past one. State is already closed by the caller — the popstate this
     triggers finds nothing left to do, which is exactly why the handler below
     is written to be idempotent. */
  const settleHistory = () => {
    if (!pushedRef.current) return;
    pushedRef.current = false;
    window.history.back();
  };

  /* The browser's back (and forward) button, made to mean something here.
     Everything this closure touches is a ref or a setState — stable across
     renders — so it binds once. */
  useEffect(() => {
    const onPop = (e: PopStateEvent) => {
      const id = (e.state as { tiffChat?: string } | null)?.tiffChat;
      if (typeof id === "string") {
        // forward, onto an entry we own: reopen the thread if it still exists
        pushedRef.current = true;
        if (loadThreads().some((t) => t.id === id)) {
          followRef.current = true;
          setActiveId(id);
        }
        return;
      }
      // back, off our entry: leave the chat, keeping a half-written answer
      pushedRef.current = false;
      leaveThread(true);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refs and setters only
  }, []);

  /** The header's back button: out of the chat, thread kept, input kept. */
  const goHome = () => {
    leaveThread(true);
    settleHistory();
  };

  const newChat = () => {
    leaveThread(false);
    settleHistory();
    setInput("");
    inputRef.current?.focus();
  };

  const openThread = (id: string) => {
    leaveThread(false);
    followRef.current = true;
    setActiveId(id);
    markOpened(id);
  };

  /* Renaming touches the title and nothing else — `updatedAt` orders the list
     by when the conversation last MOVED, and retitling it is not a turn. */
  const renameThread = (id: string, title: string) => {
    const clean = title.trim().slice(0, TITLE_MAX).trim();
    if (!clean) return;
    persist(threads.map((t) => (t.id === id ? { ...t, title: clean } : t)));
    setRenaming(null);
  };

  /* Deleting the conversation you are IN puts you back on the landing rather
     than leaving the transcript of a thread that no longer exists on screen —
     and takes the stream, the failure and the rail with it. */
  const deleteThread = (id: string) => {
    if (activeId === id) {
      leaveThread(false);
      settleHistory();
    }
    persist(threads.filter((t) => t.id !== id));
    setRemoving(null);
  };

  /* The last question asked, for the "search the library for this" offer under
     a general answer. */
  const lastQuestion = [...(active?.messages ?? [])].reverse().find((m) => m.role === "user")?.text ?? "";
  const lastMsg = active?.messages[active.messages.length - 1];
  const offerResearch =
    !streaming &&
    !failure &&
    canResearch &&
    lastMsg?.role === "tiff" &&
    !lastMsg.researched &&
    // a miss already went and looked; offering to look again is a taunt
    !lastMsg.missed &&
    Boolean(lastQuestion);

  return (
    /* `tk-lock` closes the height chain so the transcript scrolls INSIDE
       `.tchat` instead of growing the page — but only while a thread is open.
       The landing was designed to page-scroll (it grows with the thread list),
       and locking it would clip the composer's glow at the column edge. */
    <div className={`page in${active ? " tk-lock" : ""}`}>
      <div className="tk-stage" ref={stageRef}>
        <div className={`tk-chatcol${active ? "" : " landing"}`}>
          {active ? (
            <>
              <div className="tchathead">
                {/* the way OUT is the first thing in the row, where every
                    other screen's crumb already lives */}
                <button
                  type="button"
                  className="tk-tact"
                  aria-label="Back to the library"
                  title="Back to the library"
                  onClick={goHome}
                >
                  <Icon name="chevL" size={16} />
                </button>
                {/* the brand mark, not a robot: the same chevron as the
                    sidebar and the Tiff button, because the thing answering
                    is HeyTiff — a bot glyph here was the generic-AI badge on
                    the one screen that should feel most like the product */}
                <span className="tb2">
                  <Chevron size={24} gradient />
                </span>
                <div className="tcht">
                  <b>{active.title}</b>
                  <em>Library</em>
                </div>
                {/* the two things you can do TO a conversation, next to the
                    one thing you can do instead of it */}
                <button
                  type="button"
                  className="tk-tact"
                  aria-label={`Rename “${active.title}”`}
                  title="Rename this chat"
                  onClick={() => setRenaming(active)}
                >
                  <Icon name="edit" size={15} />
                </button>
                <button
                  type="button"
                  className="tk-tact dan"
                  aria-label={`Delete “${active.title}”`}
                  title="Delete this chat"
                  onClick={() => setRemoving(active)}
                >
                  <Icon name="x" size={15} />
                </button>
                <button className="pbtn ghost" onClick={newChat}>
                  <Icon name="plus" size={15} />
                  New chat
                </button>
              </div>

              <div className="tchat" ref={chatRef} onScroll={onChatScroll}>
                {active.messages.map((m, i) => (
                  /* No avatar on Tiff's turn. The answer is a full-width sheet
                     and the question is a short dark bubble on the right —
                     which of the two is speaking was never in doubt, and the
                     glyph sat at the BOTTOM of a long answer (flex-end),
                     level with the citations it had nothing to do with. */
                  <div key={i} className={`tmsg ${m.role === "user" ? "user" : "bot"}`}>
                    <div className="tmw">
                      {m.missed && <MissBanner canManage={canManage} />}
                      {/* The citations and the truncation note live INSIDE the
                          sheet. Both are statements about this answer — where
                          it came from, where it stopped — and underneath it on
                          the page they read as three grey pills belonging to
                          nothing in particular. */}
                      <div className="tmb">
                        {m.role === "tiff" ? <AnswerText text={m.text} /> : m.text}
                        {m.truncated && (
                          <p className="tk-trunc">
                            That answer ran to its limit and stops mid-thought — ask for the rest.
                          </p>
                        )}
                        {m.sources && m.sources.length > 0 && (
                          <SourceChips sources={m.sources} titles={docTitles} onPeek={setPeek} />
                        )}
                      </div>
                    </div>
                  </div>
                ))}

                {live && live.threadId === active.id && (
                  <div className="tmsg bot">
                    <div className="tmw">
                      {live.missed && <MissBanner canManage={canManage} />}
                      {/* One sheet across thinking and streaming: the container
                          is already on screen when the first token lands, so
                          the answer fills a space instead of shoving the
                          conversation down as it arrives. */}
                      <div className={`tmb${live.text ? " streaming" : ""}`}>
                        {live.text ? (
                          <AnswerText text={live.text} />
                        ) : (
                          /* THE WAIT NAMES ITSELF NOW. This was three bouncing
                             dots under an `aria-label` reading "Tiff is
                             thinking" — a sentence written for screen readers
                             about a state no sighted reader could name, and
                             wrong besides: through most of that wait Tiff is
                             not thinking, it is out at the shelves. The word
                             comes off the same machine the rail draws from
                             (`workingNote`), so the corridor and the sheet
                             cannot tell two different stories about the same
                             moment. */
                          <Waiting note={workingNote(viz)} />
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {failure && (
                  <div className="tmsg bot">
                    {/* no avatar here either — and the old one was the TEAL
                        assistant tile wrapped round an alert glyph, which is
                        the one colour a failure should not arrive in */}
                    <div className="tmw">
                      <div className="tk-fail" role="alert">
                        <span>{failure.message}</span>
                        <button type="button" className="tk-retry" onClick={retry}>
                          <Icon name="rotate" size={14} />
                          Try again
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {offerResearch && (
                  <div className="tk-offer">
                    <button type="button" className="tk-again" onClick={() => researchThis(lastQuestion)}>
                      <Icon name="library" size={14} />
                      Search the library for this
                    </button>
                  </div>
                )}
              </div>
            </>
          ) : (
            <Landing
              returning={recent.length > 0}
              recent={recent}
              readyCount={readyCount}
              recentDocs={recentDocs}
              onOpen={openThread}
              onRename={setRenaming}
              onDelete={setRemoving}
              onAskAbout={askAboutDoc}
            />
          )}

          <form
            className="tk-composer"
            ref={composerRef}
            onSubmit={(e) => {
              e.preventDefault();
              send(input);
            }}
          >
            {dict.recording ? (
              /* THE SAME CARD EVERY OTHER DOOR SHOWS (Isaac: "the input
                 section should be identical throughout the software — they
                 just appear in different places").

                 The ask bar used to grow its own recording UI: a 22px orb, a
                 small clock, a discard × and a stop ■, all crammed into the
                 bar itself. Nothing was wrong with any of it except that it
                 was a SECOND one — and on this very screen the topbar's Tiff
                 button opened a completely different card for the same act of
                 talking. Two mics, two answers to "is it hearing me", one
                 page.

                 So the bar hands its space to `RecordingCard` and gets it
                 back when the mic closes. What arrives is what the sheet and
                 the debrief show: what you have said so far, the 68px sphere,
                 the clock at a size worth reading, whether anything is
                 reaching the microphone, and Type instead / Start again /
                 Done.

                 IN THE PAGE, NOT OVER IT — the debrief's precedent (Isaac,
                 2026-08-13: "match how the global one does it but in line").
                 A scrim to dictate a question would put the conversation you
                 are asking about behind a dim sheet. `tk-rec` does the same
                 job `hm-cap` does for the debrief: it changes where the card
                 stands and nothing about what it is made of.

                 WHAT COMES AFTER `Done` IS STILL TIFF'S. The words land in
                 the ask box and you press Send — no sorting, no review,
                 because a question already knows what it is. Identical up to
                 Done, deliberately not past it. */
              <div className="wb2-capcard tk-rec wb2-dusk" role="group" aria-label="Recording">
                <div className="wb2-capribbon">
                  <span className="wb2-recdot" aria-hidden="true" />
                  <b>Recording</b>
                  {/* No chip. The note card's chip says where the words are
                      going, and here that is the "Answer from" row still live
                      directly underneath — saying it twice, two inches apart,
                      is how the two of them come to disagree. */}
                  <button
                    type="button"
                    className="wb2-ico"
                    onClick={dict.cancel}
                    title="Throw it away"
                    aria-label="Discard the recording"
                  >
                    <Icon name="x" size={14} />
                  </button>
                </div>
                {/* THE SAME INSTRUMENT THIS BAR ALWAYS HAD, mounted the way
                    the capture sheet mounts it: above the card rather than
                    inside it. The field is the mark while the mic is open and
                    the cloud while the words are read back, and those are the
                    same dots making the journey — inside the card it would be
                    unmounted and rebuilt between the two, and the flight would
                    become a cut.

                    IT IS THE MARK ONLY, HERE. This bar shows the recording and
                    the read-back in two different branches, so a field spanning
                    them would be remounted between the two anyway; giving it
                    the cloud would buy the cut it is meant to avoid. The bar
                    keeps its named wait, and the journey ships on the capture
                    sheet, where one body holds both stages. */}
                <div className="wb2-capfield">
                  <DotField stage="mark" size={252} />
                </div>
                <RecordingCard dict={dict} text={input} />
              </div>
            ) : (
            <div className="tinput">
              <div className="tib"></div>
              <div className={`tin${working ? " working" : ""}`}>
                {/* the mark, not a sparkle: the sparkle was the generic AI
                    badge AND the Field-notes icon two inches away — the bar
                    is HeyTiff's own voice and wears its own mark (Isaac's
                    call, and the visual one too) */}
                <div className="tic">
                  <Chevron size={24} gradient />
                </div>
                <input
                  ref={inputRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder={active ? "Ask a follow-up…" : "Ask Tiff anything…"}
                  aria-label="Ask Tiff"
                  disabled={listening}
                />
                {voiceEnabled && (
                  <button
                    type="button"
                    className="tmic"
                    onClick={dict.start}
                    disabled={dict.transcribing}
                    title="Ask it out loud"
                    aria-label="Ask by voice"
                  >
                    <Icon name="mic" size={19} />
                  </button>
                )}
                {/* The spinner REPLACES the arrow rather than sitting
                    beside it: one control, and what it shows is what the
                    page is doing. Still submits — a new question mid-answer
                    drops the old one, which is the behaviour. */}
                {/* `aria-busy`, NOT a changed label: the button is the
                    send button whether or not an answer is in flight, and
                    renaming a control for a passing state is how a screen
                    reader loses track of what it is. */}
                <button
                  className={`tsend${working ? " busy" : ""}`}
                  type="submit"
                  aria-label="Send"
                  aria-busy={working}
                  disabled={listening}
                >
                  {working ? (
                    <span className="tsend-spin" aria-hidden="true" />
                  ) : (
                    <Icon name="send" size={18} />
                  )}
                </button>
              </div>
            </div>
            )}

            {/* THE THIRD WAIT, AND IT GETS THE SAME OBJECT AS THE OTHER TWO.
                Reading a recording back is a wait with nothing to show for
                itself — no partial words, no shelves to light — and it said so
                in the same flat grey the two-minute notice and the error line
                use, which put a passing state in the typeface of bad news.
                The chip that names the wait in the transcript names this one
                too, keeping `tvsay` so the slot under the bar is unchanged.

                It is also the far side of a pair. While the mic is open the
                orb sits in the bar BREATHING with your voice; the moment it
                closes the same sphere carries on turning here, under its own
                power, until the words land. */}
            {dict.transcribing && <Waiting note={READING_BACK_NOTE} className="tvsay" />}
            {ranOut && !listening && (
              <p className="tvsay" role="status">
                Two minutes — that&apos;s the limit for one recording. Press the mic to carry on.
              </p>
            )}
            {voiceErr && (
              <p className="tvsay err" role="alert">
                {voiceErr}
              </p>
            )}

            {/* A CHOICE HAS TO LOOK LIKE TWO THINGS. This was one pill saying
                "Research" beside grey text saying "General knowledge", and
                nothing on screen said which of the two words was the state and
                which was the button — pressing Research made the sentence
                beside it change, so both read as labels for the same control.
                Two options with the live one lit says what you can do and what
                you are about to get, in the same glance. */}
            <div className="tk-crow">
              <span className="tk-clbl" id="tk-modelbl">
                Answer from
              </span>
              <div className="tk-mode" role="group" aria-labelledby="tk-modelbl">
                <button
                  type="button"
                  className={`tk-modeb${research ? " on" : ""}`}
                  aria-pressed={research}
                  disabled={!canResearch}
                  title={canResearch ? undefined : "Add documents to the library first"}
                  onClick={() => setResearch(true)}
                >
                  <Icon name="library" size={15} />
                  Your library
                </button>
                <button
                  type="button"
                  className={`tk-modeb${research ? "" : " on"}`}
                  aria-pressed={!research}
                  onClick={() => setResearch(false)}
                >
                  <Icon name="bot" size={15} />
                  General knowledge
                </button>
              </div>
              {/* IT ONLY SPEAKS WHEN A CONTROL CANNOT. Two of the three
                  branches here restated the buttons an inch to the left —
                  "Your documents only, with the page it came from" under a
                  segment labelled Your library, and "What Tiff already knows
                  — nothing is looked up" under one labelled General
                  knowledge. A caption that says the label again in a longer
                  sentence is the app talking rather than the control working.

                  The third one earns its place and is all that is left: Your
                  library is DISABLED until something is in it, and a dead
                  segment with no reason given is the one thing on this row a
                  person cannot work out by reading it. */}
              {!canResearch && (
                <span className="tk-chint">Add documents and Tiff can answer from those too</span>
              )}
            </div>
          </form>
        </div>

        <Rail counts={counts} viz={viz} cardRefs={cardRefs} />

        {/* LAST on purpose — it measures the two columns above and their refs
            re-attach in tree order, so an overlay placed first would measure a
            rail that had just been unregistered. It paints underneath by
            z-index, not by DOM order. `measureKey` is the other half: the
            composer MOVES when the landing screen gives way to a transcript,
            and no observer fires for a move. */}
        {/* `idle` draws the four lanes faintly on the landing, before anything
            is asked: the mechanism this page is built on — your question goes
            out to these categories — is worth showing rather than
            explaining, and it costs a stroke nobody has to read. Inside a
            conversation the overlay stays event-driven. */}
        <ResearchLines
          stageRef={stageRef}
          composerRef={composerRef}
          cardRefs={cardRefs}
          viz={viz}
          idle={!active && readyCount > 0}
          /* THE MIC IS THE SECOND THING THAT MOVES THE COMPOSER. The lanes
             leave from the composer's own edge, and the observer that catches
             layout changes watches the STAGE — which does not change size when
             a child of it does. That is why the transcript's length is here at
             all; the recording card is now the other way the composer's height
             changes under a drawn rail (ask, then press the mic while the
             answer is still streaming), so it has to bump this too or the
             lanes stay pinned to where the bar used to be.

             Any changing number does: the overlay only reads it as "something
             the observers cannot see has moved — measure again". */
          measureKey={(active?.messages.length ?? 0) * 2 + (dict.recording ? 1 : 0)}
        />
      </div>

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
          onConfirm={() => deleteThread(removing.id)}
          onClose={() => setRemoving(null)}
        />
      )}
    </div>
  );
}

/* ── what you can do to a conversation (brief §4A) ───────────────────────── */

/* Both portal to <body>: `.page.in`'s will-change traps position:fixed inside
   the shell. Outside `.fg` they inherit no ramp, so the `.fl-` family they
   borrow from the fleet modals carries its own colours. */

/* Escape closes every portal here. The family had the backdrop and the ✕ but
   no key — with the rename field focused, the keyboard's own way out went
   nowhere (round-1 finding, verified live). Window-level on purpose: the
   modals don't trap focus, so the key must work wherever it lands. */
function useEscape(onClose: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
}

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
  useEscape(onClose);

  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="fl-ov" onClick={onClose}>
      <div
        className="fl-modal tk-sm"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Rename chat"
      >
        <div className="fl-mh">
          <span>
            <b>Rename this chat</b>
            <em>What you&rsquo;ll recognise it by in the list</em>
          </span>
          <button className="fl-x" aria-label="Close" onClick={onClose}>
            <Icon name="x" size={16} />
          </button>
        </div>
        {/* a form, so Enter commits — the only key anybody presses in a
            one-field modal */}
        <form
          className="fl-mb"
          onSubmit={(e) => {
            e.preventDefault();
            if (clean) onSave(clean);
          }}
        >
          <label className="fl-f">
            <span>Title</span>
            <input
              className="fl-i"
              value={title}
              maxLength={TITLE_MAX}
              autoFocus
              aria-label="Chat title"
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>
          <div className="fl-foot">
            <button type="button" className="fl-btn ghost" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="fl-btn primary" disabled={!clean}>
              <Icon name="save" size={15} />
              Save name
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
}

function DeleteThread({
  thread,
  onConfirm,
  onClose,
}: {
  thread: Thread;
  onConfirm: () => void;
  onClose: () => void;
}) {
  useEscape(onClose);
  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="fl-ov" onClick={onClose}>
      <div
        className="fl-modal tk-sm"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Delete chat"
      >
        <div className="fl-mh">
          <span>
            <b>Delete “{thread.title}”?</b>
            <em>The conversation, not anything in the library</em>
          </span>
          <button className="fl-x" aria-label="Close" onClick={onClose}>
            <Icon name="x" size={16} />
          </button>
        </div>
        <div className="fl-mb">
          <p className="tk-confirm">
            {thread.messages.length > 0 &&
              `${thread.messages.length} ${plural(thread.messages.length, "message")} ${
                thread.messages.length === 1 ? "goes" : "go"
              } with it. `}
            Threads live on this device only, so there is no copy elsewhere and no undo.
          </p>
          <div className="fl-foot">
            <button className="fl-btn ghost" onClick={onClose}>
              Keep it
            </button>
            {/* THE BUTTON SAYS THE VERB, NOT THE TITLE AGAIN. Repeating the
                thread's name here wrapped the confirm onto two lines and
                squeezed "Keep it" into a squat block beside it — a question
                already asked in the heading, asked twice, at the cost of the
                one control that undoes it. The heading names the thread; this
                says what pressing it does. */}
            <button className="fl-btn danger arm" onClick={onConfirm}>
              Delete chat
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

/* ── landing: first run sells, a returning user resumes ──────────────────── */

/* ── what's in the library, shown rather than promised ────────────────────
   The landing's paragraph says Tiff can answer from your documents; below the
   composer the page then said nothing at all, and at 1440 the bottom half was
   bare well. This is the promise made concrete: the last few things to land,
   named, on the screen whose whole subject is asking them things.

   A ROW IS A QUESTION, NOT A FILE. Clicking opens the same sentence the
   library's own "Ask Tiff" hands over — `In “title”, ` with the caret after
   it — because this is the ask screen and the reader is already in the box.
   Nothing is sent; the opener is scaffolding. Opening the PDF is the
   library's job and the eyebrow's "Open all" goes there.

   NO TIMESTAMP. This renders on the server, and a relative time in a render
   body tears hydration for the whole tree. The heading carries the recency;
   each line says what the document is, which is what decides whether it's
   worth asking about. */
function RecentDocs({
  docs,
  onAsk,
}: {
  docs: KbRecentDoc[];
  onAsk: (title: string) => void;
}) {
  return (
    <div className="tk-newdocs">
      <div className="tk-lbl">
        <span>Recently added</span>
        {/* by name, not by path — see `navHref` */}
        <Link className="tk-lbla" href={navHref("tiffkb")}>
          Open all
          <Icon name="chevR" size={13} />
        </Link>
      </div>
      <div className="tk-ndrow">
        {docs.map((d) => {
          const cat = KB_CATEGORIES.find((c) => c.key === d.category);
          return (
            <button
              key={d.id}
              type="button"
              className="tk-nd"
              style={{ "--tkc": cat?.color ?? "#9ca3af" } as React.CSSProperties}
              aria-label={`Ask Tiff about ${d.title}`}
              title={d.title}
              onClick={() => onAsk(d.title)}
            >
              <span className="tk-ndt">{d.title}</span>
              <em>
                {cat?.label ?? "Document"}
                {d.pageCount ? ` · ${d.pageCount.toLocaleString("en-AU")} pages` : ""}
              </em>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Landing({
  returning,
  recent,
  readyCount,
  recentDocs,
  onOpen,
  onRename,
  onDelete,
  onAskAbout,
}: {
  returning: boolean;
  recent: Thread[];
  readyCount: number;
  recentDocs: KbRecentDoc[];
  onOpen: (id: string) => void;
  onRename: (t: Thread) => void;
  onDelete: (t: Thread) => void;
  onAskAbout: (title: string) => void;
}) {
  return (
    <>
      {/* One line, then the box. The subline names the switch under the box by
          the words printed ON it — it used to say "turn on Research", which
          was the one control on this screen nobody could find. */}
      <div className="tk-open">
        {/* ONE heading for both visits. It used to be "Ask the library" for a
            first visit and a friendly opener for a return — decided from
            localStorage, which the server can't read, so every returning user
            watched 38px letters swap one frame after paint. The flash bought
            nothing.

            And the heading NAMES THE SCREEN now rather than greeting you.
            "What are we working on?" is the chrome every chat product opens
            with, which made the most valuable page in the app introduce itself
            as a chatbot; the paragraph under it already carries the invitation
            and says how many documents are behind the answer. */}
        <h2>Library</h2>
        <p>
          {readyCount > 0 ? (
            <>
              Installs, servicing, specs and how we do things here. Ask{" "}
              <b>your library</b> and I&rsquo;ll answer from the{" "}
              {readyCount.toLocaleString("en-AU")} {plural(readyCount, "document")} in it, and show
              you the page it came from.
            </>
          ) : (
            <>
              Installs, servicing, specs and how we do things here. Add manuals to the library and
              I can answer from those too — with the page they came from.
            </>
          )}
        </p>
      </div>

      {returning && recent.length > 0 && (
        <div className="tk-recent">
          <div className="tk-lbl">
            <span>Pick up where you left off</span>
          </div>
          {/* the row is a DIV holding three buttons, not a button holding
              three: opening, renaming and deleting are three different things
              to press, and nesting them inside one control is invalid markup
              that also swallows the two smaller ones from a screen reader */}
          <div className="tk-threads">
            {recent.map((t) => (
              <div key={t.id} className="thread tk-thr">
                <button type="button" className="tk-topen" onClick={() => onOpen(t.id)}>
                  <div className="th">
                    <b>{t.title}</b>
                  </div>
                  <em>{ago(t.updatedAt)}</em>
                </button>
                <span className="tk-tacts">
                  <button
                    type="button"
                    className="tk-tact"
                    aria-label={`Rename “${t.title}”`}
                    title="Rename"
                    onClick={() => onRename(t)}
                  >
                    <Icon name="edit" size={14} />
                  </button>
                  <button
                    type="button"
                    className="tk-tact dan"
                    aria-label={`Delete “${t.title}”`}
                    title="Delete"
                    onClick={() => onDelete(t)}
                  >
                    <Icon name="x" size={14} />
                  </button>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {recentDocs.length > 0 && <RecentDocs docs={recentDocs} onAsk={onAskAbout} />}
    </>
  );
}

/* ── the rail: the categories, and the way into the library ─────────────── */

function Rail({
  counts,
  viz,
  cardRefs,
}: {
  counts: Record<KbCategoryKey, number>;
  viz: ResearchViz;
  cardRefs: React.RefObject<Map<KbCategoryKey, HTMLElement>>;
}) {
  return (
    <aside className="tk-rail">
      {/* The eyebrow row was built with space-between and then given nothing to
          put on the right. The way into the catalogue goes there, which is
          where a section's own link belongs and is one of the two things the
          block at the foot used to do.

          The eyebrow says "Categories" rather than "Library" now that the
          SECTION is the library: a heading repeating the page it sits on
          labels nothing, and the cards under it are categories. The link is
          named for where it lands — the same words as the ⌘K face. */}
      <div className="tk-lbl">
        <span>Categories</span>
        <Link className="tk-lbla" href={navHref("tiffkb")}>
          All documents
          <Icon name="chevR" size={13} />
        </Link>
      </div>

      <div className="tk-rcats stgp">
        {KB_CATEGORIES.map((c) => {
          const state = cardState(viz, c.key);
          /* The microline is the shelf's own live report: its document count
             at rest, "Searching…" while a line is out to it, and the real
             number of matches once the trace comes back. Null means the
             search has nothing to say and the count stands. */
          const note = cardNote(viz, c.key);
          return (
            <Link
              key={c.key}
              href={`${navHref("tiffkb")}?cat=${c.key}`}
              className={`tk-rcat spot${state === "idle" ? "" : ` ${state}`}`}
              data-cat={c.key}
              ref={(el) => {
                if (el) cardRefs.current.set(c.key, el);
                else cardRefs.current.delete(c.key);
              }}
              style={{ "--sc": `${c.color}1f`, "--tkc": c.color } as React.CSSProperties}
            >
              <span className="sglow" />
              {/* the glyph is mixed toward ink: the raw category colours were
                  chosen for tinted tiles, and mint or amber STROKES on a pale
                  wash sat under 2:1 — decoration where a symbol should be */}
              <span
                className="tk-ric"
                style={{
                  background: `${c.color}15`,
                  border: `1px solid ${c.color}30`,
                  color: `color-mix(in oklab, ${c.color} 62%, var(--ink))`,
                }}
              >
                <Icon name={c.icon} size={19} />
              </span>
              <div className="tk-rtx">
                <b>{c.label}</b>
                {/* an empty shelf says so in words, quietly — the mint "—" it
                    used to wear read as a rendering fault, in an accent colour
                    that means "ready" everywhere else */}
                <em className={!note && counts[c.key] === 0 ? "quiet" : undefined}>
                  {note ??
                    (counts[c.key] > 0
                      ? `${counts[c.key].toLocaleString("en-AU")} ${plural(counts[c.key], "document")}`
                      : "None yet")}
                </em>
              </div>
              <span className="tk-rbl">{c.blurb}</span>
            </Link>
          );
        })}
      </div>

      {/* NOTHING ELSE. This corner has now lost three things in a row and is
          better for each: "Open library" and "Add documents", which were the
          same URL twice; the Add tile that briefly replaced them, because
          uploading belongs to the library screen; and finally the running
          total, because the library says that about itself the moment you
          arrive and the five cards above already carry it per category.

          What the rail is, is the categories and one way in. `tiff_manage`
          changes nothing here — there is no control left to gate. */}
    </aside>
  );
}

/* ── the honest miss ─────────────────────────────────────────────────────── */

function MissBanner({ canManage }: { canManage: boolean }) {
  return (
    <div className="tk-miss">
      <Icon name="alert" size={15} />
      <div>
        <b>Nothing in your library covered this — answering from general knowledge.</b>
        <em>
          {canManage
            ? "Upload the manual, fault-code book or SOP that covers it and ask again."
            : "Ask a manager to add the manual or SOP that covers it."}
        </em>
      </div>
    </div>
  );
}

/* ── citations ───────────────────────────────────────────────────────────── */

const colourOf = (key: KbCategoryKey): string =>
  KB_CATEGORIES.find((c) => c.key === key)?.color ?? "#9ca3af";

const pagesOf = (s: { pageFrom: number; pageTo: number }): string =>
  s.pageTo > s.pageFrom ? `p.${s.pageFrom}–${s.pageTo}` : `p.${s.pageFrom}`;

/* A source is a DOCUMENT; its passages are what the peek is for. The chips
   used to render one per passage, and the live walk's E4 answer put "Daikin
   VRV Diagnosis Manual" on screen six times in three wrapped rows — the same
   citation shouting over itself, with the pages the only part that changed.
   One chip per document, wearing every page it was read at. */
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

/** The chip's page list: passages in page order, identical ranges said once. */
const pagesLabel = (doc: SourceDoc): string => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of [...doc.items].sort((a, b) => a.pageFrom - b.pageFrom)) {
    const label = pagesOf(item);
    if (seen.has(label)) continue;
    seen.add(label);
    out.push(label);
  }
  return out.join(" · ");
};

function SourceChips({
  sources,
  titles,
  onPeek,
}: {
  sources: AskSourceItem[];
  titles: Record<string, string>;
  onPeek: (d: SourceDoc) => void;
}) {
  const docs = groupSources(sources, titles);
  return (
    <div className="tk-srcfoot">
      <span className="tk-srclbl">
        {docs.length === 1 ? "Source" : `Sources · ${docs.length}`}
      </span>
      <div className="tk-srcs">
        {docs.map((d) => (
          <button
            key={d.docId}
            type="button"
            className="tk-src"
            onClick={() => onPeek(d)}
            aria-label={`Source ${d.n}: ${d.title}, ${pagesLabel(d)}`}
          >
            <span className="tk-sn">{d.n}</span>
            <span className="tk-sdot" style={{ background: colourOf(d.category) }} />
            <span className="tk-stl">{d.title}</span>
            <em>{pagesLabel(d)}</em>
          </button>
        ))}
      </div>
    </div>
  );
}

/* The peek panel. Portalled to <body> — `.page.in`'s will-change traps
   position:fixed inside the shell — so it restates its own colours rather than
   inheriting the ramp declared on `.fg`. */
function SourcePeek({ source, onClose }: { source: SourceDoc; onClose: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /* Whether there is more passage below the fold. macOS overlay scrollbars
     are invisible until touched, and on the live walk the well cut mid-word
     with nothing saying so — the fade is the well admitting it continues. */
  const [more, setMore] = useState(false);
  const wellRef = useRef<HTMLDivElement>(null);
  useEscape(onClose);

  const refreshMore = useCallback(() => {
    const el = wellRef.current;
    if (!el) return;
    setMore(el.scrollHeight - el.scrollTop - el.clientHeight > 8);
  }, []);
  // measured after first paint — the well has no height until the portal lands
  useEffect(() => {
    refreshMore();
  }, [refreshMore]);

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

  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="fl-ov" onClick={onClose}>
      <div
        className="fl-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={`Source ${source.n}: ${source.title}`}
      >
        <div className="fl-mh">
          <span>
            <b>{source.title}</b>
            <em>
              <span className="tk-pkdot" style={{ background: colourOf(source.category) }} />
              {KB_CATEGORIES.find((c) => c.key === source.category)?.label ?? "Document"} ·{" "}
              {pagesLabel(source)}
            </em>
          </span>
          <button className="fl-x" aria-label="Close" onClick={onClose}>
            <Icon name="x" size={16} />
          </button>
        </div>
        <div className="fl-mb">
          {error && <div className="fl-err">{error}</div>}
          <p className="tk-pklead">
            {passages.length === 1 ? "What Tiff read on that page:" : "What Tiff read on those pages:"}
          </p>
          <div className="tk-pkw">
            <div className="tk-pks" ref={wellRef} onScroll={refreshMore}>
              {passages.map((item) => (
                <blockquote key={item.chunkId} className="tk-pkq">
                  {passages.length > 1 && <span className="tk-pkqp">{pagesOf(item)}</span>}
                  {item.excerpt}
                </blockquote>
              ))}
            </div>
            <div className={`tk-pkfade${more ? " on" : ""}`} aria-hidden="true" />
          </div>
          <div className="fl-foot">
            <button className="fl-btn ghost" onClick={onClose}>
              Close
            </button>
            <button className="fl-btn primary" disabled={busy} onClick={open}>
              <Icon name="arrowUR" size={15} />
              Open document
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
