"use client";

import { createContext, useContext, useId, type ComponentProps, type ReactNode } from "react";

/* A FIELD: the label above, the control, and why it is wrong, or nothing.

   Rule 33: 36 tall, a 6 corner, the label above; a wrong field gets a red
   edge and says why underneath. Rule 28: a field matches the button beside
   it, so every control here takes the three heights, 32 in a row, 36 in a
   form, 44 on a phone.

   The wrapper hands its control the label's id and the error's id through
   context, so any control inside it (a text input, a chooser, a time) is
   tied to the label and points at the error with `aria-describedby` without
   the screen wiring either. */

export type ControlSize = 32 | 36 | 44;

type FieldWiring = { id: string; errorId: string; invalid: boolean; label: string };

const FieldContext = createContext<FieldWiring | null>(null);

/** The id, the error and the label of the Field a control stands in. */
export function useFieldWiring(own: { id?: string; invalid?: boolean; describedBy?: string }) {
  const field = useContext(FieldContext);
  const invalid = own.invalid ?? field?.invalid ?? false;
  const describedBy = [own.describedBy, invalid && field?.invalid ? field.errorId : undefined].filter(Boolean).join(" ") || undefined;
  return { id: own.id ?? field?.id, invalid, describedBy, label: field?.label };
}

/** The size modifier, for the default 36 none. */
export const sizeClass = (part: string, size: ControlSize) => (size === 36 ? "" : ` ${part}--${size}`);

export function Field({
  label,
  error,
  id,
  className,
  children,
}: {
  label: string;
  /** what is wrong, in words; a field without one is not wrong */
  error?: string | null;
  id?: string;
  className?: string;
  children: ReactNode;
}) {
  const made = useId();
  const controlId = id ?? `${made}-c`;
  const errorId = `${made}-e`;
  const invalid = !!error;
  return (
    <div className={`pt-field${className ? ` ${className}` : ""}`}>
      <label className="pt-field-label" htmlFor={controlId}>
        {label}
      </label>
      <FieldContext.Provider value={{ id: controlId, errorId, invalid, label }}>{children}</FieldContext.Provider>
      {invalid && (
        <p className="pt-field-error" id={errorId}>
          {error}
        </p>
      )}
    </div>
  );
}

type InputProps = Omit<ComponentProps<"input">, "size"> & { size?: ControlSize; invalid?: boolean };

export function TextInput({ size = 36, invalid, id, className, type = "text", "aria-describedby": ownDescribed, ...rest }: InputProps) {
  const wired = useFieldWiring({ id, invalid, describedBy: ownDescribed });
  return (
    <input
      {...rest}
      type={type}
      id={wired.id}
      aria-invalid={wired.invalid || undefined}
      aria-describedby={wired.describedBy}
      className={`pt-input${sizeClass("pt-input", size)}${wired.invalid ? " pt-input--invalid" : ""}${className ? ` ${className}` : ""}`}
    />
  );
}

type AreaProps = ComponentProps<"textarea"> & { invalid?: boolean };

export function TextArea({ invalid, id, className, rows = 3, "aria-describedby": ownDescribed, ...rest }: AreaProps) {
  const wired = useFieldWiring({ id, invalid, describedBy: ownDescribed });
  return (
    <textarea
      {...rest}
      rows={rows}
      id={wired.id}
      aria-invalid={wired.invalid || undefined}
      aria-describedby={wired.describedBy}
      className={`pt-textarea${wired.invalid ? " pt-textarea--invalid" : ""}${className ? ` ${className}` : ""}`}
    />
  );
}

/* The chevron a chooser and a time carry on the right (rule 34). The shell's
   icon set has a right chevron and no down one. */
export function Chevron({ className }: { className: string }) {
  return (
    <svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" aria-hidden="true">
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}
