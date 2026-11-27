"use client";

import { type ReactNode } from "react";
import { Button } from "@/components/parts/button";
import { Icon } from "@/components/shell/icon";
import { CvBox } from "@/components/conversations/box";
import { fmtAddition } from "@/lib/workboard/project-money";

/* HER QUESTIONS, ONE AT A TIME (Isaac, 26 November 2026: "Focus on one
   question at a time, so it kind of hold the screen on that question, then
   scrolls down once answered and so on. You have the ability to scroll back
   up and change answers", then "B" to
   https://claude.ai/artifact/RZfWLd6DGdYb5kAYCAdY4r). In the talk, the
   ones answered are a ticked line each with Change, and the one you're on is
   the card at its foot: its answers to tap, the likely one blue, and your
   own answer under them, which goes to that question. Settle asks the same
   questions over Build, one large in the middle, with Previous and Skip for
   now; she works on each answer as it's given ("Still allow her to work in
   the background while you are answering more"). */

export type Ask = {
  id: number;
  question: string;
  /** the question in a few words, for its answered line */
  topic: string;
  /** what the quote has for it now */
  put: string;
  answers: { label: string }[];
  /** what each answer does to the price; null where it can't be priced */
  deltas: (number | null)[];
  /** your answer: tapped, typed, or from your message */
  done: { label: string; typed: boolean } | null;
};

/** A price difference as an answer shows it: nothing for none. */
const deltaWords = (c: number | null | undefined) => (c == null ? "" : fmtAddition(c));

/** The one being asked: its answers, then your own. Changing an answered one
    marks yours, and Leave it as it is closes it again. */
export function AskCard({
  ask,
  step,
  busy,
  draft,
  onDraft,
  onPick,
  onOwn,
  onLeave,
  large = false,
}: {
  ask: Ask;
  /** "Question 2 of 3", or "Changing question 1" */
  step: string;
  busy: boolean;
  draft: string;
  onDraft: (words: string) => void;
  onPick: (index: number) => void;
  /** your own words to her; none where she isn't on, and then no box */
  onOwn?: () => void;
  /** set while an answered one is being changed */
  onLeave?: () => void;
  /** in Settle: the question large */
  large?: boolean;
}) {
  const changing = !!onLeave;
  return (
    <div className={`qx-card qx-ask qx-now${large ? " qx-now--large" : ""}`}>
      <p className="qx-step">{step}</p>
      <p className="qx-askq">{ask.question}</p>
      {changing && ask.done ? <p className="qx-askput">{`Your answer: ${ask.done.label}`}</p> : ask.put && <p className="qx-askput">{`On the quote now: ${ask.put}`}</p>}
      <div className="qx-answers">
        {ask.answers.map((a, i) => {
          const yours = changing && ask.done?.label === a.label;
          return (
            <Button
              key={i}
              kind={!changing && i === 0 ? "main" : "second"}
              size={44}
              className={yours ? "qx-answer picked" : "qx-answer"}
              aria-pressed={changing ? yours : undefined}
              disabled={busy || yours || (!changing && ask.deltas[i] === null)}
              onClick={() => onPick(i)}
            >
              <span>{a.label}</span>
              {yours ? <span className="qx-r">Your answer</span> : !changing && deltaWords(ask.deltas[i]) && <span className="qx-r">{deltaWords(ask.deltas[i])}</span>}
            </Button>
          );
        })}
        {onOwn && (
          <div className="qx-own">
            <CvBox value={draft} onChange={onDraft} onSubmit={onOwn} label={`Your own answer to: ${ask.question}`} placeholder="Your own answer" sendWord="Send" sendLabel="Send your answer to Tiff" waiting={busy} dict={null} tiff={false} />
          </div>
        )}
        {onLeave && (
          <Button kind="second" size={44} className="qx-answer" disabled={busy} onClick={onLeave}>
            Leave it as it is
          </Button>
        )}
      </div>
    </div>
  );
}

/** An answered one: what it was, your answer, and Change. */
export function AskDone({ ask, onChange }: { ask: Ask; onChange?: () => void }) {
  return (
    <div className="qx-card qx-done">
      <span className="qx-tick">
        <Icon name="check" size={16} />
      </span>
      <span className="qx-dq">{ask.topic}</span>
      <b className="qx-da">{ask.done?.label}</b>
      {onChange && (
        <Button kind="quiet" size={32} onClick={onChange} aria-label={`Change your answer to: ${ask.question}`}>
          Change
        </Button>
      )}
    </div>
  );
}

/** How far through you are: one bar for each, done green, the one you're on ink. */
export function AskBars({ asks, at }: { asks: Ask[]; at: number | null }) {
  return (
    <span className="qx-bars" aria-hidden="true">
      {asks.map((a) => (
        <i key={a.id} className={a.id === at ? "on" : a.done ? "done" : undefined} />
      ))}
    </span>
  );
}

