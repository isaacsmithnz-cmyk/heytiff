"use client";

/* Shared UI primitives for the Rate Calculator workspace.
   All numbers come from the engine; these components only present. */

import React from "react";
import { iconSvg } from "@/components/shell/icon";
import { RC } from "./theme";

// ── Health pill colours — fg palette ────────────────────────────────────
export const HEALTH_COLORS: Record<string, { fg: string; bg: string; dot: string }> = {
  danger:  { fg: RC.redInk,   bg: RC.redSoft,     dot: RC.red },
  warning: { fg: RC.amberInk, bg: RC.amberSoft,   dot: RC.amber },
  success: { fg: "#00745F",   bg: RC.serviceSoft, dot: RC.service },
  neutral: { fg: RC.ink2,     bg: RC.bg,          dot: RC.faint },
};

// ── Primitives ──────────────────────────────────────────────────────────
// Lucide icon from the shell registry, usable inline in React.
export function RcIcon({ name, size = 16, sw, style }: {
  name: string; size?: number; sw?: number; style?: React.CSSProperties;
}) {
  return <span style={{ display: "inline-flex", flexShrink: 0, ...style }} dangerouslySetInnerHTML={{ __html: iconSvg(name, size, sw) }} />;
}

// Micro-eyebrow — studio vocabulary (10px, 800, .07em tracked caps)
export function WsEyebrow({ children, color, style = {} }: {
  children: React.ReactNode; color?: string; style?: React.CSSProperties;
}) {
  return <div style={{ fontFamily: RC.head, fontWeight: 800, fontSize: 10, letterSpacing: "0.07em", textTransform: "uppercase", color: color || RC.faint, ...style }}>{children}</div>;
}

// Segmented toggle — timesheets .ptabs vocabulary (gray well, white active pill)
export function WsToggle({ value, onChange, options = ["Simple", "Detailed"] }: {
  value: string; onChange: (v: string) => void; options?: string[];
}) {
  return (
    <div style={{ display: "flex", gap: 3, background: "#ECEEF1", borderRadius: 11, padding: 3 }}>
      {options.map(o => {
        const on = value === o;
        return (
          <button key={o} onClick={() => onChange(o)} style={{ fontSize: 12.5, fontWeight: 700, padding: "7px 15px", borderRadius: 8, border: "none", cursor: "pointer", fontFamily: RC.body, background: on ? "#fff" : "transparent", color: on ? RC.ink : RC.label, boxShadow: on ? "0 3px 8px -3px rgba(10,12,20,0.28)" : "none", transition: "all .2s" }}>{o}</button>
        );
      })}
    </div>
  );
}

export function WsSlider({ value, min, max, step = 1, onChange, color = RC.install }: {
  value: number; min: number; max: number; step?: number; onChange: (v: number) => void; color?: string;
}) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div style={{ position: "relative", height: 22, display: "flex", alignItems: "center" }}>
      <div style={{ position: "absolute", left: 0, right: 0, height: 6, borderRadius: 4, background: "#ECEEF1" }} />
      <div style={{ position: "absolute", left: 0, width: `${pct}%`, height: 6, borderRadius: 4, background: color }} />
      <div style={{ position: "absolute", left: `calc(${pct}% - 10px)`, width: 20, height: 20, borderRadius: "50%", background: "#fff", border: `3px solid ${color}`, boxShadow: "0 1px 5px rgba(10,12,20,0.2)", pointerEvents: "none" }} />
      <input type="range" min={min} max={max} step={step} value={value} onChange={e => onChange(parseFloat(e.target.value))}
        style={{ position: "absolute", left: 0, right: 0, width: "100%", margin: 0, opacity: 0, height: 22, cursor: "pointer" }} />
    </div>
  );
}

