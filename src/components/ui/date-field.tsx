"use client";

import { forwardRef, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "@/components/shell/icon";
import { formatAuDate, todayInAu } from "@/lib/au-dates";
import { MonthGrid, monthOf } from "./month-grid";

/* Every date in HeyTiff is picked, never typed.

   `<input type="date">` renders a different control in every browser — and on
   a phone, a wheel that answers "what's the date" with whatever the OS locale
   says. dd/mm vs mm/dd is the whole problem: a tradesman entering a rego
   expiry has no way to tell which one he's looking at, and a wrong month is
   silent. So this is a BUTTON that shows dd/mm/yyyy and opens our own
   calendar. There is no text entry anywhere in it — nothing to mis-format.

   Value protocol is ISO yyyy-mm-dd in and out, same as everything else.

   The popover portals to <body>: the shell keeps `will-change` on `.page.in`,
   which makes it the containing block for position:fixed descendants and would
   anchor this to the page instead of the viewport. The `.fg` display:contents
   wrapper carries the frame's custom properties across without re-applying its
   layout (precedent: components/timepay/settings.tsx). */

const POP_W = 300;
/* Enough room to matter, not a measurement: the flip decision only needs to
   know "is there roughly a calendar's worth of space below". When it flips it
   anchors on `bottom`, so the real height never has to be known. */
const POP_H = 340;
const GAP = 6;
const EDGE = 8;

type Anchor = { left: number; top?: number; bottom?: number };

function measure(el: HTMLElement): Anchor {
  const r = el.getBoundingClientRect();
  const left = Math.max(EDGE, Math.min(r.left, window.innerWidth - POP_W - EDGE));
  const below = window.innerHeight - r.bottom;
  if (below < POP_H && r.top > below) return { left, bottom: window.innerHeight - r.top + GAP };
  return { left, top: r.bottom + GAP };
}

export type DateFieldProps = {
  value: string | null;
  onChange: (iso: string | null) => void;
  min?: string;
  max?: string;
  placeholder?: string;
  /** show a Clear action in the popover footer (only when there's a value) */
  clearable?: boolean;
  id?: string;
  disabled?: boolean;
  /** The AU calendar date. Pass the server's day wherever the screen has one —
      the browser clock is a different day for most of the working morning. */
  today?: string;
  /** "lg" matches the fleet modals' taller `.fl-i` controls. */
  size?: "md" | "lg";
};

export const DateField = forwardRef<HTMLButtonElement, DateFieldProps>(function DateField(
  {
    value,
    onChange,
    min,
    max,
    placeholder = "dd/mm/yyyy",
    clearable,
    id,
    disabled,
    today,
    size = "md",
  },
  ref,
) {
  const todayISO = today ?? todayInAu();
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const popRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [month, setMonth] = useState(() => monthOf(value || todayISO));
  const [anchor, setAnchor] = useState<Anchor>({ left: 0, top: 0 });

  const close = () => {
    setOpen(false);
    btnRef.current?.focus();
  };

  const toggle = () => {
    if (open) return close();
    setMonth(monthOf(value || todayISO));
    if (btnRef.current) setAnchor(measure(btnRef.current));
    setOpen(true);
  };

  const pick = (iso: string) => {
    onChange(iso);
    close();
  };

  /* The field can scroll away under an open popover — inside a modal body, a
     card list, the page itself — so re-measure rather than freeze the first
     position. Capture phase catches scrolls on inner containers too. */
  useLayoutEffect(() => {
    if (!open) return;
    const el = btnRef.current;
    if (!el) return;
    const sync = () => setAnchor(measure(el));
    sync();
    window.addEventListener("scroll", sync, true);
    window.addEventListener("resize", sync);
    return () => {
      window.removeEventListener("scroll", sync, true);
      window.removeEventListener("resize", sync);
    };
  }, [open]);

  /* Escape is handled on the CAPTURE phase and stopped: every modal this field
     lives in (fleet, notices, pay settings) closes itself on a document-level
     Escape, and one key press must not close both the picker and the form
     around it. */
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (popRef.current?.contains(t) || btnRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      close();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open]);

  /* Land on the day you'd want to move from — the selection, else today, else
     whatever's first and in bounds. Paging months afterwards doesn't re-steal
     focus (the effect only runs when the popover opens). */
  useEffect(() => {
    if (!open) return;
    const pop = popRef.current;
    if (!pop) return;
    const cell =
      pop.querySelector<HTMLButtonElement>(".cal-d.on:not(:disabled)") ??
      pop.querySelector<HTMLButtonElement>(".cal-d.today:not(:disabled)") ??
      pop.querySelector<HTMLButtonElement>(".cal-d:not(:disabled)");
    cell?.focus();
  }, [open]);

  const todayOut = (!!min && todayISO < min) || (!!max && todayISO > max);

  return (
    <>
      <button
        type="button"
        id={id}
        ref={(el) => {
          btnRef.current = el;
          if (typeof ref === "function") ref(el);
          else if (ref) ref.current = el;
        }}
        className={`datef${size === "lg" ? " lg" : ""}${value ? "" : " empty"}`}
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={toggle}
      >
        <span className="datef-v">{value ? formatAuDate(value) : placeholder}</span>
        <span className="datef-ic">
          <Icon name="calendar" size={15} />
        </span>
      </button>

      {open &&
        createPortal(
          <div className="fg" style={{ display: "contents" }}>
            <div
              ref={popRef}
              className="cal-pop"
              role="dialog"
              aria-label="Choose a date"
              style={{ left: anchor.left, top: anchor.top, bottom: anchor.bottom }}
            >
              <MonthGrid
                month={month}
                today={todayISO}
                value={value}
                min={min}
                max={max}
                onPick={pick}
                onMonthChange={setMonth}
              />
              <div className="cal-foot">
                <button
                  type="button"
                  className="cal-fbtn"
                  disabled={todayOut}
                  onClick={() => pick(todayISO)}
                >
                  Today
                </button>
                {clearable && value ? (
                  <button
                    type="button"
                    className="cal-fbtn clear"
                    onClick={() => {
                      onChange(null);
                      close();
                    }}
                  >
                    Clear
                  </button>
                ) : null}
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
});
