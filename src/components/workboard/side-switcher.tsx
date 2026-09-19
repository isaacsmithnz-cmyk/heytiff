"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/shell/icon";

/* THE TITLE IS THE SWITCHER (Isaac, 2026-09-20, after the six ways were drawn
   side by side at 1440: "go with 1, the title switcher").

   The switcher spent a release on a line of its own above the band, which
   cost 48px of board on every tab — a whole crew row — and said "Workboard"
   twice, since the rail one column to the left already names the screen. So
   the band's title says which half of the book you are reading, and opens a
   menu to change it: All jobs, Projects, Maintenance.

   WHAT THE OLD SEATS DID AND THIS HAS TO KEEP. Each side carried its own
   count at all times — a summons you could see from any side. A menu hides
   them, so the arrow wears a dot in the worst tone of the OTHER sides, and
   the menu says which side and how many in words. A side with nothing
   waiting says nothing: a zero is not a count.

   An ARIA menu, and it keeps the promise: arrows move, Home and End jump,
   Escape closes and hands focus back, and a click anywhere else closes it. */

export type SideBadge = { n: number; tone: "dan" | "wrn" | "clr" } | null;
export type SideChoice<K extends string> = { key: K; label: string; badge: SideBadge };

/** One switcher is on screen at a time, so the title can carry a stable id —
    which is how focus finds the new one after a side swap (see `close`). */
const SWITCH_ID = "wb2-side-switch";

/** The tone a side's count is said in — `clr` is nothing to say. */
const toneOf = (b: SideBadge) => (b && b.n > 0 ? (b.tone === "dan" ? "dan" : "wrn") : null);

export function SideSwitcher<K extends string>({
  sides,
  value,
  onPick,
}: {
  sides: readonly SideChoice<K>[];
  value: K;
  onPick: (key: K) => void;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const current = sides.find((s) => s.key === value) ?? sides[0];

  /* The dot answers "is anything waiting on a side I am not looking at" —
     the question the seats answered by standing there with their counts. */
  const elsewhere = sides.filter((s) => s.key !== value && (s.badge?.n ?? 0) > 0);
  const dot = elsewhere.some((s) => s.badge?.tone === "dan") ? "dan" : elsewhere.length ? "wrn" : null;
  const summons = elsewhere
    .map((s) => `${s.label} ${s.badge!.n === 1 ? "needs" : "need"} you`)
    .join(", ");

  const close = (toButton = true) => {
    setOpen(false);
    if (!toButton) return;
    /* CHOOSING A SIDE SWAPS THE WHOLE BOARD, and the board is what renders
       this title — so by the time the menu closes, this button has unmounted
       with the side it belonged to and the new one is a different element.
       Focusing the ref would put focus on a node that has left the document,
       which drops a keyboard user on <body>. So the button carries a stable
       id and the focus is taken after the swap; the ref is the fallback for
       the closes that change nothing (Escape, or picking the side you are
       already on). */
    queueMicrotask(() => {
      const fresh = document.getElementById(SWITCH_ID) as HTMLButtonElement | null;
      (fresh ?? btnRef.current)?.focus();
    });
  };

  /* A click outside closes it. Pointerdown rather than click, so the press
     that lands on the board closes the menu before the board reads it. */
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    /* Escape belongs to the DOCUMENT, not to the items: the menu can be open
       with focus still on the title (a mouse opened it), and Escape has to
       shut it from there too. */
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      close();
    };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", key);
    };
  }, [open]);

  /* Opening from the keyboard lands on the side you are on, not on the first.
     The focus is taken in an effect rather than in the handler, because the
     item it wants does not exist until the menu has rendered. */
  const wanted = useRef<number | null>(null);
  useEffect(() => {
    if (!open || wanted.current === null) return;
    itemRefs.current[wanted.current]?.focus();
    wanted.current = null;
  }, [open]);
  const openMenu = (focusIndex: number) => {
    wanted.current = focusIndex;
    setOpen(true);
  };
  const here = Math.max(0, sides.findIndex((s) => s.key === value));

  const onButtonKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      openMenu(here);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      openMenu(sides.length - 1);
    }
  };

  const onItemKey = (e: React.KeyboardEvent, i: number) => {
    const go = (n: number) => {
      e.preventDefault();
      itemRefs.current[(n + sides.length) % sides.length]?.focus();
    };
    if (e.key === "ArrowDown") go(i + 1);
    else if (e.key === "ArrowUp") go(i - 1);
    else if (e.key === "Home") go(0);
    else if (e.key === "End") go(sides.length - 1);
    else if (e.key === "Tab") close(false);
  };

  return (
    <div className="wb2-sw" ref={wrapRef}>
      {/* the rail names the screen; the title names the side. A screen reader
          gets both, so the page still announces where it is. */}
      <h1 className="wb2-h1">
        <span className="sr-only">Workboard, </span>
        <button
          type="button"
          id={SWITCH_ID}
          ref={btnRef}
          className="wb2-ttl"
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => (open ? close(false) : setOpen(true))}
          onKeyDown={onButtonKey}
        >
          {current.label}
          <span className="wb2-ttlc" aria-hidden="true">
            <Icon name="chevD" size={18} />
            {dot && <i className={`wb2-ttldot ${dot}`} />}
          </span>
          {summons && <span className="sr-only">, {summons}</span>}
        </button>
      </h1>

      {/* the row menu's own dress — paper, the one hairline, the card corner
          and the one overlay shadow — hung under the title instead */}
      {open && (
        <div className="dmenu open wb2-ttlmenu" role="menu" aria-label="Which work">
          {sides.map((s, i) => {
            const on = s.key === value;
            const tone = toneOf(s.badge);
            return (
              <button
                key={s.key}
                type="button"
                role="menuitemradio"
                aria-checked={on}
                ref={(el) => {
                  itemRefs.current[i] = el;
                }}
                className={"wb2-ttlmi" + (on ? " on" : "")}
                onClick={() => {
                  onPick(s.key);
                  close();
                }}
                onKeyDown={(e) => onItemKey(e, i)}
              >
                <span className="wb2-ttlck" aria-hidden="true">
                  {on && <Icon name="check" size={16} />}
                </span>
                <span className="wb2-ttlml">{s.label}</span>
                {tone && (
                  <span className={`wb2-ttlmn ${tone}`}>
                    {s.badge!.n} {s.badge!.n === 1 ? "needs" : "need"} you
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
