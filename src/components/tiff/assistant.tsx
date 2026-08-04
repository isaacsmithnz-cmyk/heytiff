"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { Icon } from "@/components/shell/icon";
import { kbDocUrl } from "@/app/actions/kb";
import { askTiff, type AskSourceItem, type AskTurn } from "@/lib/tiff/ask-client";
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

   CLASS HOOKS ARE LOAD-BEARING FOR THE NEXT PHASE. `.tk-stage`, `.tk-composer`
   and `.tk-rcat[data-cat]` are measured by the SVG line overlay in PR 4 — they
   are not decorative names. */

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

const SUGGESTIONS: { cat: string; icon: string; color: string; tint: string; title: string; desc: string }[] = [
  { cat: "DIAGNOSTICS", icon: "wrench", color: "#00E5C0", tint: "rgba(0,229,192,0.1)", title: "R32 running pressures at 35°C", desc: "What should I see on gauges?" },
  { cat: "SYSTEM DESIGN", icon: "zap", color: "#2E68FF", tint: "rgba(46,104,255,0.1)", title: "Size a VRF for a 3-storey office", desc: "18 indoor units, mixed zones" },
  { cat: "FAULT CODES", icon: "alert", color: "#FF3366", tint: "rgba(255,51,102,0.1)", title: "Mitsubishi U4 error", desc: "Diagnosis and likely fix" },
  { cat: "COMPANY SOP", icon: "shield", color: "#8A2BE2", tint: "rgba(138,43,226,0.1)", title: "Daikin warranty claim process", desc: "What’s our standard procedure?" },
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

export type AnswerBlock = { kind: "p"; text: string } | { kind: "ul"; items: string[] };

/* Paragraphs on blank lines, and lines starting "- " as a list. That is the
   whole grammar, and it matches what the system prompt asks for — a model that
   sends a markdown table would have it rendered as the literal characters it
   is, which is the honest failure and not a silent one. */
export function answerBlocks(text: string): AnswerBlock[] {
  const blocks: AnswerBlock[] = [];
  let para: string[] = [];
  let items: string[] = [];

  const flushPara = () => {
    if (para.length) blocks.push({ kind: "p", text: para.join(" ") });
    para = [];
  };
  const flushList = () => {
    if (items.length) blocks.push({ kind: "ul", items });
    items = [];
  };

  for (const raw of String(text ?? "").split("\n")) {
    const line = raw.trim();
    if (!line) {
      flushList();
      flushPara();
      continue;
    }
    if (line.startsWith("- ") || line === "-") {
      flushPara();
      const item = line.slice(1).trim();
      if (item) items.push(item);
      continue;
    }
    flushList();
    para.push(line);
  }
  flushList();
  flushPara();
  return blocks;
}

function AnswerText({ text }: { text: string }) {
  const blocks = useMemo(() => answerBlocks(text), [text]);
  return (
    <>
      {blocks.map((b, i) =>
        b.kind === "ul" ? (
          <ul key={i}>
            {b.items.map((item, j) => (
              <li key={j}>{item}</li>
            ))}
          </ul>
        ) : (
          <p key={i}>{b.text}</p>
        )
      )}
    </>
  );
}

/* ── the screen ──────────────────────────────────────────────────────────── */

export function TiffAssistant({
  counts = { install: 0, faults: 0, specs: 0, sops: 0 },
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
            /* Where Tiff looked, with real numbers. Nothing renders it yet —
               it is what drives the line animation in the next phase. */
            break;
          case "miss":
            patchLive((prev) => ({ ...prev, missed: true }));
            break;
          case "delta":
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
            break;
          }
          case "err": {
            const state = liveRef.current;
            if (state) commitLive(state);
            setLiveBoth(null);
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

  const pickSuggestion = (s: (typeof SUGGESTIONS)[number]) => {
    setInput(`${s.title}. ${s.desc}`);
    inputRef.current?.focus();
  };

  const newChat = () => {
    abortRef.current?.abort();
    setLiveBoth(null);
    setFailure(null);
    setActiveId(null);
    setInput("");
    inputRef.current?.focus();
  };

  const openThread = (id: string) => {
    abortRef.current?.abort();
    setLiveBoth(null);
    setFailure(null);
    setActiveId(id);
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
      <div className="tk-stage">
        <div className="tk-chatcol">
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
                <button className="pbtn ghost" onClick={newChat}>
                  <Icon name="plus" size={15} />
                  New chat
                </button>
              </div>

              <div className="tchat" ref={chatRef}>
                {active.messages.map((m, i) => (
                  <div key={i} className={`tmsg ${m.role === "user" ? "user" : "bot"}`}>
                    {m.role === "tiff" && (
                      <span className="tmav">
                        <Icon name="bot" size={18} />
                      </span>
                    )}
                    <div className="tmw">
                      {m.missed && <MissBanner canManage={canManage} />}
                      <div className="tmb">
                        {m.role === "tiff" ? <AnswerText text={m.text} /> : m.text}
                      </div>
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
                ))}

                {live && live.threadId === active.id && (
                  <div className="tmsg bot">
                    <span className="tmav">
                      <Icon name="bot" size={18} />
                    </span>
                    <div className="tmw">
                      {live.missed && <MissBanner canManage={canManage} />}
                      {live.text ? (
                        <div className="tmb">
                          <AnswerText text={live.text} />
                        </div>
                      ) : (
                        <div className="tmb ttyping" aria-label="Tiff is thinking">
                          <i></i>
                          <i></i>
                          <i></i>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {failure && (
                  <div className="tmsg bot">
                    <span className="tmav">
                      <Icon name="alert" size={18} />
                    </span>
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
              onSuggest={pickSuggestion}
            />
          )}

          <form
            className="tk-composer"
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

        <Rail counts={counts} readyCount={readyCount} canManage={canManage} />
      </div>

      {peek && <SourcePeek source={peek} onClose={() => setPeek(null)} />}
    </div>
  );
}

/* ── landing: first run sells, a returning user resumes ──────────────────── */

function Landing({
  returning,
  recent,
  readyCount,
  onOpen,
  onSuggest,
}: {
  returning: boolean;
  recent: Thread[];
  readyCount: number;
  onOpen: (id: string) => void;
  onSuggest: (s: (typeof SUGGESTIONS)[number]) => void;
}) {
  return (
    <>
      {returning ? (
        /* Somebody who has asked before doesn't need the pitch again — the
           thing they came back for is the thread they were in. */
        <div className="tk-welcome">
          <h2>What are we working on?</h2>
          <p>
            {readyCount > 0
              ? `Ask anything, or turn on Research and I'll answer from the ${readyCount} ${plural(readyCount, "document")} in your library.`
              : "Ask anything. Add documents to the library and I can answer from those too."}
          </p>
        </div>
      ) : (
        <div className="thero">
          <div className="o1"></div>
          <div className="o2"></div>
          <div className="trow">
            <div className="tbot">
              <div className="tb">
                <Icon name="bot" size={40} sw={1.5} />
              </div>
              <div className="tst">
                <i></i>
              </div>
            </div>
            <div className="tlead">
              <div className="pill">
                <Icon name="fingerprint" size={12} />
                Tiff AI
              </div>
              <h2>What are we building today?</h2>
              <p className="tl">
                Ask about system sizing, diagnostics, fault codes or company SOPs. Turn on{" "}
                <b>Research</b> and I&rsquo;ll answer from your knowledge base and show you the
                page it came from.
              </p>
            </div>
          </div>
        </div>
      )}

      {returning && recent.length > 0 && (
        <div className="tk-recent">
          <div className="tk-lbl">
            <span>Pick up where you left off</span>
          </div>
          <div className="tk-threads">
            {recent.map((t) => (
              <button key={t.id} className="thread" onClick={() => onOpen(t.id)}>
                <div className="th">
                  <b>{t.title}</b>
                </div>
                <em>{ago(t.updatedAt)}</em>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="tsgrid stgp">
        {SUGGESTIONS.map((s) => (
          <button key={s.cat} className="tsugg" onClick={() => onSuggest(s)}>
            <span className="tsg" style={{ background: s.color }}></span>
            <div className="tsh">
              <div className="tsi" style={{ background: s.tint, color: s.color }}>
                <Icon name={s.icon} size={18} />
              </div>
              <span className="tsc" style={{ color: s.color }}>
                {s.cat}
              </span>
            </div>
            <div className="tst2">{s.title}</div>
            <div className="tsd">{s.desc}</div>
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
}: {
  counts: Record<KbCategoryKey, number>;
  readyCount: number;
  canManage: boolean;
}) {
  return (
    <aside className="tk-rail">
      <div className="tk-lbl">
        <span>Knowledge base</span>
      </div>

      <div className="tk-rcats stgp">
        {KB_CATEGORIES.map((c) => (
          <Link
            key={c.key}
            href={`/dashboard/tiff/knowledge?cat=${c.key}`}
            className="tk-rcat spot"
            data-cat={c.key}
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
                {counts[c.key] > 0
                  ? `${counts[c.key].toLocaleString("en-AU")} ${plural(counts[c.key], "document")}`
                  : "—"}
              </em>
            </div>
            <span className="tk-rbl">{c.blurb}</span>
          </Link>
        ))}
      </div>

      <div className="tk-lib">
        <b>
          {readyCount > 0
            ? `${readyCount.toLocaleString("en-AU")} ${plural(readyCount, "document")} Tiff can read`
            : "Nothing in the library yet"}
        </b>
        <div className="tk-libl">
          <Link href="/dashboard/tiff/knowledge">Open library</Link>
          {canManage && <Link href="/dashboard/tiff/knowledge">Add documents</Link>}
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
