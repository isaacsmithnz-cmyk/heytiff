"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "./icon";
import { NAV } from "./nav";

export function CommandPalette({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [sel, setSel] = useState(0);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    return NAV.filter(
      (n) => !q || `${n.label} ${n.hint}`.toLowerCase().includes(q)
    );
  }, [query]);

  // reset + focus when opened
  useEffect(() => {
    if (open) {
      setQuery("");
      setSel(0);
      const t = setTimeout(() => inputRef.current?.focus(), 40);
      return () => clearTimeout(t);
    }
  }, [open]);

  // keep selection in range as results change
  useEffect(() => {
    setSel((s) => (results.length ? Math.min(s, results.length - 1) : 0));
  }, [results.length]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        if (results.length) setSel((s) => (s + 1) % results.length);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        if (results.length) setSel((s) => (s - 1 + results.length) % results.length);
      } else if (e.key === "Enter") {
        e.preventDefault();
        const item = results[sel];
        if (item) run(item.href);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, results, sel, onClose]);

  function run(href: string) {
    onClose();
    router.push(href);
  }

  return (
    <div className={`fg-cmd${open ? " open" : ""}`} id="fg-cmd">
      <div className="ov" onClick={onClose} />
      <div className="box">
        <div className="glow" />
        <div className="cin">
          <span className="ci">
            <Icon name="search" size={20} />
          </span>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSel(0);
            }}
            placeholder="Search screens, tools, or actions..."
            autoComplete="off"
          />
          <kbd className="esc">ESC</kbd>
        </div>

        <div className="clist no-sb" id="fg-cmd-list">
          {results.length === 0 ? (
            <div className="cempty">
              <b>No results for &quot;{query}&quot;</b>
              <em>Try &quot;team&quot;, &quot;design&quot;, or &quot;admin&quot;</em>
            </div>
          ) : (
            <>
              <div className="cgl">Navigate</div>
              {results.map((c, i) => (
                <button
                  key={c.key}
                  className={`crow${i === sel ? " on" : ""}`}
                  onMouseMove={() => i !== sel && setSel(i)}
                  onClick={() => run(c.href)}
                  type="button"
                >
                  <span className="ci2" style={{ background: `${c.accent}15` }}>
                    <span style={{ color: c.accent, display: "flex" }}>
                      <Icon name={c.icon} size={17} />
                    </span>
                  </span>
                  <span className="ck">
                    <b>{c.label}</b>
                    <em>{c.hint}</em>
                  </span>
                  <span className="cen">
                    <Icon name="cornerDL" size={14} />
                  </span>
                </button>
              ))}
            </>
          )}
        </div>

        <div className="cfoot">
          <div className="cf-l">
            <span style={{ display: "flex" }}>
              <Icon name="arrowUp" size={9} />
              <Icon name="arrowDown" size={9} />
            </span>{" "}
            Navigate ·{" "}
            <span style={{ display: "flex" }}>
              <Icon name="cornerDL" size={9} />
            </span>{" "}
            Select
          </div>
          <div className="cf-r">
            <span style={{ color: "#00E5C0", display: "flex" }}>
              <Icon name="sparkles" size={12} />
            </span>{" "}
            HeyTiff Command
          </div>
        </div>
      </div>
    </div>
  );
}
