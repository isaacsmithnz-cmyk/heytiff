"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { Icon } from "@/components/shell/icon";
import { kbDocUrl } from "@/app/actions/kb";
import { askTiff, type AskSourceItem, type AskTurn } from "@/lib/tiff/ask-client";
import { consumeAskHandoff } from "@/lib/tiff/ask-handoff";
import {
  cardNote,
  cardState,
  reduceViz,
  IDLE_VIZ,
  type ResearchViz,
  type VizEvent,
} from "@/lib/tiff/research-viz";
import { ResearchLines } from "./research-lines";
import { KB_CATEGORIES, type KbCategoryKey } from "./kb";

/* Tiff AI — the assistant, connected.

   TWO COLUMNS, AND THE RIGHT ONE IS THE POINT. The transcript sits beside the
   four category cards rather than under them: the cards stay on screen while
   the answer grows (bottom cards scroll away mid-answer), they double as the
   way into the library when nothing is being asked, and the horizontal gap
   between composer and cards is where the next phase draws the search lines.
   Under 1100px they stack and nothing is lost.

   RESEARCH IS A CHOICE, NOT A MODE. Off, Tiff answers from general knowledge
   and says so. On, it answers only from the company's own documents and cites
   the page. The toggle says which one you are about to get BEFORE you press
   send, and every answer carries the same distinction afterwards — a
   researched answer has chips under it, a general one has an offer to go and
   look. With no ready documents the toggle is disabled and says why, because a
   Research button that finds nothing teaches you not to trust the feature.

   THE ANSWER ARRIVES AS IT IS WRITTEN. `askTiff` reads the NDJSON stream and
   this component appends deltas to one live message, which is committed to the
   thread when the stream ends. Threads live in localStorage as before, on a
   bumped key: messages now carry sources and whether they were researched, and
   v1 rows have neither.

   THE LINES SHOW WHERE IT IS LOOKING, AND THEY ARE NOT DECORATION. The
   overlay measures `.tk-stage`, `.tk-composer` and the four `.tk-rcat` cards
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

/* Starters, as pills rather than cards.

   THE LABEL IS THE QUESTION. A card that said "DIAGNOSTICS · R32 running
   pressures at 35°C · What should I see on gauges?" spent three lines saying
   what one line says, and its category eyebrow repeated the shelf sitting in
   the rail beside it. What survives is the sentence that goes in the box; the
   dot carries the category, and nothing else has to.

   `research` marks the ones that only make sense against the company's own
   documents — those turn Research on as they fill the box, and are offered
   only when the library actually holds something. */
const SUGGESTIONS: { cat: string; color: string; label: string; research: boolean }[] = [
  { cat: "DIAGNOSTICS", color: "#00E5C0", label: "R32 running pressures at 35°C", research: false },
  { cat: "SYSTEM DESIGN", color: "#2E68FF", label: "Size a VRF for a 3-storey office", research: false },
  { cat: "FAULT CODES", color: "#FF3366", label: "What does fault code U4 mean?", research: true },
  { cat: "COMPANY SOP", color: "#8A2BE2", label: "What's our warranty claim process?", research: true },
];

/* hydration guard: false on the server and during hydration, true after —
   lets us read localStorage without a server/client markup mismatch */
