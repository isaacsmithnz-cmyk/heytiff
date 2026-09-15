"use client";

import Link from "next/link";
import type { ViewTab } from "@/components/shell/view-tabs";

/* THE RAIL — the four faces of Home, down the left of the card.

   The faces were a strip of tabs across the card's top (the board's own
   strip, borrowed). The three-room handoff (2026-09-14) stands them in a
   column beside the list they switch, which is where a reading pane wants
   its index: the eye moves right, from the face to the list to the words.

   IT IS AN EDGE, NOT A FILL. A tray is a fill or an edge, never the ground's
   own value (law 1); this one is a hairline on its right and nothing behind
   it, and the active face is the ink tint — selection is a fill (law 14),
   and the fill is the only thing that says which room you are in.

   THE FACTS ON IT ARE THE TAB MODEL'S. `homeTabs()` decides the keys, the
   count, its tone and the debrief's dot; this component only draws them.
   The count is absent at zero (a grey nought is noise), red when it counts
   what is past its date, and its meaning is said in words for anyone who
   cannot see the colour.

   THE TWO DOORS AT ITS FOOT are the glance that used to float in the page
   head and then sat on the strip: what needs attention, and what is unread.
   They are nav, so they stand with the nav — and they are absent at zero,
   because "nothing is past its date" is said by not being here. */

export function HomeRailNav({
  tabs,
  active,
  onGo,
  attention,
  chipsOverdue,
  unread,
  idPrefix = "hmtab",
  panelPrefix = "hmsec",
}: {
  tabs: ViewTab[];
  active: string;
  onGo: (key: string) => void;
  /** Dated things that want you, past and coming, as one number. */
  attention: number;
  /** How many of those are past their date — the number goes red. */
  chipsOverdue: number;
  /** Notices you have not read. */
  unread: number;
  idPrefix?: string;
  panelPrefix?: string;
}) {
  /* Up and down move between faces the way a vertical tablist expects;
     focus follows so the next arrow press lands where the reader is. */
  const onKey = (e: React.KeyboardEvent, i: number) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const next = tabs[(i + (e.key === "ArrowDown" ? 1 : tabs.length - 1)) % tabs.length];
    onGo(next.key);
    document.getElementById(`${idPrefix}-${next.key}`)?.focus();
  };

  return (
    <nav className="hm-rail" aria-label="Home">
      <div className="hm-railtabs" role="tablist" aria-orientation="vertical" aria-label="Home">
        {tabs.map((t, i) => {
          const on = t.key === active;
          const count = t.count ?? 0;
          return (
            <button
              key={t.key}
              type="button"
              role="tab"
              id={`${idPrefix}-${t.key}`}
              className={"hm-rl" + (on ? " on" : "")}
              aria-selected={on}
              aria-controls={`${panelPrefix}-${t.key}`}
              tabIndex={on ? 0 : -1}
              onClick={() => onGo(t.key)}
              onKeyDown={(e) => onKey(e, i)}
            >
              {t.label}
              {count > 0 && (
                <span
                  className={
                    "hm-rln" + (t.tone === "dan" ? " bad" : t.tone === "warn" ? " warn" : "")
                  }
                  aria-label={t.countLabel ? t.countLabel(count) : `${count}`}
                >
                  {count}
                </span>
              )}
              {count === 0 && t.dot && (
                /* NOT a count — a state. The debrief is had or it isn't. */
                <span className="hm-rldot" role="img" aria-label={t.dotLabel} />
              )}
            </button>
          );
        })}
      </div>

      {(attention > 0 || unread > 0) && (
        <>
          <hr />
          <div className="hm-raildoors" aria-label="Needs you">
            {attention > 0 && (
              <Link
                className="hm-rl"
                href="/dashboard/action-required"
                aria-label={`Action required, ${attention} need${attention === 1 ? "s" : ""} attention`}
              >
                Action required
                {/* THE SEVERITY IS ON THE NUMBER'S COLOUR. Anything past its
                    date makes it red, because red on this app means something
                    is wrong; otherwise amber, which is "closing in". */}
                <span className={"hm-rln " + (chipsOverdue > 0 ? "bad" : "warn")} aria-hidden="true">
                  {attention}
                </span>
              </Link>
            )}
            {unread > 0 && (
              <Link
                className="hm-rl"
                href="/dashboard/notices"
                aria-label={`Noticeboard, ${unread} unread`}
              >
                Noticeboard
                <span className="hm-rln" aria-hidden="true">
                  {unread}
                </span>
              </Link>
            )}
          </div>
        </>
      )}
    </nav>
  );
}
