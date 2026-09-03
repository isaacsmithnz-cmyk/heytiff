"use client";

import type { ReactNode } from "react";
import { Icon } from "@/components/shell/icon";

/* The vehicle modal's vocabulary — the handful of shapes every screen is built
   from. Cards, eyebrows, detail grids, the two button weights. Kept small on
   purpose: the design has exactly these, and a screen that needs something
   else is a screen that has drifted from it. */

/** The 11px uppercase label that names a card or a section inside one. */
export function Eyebrow({ children, tone }: { children: ReactNode; tone?: "accent" | "warn" }) {
  return <span className={`vm-eyebrow${tone ? ` ${tone}` : ""}`}>{children}</span>;
}

/** A sunken card. Clickable cards are buttons, because they are. */
export function Card({
  children,
  className,
  onClick,
  ariaLabel,
}: {
  children: ReactNode;
  className?: string;
  onClick?: () => void;
  ariaLabel?: string;
}) {
  const cls = `vm-card${className ? ` ${className}` : ""}`;
  if (onClick) {
    return (
      <button type="button" className={`${cls} clickable`} onClick={onClick} aria-label={ariaLabel}>
        {children}
      </button>
    );
  }
  return <div className={cls}>{children}</div>;
}

export type DetailItem = {
  label: string;
  value: ReactNode;
  /** "faint" for an empty value, "warn" for one inside a warning window. */
  tone?: "faint" | "warn";
  /** An inline action beside the value — "Add", "Edit". */
  action?: { label: string; onClick: () => void };
  wide?: boolean;
};

/** Label-over-value pairs in a grid. Three columns by default; four for specs. */
export function DetailGrid({ items, cols = 3, dense }: { items: DetailItem[]; cols?: 3 | 4; dense?: boolean }) {
  return (
    <div className={`vm-grid cols${cols}${dense ? " dense" : ""}`}>
      {items.map((it) => (
        <div key={it.label} className={`vm-field${it.wide ? " wide" : ""}`}>
          <span className="vm-fl">{it.label}</span>
          <span className="vm-fv">
            <span className={it.tone ? `vm-fvt ${it.tone}` : "vm-fvt"}>{it.value}</span>
            {it.action && (
              <button type="button" className="vm-inline" onClick={it.action.onClick}>
                {it.action.label}
              </button>
            )}
          </span>
        </div>
      ))}
    </div>
  );
}

/** The 40×40 square control — back, close, the + on a card. */
export function IconBtn({
  icon,
  label,
  onClick,
  size = 16,
}: {
  icon: string;
  label: string;
  onClick: () => void;
  size?: number;
}) {
  return (
    <button type="button" className="vm-iconbtn" aria-label={label} onClick={onClick}>
      <Icon name={icon} size={size} />
    </button>
  );
}

export type BtnKind = "primary" | "outline" | "danger" | "warn";

export function Btn({
  kind = "outline",
  children,
  onClick,
  disabled,
  icon,
}: {
  kind?: BtnKind;
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  icon?: string;
}) {
  return (
    <button type="button" className={`vm-btn ${kind}`} onClick={onClick} disabled={disabled}>
      {icon && <Icon name={icon} size={15} />}
      {children}
    </button>
  );
}

/** A quiet text action: "Edit", "Add document", "Enter manually". */
export function Inline({
  children,
  onClick,
  muted,
}: {
  children: ReactNode;
  onClick: () => void;
  muted?: boolean;
}) {
  return (
    <button type="button" className={`vm-inline${muted ? " muted" : ""}`} onClick={onClick}>
      {children}
    </button>
  );
}

/** The row of segmented tabs inside a card header. */
export function Segmented<K extends string>({
  items,
  active,
  onSelect,
  ariaLabel,
}: {
  items: { key: K; label: string }[];
  active: K;
  onSelect: (k: K) => void;
  ariaLabel: string;
}) {
  return (
    <div className="vm-seg" role="tablist" aria-label={ariaLabel}>
      {items.map((t) => (
        <button
          key={t.key}
          type="button"
          role="tab"
          aria-selected={t.key === active}
          className={`vm-segbtn${t.key === active ? " on" : ""}`}
          onClick={() => onSelect(t.key)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

/** The header shared by the four sub-screens: back, eyebrow, title, plate. */
export function SubHeader({
  eyebrow,
  title,
  onBack,
  right,
}: {
  eyebrow: string;
  title: string;
  onBack: () => void;
  right?: ReactNode;
}) {
  return (
    <div className="vm-head sub">
      <div className="vm-headl">
        <IconBtn icon="chevL" label="Back" onClick={onBack} size={18} />
        <div className="vm-titles">
          <span className="vm-eyebrow">{eyebrow}</span>
          <h2 className="vm-title sub">{title}</h2>
        </div>
      </div>
      {right}
    </div>
  );
}

/* ---- form atoms shared by the record panels ---- */

/** A labelled field in a record panel's grid. */
export function Field({ label, req, children }: { label: string; req?: boolean; children: ReactNode }) {
  return (
    <label className="vm-ffield">
      <span className="vm-fl">
        {label}
        {req && <i aria-hidden>*</i>}
      </span>
      {children}
    </label>
  );
}

/** A dollar figure, typed as digits. */
export function MoneyInput({
  value,
  onChange,
  placeholder,
  ariaLabel,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  ariaLabel?: string;
}) {
  return (
    <span className="vm-money-in">
      <span>$</span>
      <input inputMode="decimal" value={value} placeholder={placeholder} aria-label={ariaLabel} onChange={(e) => onChange(e.target.value)} />
    </span>
  );
}
