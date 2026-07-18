"use client";

/* Toolbox screen — the v3 four-category grid, now a live React component so
   tool rows link to their pages and the search box actually filters. Markup
   classes match the ported static screen exactly (shell.css .tbx-* / .cat /
   .toolrow), so the existing styles + stagger animations apply unchanged. */

import { useState } from "react";
import Link from "next/link";
import { Icon } from "@/components/shell/icon";
import { BADGE_COLORS, TOOL_CATEGORIES, toolMatches, type Tool, type ToolCategory } from "./tools";

/* small inline empty-state hint (matches screens.ts hint()) */
function Hint({ text }: { text: string }) {
  return (
    <div
      style={{
        padding: 22,
        textAlign: "center",
        color: "#9ca3af",
        fontSize: 13,
        fontWeight: 600,
        border: "1.5px dashed #e6e8ee",
        borderRadius: 16,
        background: "linear-gradient(180deg,#fafbfc,#fff)",
      }}
    >
      {text}
    </div>
  );
}

function ToolRow({ tool, accent, first }: { tool: Tool; accent: string; first: boolean }) {
  const badge = tool.badge ? BADGE_COLORS[tool.badge] : null;
  return (
    <Link
      href={tool.href}
      className="toolrow"
      style={{ textDecoration: "none", color: "inherit" }}
    >
      <span className="tdot" style={{ background: first ? accent : "#e5e7eb" }} />
      <div className="tnm">
        <b>{tool.name}</b>
        <em>{tool.desc}</em>
      </div>
      {badge && tool.badge && (
        <span
          className="tbg"
          style={{ background: badge[0], color: badge[1], borderColor: badge[1] + "30" }}
        >
          {tool.badge}
        </span>
      )}
      <span className="tch" style={{ display: "flex" }}>
        <Icon name="chevR" size={18} />
      </span>
    </Link>
  );
}

function CategoryCard({ cat, query }: { cat: ToolCategory; query: string }) {
  const visible = cat.tools.filter((t) => toolMatches(t, query));
  const searching = query.trim().length > 0;
  /* while searching, drop cards with nothing to show */
  if (searching && visible.length === 0) return null;
  return (
    <div className="catwrap">
      <div className="cat spot" style={{ "--sc": cat.accent + "1f" } as React.CSSProperties}>
        <span className="sglow" />
        <div className="ctop" style={{ background: cat.accent }} />
        <div className="cin">
          <div className="chd">
            <div
              className="cic"
              style={{ background: cat.accent + "15", border: `1px solid ${cat.accent}30` }}
            >
              <Icon name={cat.icon} size={24} />
            </div>
            <div>
              <div className="cht">{cat.title}</div>
              <div className="chs">{cat.sub}</div>
            </div>
          </div>
          {visible.length > 0 ? (
            visible.map((t, i) => <ToolRow key={t.href} tool={t} accent={cat.accent} first={i === 0} />)
          ) : (
            <Hint text="No tools yet" />
          )}
        </div>
      </div>
    </div>
  );
}

export function ToolboxScreen() {
  const [query, setQuery] = useState("");
  const anyMatch = TOOL_CATEGORIES.some(
    (c) => c.tools.some((t) => toolMatches(t, query)) || !query.trim()
  );

  return (
    <div className="page in">
      <div className="wrap">
        <div className="tbx-head">
          <div className="stg">
            <h1>Toolbox</h1>
          </div>
          <div className="tbx-search">
            <Icon name="search" size={18} />
            <input
              placeholder="Search tools..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Search tools"
            />
          </div>
        </div>
        {anyMatch ? (
          <div className="tbx-grid stgp">
            {TOOL_CATEGORIES.map((c) => (
              <CategoryCard key={c.key} cat={c} query={query} />
            ))}
          </div>
        ) : (
          <Hint text={`No tools match “${query.trim()}”`} />
        )}
      </div>
    </div>
  );
}