/** SETTLE, over Build: the questions alone, one large in the middle, what's
    settled under it, her work on the line above the foot, and Previous and
    Skip for now at the foot. Back to the chat closes it; the chat holds the
    same answers. */
function SettleView({
  asks,
  at,
  card,
  done,
  working,
  onBack,
  onPrevious,
  onSkip,
}: {
  asks: Ask[];
  /** the one on screen */
  at: number | null;
  card: ReactNode;
  /** the answered ones, as their lines */
  done: ReactNode;
  working: ReactNode;
  onBack: () => void;
  onPrevious?: () => void;
  onSkip?: () => void;
}) {
  const n = at == null ? -1 : asks.findIndex((a) => a.id === at);
  return (
    <section className="qx-settle" aria-label="Questions to settle">
      <div className="qx-shead">
        <h2>Questions to settle</h2>
        <AskBars asks={asks} at={at} />
        {n >= 0 && <span className="qx-sof">{`${n + 1} of ${asks.length}`}</span>}
        <Button kind="second" size={36} onClick={onBack}>
          Back to the chat
        </Button>
      </div>
      <div className="qx-sbody">
        <div className="qx-scol">
          {card ?? <p className="qx-settled">Every question is settled.</p>}
          {done}
        </div>
      </div>
      {working}
      <div className="qx-sfoot">
        {onPrevious ? (
          <Button kind="quiet" size={36} onClick={onPrevious}>
            Previous
          </Button>
        ) : (
          <span />
        )}
        {onSkip && (
          <Button kind="quiet" size={36} onClick={onSkip}>
            Skip for now
          </Button>
        )}
      </div>
    </section>
  );
}

type Acts = {
  asks: Ask[];
  /** the open one you're on */
  current: Ask | null;
  /** an answered one asked again */
  changing: number | null;
  busy: boolean;
  drafts: Record<number, string>;
  onDraft: (id: number, words: string) => void;
  onPick: (ask: Ask, index: number) => void;
  onOwn: (ask: Ask) => void;
  onChange: (id: number | null) => void;
};

function cardFor(a: Ask, p: Acts, large: boolean) {
  const n = p.asks.findIndex((x) => x.id === a.id) + 1;
  return (
    <AskCard
      key={a.id}
      ask={a}
      step={a.done ? `Changing question ${n}` : `Question ${n} of ${p.asks.length}`}
      busy={p.busy}
      draft={p.drafts[a.id] ?? ""}
      onDraft={(w) => p.onDraft(a.id, w)}
      onPick={(i) => p.onPick(a, i)}
      onOwn={() => p.onOwn(a)}
      onLeave={a.done ? () => p.onChange(null) : undefined}
      large={large}
    />
  );
}

/** In the talk: the answered ones, each its line with Change (or its card
    while it's changed), then the one you're on. */
export function TalkAsks(p: Acts) {
  return (
    <section className="qx-asks" aria-label="Tiff's questions">
      {p.asks
        .filter((a) => a.done)
        .map((a) => (a.id === p.changing ? cardFor(a, p, false) : <AskDone key={a.id} ask={a} onChange={() => p.onChange(a.id)} />))}
      {p.current && p.changing == null && cardFor(p.current, p, false)}
    </section>
  );
}

/** Settle over Build: the one on screen large, what's settled under it. */
export function SettleAsks({ working, onBack, onSkip, ...p }: Acts & { working: ReactNode; onBack: () => void; onSkip: (id: number) => void }) {
  const onScreen = p.changing != null ? (p.asks.find((a) => a.id === p.changing) ?? null) : p.current;
  const at = onScreen ? p.asks.findIndex((a) => a.id === onScreen.id) : p.asks.length;
  const previous = p.asks.slice(0, Math.max(0, at)).findLast((a) => a.done) ?? null;
  const settled = p.asks.filter((a) => a.done && a.id !== onScreen?.id);
  const open = p.asks.filter((a) => !a.done).length;
  return (
    <SettleView
      asks={p.asks}
      at={onScreen?.id ?? null}
      card={onScreen ? cardFor(onScreen, p, true) : null}
      done={
        settled.length > 0 ? (
          <div className="qx-sdone">
            <h3>Settled</h3>
            {settled.map((a) => (
              <AskDone key={a.id} ask={a} onChange={() => p.onChange(a.id)} />
            ))}
          </div>
        ) : null
      }
      working={working}
      onBack={() => {
        p.onChange(null);
        onBack();
      }}
      onPrevious={previous ? () => p.onChange(previous.id) : undefined}
      onSkip={p.changing == null && p.current && open > 1 ? () => onSkip(p.current!.id) : undefined}
    />
  );
}
