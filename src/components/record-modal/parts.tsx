"use client";

import { createContext, useContext, useId, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ConfirmDialog, Dialog, type DialogWidth } from "@/components/parts/dialog";
import { Button } from "@/components/parts/button";
import { Dot, StateWord, type Tone } from "@/components/parts/state";
import { Fade } from "@/components/parts/fade";
import { Field } from "@/components/parts/field";
import { DateField } from "@/components/ui/date-field";

/* THE RECORD WINDOW'S VOCABULARY (the old-modals mock, 27 October 2026): a
   licence, a right to work, the organisation's licences and insurance, and
   the vehicle's records all open in the one Dialog part and are built from
   the same few shapes. A status line with its word; groups under a hairline,
   each with its name and, on the right, the one thing you do to it; facts as
   a label over a value; the history as rows that open in place. No cards
   inside the dialog, no eyebrows, no close cross: Escape, the scrim and the
   foot's buttons close it. */

/* ---- the frame ----

   ONE DIALOG, MANY SCREENS. A record window steps between screens (the card,
   its details, filing the next term) without closing, so the Dialog stays
   mounted and each screen writes its own title and foot into it: the frame
   hands them a place in the title and a place in the foot, and the screen
   portals into those places. Swapping a whole Dialog per screen flashed the
   page through the scrim on every step. */

type Slots = { head: HTMLElement | null; foot: HTMLElement | null };
/* null outside a frame: a screen rendered on its own (a test, a page that
   hosts it) writes its title and foot where it stands. */
const FrameSlots = createContext<Slots | null>(null);

export function RecordFrame({
  width = 720,
  onClose,
  children,
}: {
  width?: DialogWidth;
  /** Escape and the scrim. */
  onClose: () => void;
  children: ReactNode;
}) {
  const [head, setHead] = useState<HTMLElement | null>(null);
  const [foot, setFoot] = useState<HTMLElement | null>(null);
  return (
    <Dialog
      heading={<span ref={setHead} className="rcw-slot" />}
      foot={<div ref={setFoot} className="rcw-slot" />}
      width={width}
      onClose={onClose}
    >
      <FrameSlots.Provider value={{ head, foot }}>
        <div className="rcw-body">{children}</div>
      </FrameSlots.Provider>
    </Dialog>
  );
}

/** The screen's title, written into the dialog's own heading. */
export function FrameTitle({ children }: { children: ReactNode }) {
  const slots = useContext(FrameSlots);
  if (!slots) return <h2 className="rcw-title">{children}</h2>;
  return slots.head ? createPortal(children, slots.head) : null;
}

/** The screen's buttons, written into the dialog's foot, on the right. A
    `mk-gap` span among them pushes what comes before it to the left. */
export function FrameFoot({ children }: { children: ReactNode }) {
  const slots = useContext(FrameSlots);
  if (!slots) return <div className="rcw-foot">{children}</div>;
  return slots.foot ? createPortal(children, slots.foot) : null;
}

/* ---- what the record says ---- */

export type RecordState = "ok" | "warn" | "bad" | "none" | "forever";

const STATE_TONE: Record<RecordState, Tone> = { ok: "good", forever: "good", warn: "look", bad: "wrong", none: "info" };

/** The status line: its word in its colour, at the section size, and the fact
    beside it in grey. */
export function RecordStatus({ state, word, line }: { state: RecordState; word: ReactNode; line?: ReactNode }) {
  return (
    <p className="rcw-status">
      <StateWord tone={STATE_TONE[state]}>{word}</StateWord>
      {line ? <span className="rcw-status-line">{line}</span> : null}
    </p>
  );
}

/** A refusal from the server: the red dot and the reason (rule 42). */
export function RecordError({ children }: { children: ReactNode }) {
  return (
    <p className="rcw-err" role="alert">
      <Dot hue="red" />
      <span>{children}</span>
    </p>
  );
}

/** A group under a hairline: its name, a grey fact beside it, and the one
    thing you do to it on the right. */
export function Group({
  name,
  aside,
  action,
  className,
  children,
}: {
  /** The group's name, at 14/600. Not `title`: a `title=` reads as a tooltip. */
  name?: ReactNode;
  aside?: ReactNode;
  action?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={["rcw-grp", className].filter(Boolean).join(" ")}>
      {(name != null || aside != null || action != null) && (
        <div className="rcw-gh">
          {name != null && <h3 className="rcw-gh-t">{name}</h3>}
          {aside != null && <span className="rcw-gh-aside">{aside}</span>}
          {action != null && <span className="rcw-gh-act">{action}</span>}
        </div>
      )}
      <div className="rcw-gb">{children}</div>
    </section>
  );
}

/** What a group holds when it holds nothing yet. */
export function Nothing({ children }: { children: ReactNode }) {
  return <p className="rcw-empty">{children}</p>;
}

