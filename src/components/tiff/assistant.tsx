"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { Icon } from "@/components/shell/icon";
import { KB_CATEGORIES, kbCounts, type KbDoc } from "./kb";

/* Tiff AI — stage 1. Full v3 design (hero, suggestion prompts, glowing input,
   Knowledge Base + Recent Threads sidebar) plus a working chat surface. There
   is no model behind it yet: sends get an honest "preview" reply, and threads
   persist per-device in localStorage so the surface survives a refresh. When
   the real model lands, only `replyTo` and the storage layer should change. */

type Msg = { role: "user" | "tiff"; text: string; at: number };
type Thread = { id: string; title: string; updatedAt: number; messages: Msg[] };

const STORE_KEY = "heytiff.tiff.threads.v1";

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

export function TiffAssistant({ docs }: { docs: KbDoc[] }) {
  const hydrated = useHydrated();
  // null = "not touched yet": until the first send, render straight from storage
  const [threadState, setThreadState] = useState<Thread[] | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const chatRef = useRef<HTMLDivElement>(null);
  const replyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const counts = useMemo(() => kbCounts(docs), [docs]);
  const threads = threadState ?? (hydrated ? loadThreads() : []);
  const active = threads.find((t) => t.id === activeId) ?? null;

  useEffect(() => {
    return () => {
      if (replyTimer.current) clearTimeout(replyTimer.current);
    };
  }, []);

  useEffect(() => {
    const el = chatRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [active?.messages.length, thinking]);

  const persist = (next: Thread[]) => {
    setThreadState(next);
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(next));
    } catch {
      /* storage full/blocked — threads just won't survive a refresh */
    }
  };

  const replyTo = (threadId: string) => {
    setThinking(true);
    replyTimer.current = setTimeout(() => {
      setThinking(false);
      setThreadState((prev) => {
        const next = (prev ?? loadThreads()).map((t) =>
          t.id === threadId
            ? {
                ...t,
                updatedAt: Date.now(),
                messages: [
                  ...t.messages,
                  {
                    role: "tiff" as const,
                    text:
                      "I’m in preview — the model behind me isn’t connected yet. " +
                      `Once it is, I’ll answer questions like this from the knowledge base (${docs.length} documents across install procedures, fault codes, specs and SOPs). ` +
                      "This thread is saved on this device, so it’ll be here when I come online.",
                    at: Date.now(),
                  },
                ],
              }
            : t
        );
        try {
          localStorage.setItem(STORE_KEY, JSON.stringify(next));
        } catch {}
        return next;
      });
    }, 1100);
  };

  const send = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || thinking) return;
    const msg: Msg = { role: "user", text: trimmed, at: Date.now() };
    let threadId = activeId;
    let next: Thread[];
    if (active) {
      next = threads.map((t) =>
        t.id === active.id ? { ...t, updatedAt: msg.at, messages: [...t.messages, msg] } : t
      );
    } else {
      threadId = `t-${msg.at.toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
      const title = trimmed.length > 52 ? trimmed.slice(0, 52).trimEnd() + "…" : trimmed;
      next = [{ id: threadId, title, updatedAt: msg.at, messages: [msg] }, ...threads];
      setActiveId(threadId);
    }
    persist(next);
    setInput("");
    replyTo(threadId!);
  };

  const pickSuggestion = (s: (typeof SUGGESTIONS)[number]) => {
    setInput(`${s.title}. ${s.desc}`);
    inputRef.current?.focus();
  };

  const newChat = () => {
    setActiveId(null);
    setInput("");
    inputRef.current?.focus();
  };

  const recent = [...threads].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 8);

  return (
    <div className="page in">
      <div className="tiff">
        <div className="tmain">
          {active ? (
            <>
              <div className="tchathead">
                <span className="tb2">
                  <Icon name="bot" size={22} />
                </span>
                <div className="tcht">
                  <b>{active.title}</b>
                  <em>Tiff AI &middot; preview</em>
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
                    <div className="tmb">{m.text}</div>
                  </div>
                ))}
                {thinking && (
                  <div className="tmsg bot">
                    <span className="tmav">
                      <Icon name="bot" size={18} />
                    </span>
                    <div className="tmb ttyping">
                      <i></i>
                      <i></i>
                      <i></i>
                    </div>
                  </div>
                )}
              </div>
            </>
          ) : (
            <>
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
                      Tiff AI &middot; Preview
                    </div>
                    <h2>What are we building today?</h2>
                    <p className="tl">
                      Ask about system sizing, diagnostics, fault codes or company SOPs.
                      I&rsquo;ll answer from your <b>knowledge base</b> once I&rsquo;m connected.
                    </p>
                  </div>
                </div>
              </div>
              <div className="tsgrid stgp">
                {SUGGESTIONS.map((s) => (
                  <button key={s.cat} className="tsugg" onClick={() => pickSuggestion(s)}>
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
          )}

          <form
            className="tinput"
            onSubmit={(e) => {
              e.preventDefault();
              send(input);
            }}
          >
            <div className="tib"></div>
            <div className="tin">
              <div className="tic">
                <Icon name="sparkles" size={20} />
              </div>
              <input
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Message Tiff AI..."
              />
              <button className="tsend" type="submit" aria-label="Send">
                <Icon name="send" size={18} />
              </button>
            </div>
          </form>
        </div>

        <div className="tside">
          <div>
            <div className="tsl">
              <span>Knowledge Base</span>
              <Link href="/dashboard/tiff/knowledge">View all</Link>
            </div>
            {KB_CATEGORIES.map((c) => (
              <Link key={c.key} href="/dashboard/tiff/knowledge" className="kbrow">
                <span className="kd" style={{ background: c.color }}></span>
                <span className="kl">{c.label}</span>
                <span className="kc" style={{ color: c.color }}>
                  {counts[c.key]}
                </span>
              </Link>
            ))}
          </div>
          <div className="tdiv"></div>
          <div>
            <div className="tsl">
              <span>Recent Threads</span>
              {recent.length > 0 && <button onClick={newChat}>New</button>}
            </div>
            {recent.length === 0 ? (
              <div style={{ padding: "40px 16px", textAlign: "center" }}>
                <b style={{ display: "block", fontSize: 14, fontWeight: 700, color: "#9ca3af" }}>
                  Nothing to see here
                </b>
                <em
                  style={{
                    fontStyle: "normal",
                    display: "block",
                    fontSize: 12.5,
                    color: "#d1d5db",
                    marginTop: 4,
                  }}
                >
                  Your conversations will show up here.
                </em>
              </div>
            ) : (
              recent.map((t) => (
                <button
                  key={t.id}
                  className={`thread${t.id === activeId ? " on" : ""}`}
                  onClick={() => setActiveId(t.id)}
                >
                  <div className="th">
                    <b>{t.title}</b>
                  </div>
                  <em>{ago(t.updatedAt)}</em>
                </button>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
