"use client";

import type { ReactNode, Ref } from "react";
import { Dialog, type DialogWidth } from "@/components/parts/dialog";
import { SectionTabs, type TabItem } from "@/components/parts/tabs";
import { Dot } from "@/components/parts/state";

/* THE TWO WIZARDS' FRAME — the SWMS and the certificate, each the v2 dialog
   (rule 36) over the job page (Isaac, 25 October 2026: "every pop-up is the
   v2 dialog"; "the SWMS and certificate keep their steps, as underlined tabs
   inside the dialog, with Back and Continue").

   The title, a grey line naming the job and its address, the steps as
   section tabs (rule 31), and the screen under them, which scrolls between
   the tabs and the foot. While the steps are up the dialog keeps one
   height, so a tab never makes it jump; a short screen (the job loading,
   the template waiting, the paper issued) is as tall as it is.

   The pieces both wizards ask with live here too: a radio row, a step's
   box, and the list of what still stands in the way, each a press away
   from its answer. Styled by swms.css. */

export function WizardDialog({
  heading,
  line,
  tabs,
  width,
  tall = false,
  onClose,
  foot,
  scrollRef,
  children,
}: {
  heading: string;
  /** "Job 3385, 8/36 Abbott Road, Seven Hills NSW 2147" */
  line: string | null;
  tabs?: { items: readonly TabItem[]; current: string; onGo: (key: string) => void; ariaLabel: string; idPrefix: string; panelPrefix: string } | null;
  width: DialogWidth;
  /** one height while the steps are up */
  tall?: boolean;
  /** Escape, the scrim, and Cancel: the wizard decides whether it asks first */
  onClose: () => void;
  foot?: ReactNode;
  scrollRef?: Ref<HTMLDivElement>;
  children: ReactNode;
}) {
  return (
    <Dialog heading={heading} width={width} onClose={onClose} foot={foot}>
      <div className={tall ? "wzd wzd--tall" : "wzd"}>
        {line && <p className="wzd-line">{line}</p>}
        {tabs && <SectionTabs {...tabs} />}
        <div className="wzd-scroll" ref={scrollRef}>
          {children}
        </div>
      </div>
    </Dialog>
  );
}

/** The job's number and its address, on one line. */
export function jobLine(job: { number: string | null; address: string | null } | null): string | null {
  if (!job) return null;
  const address = job.address?.trim().replace(/\s*\n\s*/g, ", ") || null;
  const parts = [job.number ? `Job ${job.number}` : null, address].filter(Boolean);
  return parts.length ? parts.join(", ") : null;
}

/* A QUESTION: its label, a grey fact under it when the job already says
   something about it, then the answer. `htmlFor` ties the label to a
   control with that id; a tray names itself. `id` is where a problem
   lands. */
export function Q({ label, sub, htmlFor, id, children }: { label: string; sub?: ReactNode; htmlFor?: string; id?: string; children: ReactNode }) {
  return (
    <div className="wzd-q" id={id}>
      {htmlFor ? (
        <label className="wzd-ql" htmlFor={htmlFor}>
          {label}
        </label>
      ) : (
        <span className="wzd-ql">{label}</span>
      )}
      {sub != null && sub !== false && <span className="wzd-qs">{sub}</span>}
      {children}
    </div>
  );
}

/** What the foot says on its left: what the main button waits for, or what
    went wrong with it. */
export function FootWord({ tone, children }: { tone: "look" | "wrong"; children: ReactNode }) {
  return <span className={`wzd-footword wzd-footword--${tone}`}>{children}</span>;
}

/* A RADIO ROW: the browser's own radio, redrawn as the tick is (16, blue
   when on), with its words beside it, and a grey line under them when the
   choice needs one. A click on the words chooses. */
export function Radio({
  name,
  checked,
  onChange,
  label,
  sub,
  id,
  disabled = false,
}: {
  name: string;
  checked: boolean;
  onChange: () => void;
  label: string;
  sub?: string | null;
  id?: string;
  disabled?: boolean;
}) {
  return (
    <label className={disabled ? "wzd-radio wzd-radio--off" : "wzd-radio"}>
      <input id={id} type="radio" className="wzd-radio-in" name={name} checked={checked} disabled={disabled} onChange={() => onChange()} />
      <span className="wzd-words">
        <span className="wzd-title">{label}</span>
        {sub && <span className="wzd-sub">{sub}</span>}
      </span>
    </label>
  );
}

/** A tick's words: the title, and a grey line under it. For the Tick part's label. */
export function TickWords({ main, sub }: { main: ReactNode; sub?: ReactNode }) {
  return (
    <span className="wzd-words">
      <span className="wzd-title">{main}</span>
      {sub != null && <span className="wzd-sub">{sub}</span>}
    </span>
  );
}

/** A group: its heading, a grey fact on its right, and what it holds. */
export function Group({ heading, fact, id, children }: { heading: ReactNode; fact?: ReactNode; id?: string; children: ReactNode }) {
  return (
    <section className="wzd-grp" aria-labelledby={id}>
      <div className="wzd-gh">
        <h3 className="wzd-gt" id={id}>
          {heading}
        </h3>
        {fact != null && <span className="wzd-fact">{fact}</span>}
      </div>
      {children}
    </section>
  );
}

/* WHAT STILL STANDS IN THE WAY: an orange dot and each thing to answer,
   which takes you to the field that answers it. */
export function Jumps({ items, onJump }: { items: readonly { key: string; text: string }[]; onJump: (key: string, i: number) => void }) {
  if (items.length === 0) return null;
  return (
    <ul className="wzd-jumps">
      {items.map((p, i) => (
        <li key={`${p.key}:${p.text}`}>
          <Dot hue="orange" />
          <button type="button" className="wzd-jump" onClick={() => onJump(p.key, i)}>
            {p.text}
          </button>
        </li>
      ))}
    </ul>
  );
}

/* A field reached from a problem: after its screen has painted, bring it
   into view and focus it, or the first thing inside it a key can reach (a
   tray's chosen option). Two frames: the first commits the tab, the second
   lays it out. */
export function focusSoon(id: string) {
  const land = () => {
    const el = document.getElementById(id);
    if (!el) return;
    el.scrollIntoView?.({ block: "center" });
    const reach = el.matches("input, button, select, textarea, [tabindex]")
      ? el
      : el.querySelector<HTMLElement>('[tabindex="0"], input:not([type="hidden"]), button, textarea');
    (reach ?? el).focus();
  };
  if (typeof requestAnimationFrame === "function") requestAnimationFrame(() => requestAnimationFrame(land));
  else setTimeout(land, 0);
}