export function NumInput({ value, onChange, w = "100%", size = 22, prefix = "$" }: {
  value: number; onChange: (v: number) => void; w?: number | string; size?: number; prefix?: string;
}) {
  // Local text buffer while focused so partial entries like "42." survive typing.
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState("");
  const formatted = Number.isInteger(value) ? value.toLocaleString() : String(value);
  const display = editing ? draft : formatted;
  return (
    <div style={{ display: "inline-flex", alignItems: "baseline", gap: 2, background: RC.card2, borderRadius: 10, padding: "8px 12px", border: `1px solid ${RC.lineStrong}`, width: w, boxSizing: "border-box" }}>
      {prefix && <span style={{ fontSize: 13, color: RC.faint, fontWeight: 600 }}>{prefix}</span>}
      <input value={display}
        onFocus={() => { setEditing(true); setDraft(value ? String(value) : ""); }}
        onBlur={() => setEditing(false)}
        onChange={e => {
          let raw = e.target.value.replace(/[^0-9.]/g, "");
          const parts = raw.split(".");
          if (parts.length > 2) raw = parts[0] + "." + parts.slice(1).join("");
          setDraft(raw);
          const n = parseFloat(raw);
          onChange(isNaN(n) ? 0 : n);
        }}
        style={{ border: "none", background: "transparent", outline: "none", fontFamily: RC.head, fontWeight: 800, fontSize: size, letterSpacing: "-0.01em", color: RC.ink, width: "100%", padding: 0 }} />
    </div>
  );
}

// Dismissible mode-helper note. Close (✕) collapses to a "How this works" info
// chip; "Don't show again" also remembers for the session (chip stays available).
const rcNoteStore: Record<string, boolean> = {};

export function WsInfoGlyph({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" style={{ flexShrink: 0, marginTop: 2 }}>
      <circle cx="12" cy="12" r="10"></circle><path d="M12 16v-5"></path><path d="M12 8h.01"></path>
    </svg>
  );
}

export function WsHelpNote({ id, children, style = {} }: {
  id: string; children: React.ReactNode; style?: React.CSSProperties;
}) {
  const [open, setOpen] = React.useState(!rcNoteStore[id]);
  if (!open) return (
    <div style={{ ...style }}>
      <button onClick={() => setOpen(true)} title="Show help"
        style={{ display: "inline-flex", alignItems: "center", gap: 6, border: `1px solid ${RC.lineStrong}`, background: "#fff", color: RC.label, borderRadius: 100, padding: "4px 11px 4px 8px", fontFamily: RC.body, fontSize: 11.5, fontWeight: 700, cursor: "pointer", boxShadow: "0 1px 2px rgba(10,12,20,.04)" }}>
        <span style={{ display: "flex", marginTop: -2 }}><WsInfoGlyph size={13} /></span> How this works
      </button>
    </div>
  );
  return (
    <div style={{ background: RC.installSoft, borderRadius: 12, padding: "12px 16px", fontSize: 12.5, color: "#1D4FD7", lineHeight: 1.55, display: "flex", gap: 9, alignItems: "flex-start", ...style }}>
      <WsInfoGlyph />
      <span style={{ flex: 1 }}>{children}</span>
      <span style={{ display: "flex", alignItems: "center", gap: 12, flexShrink: 0, marginLeft: 8, marginTop: 2 }}>
        <button onClick={() => { rcNoteStore[id] = true; setOpen(false); }} style={{ border: "none", background: "transparent", color: "#1D4FD7", opacity: .7, fontSize: 11.5, fontWeight: 700, cursor: "pointer", textDecoration: "underline", fontFamily: RC.body, padding: 0, whiteSpace: "nowrap" }}>Don&apos;t show again</button>
        <button onClick={() => setOpen(false)} title="Close" style={{ border: "none", background: "transparent", color: "#1D4FD7", cursor: "pointer", padding: 0, display: "flex", opacity: .8 }}><RcIcon name="x" size={13} /></button>
      </span>
    </div>
  );
}

