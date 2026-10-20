"use client";

import { useId, useRef, useState, type KeyboardEvent } from "react";
import { Chevron, sizeClass, useFieldWiring, type ControlSize } from "./field";
import { Menu } from "./menu";

/* A CHOOSER: one of a list, picked from the app's own menu.

   Rule 34: a field with a chevron that opens a menu. It replaces the
   native select, which no stylesheet reaches and every browser draws its
   own way. It looks like a field (rule 33: 36, a 6 corner, a red edge when
   wrong) and keeps the select's one quiet virtue: given a `name`, it puts
   its value in a hidden input, so a plain form posting to a server action
   still carries it. Past eight options the menu gains a filter box. */

export type ChooserOption = { value: string; label: string; hint?: string };

const FILTER_PAST = 8;

export function Chooser({
  options,
  value,
  onChange,
  placeholder = "Choose one",
  disabled,
  invalid,
  size = 36,
  name,
  id,
  "aria-label": ariaLabel,
  className,
}: {
  options: readonly ChooserOption[];
  value: string | null;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  invalid?: boolean;
  size?: ControlSize;
  /** posts the value with a plain form, as a select does */
  name?: string;
  id?: string;
  /** where no Field's label names it */
  "aria-label"?: string;
  className?: string;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const listId = `${useId()}-list`;
  const wired = useFieldWiring({ id, invalid });
  const chosen = options.find((o) => o.value === value);

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (open || disabled) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setOpen(true);
    }
  };

  const cls =
    "pt-chooser" +
    sizeClass("pt-chooser", size) +
    (wired.invalid ? " pt-chooser--invalid" : "") +
    (className ? ` ${className}` : "");

  return (
    <>
      <button
        ref={ref}
        type="button"
        id={wired.id}
        className={cls}
        role="combobox"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-invalid={wired.invalid || undefined}
        aria-describedby={wired.describedBy}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={onKeyDown}
      >
        <span className={`pt-chooser-value${chosen ? "" : " pt-chooser-value--empty"}`}>{chosen?.label ?? placeholder}</span>
        <Chevron className="pt-chooser-chev" />
      </button>
      {name != null && <input type="hidden" name={name} value={value ?? ""} />}
      <Menu
        open={open}
        anchor={ref}
        id={listId}
        kind="listbox"
        label={ariaLabel ?? wired.label ?? placeholder}
        items={options.map((o) => ({ key: o.value, label: o.label, hint: o.hint }))}
        chosen={value}
        filter={options.length > FILTER_PAST}
        matchWidth
        onClose={() => setOpen(false)}
        onSelect={(v) => {
          if (v !== value) onChange(v);
        }}
      />
    </>
  );
}