const emptySubscribe = () => () => {};
function useHydrated(): boolean {
  return useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false
  );
}

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
}: {
  counts?: Record<KbCategoryKey, number>;
  /** Ready documents across every shelf — nothing can be researched at zero. */
  readyCount?: number;
  canManage?: boolean;
}) {
  const hydrated = useHydrated();
  // null = "not touched yet": until the first send, render straight from storage
  const [threadState, setThreadState] = useState<Thread[] | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [research, setResearch] = useState(false);
  const [peek, setPeek] = useState<AskSourceItem | null>(null);

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

  /* What the search lines and the four shelves are doing. The refs below are
     the overlay's measuring points — the stage it draws inside, the composer
     every line leaves from, and the card each one arrives at. */
  const [viz, setViz] = useState<ResearchViz>(IDLE_VIZ);
  const stageRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLFormElement>(null);
  const cardRefs = useRef(new Map<KbCategoryKey, HTMLElement>());
  const showViz = (event: VizEvent) => setViz((prev) => reduceViz(prev, event));

  const threads = threadState ?? (hydrated ? loadThreads() : []);
  const active = threads.find((t) => t.id === activeId) ?? null;
  const recent = [...threads].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 8);

  const streaming = live !== null;
  const canResearch = readyCount > 0;

  useEffect(() => () => abortRef.current?.abort(), []);

  useEffect(() => {
    const el = chatRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [active?.messages.length, live?.text, streaming]);

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
       behind rather than leaving a stale rail under a new conversation. */
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
            /* Where Tiff looked, with real numbers — the shelves light from
               these and from nothing else. The winning shelf also names the
               document it ranked first, which is the one the citations under
               the answer are about to be checked against. */
            showViz({
              t: "trace",
              winners: event.winners,
              hits: {
                install: event.categories.install?.hits,
                faults: event.categories.faults?.hits,
                specs: event.categories.specs?.hits,
                sops: event.categories.sops?.hits,
              },
              topDocs: {
                install: event.categories.install?.topDoc,
                faults: event.categories.faults?.topDoc,
                specs: event.categories.specs?.topDoc,
                sops: event.categories.sops?.topDoc,
              },
            });
            break;
          case "miss":
            showViz({ t: "miss" });
            patchLive((prev) => ({ ...prev, missed: true }));
            break;
          case "delta":
            // the first word is when the search stops and the answer starts
            if (!liveRef.current?.text) showViz({ t: "firstDelta" });
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
      setActiveId(threadId);
    }

    persist(next);
    setInput("");
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

  /* Fills the box and hands the caret over — never sends. A starter is a way
     to stop staring at an empty field, and the question that gets asked
     should still be the reader's own. A library-shaped one arrives with
     Research already on, since that is the mode it was written for. */
  const pickSuggestion = (s: (typeof SUGGESTIONS)[number]) => {
    setInput(s.label);
    if (s.research && canResearch) setResearch(true);
    inputRef.current?.focus();
  };

  const newChat = () => {
    abortRef.current?.abort();
    setLiveBoth(null);
    setFailure(null);
    showViz({ t: "reset" });
    setActiveId(null);
    setInput("");
    inputRef.current?.focus();
  };

  const openThread = (id: string) => {
    abortRef.current?.abort();
    setLiveBoth(null);
    setFailure(null);
    // the rail belongs to the question that was asked, not to the screen
    showViz({ t: "reset" });
    setActiveId(id);
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
      abortRef.current?.abort();
      setLiveBoth(null);
      setFailure(null);
      showViz({ t: "reset" });
      setActiveId(null);
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
    <div className="page in">
      <div className="tk-stage" ref={stageRef}>
        <div className={`tk-chatcol${active ? "" : " landing"}`}>
          {active ? (
            <>
              <div className="tchathead">
                <span className="tb2">
                  <Icon name="bot" size={22} />
                </span>
                <div className="tcht">
                  <b>{active.title}</b>
                  <em>Tiff AI</em>
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

              <div className="tchat" ref={chatRef}>
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
                          <SourceChips sources={m.sources} onPeek={setPeek} />
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
                          <span className="ttyping" aria-label="Tiff is thinking">
                            <i></i>
                            <i></i>
                            <i></i>
                          </span>
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
              onOpen={openThread}
              onRename={setRenaming}
              onDelete={setRemoving}
              onSuggest={pickSuggestion}
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
            <div className="tinput">
              <div className="tib"></div>
              <div className="tin">
                <div className="tic">
                  <Icon name="sparkles" size={20} />
                </div>
                <input
                  ref={inputRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="Ask Tiff anything…"
                  aria-label="Ask Tiff"
                />
                <button className="tsend" type="submit" aria-label="Send">
                  <Icon name="send" size={18} />
                </button>
              </div>
            </div>

            <div className="tk-crow">
              <button
                type="button"
                className={`tk-res${research ? " on" : ""}`}
                aria-pressed={research}
                disabled={!canResearch}
                title={canResearch ? undefined : "Upload documents to the library first"}
                onClick={() => setResearch((r) => !r)}
              >
                <Icon name="search" size={15} />
                Research
              </button>
              <span className="tk-chint">
                {research ? "Digging through the library" : "General knowledge"}
              </span>
            </div>
          </form>
        </div>

        <Rail
          counts={counts}
          readyCount={readyCount}
          canManage={canManage}
          viz={viz}
          cardRefs={cardRefs}
        />

        {/* LAST on purpose — it measures the two columns above and their refs
            re-attach in tree order, so an overlay placed first would measure a
            rail that had just been unregistered. It paints underneath by
            z-index, not by DOM order. `measureKey` is the other half: the
            composer MOVES when the landing screen gives way to a transcript,
            and no observer fires for a move. */}
        {/* `idle` draws the four lanes faintly on the landing, before anything
            is asked: the mechanism this page is built on — your question goes
            out to these four shelves — is worth showing rather than
            explaining, and it costs a stroke nobody has to read. Inside a
            conversation the overlay stays event-driven. */}
        <ResearchLines
          stageRef={stageRef}
          composerRef={composerRef}
          cardRefs={cardRefs}
          viz={viz}
          idle={!active && readyCount > 0}
          measureKey={active?.messages.length ?? 0}
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
            <button className="fl-btn danger arm" onClick={onConfirm}>
              Delete “{thread.title}”
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

/* ── landing: first run sells, a returning user resumes ──────────────────── */

function Landing({
  returning,
  recent,
  readyCount,
  onOpen,
  onRename,
  onDelete,
  onSuggest,
}: {
  returning: boolean;
  recent: Thread[];
  readyCount: number;
  onOpen: (id: string) => void;
  onRename: (t: Thread) => void;
  onDelete: (t: Thread) => void;
  onSuggest: (s: (typeof SUGGESTIONS)[number]) => void;
}) {
  return (
    <>
      {/* One line, then the box. The subline is the only place the library's
          size is stated in words, so it says what Research would actually do
          rather than advertising a feature. */}
      <div className="tk-open">
        <h2>{returning ? "What are we working on?" : "Ask the library"}</h2>
        <p>
          {readyCount > 0 ? (
            <>
              Diagnostics, sizing, fault codes and company procedure. Turn on <b>Research</b> and
              I&rsquo;ll answer from the {readyCount.toLocaleString("en-AU")}{" "}
              {plural(readyCount, "document")} in your library, and show you the page it came from.
            </>
          ) : (
            <>
              Diagnostics, sizing, fault codes and company procedure. Add manuals to the library
              and I can answer from those too — with the page they came from.
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

      {/* A library-shaped starter is hidden while the shelves are empty: it
          would fill the box with a question this workspace cannot answer yet,
          which reads as a broken feature rather than an empty one. */}
      <div className="tk-starts">
        {SUGGESTIONS.filter((s) => !s.research || readyCount > 0).map((s) => (
          <button
            key={s.cat}
            type="button"
            className="tk-start"
            style={{ "--tkc": s.color } as React.CSSProperties}
            onClick={() => onSuggest(s)}
          >
            <i />
            {s.label}
          </button>
        ))}
      </div>
    </>
  );
}

/* ── the rail: four shelves, and the way into the library ────────────────── */

function Rail({
  counts,
  readyCount,
  canManage,
  viz,
  cardRefs,
}: {
  counts: Record<KbCategoryKey, number>;
  readyCount: number;
  canManage: boolean;
  viz: ResearchViz;
  cardRefs: React.RefObject<Map<KbCategoryKey, HTMLElement>>;
}) {
  return (
    <aside className="tk-rail">
      <div className="tk-lbl">
        <span>Library</span>
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
              href={`/dashboard/tiff/library?cat=${c.key}`}
              className={`tk-rcat spot${state === "idle" ? "" : ` ${state}`}`}
              data-cat={c.key}
              ref={(el) => {
                if (el) cardRefs.current.set(c.key, el);
                else cardRefs.current.delete(c.key);
              }}
              style={{ "--sc": `${c.color}1f`, "--tkc": c.color } as React.CSSProperties}
            >
              <span className="sglow" />
              <span
                className="tk-ric"
                style={{
                  background: `${c.color}15`,
                  border: `1px solid ${c.color}30`,
                  color: c.color,
                }}
              >
                <Icon name={c.icon} size={19} />
              </span>
              <div className="tk-rtx">
                <b>{c.label}</b>
                <em>
                  {note ??
                    (counts[c.key] > 0
                      ? `${counts[c.key].toLocaleString("en-AU")} ${plural(counts[c.key], "document")}`
                      : "—")}
                </em>
              </div>
              <span className="tk-rbl">{c.blurb}</span>
            </Link>
          );
        })}
      </div>

      <div className="tk-lib">
        <b>
          {readyCount > 0
            ? `${readyCount.toLocaleString("en-AU")} ${plural(readyCount, "document")} Tiff can read`
            : "Nothing in the library yet"}
        </b>
        <div className="tk-libl">
          <Link href="/dashboard/tiff/library">Open library</Link>
          {canManage && <Link href="/dashboard/tiff/library">Add documents</Link>}
        </div>
      </div>
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

function SourceChips({
  sources,
  onPeek,
}: {
  sources: AskSourceItem[];
  onPeek: (s: AskSourceItem) => void;
}) {
  return (
    <div className="tk-srcfoot">
      <span className="tk-srclbl">
        {sources.length === 1 ? "Source" : `Sources · ${sources.length}`}
      </span>
      <div className="tk-srcs">
        {sources.map((s) => (
          <button
            key={s.chunkId}
            type="button"
            className="tk-src"
            onClick={() => onPeek(s)}
            aria-label={`Source ${s.n}: ${s.title}, ${pagesOf(s)}`}
          >
            <span className="tk-sn">{s.n}</span>
            <span className="tk-sdot" style={{ background: colourOf(s.category) }} />
            <span className="tk-stl">{s.title}</span>
            <em>{pagesOf(s)}</em>
          </button>
        ))}
      </div>
    </div>
  );
}

/* The peek panel. Portalled to <body> — `.page.in`'s will-change traps
   position:fixed inside the shell — so it restates its own colours rather than
   inheriting the ramp declared on `.fg`. */
function SourcePeek({ source, onClose }: { source: AskSourceItem; onClose: () => void }) {
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
    const url = `${res.url}#page=${source.pageFrom}`;
    if (tab) {
      tab.opener = null;
      tab.location.href = url;
    } else if (typeof window !== "undefined") {
      window.open(url, "_blank", "noopener,noreferrer");
    }
  };

  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="fl-ov" onClick={onClose}>
      <div
        className="fl-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={`Source ${source.n}`}
      >
        <div className="fl-mh">
          <span>
            <b>{source.title}</b>
            <em>
              <span className="tk-pkdot" style={{ background: colourOf(source.category) }} />
              {KB_CATEGORIES.find((c) => c.key === source.category)?.label ?? "Document"} ·{" "}
              {pagesOf(source)}
            </em>
          </span>
          <button className="fl-x" aria-label="Close" onClick={onClose}>
            <Icon name="x" size={16} />
          </button>
        </div>
        <div className="fl-mb">
          {error && <div className="fl-err">{error}</div>}
          <p className="tk-pklead">What Tiff read on that page:</p>
          <blockquote className="tk-pkq">{source.excerpt}</blockquote>
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