export type DetailItem = {
  label: string;
  value: ReactNode;
  /** "faint" for an empty value, "warn" for one inside a warning window. */
  tone?: "faint" | "warn";
  /** An action beside the value — "Add", "Edit". */
  action?: { label: string; onClick: () => void };
  wide?: boolean;
};

/** Facts: a grey label over its value, three to a row, four for a vehicle's
    specs. Dense, a value is one line and fades if it runs long (rule 50). */
export function DetailGrid({ items, cols = 3, dense }: { items: DetailItem[]; cols?: 3 | 4; dense?: boolean }) {
  return (
    <dl className={`rcw-facts${cols === 4 ? " rcw-facts--4" : ""}`}>
      {items.map((it) => (
        <div key={it.label} className={it.wide ? "rcw-fact rcw-fact--wide" : "rcw-fact"}>
          <dt>{it.label}</dt>
          <dd className={it.tone ? `rcw-fact-v rcw-fact-v--${it.tone}` : "rcw-fact-v"}>
            {dense ? <Fade>{it.value}</Fade> : it.value}
            {it.action && (
              <Button kind="quiet" size={32} onClick={it.action.onClick}>
                {it.action.label}
              </Button>
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** One row of a history, which opens in place: what it was, a grey line, the
    figures on the right, and Open. */
export function HistoryRow({
  name,
  line,
  aside,
  open,
  onToggle,
  children,
}: {
  name: ReactNode;
  line?: ReactNode;
  aside?: ReactNode[];
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <div className="rcw-hist">
      <div className="rcw-histrow">
        <span className="rcw-histk">
          <b>{name}</b>
          {line != null && <span>{line}</span>}
        </span>
        {aside?.filter(Boolean).map((a, i) => (
          <span key={i} className="rcw-histfig">
            {a}
          </span>
        ))}
        <Button kind="quiet" size={32} aria-expanded={open} onClick={onToggle}>
          {open ? "Close" : "Open"}
        </Button>
      </div>
      {open && <div className="rcw-histbody">{children}</div>}
    </div>
  );
}

/** Taking a term out of the history: a red word that asks once, in
    ConfirmDialog, naming what goes. It replaced "click again to remove". */
export function RemoveFromHistory({
  label,
  heading,
  confirm,
  disabled,
  onConfirm,
  children,
}: {
  label: string;
  heading: string;
  confirm: string;
  disabled?: boolean;
  onConfirm: () => void;
  children: ReactNode;
}) {
  const [asking, setAsking] = useState(false);
  return (
    <>
      <Button kind="delete" size={32} disabled={disabled} onClick={() => setAsking(true)}>
        {label}
      </Button>
      <ConfirmDialog
        open={asking}
        heading={heading}
        confirm={confirm}
        onConfirm={() => {
          setAsking(false);
          onConfirm();
        }}
        onClose={() => setAsking(false)}
      >
        <p>{children}</p>
      </ConfirmDialog>
    </>
  );
}

/* ---- colour ----

   The colour a card wears beside its name. Snapped to the palette's bright
   values (rule 15), and never red or blue: red only means wrong and blue only
   means press (Isaac left the mock's choice standing, 27 October 2026).
   "Auto" lets the type choose, as it did. */
export const RECORD_COLOURS: { label: string; value: string }[] = [
  { label: "Auto", value: "" },
  { label: "Orange", value: "#F97316" },
  { label: "Yellow", value: "#FACC15" },
  { label: "Green", value: "#22C55E" },
  { label: "Purple", value: "#A855F7" },
  { label: "Pink", value: "#EC4899" },
  { label: "Grey", value: "#9CA3AF" },
];

export function ColourDiscs({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="pt-field">
      <span className="pt-field-label">Colour</span>
      <div className="rcw-discs" role="group" aria-label="Colour">
        {RECORD_COLOURS.map((c) => (
          <button
            key={c.label}
            type="button"
            className={c.value ? "rcw-disc" : "rcw-disc rcw-disc--auto"}
            style={c.value ? { background: c.value } : undefined}
            aria-label={c.label}
            aria-pressed={value === c.value}
            onClick={() => onChange(c.value)}
          />
        ))}
      </div>
    </div>
  );
}

/* ---- a date, as a field ---- */

/** A date with its label above, the shape every record's fields share. The
    value is an ISO day or "" for none. */
export function DateIn({
  label,
  value,
  onChange,
  today,
  max,
  error,
  className,
}: {
  label: string;
  value: string;
  onChange: (iso: string) => void;
  today: string;
  max?: string;
  error?: string | null;
  className?: string;
}) {
  const id = useId();
  return (
    <Field label={label} id={id} error={error} className={className}>
      <DateField id={id} clearable today={today} max={max} value={value || null} onChange={(iso) => onChange(iso ?? "")} aria-label={label} invalid={!!error} />
    </Field>
  );
}
