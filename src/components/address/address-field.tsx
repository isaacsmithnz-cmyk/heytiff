"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { AddressParts, AddressSuggestion } from "@/lib/address/map-place";

/* A text box that happens to know Australian addresses.

   AUTOCOMPLETE-ASSISTED, NOT PICKER-LOCKED. This is a `.inp` text input and it
   stays one: every keystroke reaches onChange whether or not Google has heard
   of the place. New estates, rural properties, a depot behind a service road —
   addresses that no lookup can find are exactly the ones a tradesman needs to
   type, and a field that refuses them is worse than no field. The dropdown is
   a shortcut on top, never a gate in front.

   IT DEGRADES TO NOTHING. `enabled` comes from the server as
   Boolean(GOOGLE_MAPS_API_KEY). False, and this component is the plain input it
   already looks like: no debounce, no listeners, no fetch. If the key
   disappears under a running page the proxy answers 503 {enabled:false} and the
   field switches itself off for the rest of the session rather than retrying
   every keystroke. Nothing anywhere renders an error about it — an address box
   without autocomplete is still an address box.

   THE POPOVER PORTALS TO <body>, for the reason date-field documents: the shell
   keeps `will-change` on `.page.in`, which makes it the containing block for
   position:fixed descendants and would anchor this to the page instead of the
   viewport. The `.fg` display:contents wrapper carries the frame's custom
   properties across without re-applying its layout. Anchoring, flipping and
   re-measuring on scroll all follow components/ui/date-field.tsx.

   THE KEY IS NOT HERE, and there is nowhere in this file it could be: the only
   URL is our own /api/address. */

/** Same floor the proxy enforces — checked here too so two characters cost no
    request at all, not merely no billable Google call. */
const MIN_INPUT = 3;
const DEBOUNCE_MS = 250;

const GAP = 6;
const EDGE = 8;
/** Not a measurement — just "is there roughly a dropdown's worth of room
    below". When it flips it anchors on `bottom`, so the real height never has
    to be known. */
const POP_H = 240;

type Anchor = { left: number; width: number; top?: number; bottom?: number };

function measure(el: HTMLElement): Anchor {
  const r = el.getBoundingClientRect();
  // The dropdown is the width of the field it belongs to, so the two read as
  // one control rather than a panel that happens to be nearby.
  const width = r.width;
  const left = Math.max(EDGE, Math.min(r.left, window.innerWidth - width - EDGE));
  const below = window.innerHeight - r.bottom;
  if (below < POP_H && r.top > below) return { left, width, bottom: window.innerHeight - r.top + GAP };
  return { left, width, top: r.bottom + GAP };
}

/** A billing session id. randomUUID needs a secure context; the fallback keeps
    a plain-http dev host working rather than throwing inside a keystroke. */
