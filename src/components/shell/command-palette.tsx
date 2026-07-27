"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useCommandPalette } from "./command-palette-context";
import { Icon } from "./icon";
import { navFor } from "./nav";
import type { Role } from "@/lib/roles-shared";
import type { Capability } from "@/lib/permissions";

export function CommandPalette({
  role,
  caps,
}: {
  role: Role | null;
  caps: readonly Capability[];
}) {
  /* open/close live in context rather than props — this is a SERVER slot (it
     needs the viewer's capabilities to build the entry list), so it cannot
     receive client state or a callback from the frame around it. */
  const { isOpen: open, close: onClose } = useCommandPalette();
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [selRaw, setSel] = useState(0);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    return navFor({ caps: new Set(caps), role }).filter(
      (n) => !q || `${n.label} ${n.hint}`.toLowerCase().includes(q)
    );
  }, [query, role, caps]);

  /* The highlighted row, clamped as you read it rather than corrected after the
     fact. Typing shortens the list, which can strand the selection past the
     end; an effect that wrote the selection back would render the stale row
     once before fixing it. Derived, it is never wrong for even one frame. */
  const sel = results.length ? Math.min(selRaw, results.length - 1) : 0;

  /* Reopening starts clean. Done while rendering the change rather than in an
     effect: this is state derived from `open`, and an effect would paint the
     previous session's query for a frame first. The palette stays mounted when
     closed (it animates on a class), so without this the old text would still
     be sitting there next time. */
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setQuery("");
      setSel(0);
    }
  }

  // focusing the input is a DOM effect, and stays one
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => inputRef.current?.focus(), 40);
    return () => clearTimeout(t);
  }, [open]);

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
