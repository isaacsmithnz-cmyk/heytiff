"use client";

/* The calculator's own small pieces, on the app's parts. All numbers come
   from the engine; these only present and take what's typed.

   A figure is typed into a number field, never dragged on a slider: the app
   has no slider part, and a typed figure is the one you meant (his mock,
   27 October 2026). */

import React from "react";
import { Field, TextInput } from "@/components/parts/field";

/** Read a typed $/hr field: digits and a decimal point only, blank is null.
    Shared so Your rates and the settings accept the same keystrokes. */
export const parseRate = (input: string): number | null => {
  const raw = input.replace(/[^0-9.]/g, "");
  const n = parseFloat(raw);
  return raw === "" || isNaN(n) ? null : n;
};

/** Digits and one decimal point, from whatever was typed. */
const digitsOf = (input: string) => {
  const raw = input.replace(/[^0-9.]/g, "");
  const parts = raw.split(".");
  return parts.length > 2 ? parts[0] + "." + parts.slice(1).join("") : raw;
};

/** How a figure reads at rest: "$38,400", "75", or nothing for an empty
    money figure, so a field nobody has filled in looks unfilled. */
const atRest = (value: number, money: boolean) => {
  if (money && !value) return "";
  const n = Number.isInteger(value) ? value.toLocaleString("en-AU") : String(value);
  return money ? "$" + n : n;
};

/* A NUMBER, TYPED. While it has the focus the field holds exactly what was
   typed, so "42." survives the keystroke; at rest it reads as money. Every
   keystroke that makes a number reaches the engine at once, so Your rates
   moves as you type. `clamp` lets a field refuse a figure past its ceiling on
   the spot (the work split can't pass 100), and the field shows what was
   kept. A figure under its floor is held, unsent, while more digits may
   come: refusing it at once would turn the "1" of "12" into the floor. If
   the field is left there, it goes back to the last figure it sent. */
export function NumberInput({
  value,
  onChange,
  money = false,
  clamp,
  size = 36,
  className,
  ...rest
}: {
  value: number;
  onChange: (n: number) => void;
  money?: boolean;
  clamp?: (n: number) => number;
  size?: 32 | 36;
  className?: string;
  id?: string;
  "aria-label"?: string;
}) {
  const [draft, setDraft] = React.useState<string | null>(null);
  return (
    <TextInput
      {...rest}
      size={size}
      inputMode="decimal"
      className={["rc-num", className].filter(Boolean).join(" ")}
      placeholder={money ? "$0" : undefined}
      value={draft ?? atRest(value, money)}
      onFocus={() => setDraft(value ? String(value) : "")}
      onBlur={() => setDraft(null)}
      onChange={(e) => {
        const raw = digitsOf(e.target.value);
        const n = parseFloat(raw);
        const typed = isNaN(n) ? 0 : n;
        const kept = clamp ? clamp(typed) : typed;
        if (kept > typed) {
          setDraft(raw);
          return;
        }
        setDraft(kept === typed ? raw : String(kept));
        onChange(kept);
      }}
    />
  );
}

/** A labelled money figure, the label above (rule 33). */
export function MoneyField({ label, value, onChange }: { label: string; value: number; onChange: (n: number) => void }) {
  return (
    <Field label={label}>
      <NumberInput money value={value} onChange={onChange} />
    </Field>
  );
}

/** One setting: its name, and a figure with its unit on the right. */
export function SettingRow({ name, line, children }: { name: React.ReactNode; line?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="rc-set">
      <div className="rc-set-w">
        <span className="rc-set-t">{name}</span>
        {line != null && <span className="rc-set-s">{line}</span>}
      </div>
      {children != null && <span className="rc-amt">{children}</span>}
    </div>
  );
}

/** A figure in a setting row, with its unit after it. */
export function Amount({
  label,
  value,
  onChange,
  unit,
  wide = "sm",
  clamp,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  unit?: string;
  wide?: "sm" | "md" | "lg";
  clamp?: (n: number) => number;
}) {
  return (
    <>
      <NumberInput aria-label={label} value={value} onChange={onChange} clamp={clamp} className={wide === "md" ? undefined : `rc-w-${wide}`} />
      <span className="rc-unit">{unit}</span>
    </>
  );
}

/** Labels and figures, the last one the sum when `sum` says so. */
export function Facts({ rows, sum = true }: { rows: readonly (readonly [string, React.ReactNode])[]; sum?: boolean }) {
  return (
    <dl className="rc-facts">
      {rows.map(([k, v], i) => (
        <div key={k} className={sum && i === rows.length - 1 ? "is-sum" : undefined}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/** The drawing's colours: the eight's bright values, never red or blue. */
export type BarHue = "purple" | "pink" | "grey" | "yellow" | "orange" | "green";

/** A bar of parts, each named with its figure under it (rule 20). */
export function Bar({ parts, label }: { parts: readonly { name: string; share: number; hue: BarHue; figure: string }[]; label?: string }) {
  const total = parts.reduce((a, p) => a + Math.max(0, p.share), 0) || 1;
  return (
    <>
      <div className="rc-bar" role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
        {parts.map((p) =>
          p.share > 0 ? <span key={p.name} className={`rc-c-${p.hue}`} style={{ width: `${(p.share / total) * 100}%` }} /> : null
        )}
      </div>
      <ul className="rc-key">
        {parts.map((p) => (
          <li key={p.name}>
            <i className={`rc-c-${p.hue}`} aria-hidden="true" />
            {p.name} <b>{p.figure}</b>
          </li>
        ))}
      </ul>
    </>
  );
}