// Section card shell (shared by Insights / EOFY / Business summary)
export function InsightCard({ title, sub, accent, children, right }: {
  title: React.ReactNode; sub?: React.ReactNode; accent?: string;
  children: React.ReactNode; right?: React.ReactNode;
}) {
  return (
    <div style={{ background: "#fff", borderRadius: 16, border: `1px solid ${RC.line}`, boxShadow: "0 8px 30px rgba(0,0,0,.03)", overflow: "hidden" }}>
      <div style={{ padding: "14px 20px", borderBottom: `1px solid ${RC.line}`, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <div>
          <div style={{ fontFamily: RC.head, fontWeight: 800, fontSize: 14.5, letterSpacing: "-0.01em", color: accent || RC.ink }}>{title}</div>
          {sub && <div style={{ fontSize: 11.5, color: RC.faint, marginTop: 1 }}>{sub}</div>}
        </div>
        {right}
      </div>
      <div style={{ padding: "16px 20px" }}>{children}</div>
    </div>
  );
}

// ── Question stack — one question at a time within a step ───────────────
// Questions are revealed sequentially: the current question shows a Next
// button (enabled once answered); clicking it reveals the next question
// BELOW while the answered ones stay visible — and editable — above.
// `revealed` is a high-water mark local to the step (the stack remounts on
// step change via the page's key={step} wrapper), initialised at the first
// unanswered question so partially-saved orgs resume mid-stack and complete
// ones show everything.

export interface StackQuestion {
  id: string;
  title: string;
  hint?: string;
  /** Live answer state — drives the ✓ chip and enables Next. */
  answered: boolean;
  /** Card content; a function receives `advance` so a choice inside the body
      (e.g. a Yes button) can reveal the next question itself. */
  body: React.ReactNode | ((advance: () => void) => React.ReactNode);
  /** Label override for this question's Next button. */
  nextLabel?: string;
  /** Hide this question's Next button (its body advances the stack itself). */
  hideNext?: boolean;
}

export function QuestionStack({ questions, revealAll = false, stageFromTop = false }: {
  questions: StackQuestion[];
  /** Skip staging entirely — returning users see the whole stack at once. */
  revealAll?: boolean;
  /** Stage from the first question even when all are default-answered
      (Risk/Profit — every question is valid on defaults). */
  stageFromTop?: boolean;
}) {
  const firstUnanswered = questions.findIndex(q => !q.answered);
  const [revealed, setRevealed] = React.useState(() =>
    revealAll ? questions.length - 1
    : stageFromTop ? 0
    : firstUnanswered === -1 ? questions.length - 1 : firstUnanswered);
  const wrapRef = React.useRef<HTMLDivElement>(null);
  const advance = () => setRevealed(r => Math.min(questions.length - 1, r + 1));
  // Bring a newly revealed question into view (skip the mount render so
  // resumed/expanded stacks open at the top of the page).
  const mounted = React.useRef(false);
  React.useEffect(() => {
    if (!mounted.current) { mounted.current = true; return; }
    try { wrapRef.current?.lastElementChild?.scrollIntoView({ behavior: "smooth", block: "nearest" }); } catch { /* jsdom */ }
  }, [revealed]);
  const complete = revealed >= questions.length - 1 && questions[questions.length - 1]?.answered;
  return (
    <div ref={wrapRef} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {questions.slice(0, revealed + 1).map((q, i) => {
        const cur = i === revealed && !complete;
        const done = q.answered && !cur;
        return (
          <div key={q.id} className="rca-q" style={{ background: "#fff", borderRadius: 16, border: cur ? `1.5px solid ${RC.install}` : `1px solid ${RC.line}`, boxShadow: cur ? `0 0 0 4px ${RC.installSoft}, 0 8px 30px rgba(0,0,0,.04)` : "0 8px 30px rgba(0,0,0,.03)", padding: "16px 20px 18px", transition: "border-color .25s, box-shadow .25s" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
              <span style={{ width: 24, height: 24, borderRadius: "50%", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: RC.head, fontWeight: 800, fontSize: 11.5, background: done ? RC.service : cur ? RC.install : RC.card2, color: done || cur ? "#fff" : RC.faint, transition: "background .25s" }}>{done ? "✓" : i + 1}</span>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontFamily: RC.head, fontWeight: 800, fontSize: 14.5, letterSpacing: "-0.01em", color: RC.ink }}>{q.title}</div>
                {q.hint && <div style={{ fontSize: 11.5, color: RC.faint, marginTop: 1 }}>{q.hint}</div>}
              </div>
            </div>
            {typeof q.body === "function" ? q.body(advance) : q.body}
            {i === revealed && i < questions.length - 1 && !q.hideNext && (
              <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 14 }}>
                <button className="rca-btn primary sm" disabled={!q.answered} onClick={advance}>{q.nextLabel ?? "Next →"}</button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
