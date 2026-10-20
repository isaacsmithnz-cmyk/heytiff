"use client";

import Link from "next/link";
import type { KeyboardEvent, ReactNode } from "react";

/* THREE WAYS TO PICK WHAT YOU SEE: soft tabs for the views of a list (rule
   29), underlined tabs for a record's sections (rule 31), and a tray for one
   of a few (rule 30). Each is one tab stop: the arrow keys walk it, Home and
   End go to its ends. A tab with an `href` is a link, so the view lives in
   the address; without one it is a button and `onGo` hears it. */

export type TabItem = {
  key: string;
  label: string;
  href?: string;
  /** Something on it needs a look (amber) or is wrong (red). No tab carries
      a number (Isaac, 20 October): the word takes the colour, and a screen
      reader hears it. */
  tone?: "look" | "wrong";
};

type TabsProps = {
  items: readonly TabItem[];
  /** The key of the tab you're on. */
  current: string;
  onGo?: (key: string) => void;
  ariaLabel: string;
  /** `${idPrefix}-${key}` is each tab's id. */
  idPrefix?: string;
  /** `${panelPrefix}-${key}` is the panel a button tab controls. */
  panelPrefix?: string;
};

/** Left and right (and Home, End) walk the tabs of the list they are in. */
function walk(e: KeyboardEvent<HTMLElement>, role: "tab" | "radio"): HTMLElement | null {
  const keys = role === "tab" ? ["ArrowLeft", "ArrowRight", "Home", "End"] : ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"];
  if (!keys.includes(e.key)) return null;
  const list = e.currentTarget.closest(role === "tab" ? '[role="tablist"]' : '[role="radiogroup"]');
  if (!list) return null;
  const all = [...list.querySelectorAll<HTMLElement>(`[role="${role}"]`)];
  const i = all.indexOf(e.currentTarget);
  if (i < 0) return null;
  e.preventDefault();
  const back = e.key === "ArrowLeft" || e.key === "ArrowUp";
  const to = e.key === "Home" ? 0 : e.key === "End" ? all.length - 1 : (i + (back ? -1 : 1) + all.length) % all.length;
  all[to]!.focus();
  return all[to]!;
}

function Tabs({ items, current, onGo, ariaLabel, idPrefix, panelPrefix, kind }: TabsProps & { kind: "pt-vtab" | "pt-stab" }) {
  return (
    <div className={kind === "pt-vtab" ? "pt-vtabs" : "pt-stabs"} role="tablist" aria-label={ariaLabel}>
      {items.map((t) => {
        const on = t.key === current;
        const shared = {
          role: "tab" as const,
          id: idPrefix ? `${idPrefix}-${t.key}` : undefined,
          "aria-selected": on,
          /* only the tab you're on is in the tab order; the arrows reach the rest */
          tabIndex: on ? 0 : -1,
          className: t.tone ? `${kind} ${kind}--${t.tone}` : kind,
          onKeyDown: (e: KeyboardEvent<HTMLElement>) => walk(e, "tab"),
        };
        const body: ReactNode = (
          <>
            <span className={`${kind}-word`}>{t.label}</span>
            {t.tone && (
              <span className="pt-tabs-sr">, {t.tone === "wrong" ? "something wrong" : "something to look at"}</span>
            )}
          </>
        );
        if (t.href)
          return (
            <Link key={t.key} href={t.href} {...shared} onClick={() => onGo?.(t.key)}>
              {body}
            </Link>
          );
        return (
          <button
            key={t.key}
            type="button"
            {...shared}
            aria-controls={panelPrefix ? `${panelPrefix}-${t.key}` : undefined}
            onClick={() => onGo?.(t.key)}
          >
            {body}
          </button>
        );
      })}
    </div>
  );
}

/* VIEWS OF A LIST (rule 29). Soft tabs under the title: the word at 14/500,
   the one you're on in a light fill with the button's 10 corner. No
   outlines, no thumb, no numbers. The props follow shell/view-tabs.tsx, with
   `current` for its `active`. */
export function ViewTabs(props: TabsProps) {
  return <Tabs {...props} kind="pt-vtab" />;
}

/* A RECORD'S SECTIONS (rule 31). Underlined: the one you're on stands on
   2px of ink. A tab with something to look at has its word in amber, red
   when something is wrong (`tone`). A job has seven: Overview, Quote,
   Visits, Checklist, Photos, Documents, Billing. */
export function SectionTabs(props: TabsProps) {
  return <Tabs {...props} kind="pt-stab" />;
}

/* ONE OF A FEW (rule 30): Day, Week, Month. A thin tray, an edge and never a
   fill as well (law 1: a tray is a fill OR an edge), so it holds on any
   ground; the chosen one is filled light and its word turns ink. 32 tall.
   A radiogroup: the arrows move the choice, as radios do. */

export type TrayOption<T extends string> = { value: T; label: string };

export function Tray<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  disabled,
}: {
  options: readonly TrayOption<T>[];
  value: T;
  onChange: (value: T) => void;
  ariaLabel: string;
  /** while what it sets is saving */
  disabled?: boolean;
}) {
  return (
    <div className="pt-tray" role="radiogroup" aria-label={ariaLabel}>
      {options.map((o, i) => {
        const on = o.value === value;
        /* nothing chosen yet: Tab still reaches the tray, on its first */
        const reach = on || (i === 0 && !options.some((p) => p.value === value));
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={reach ? 0 : -1}
            className="pt-tray-opt"
            disabled={disabled}
            data-value={o.value}
            onClick={() => onChange(o.value)}
            onKeyDown={(e) => {
              const to = walk(e, "radio");
              const next = options.find((p) => p.value === to?.dataset.value);
              if (next && next.value !== value) onChange(next.value);
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
