"use client";

import { isValidElement, type ReactNode } from "react";
import { Icon } from "@/components/shell/icon";

/* Controlled form primitives over the design's existing `.field / .inp /
   .selwrap / .seg` classes — the same vocabulary the injected renderer built
   as strings, now with a value and an onChange.

   `invalid` is new: it rings the input and prints a line under it, so a
   rejected save says WHICH field rather than only that something was wrong. */

export function Field({
  label,
  req,
  help,
  error,
  children,
  style,
}: {
  label: ReactNode;
  req?: boolean;
  help?: ReactNode;
  /** shown as .ferr under the control when the last save rejected this field */
  error?: string | null;
  children: ReactNode;
  style?: React.CSSProperties;
}) {
  /* The string renderer emitted a bare <label> beside its input and never tied
     the two together, so nothing announced a field's name and clicking a label
     did nothing. Every control below sets id={name}, so the wrapper can pick
     the association up from its child rather than every call site repeating
     the name twice. */
  const control = isValidElement<{ name?: string }>(children) ? children.props.name : undefined;
  return (
    <div className="field" style={style}>
      <label htmlFor={control}>
        {label}
        {req && <span className="req">*</span>}
      </label>
      {children}
      {help && <span className="help">{help}</span>}
      {error && <span className="ferr">{error}</span>}
    </div>
  );
}

export function TextInput({
  name,
  value,
  onChange,
  placeholder,
  type = "text",
  invalid,
  suggestions,
}: {
  name: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  invalid?: boolean;
  /* Names people mostly type here, offered as a datalist. SUGGESTIONS, not
     options: the field stays free text, because the next business will hold a
     policy nobody thought to list. */
  suggestions?: readonly string[];
}) {
  const listId = suggestions?.length ? `${name}-suggestions` : undefined;
  return (
    <>
      <input
        className={invalid ? "inp err" : "inp"}
        name={name}
        id={name}
        type={type}
        placeholder={placeholder}
        value={value}
        list={listId}
        aria-invalid={invalid || undefined}
        onChange={(e) => onChange(e.target.value)}
      />
      {listId && (
        <datalist id={listId}>
          {suggestions!.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
      )}
    </>
  );
}

/* Every date in this app is PICKED, never typed — and every one of them comes
   through here.

   A text date input is a format argument you have with the user forever:
   dd/mm vs mm/dd, two-digit years, "31/02". A calendar ends it — a value that
   can only ever be a real yyyy-mm-dd.

   THIS COMPONENT IS A SEAM, AND THAT IS THE POINT. The internals are a native
   <input type="date"> today and will be a design-matched calendar popover
   next; because no call site anywhere writes a raw type="date", that swap is
   one file. Do not inline a date input at a call site, however small — use
   DateField, or the popover will land in some places and not others.

   Note the name: `Field` is the label wrapper that goes AROUND a control;
   `DateField` is the control itself, and sits inside a `Field` like the rest.

   The VALUE is ISO. Read mode renders dd/mm/yyyy itself, via formatAuDate. */
export function DateField({
  name,
  value,
  onChange,
  invalid,
  max,
  min,
}: {
  name: string;
  /** yyyy-mm-dd, or "" */
  value: string;
  onChange: (v: string) => void;
  invalid?: boolean;
  max?: string;
  min?: string;
}) {
  return (
    <input
      className={invalid ? "inp date err" : "inp date"}
      name={name}
      id={name}
      type="date"
      value={value}
      max={max}
      min={min}
      aria-invalid={invalid || undefined}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

export function SelectInput({
  name,
  value,
  onChange,
  placeholder,
  options,
  invalid,
}: {
  name: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  options: readonly string[];
  invalid?: boolean;
}) {
  return (
    <div className="selwrap">
      <select
        className={invalid ? "inp err" : "inp"}
        name={name}
        id={name}
        value={value}
        aria-invalid={invalid || undefined}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">{placeholder}</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
      <span className="chev">
        <Icon name="chevD" size={16} />
      </span>
    </div>
  );
}

export function TextArea({
  name,
  value,
  onChange,
  placeholder,
  style,
}: {
  name: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  style?: React.CSSProperties;
}) {
  return (
    <textarea
      className="inp"
      name={name}
      id={name}
      placeholder={placeholder}
      value={value}
      style={style}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

/** $-prefixed money input. */
export function MoneyInput({
  name,
  value,
  onChange,
  placeholder,
  invalid,
}: {
  name: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  invalid?: boolean;
}) {
  return (
    <div className="suffixwrap">
      <input
        className={invalid ? "inp err" : "inp"}
        name={name}
        id={name}
        type="text"
        style={{ paddingLeft: 30 }}
        placeholder={placeholder}
        value={value}
        aria-invalid={invalid || undefined}
        onChange={(e) => onChange(e.target.value)}
      />
      <span className="sfx" style={{ left: 14, right: "auto" }}>
        $
      </span>
    </div>
  );
}

/** %-suffixed input. */
export function PctInput({
  name,
  value,
  onChange,
  placeholder,
  invalid,
}: {
  name: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  invalid?: boolean;
}) {
  return (
    <div className="suffixwrap">
      <input
        className={invalid ? "inp with-suffix err" : "inp with-suffix"}
        name={name}
        id={name}
        type="text"
        placeholder={placeholder}
        value={value}
        aria-invalid={invalid || undefined}
        onChange={(e) => onChange(e.target.value)}
      />
      <span className="sfx">%</span>
    </div>
  );
}

/** Two-state segmented control (Active / Inactive). */
export function Seg({
  value,
  onChange,
  options,
  greenValue,
}: {
  value: string;
  onChange: (v: string) => void;
  options: readonly string[];
  /** the option that reads as "good" — gets the teal treatment */
  greenValue?: string;
}) {
  return (
    <div className="seg">
      {options.map((o) => {
        const on = o === value;
        return (
          <button
            key={o}
            type="button"
            className={on ? (o === greenValue ? "on green" : "on") : ""}
            aria-pressed={on}
            onClick={() => onChange(o)}
          >
            {o}
          </button>
        );
      })}
    </div>
  );
}

/** The little "what is this?" tooltip the design puts beside a label. */
export function InfoTip({ children }: { children: ReactNode }) {
  return (
    <span className="infobtn" tabIndex={0}>
      <Icon name="info" size={14} />
      <span className="tip">{children}</span>
    </span>
  );
}

/** A read-mode fact row for values that don't belong on the plastic card. */
export function FactRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="ro-row">
      <em>{label}</em>
      <b>{value || <span className="ro-none">Not set</span>}</b>
    </div>
  );
}
