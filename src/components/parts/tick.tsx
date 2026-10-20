"use client";

import type { InputHTMLAttributes, ReactNode, Ref } from "react";

/* TICKS AND SWITCHES (docs/design.md, rule 32): blue when on. Off, both
   are drawn in grey's bright value, the one the palette gives ticks; on,
   in `--press`, because blue only means press (rule 17).

   The tick is the browser's own checkbox, redrawn: a 16 box with the
   fields' 6 corner (rule 46), so Space, the form and the label come free.
   Its word sits beside it inside the <label>, so a click on the word ticks.

   A switch saves itself, so it is a button that says it is a switch and
   never submits: it takes `checked` and `onChange` and nothing else
   decides. Its word is inside the button, which is its name. */

export type TickProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "onChange" | "className" | "children"> & {
  label: ReactNode;
  onChange?: (checked: boolean) => void;
  className?: string;
  ref?: Ref<HTMLInputElement>;
};

export function Tick({ label, onChange, className, disabled, ...rest }: TickProps) {
  return (
    <label className={["pt-tick", disabled ? "pt-tick--disabled" : "", className].filter(Boolean).join(" ")}>
      <span className="pt-tick__box">
        <input
          {...rest}
          type="checkbox"
          disabled={disabled}
          className="pt-tick__input"
          onChange={onChange ? (e) => onChange(e.currentTarget.checked) : undefined}
        />
        <svg className="pt-tick__mark" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="m4 8.5 2.5 2.5L12 5.5" />
        </svg>
      </span>
      <span className="pt-tick__word">{label}</span>
    </label>
  );
}

export type SwitchProps = {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: ReactNode;
  disabled?: boolean;
  id?: string;
  className?: string;
  ref?: Ref<HTMLButtonElement>;
};

export function Switch({ checked, onChange, label, disabled, id, className, ref }: SwitchProps) {
  return (
    <button
      ref={ref}
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      className={["pt-switch", className].filter(Boolean).join(" ")}
      onClick={() => onChange(!checked)}
    >
      <span className="pt-switch__track" aria-hidden="true">
        <span className="pt-switch__knob" />
      </span>
      <span className="pt-switch__word">{label}</span>
    </button>
  );
}
