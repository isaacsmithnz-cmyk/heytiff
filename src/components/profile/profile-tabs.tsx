"use client";

import { Icon } from "@/components/shell/icon";
import type { SectionKey } from "./types";

export type NavItem = { key: SectionKey; label: string; admin?: boolean };

/* The section strip across the top of the card.

   It was a column of icon rows down the left. Horizontal buys the panel the
   card's whole width, which is what makes a two-up read view fit.

   IT WRAPS, IT DOES NOT SCROLL. `.prof` caps the card at 1320px, so the strip
   has ~920px however wide the monitor is — ten labels never fit on one line on
   any screen. A scroller would therefore hide Payroll and Notes from every
   admin, permanently, behind a gesture with no affordance. Wrapping shows the
   lot. The labels carry no icons for the same reason: it is 24px a tab spent
   on decoration next to a word that already says it.

   The amber dot is the tab's half of the completeness model: a section shows
   one when it is holding a field the checklist above is still asking for, so
   the strip and the ring can never disagree. Admin-only sections keep their
   divider and their lock; they are omitted entirely, never disabled, so a tab
   appearing here means the viewer may open it. */
export function ProfileTabs({
  items,
  active,
  attention,
  onGo,
}: {
  items: NavItem[];
  active: SectionKey;
  /** sections holding a missing field */
  attention: ReadonlySet<string>;
  onGo: (key: SectionKey) => void;
}) {
  const mains = items.filter((n) => !n.admin);
  const admins = items.filter((n) => n.admin);

  return (
    <div className="pftabs" role="tablist" aria-label="Profile sections">
      {mains.map((n) => (
        <Tab key={n.key} item={n} active={active} attention={attention} onGo={onGo} />
      ))}
      {admins.length > 0 && (
        <>
          <span className="pftabbreak" aria-hidden="true" />
          <span className="pftabgl">Admin only</span>
          {admins.map((n) => (
            <Tab key={n.key} item={n} active={active} attention={attention} onGo={onGo} />
          ))}
        </>
      )}
    </div>
  );
}

function Tab({
  item,
  active,
  attention,
  onGo,
}: {
  item: NavItem;
  active: SectionKey;
  attention: ReadonlySet<string>;
  onGo: (key: SectionKey) => void;
}) {
  const on = item.key === active;
  const flagged = attention.has(item.key);
  return (
    <button
      type="button"
      role="tab"
      id={`pftab-${item.key}`}
      aria-selected={on}
      aria-controls={`psec-${item.key}`}
      // only the selected tab is in the tab order; the arrow keys move between
      // them, which is what a tablist is supposed to do
      tabIndex={on ? 0 : -1}
      className={`pftab${item.admin ? " adminrow" : ""}${on ? " on" : ""}`}
      data-psec={item.key}
      onClick={() => onGo(item.key)}
      onKeyDown={(e) => moveFocus(e)}
    >
      {item.label}
      {item.admin && (
        <span className="lock">
          <Icon name="lock" size={13} />
        </span>
      )}
      {flagged && (
        <>
          <i className="attn" aria-hidden="true" />
          <span className="sr-only"> — details missing</span>
        </>
      )}
    </button>
  );
}

/** Left/right (and Home/End) walk the strip, as a tablist should. */
function moveFocus(e: React.KeyboardEvent<HTMLButtonElement>) {
  const keys = ["ArrowLeft", "ArrowRight", "Home", "End"];
  if (!keys.includes(e.key)) return;
  const strip = e.currentTarget.closest(".pftabs");
  if (!strip) return;
  const tabs = [...strip.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
  const i = tabs.indexOf(e.currentTarget);
  if (i < 0) return;
  e.preventDefault();
  const next =
    e.key === "Home"
      ? 0
      : e.key === "End"
        ? tabs.length - 1
        : (i + (e.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
  tabs[next].focus();
}
