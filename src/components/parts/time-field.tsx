"use client";

import { useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type RefObject } from "react";
import { createPortal } from "react-dom";
import { useOverlay } from "@/components/overlay/use-overlay";
import { TimeWheel } from "@/components/ui/time-wheel";
import { Chevron, sizeClass, useFieldWiring, type ControlSize } from "./field";
import { useFloat, useOutsidePress } from "./float";

/* A TIME: a field that opens the wheel.

   Rule 34: a time opens a wheel, the hour, minutes in fives, am or pm, and
   nothing types a clock time. The wheel is the timesheet's own
   (`ui/time-wheel`), unchanged, so the value is its "7:05 AM" and every
   value round-trips through `parseClock`. Its v2 dress is scoped under this
   panel, so the timesheet's wheel keeps its own.

   The field is a combobox whose popup is a small dialog: the panel joins
   the overlay stack, Tab goes round inside it, and Escape or a press
   outside closes it, Escape with focus back on the field. A pick keeps it
   open, since a time is three picks. */

export function TimeField({
  value,
  onChange,
  placeholder = "Choose a time",
  disabled,
  invalid,
  size = 36,
  name,
  id,
  label,
  className,
}: {
  /** "7:05 AM", or empty for no time yet */
  value: string | null;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  invalid?: boolean;
  size?: ControlSize;
  /** posts the value with a plain form */
  name?: string;
  id?: string;
  /** what the time is, where no Field's label names it */
  label?: string;
  className?: string;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const wired = useFieldWiring({ id, invalid });
  const named = label ?? wired.label ?? "Time";
  const panelId = `${useId()}-time`;

  const cls =
    "pt-timefield" +
    sizeClass("pt-timefield", size) +
    (wired.invalid ? " pt-timefield--invalid" : "") +
    (className ? ` ${className}` : "");

  return (
    <>
      <button
        ref={ref}
        type="button"
        id={wired.id}
        className={cls}
        role="combobox"
        aria-label={wired.label ? undefined : named}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-invalid={wired.invalid || undefined}
        aria-describedby={wired.describedBy}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
      >
        <span className={`pt-timefield-value${value ? "" : " pt-timefield-value--empty"}`}>{value || placeholder}</span>
        <Chevron className="pt-timefield-chev" />
      </button>
      {name != null && <input type="hidden" name={name} value={value ?? ""} />}
      {open &&
        typeof document !== "undefined" &&
        createPortal(
          <TimePanel id={panelId} anchor={ref} label={named} value={value ?? ""} onChange={onChange} onClose={() => setOpen(false)} />,
          document.body,
        )}
    </>
  );
}

function TimePanel({
  id,
  anchor,
  label,
  value,
  onChange,
  onClose,
}: {
  id: string;
  anchor: RefObject<HTMLButtonElement | null>;
  label: string;
  value: string;
  onChange: (value: string) => void;
  onClose: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const { style, overModal } = useFloat(anchor, panelRef);

  useOverlay(panelRef, { restoreFocus: false });
  useOutsidePress(anchor, panelRef, onClose);

  /* focus lands on the chosen hour, the first of the three picks */
  useLayoutEffect(() => {
    panelRef.current?.querySelector<HTMLButtonElement>(".tw-opt.on")?.focus({ preventScroll: true });
  }, []);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "Escape") return;
    e.preventDefault();
    e.stopPropagation();
    anchor.current?.focus({ preventScroll: true });
    onClose();
  };

  return (
    <div
      ref={panelRef}
      id={id}
      className={`pt-timefield-panel${overModal ? " pt-timefield-panel--over-modal" : ""}`}
      style={style}
      role="dialog"
      aria-label={label}
      onKeyDown={onKeyDown}
    >
      <TimeWheel label={label} value={value} onChange={onChange} />
    </div>
  );
}
