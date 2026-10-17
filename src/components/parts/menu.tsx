"use client";

import { useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { useOverlay } from "@/components/overlay/use-overlay";
import { useFloat, useOutsidePress, type FloatAlign } from "./float";

/* A MENU: a white list that floats from the thing you pressed.

   Rule 36: white, a 16 corner, the one shadow. Items are 32 tall, the one
   you point at on the hover fill and the chosen one on the selected fill.
   Rule 53: what ends a record is red, and last, so the menu puts a danger
   item after the rest, under a thin line, whatever order it was given in.

   Focus stays on the list (or on the filter box, when there is one) and the
   item you are on is its active descendant, so the keys are one handler:
   the arrows, Home and End, Enter or Space, a first letter, Escape and Tab.
   Escape, Tab and a pick put focus back on the trigger; a press outside
   leaves it where the press put it.

   It joins the overlay stack (`useOverlay`) so a dialog under it hears none
   of its keys and the page knows something is open. The stack's own Tab
   trap and focus return are off: Tab closes a menu rather than going round
   it, and the trigger is where focus goes back, not whatever had it. */

export type MenuItem = {
  key: string;
  label: string;
  /** a second line in grey */
  hint?: string;
  /** a Dot or an icon before the word */
  lead?: ReactNode;
  /** a grey figure on the right */
  count?: ReactNode;
  /** ends the record: a red word, last (rule 53) */
  danger?: boolean;
  disabled?: boolean;
};

export type MenuProps = {
  open: boolean;
  /** the element the menu hangs from, and where focus goes back */
  anchor: RefObject<HTMLElement | null>;
  onClose: () => void;
  onSelect: (key: string) => void;
  items: readonly MenuItem[];
  /** what the list is, for a screen reader */
  label: string;
  /** the chosen item, on the selected fill */
  chosen?: string | null;
  /** "listbox" for a chooser's options */
  kind?: "menu" | "listbox";
  /** a filter box above the items */
  filter?: boolean;
  /** at least as wide as the trigger */
  matchWidth?: boolean;
  align?: FloatAlign;
  /** the list's id, for a trigger's `aria-controls` */
  id?: string;
  /** "ink" for New's panel (rule 44): dark, square where it leaves the sidebar */
  tone?: "white" | "ink";
};

export function Menu(props: MenuProps) {
  if (!props.open || typeof document === "undefined") return null;
  return createPortal(<MenuPanel {...props} />, document.body);
}

const first = (list: readonly MenuItem[]) => list.find((i) => !i.disabled)?.key ?? null;

function MenuPanel({ anchor, onClose, onSelect, items, label, chosen, kind = "menu", filter, matchWidth, align, id, tone = "white" }: MenuProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const filterRef = useRef<HTMLInputElement>(null);
  const made = useId();
  const listId = id ?? `${made}-list`;
  const [query, setQuery] = useState("");
  const [keyed, setKeyed] = useState(false);

  const ordered = [...items.filter((i) => !i.danger), ...items.filter((i) => i.danger)];
  const q = query.trim().toLowerCase();
  const shown = q ? ordered.filter((i) => i.label.toLowerCase().includes(q)) : ordered;
  const [active, setActive] = useState<string | null>(() =>
    chosen != null && ordered.some((i) => i.key === chosen && !i.disabled) ? chosen : first(ordered),
  );
  const enabled = shown.filter((i) => !i.disabled);
  const at = enabled.findIndex((i) => i.key === active);
  const optionId = (key: string) => `${made}-o${shown.findIndex((i) => i.key === key)}`;
  const activeId = at >= 0 && active != null ? optionId(active) : undefined;

  const { style, overModal } = useFloat(anchor, panelRef, { align, matchWidth });

  const close = (back: boolean) => {
    if (back) anchor.current?.focus({ preventScroll: true });
    onClose();
  };
  const pick = (item: MenuItem) => {
    if (item.disabled) return;
    close(true);
    onSelect(item.key);
  };

  useOverlay(panelRef, { trap: false, restoreFocus: false });
  useOutsidePress(anchor, panelRef, () => onClose());

  useLayoutEffect(() => {
    (filterRef.current ?? listRef.current)?.focus({ preventScroll: true });
  }, []);

  /* the active item stays in view as the keys move it */
  useLayoutEffect(() => {
    if (!activeId) return;
    document.getElementById(activeId)?.scrollIntoView?.({ block: "nearest" });
  }, [activeId]);

  const move = (to: number) => {
    const item = enabled[(to + enabled.length) % enabled.length];
    if (item) setActive(item.key);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const inFilter = e.target === filterRef.current;
    setKeyed(true);
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        move(at < 0 ? 0 : at + 1);
        return;
      case "ArrowUp":
        e.preventDefault();
        move(at < 0 ? enabled.length - 1 : at - 1);
        return;
      case "Home":
      case "End":
        if (inFilter) return;
        e.preventDefault();
        move(e.key === "Home" ? 0 : enabled.length - 1);
        return;
      case "Enter":
      case " ": {
        if (e.key === " " && inFilter) return;
        e.preventDefault();
        const item = enabled[at];
        if (item) pick(item);
        return;
      }
      case "Escape":
        e.preventDefault();
        e.stopPropagation();
        close(true);
        return;
      case "Tab":
        e.preventDefault();
        close(true);
        return;
    }
    /* a first letter jumps to the next item that starts with it */
    if (inFilter || e.key.length !== 1 || e.ctrlKey || e.metaKey || e.altKey) return;
    const letter = e.key.toLowerCase();
    for (let step = 1; step <= enabled.length; step++) {
      const item = enabled[(Math.max(at, 0) + step) % enabled.length];
      if (item && item.label.toLowerCase().startsWith(letter)) {
        setActive(item.key);
        return;
      }
    }
  };

  const itemRole = kind === "listbox" ? "option" : "menuitem";
  const firstDanger = kind === "menu" ? shown.findIndex((i) => i.danger) : -1;

  return (
    <div
      ref={panelRef}
      className={`pt-menu${tone === "ink" ? " pt-menu--ink" : ""}${overModal ? " pt-menu--over-modal" : ""}${keyed ? " pt-menu--keys" : ""}`}
      style={style}
      onKeyDown={onKeyDown}
    >
      {filter && (
        <div className="pt-menu-filter">
          <input
            ref={filterRef}
            className="pt-menu-filter-input"
            type="text"
            placeholder="Filter"
            aria-label={`Filter ${label.toLowerCase()}`}
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={activeId}
            value={query}
            onChange={(e) => {
              const next = e.target.value;
              setQuery(next);
              const n = next.trim().toLowerCase();
              setActive(first(n ? ordered.filter((i) => i.label.toLowerCase().includes(n)) : ordered));
            }}
          />
        </div>
      )}
      <ul
        ref={listRef}
        id={listId}
        className="pt-menu-list"
        role={kind}
        aria-label={label}
        tabIndex={-1}
        aria-activedescendant={filter ? undefined : activeId}
      >
        {shown.map((item, i) => {
          const on = item.key === chosen;
          return (
            <MenuRow
              key={item.key}
              item={item}
              id={optionId(item.key)}
              role={itemRole}
              on={on}
              active={item.key === active}
              rule={i === firstDanger && i > 0}
              onPoint={() => {
                setKeyed(false);
                if (!item.disabled) setActive(item.key);
              }}
              onPick={() => pick(item)}
            />
          );
        })}
        {shown.length === 0 && (
          <li className="pt-menu-empty" role="presentation">
            {`Nothing matches “${query.trim()}”`}
          </li>
        )}
      </ul>
    </div>
  );
}

