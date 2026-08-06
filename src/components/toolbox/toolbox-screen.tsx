"use client";

/* Toolbox screen — the four category cards + live search.

   Styling is deliberately self-scoped (.tbx2-* in toolbox.css) rather than
   reusing shell.css's .cat/.ctop card: that older pattern (40px radius, 6px
   coloured cap) is still shared with the Tiff AI knowledge screen, so the
   toolbox carries its own premium variant — flat white card, 24px radius,
   accent living in the icon chip and the row hover instead of a top stripe. */

import { useState } from "react";
import Link from "next/link";
import { Icon } from "@/components/shell/icon";
import { BADGE_COLORS, TOOL_CATEGORIES, toolBadge, toolMatches, type Tool, type ToolCategory } from "./tools";
import "./toolbox.css";

function ToolRow({ tool, today }: { tool: Tool; today: string }) {
  /* Derived, never stored: "New" ages out of its own accord (see toolBadge),
     so no row can wear one indefinitely the way all four used to. */
  const name = toolBadge(tool, today);
  const badge = name ? BADGE_COLORS[name] : null;
  return (
    <Link href={tool.href} className="tbx2-row">
      <span className="nm">
        <b>{tool.name}</b>
        <em>{tool.desc}</em>
      </span>
      {badge && name && (
        <span className="bg" style={{ background: badge[0], color: badge[1] }}>
          {name}
        </span>
      )}
      <span className="ch">
        <Icon name="chevR" size={16} />
      </span>
    </Link>
  );
}

function CategoryCard({ cat, query, today }: { cat: ToolCategory; query: string; today: string }) {
  const visible = cat.tools.filter((t) => toolMatches(t, query));
  const searching = query.trim().length > 0;
  /* while searching, drop cards with nothing to show */
  if (searching && visible.length === 0) return null;
  return (
    <div
      className="tbx2-card spot"
      style={
        {
          "--ac": cat.accent,
          "--sc": cat.accent + "1a",
          "--rowbg": cat.accent + "0f",
        } as React.CSSProperties
      }
    >
      <span className="sglow" />
      <span className="tbx2-wash" />
      <div className="tbx2-head">
        <span className="tbx2-ic">
          <Icon name={cat.icon} size={24} />
        </span>
        <span className="tbx2-ht">
          <b>{cat.title}</b>
          <em>{cat.sub}</em>
        </span>
        {visible.length > 0 && <span className="tbx2-count">{visible.length}</span>}
      </div>
      {visible.length > 0 ? (
        <div className="tbx2-rows">
          {visible.map((t) => (
            <ToolRow key={t.href} tool={t} today={today} />
          ))}
        </div>
      ) : (
        <div className="tbx2-empty">Nothing here yet</div>
      )}
    </div>
  );
}

/* `today` arrives from the server page rather than `new Date()` here: this
   renders on a phone in a van that may be set to anything, and the badge has to
   age out on the yard's calendar, not the handset's. */
export function ToolboxScreen({ today }: { today: string }) {
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
          <div className="tbx2-grid stgp">
            {TOOL_CATEGORIES.map((c) => (
              <CategoryCard key={c.key} cat={c} query={query} today={today} />
            ))}
          </div>
        ) : (
          <div className="tbx2-noresult">No tools match “{query.trim()}”</div>
        )}
      </div>
    </div>
  );
}
