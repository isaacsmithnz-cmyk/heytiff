"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon } from "./icon";
import { actionRequiredItems } from "@/app/actions/action-required";
import { GROUP_ICON, chipGroup, type ActionChip } from "@/lib/dashboard/chips";

/* THE BELL, AND WHAT IT OPENS.

   It shipped as a `<button>` with no handler wearing a teal dot that pulsed on
   every screen forever — the CSS drew the dot unconditionally, so it never
   meant anything and could never stop meaning it. It became a LINK to
   /dashboard/action-required, which fixed the badge but bought a new problem:
   the only way to find out whether the number was worth caring about was to
   abandon the screen you were on. Notifications are an interruption you glance
   at; a whole route is one you commit to.

   So the list grows down out of the bell instead — the same dark glass as the
   user menu two controls to the right, absolutely positioned inside a relative
   wrapper rather than `fixed`, because the `.page.in` will-change trap breaks
   `position:fixed` in this shell. It is a plain popover with NO scrim: a scrim
   would put a body-portalled layer over `.fg`, which traps everything under it,
   and there is nothing here worth blocking the page for.

   The board at /dashboard/action-required is still there and still the whole
   truth — the panel caps at PANEL_CAP rows and says so, and the footer is the
   way through to the rest. That link is absent when nothing was cut: a "see
   all" under a list that already IS all is a lie about there being more. */

/** How many rows the panel will draw before it stops and points at the board. */
const PANEL_CAP = 20;

function panelLabel(count: number | null): string {
  if (count === null) return "What needs you";
  if (count === 0) return "Nothing needs you";
  return `${count} ${count === 1 ? "thing needs" : "things need"} you`;
}

export function Bell() {
  const [items, setItems] = useState<ActionChip[] | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const pathname = usePathname();

  /* Same trick as the user menu: store the route the panel was opened on
     rather than a plain boolean, so navigating away closes it by construction
     — no setState-in-effect, and clicking a row inside it closes the panel it
     was clicked from. */
  const [openedAt, setOpenedAt] = useState<string | null>(null);
  const open = openedAt === pathname;

  useEffect(() => {
    let live = true;
    actionRequiredItems()
      .then((rows) => {
        if (live) setItems(rows);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpenedAt(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpenedAt(null);
    };
    document.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const count = items === null ? null : items.length;
  const label = panelLabel(count);
  return (
    <div className="bell-top" ref={wrapRef}>
      <button
        className={`bell${open ? " on" : ""}`}
        type="button"
        onClick={() => setOpenedAt((o) => (o === pathname ? null : pathname))}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={label}
        title={label}
      >
        <Icon name="bell" size={20} />
        {/* `.d` is a COUNT and only renders when there is something to count,
            so it no longer pulses: a number that is present at all is already
            the signal, and an animation that ran forever was what made the old
            dot invisible. A failed read leaves it silent rather than guessing. */}
        {count !== null && count > 0 && (
          <span className="d" aria-hidden="true">
            {count > 9 ? "9+" : count}
          </span>
        )}
      </button>

      {open && (
        <BellPanel items={items} label={label} onLeave={() => setOpenedAt(null)} />
      )}
    </div>
  );
}

/* The panel itself, split out with no state of its own so it can be rendered
   against the real stylesheet at the real font by an inert harness route —
   jest ignores CSS entirely, and a 360px popover that scrolls is exactly the
   kind of thing that is only ever wrong on screen. */
export function BellPanel({
  items,
  label,
  onLeave,
}: {
  items: ActionChip[] | null;
  label: string;
  onLeave: () => void;
}) {
  const count = items?.length ?? 0;
  const shown = items?.slice(0, PANEL_CAP) ?? [];
  const cut = count - shown.length;

  return (
    <div className="bell-panel" role="dialog" aria-label={label}>
      <div className="bp-head">
        <b>Needs you</b>
        {count > 0 && <span className="bp-n">{count}</span>}
      </div>

      {items === null ? (
        <div className="bp-quiet">Checking…</div>
      ) : items.length === 0 ? (
        <div className="bp-empty">
          <span className="bp-ei">
            <Icon name="check" size={18} />
          </span>
          <b>Nothing needs you</b>
          <em>Everything is in date and nobody is waiting on an answer.</em>
        </div>
      ) : (
        <div className="bp-list">
          {shown.map((c) => (
            <Link key={c.key} className={`bp-row ${c.state}`} href={c.href} onClick={onLeave}>
              <span className="bp-ic">
                <Icon name={GROUP_ICON[chipGroup(c.kind)]} size={15} />
              </span>
              <span className="bp-main">
                <b>{c.label}</b>
                <em>
                  {c.subject} · {chipGroup(c.kind)}
                </em>
              </span>
              <span className="bp-chev">
                <Icon name="arrowR" size={15} />
              </span>
            </Link>
          ))}
        </div>
      )}

      {/* Present ONLY when rows were actually cut: a "see all" under a list
          that is already all of it is a lie about there being more. */}
      {cut > 0 && (
        <Link className="bp-more" href="/dashboard/action-required" onClick={onLeave}>
          {cut} more on the board
          <Icon name="arrowR" size={14} />
        </Link>
      )}
    </div>
  );
}