function MenuRow({
  item,
  id,
  role,
  on,
  active,
  rule,
  onPoint,
  onPick,
}: {
  item: MenuItem;
  id: string;
  role: "menuitem" | "option";
  on: boolean;
  active: boolean;
  rule: boolean;
  onPoint: () => void;
  onPick: () => void;
}) {
  const cls =
    "pt-menu-item" +
    (on ? " pt-menu-item--chosen" : "") +
    (active ? " pt-menu-item--active" : "") +
    (item.danger ? " pt-menu-item--danger" : "") +
    (rule ? " pt-menu-item--ruled" : "");
  return (
    <li
      id={id}
      role={role}
      className={cls}
      aria-selected={role === "option" ? on : undefined}
      aria-current={role === "menuitem" && on ? "true" : undefined}
      aria-disabled={item.disabled || undefined}
      onPointerMove={onPoint}
      /* the list keeps focus; the press is the click */
      onMouseDown={(e) => e.preventDefault()}
      onClick={onPick}
    >
      {item.lead != null && <span className="pt-menu-lead">{item.lead}</span>}
      <span className="pt-menu-words">
        <span className="pt-menu-label">{item.label}</span>
        {item.hint && <span className="pt-menu-hint">{item.hint}</span>}
      </span>
      {item.count != null && <span className="pt-menu-count">{item.count}</span>}
    </li>
  );
}