function newToken(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

type Wire = {
  enabled?: boolean;
  suggestions?: AddressSuggestion[];
  formatted?: string;
  parts?: AddressParts;
};

async function post(body: unknown): Promise<Wire | null> {
  try {
    const res = await fetch("/api/address", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    // 503 is "this deployment has no key" — an answer, not a failure.
    if (res.status === 503) return { enabled: false };
    if (!res.ok) return null;
    return (await res.json()) as Wire;
  } catch {
    // Offline, aborted, blocked. The field is still a text box.
    return null;
  }
}

export type AddressFieldProps = {
  /** ties the control to its <Field> label, exactly like TextInput */
  name: string;
  value: string;
  onChange: (v: string) => void;
  /** fired only on a picked suggestion — the split fields, plus the one-liner */
  onResolve?: (parts: AddressParts, formatted: string) => void;
  placeholder?: string;
  /** server-computed Boolean(GOOGLE_MAPS_API_KEY); false = plain text input */
  enabled: boolean;
  disabled?: boolean;
};

export function AddressField({
  name,
  value,
  onChange,
  onResolve,
  placeholder,
  enabled,
  disabled,
}: AddressFieldProps) {
  const listId = `${useId()}-adr`;
  const inputRef = useRef<HTMLInputElement | null>(null);
  const popRef = useRef<HTMLDivElement | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** the open billing session; cleared by a resolve, re-minted on next use */
  const token = useRef<string | null>(null);
  /** monotonic — an answer that isn't the newest question is dropped */
  const seq = useRef(0);

  const [items, setItems] = useState<AddressSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<Anchor>({ left: 0, width: 0, top: 0 });
  // -1 = nothing highlighted. Enter does nothing until you arrow to a row, so
  // a person typing an address the lookup doesn't know can never have one
  // silently substituted.
  const [active, setActive] = useState(-1);
  /** the proxy said there's no key — stop asking for the rest of the session */
  const [off, setOff] = useState(false);

  const live = enabled && !off;

  const close = () => {
    setOpen(false);
    setActive(-1);
  };

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const sessionToken = () => (token.current ??= newToken());

  const ask = async (input: string) => {
    const mine = ++seq.current;
    const res = await post({ op: "suggest", input, sessionToken: sessionToken() });
    if (mine !== seq.current) return; // a later keystroke already went out
    if (!res) return; // upstream trouble: leave the box alone, say nothing
    if (res.enabled === false) {
      setOff(true);
      close();
      return;
    }
    const list = res.suggestions ?? [];
    setItems(list);
    setActive(-1);
    setOpen(list.length > 0);
    if (list.length > 0 && inputRef.current) setAnchor(measure(inputRef.current));
  };

  const onType = (next: string) => {
    // The value goes through FIRST and unconditionally. Everything below is
    // the optional part.
    onChange(next);
    if (timer.current) clearTimeout(timer.current);
    if (!live) return;
    if (next.trim().length < MIN_INPUT) {
      setItems([]);
      close();
      return;
    }
    timer.current = setTimeout(() => void ask(next.trim()), DEBOUNCE_MS);
  };

  const choose = async (s: AddressSuggestion) => {
    if (timer.current) clearTimeout(timer.current);
    // Bump the sequence so a suggest still in flight can't reopen the list
    // over the top of a selection that already landed.
    seq.current++;
    close();
    setItems([]);

    const res = await post({ op: "resolve", placeId: s.placeId, sessionToken: sessionToken() });
    // Resolved or not, that session is spent.
    token.current = null;

    if (!res || res.enabled === false || !res.parts) {
      // The details call failed, but the person did pick something — the line
      // they picked is better than the half-typed one they'd be left with.
      onChange(s.text);
      return;
    }
    const formatted = res.formatted || s.text;
    onChange(formatted);
    onResolve?.(res.parts, formatted);
  };

  /* The field can scroll away under an open dropdown — inside a card list, the
     page itself — so re-measure rather than freeze the first position. Capture
     phase catches scrolls on inner containers too. */
  useLayoutEffect(() => {
    if (!open) return;
    const el = inputRef.current;
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

  /* Escape on the CAPTURE phase and stopped, for date-field's reason: a field
     inside a modal must not close the modal with the same key press that
     closes its dropdown. */
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (popRef.current?.contains(t) || inputRef.current?.contains(t)) return;
      close();
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

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open || items.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => (i + 1) % items.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => (i <= 0 ? items.length - 1 : i - 1));
    } else if (e.key === "Enter") {
      // Only when a row is highlighted — otherwise Enter belongs to whatever
      // the person was typing.
      if (active < 0) return;
      e.preventDefault();
      void choose(items[active]!);
    } else if (e.key === "Tab") {
      close();
    }
  };

  return (
    <>
      <input
        className="inp"
        ref={inputRef}
        name={name}
        id={name}
        type="text"
        autoComplete="off"
        placeholder={placeholder}
        value={value}
        disabled={disabled}
        onChange={(e) => onType(e.target.value)}
        onKeyDown={onKeyDown}
        {...(live
          ? {
              role: "combobox",
              "aria-expanded": open,
              "aria-controls": listId,
              "aria-autocomplete": "list" as const,
              "aria-activedescendant": active >= 0 ? `${listId}-${active}` : undefined,
            }
          : {})}
      />

      {open &&
        items.length > 0 &&
        createPortal(
          <div className="fg" style={{ display: "contents" }}>
            <div
              ref={popRef}
              className="adr-pop"
              id={listId}
              role="listbox"
              aria-label="Address suggestions"
              style={{
                left: anchor.left,
                top: anchor.top,
                bottom: anchor.bottom,
                width: anchor.width || undefined,
              }}
            >
              {items.map((s, i) => (
                <div
                  key={s.placeId}
                  id={`${listId}-${i}`}
                  role="option"
                  aria-selected={i === active}
                  className={i === active ? "adr-opt on" : "adr-opt"}
                  // preventDefault keeps focus in the input, so picking a row
                  // never blurs the field out from under the click.
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => void choose(s)}
                >
                  {s.text}
                </div>
              ))}
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
