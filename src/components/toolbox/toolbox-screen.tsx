"use client";

/* Toolbox screen — one uniform tile per tool, a chip row for the categories,
   and live search.

   THE TILE IS THE TOOL. The previous landing gave each CATEGORY a card and
   each tool a row inside it: four tools in three containers, in a 2-column
   grid that could only ever come out ragged — an L-shaped hole bottom-right,
   Reference orphaned on its own row, and the page ending a third of the way
   down the window. Every card spent a 54px gradient chip, a 20px title, a
   subtitle and a count pill reading "1" to introduce a single 15px link.

   Now the grid holds tools, auto-fills, and cannot go ragged; the categories
   are a filter chip apiece. Styling stays self-scoped (.tbx2-* in
   toolbox.css) — shell.css's older .cat/.ctop card is still shared with the
   Tiff AI knowledge screen and must not move. */

import { useState } from "react";
import Link from "next/link";
import { Icon } from "@/components/shell/icon";
import {
  BADGE_COLORS,
  categoryChips,
  toolBadge,
  toolIcon,
  visibleTools,
  type ShelvedTool,
} from "./tools";
import "./toolbox.css";

const ALL = "all";

function ToolTile({ shelved, today }: { shelved: ShelvedTool; today: string }) {
  const { tool, cat } = shelved;
  /* Derived, never stored: "New" ages out of its own accord (see toolBadge),
     so no tile can wear one indefinitely the way all four rows used to. */
  const name = toolBadge(tool, today);
  const badge = name ? BADGE_COLORS[name] : null;
  return (
    <Link href={tool.href} className="tbx2-tile" style={{ "--ac": cat.accent } as React.CSSProperties}>
      <span className="tbx2-ic">
        <Icon name={toolIcon(shelved)} size={26} />
      </span>
      {badge && name && (
        <span className="tbx2-bg" style={{ background: badge[0], color: badge[1] }}>
          {name}
        </span>
      )}
      <span className="tbx2-cat">{cat.title}</span>
      <b>{tool.name}</b>
      <em>{tool.desc}</em>
      <span className="tbx2-go">
        Open
        <Icon name="chevR" size={15} />
      </span>
    </Link>
  );
}

/* `today` arrives from the server page rather than `new Date()` here: this
   renders on a phone in a van that may be set to anything, and the badge has to
   age out on the yard's calendar, not the handset's. */
export function ToolboxScreen({ today }: { today: string }) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState(ALL);

  const chips = categoryChips(query);
  const tiles = visibleTools(query, category);
  /* What the chip row is actually showing, which is not always what was last
     clicked — see `visibleTools`. A search that empties the chosen category
     takes its chip away, so the highlight has to come back to All rather than
     sit on a chip that is no longer in the row. */
  const active = chips.some((c) => c.key === category) ? category : ALL;
  const total = chips.reduce((n, c) => n + c.count, 0);

  return (
    <div className="page in">
      <div className="wrap tbx2-page">
        <div className="tbx-head">
          <div className="stg">
            <h1>
              Toolbox
              {total > 0 && (
                <span className="tbx2-hcount">
                  {total} field {total === 1 ? "tool" : "tools"}
                </span>
              )}
            </h1>
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
        {tiles.length > 0 ? (
          <>
            {/* One chip more than there are categories: All is the way back,
                and without it a filtered screen is a dead end. It is only
                worth its row when there is a choice to make. */}
            {chips.length > 1 && (
              <div className="tbx2-filters" role="group" aria-label="Filter by category">
                <button
                  type="button"
                  className={"tbx2-f" + (active === ALL ? " on" : "")}
                  aria-pressed={active === ALL}
                  onClick={() => setCategory(ALL)}
                >
                  All <i>{total}</i>
                </button>
                {chips.map((c) => (
                  <button
                    key={c.key}
                    type="button"
                    className={"tbx2-f" + (active === c.key ? " on" : "")}
                    aria-pressed={active === c.key}
                    onClick={() => setCategory(c.key)}
                  >
                    {c.title} <i>{c.count}</i>
                  </button>
                ))}
              </div>
            )}
            <div className="tbx2-grid stgp">
              {tiles.map((s) => (
                <ToolTile key={s.tool.href} shelved={s} today={today} />
              ))}
            </div>
          </>
        ) : (
          <div className="tbx2-noresult">No tools match “{query.trim()}”</div>
        )}
      </div>
    </div>
  );
}
