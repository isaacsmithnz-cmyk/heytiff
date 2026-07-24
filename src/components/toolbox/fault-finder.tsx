"use client";

/* Fault Finder — guided diagnosis, one question at a time.

   Walks the way you'd walk an apprentice through a callout: look at the
   obvious thing, and let the answer decide what to look at next. Three
   states — pick a symptom, answer questions, read the outcome — with the
   trail of answers kept visible so you can step back without starting over.

   All the diagnostic content lives in lib/toolbox/guided.ts; this file is
   only the walk through it. */

import { useState } from "react";
import Link from "next/link";
import { Icon } from "@/components/shell/icon";
import {
  getOutcome,
  getQuestion,
  getSymptom,
  isOutcomeRef,
  outcomeId,
  remainingLabel,
  SYMPTOMS,
  type Answer,
  type Outcome,
  type TrailStep,
} from "@/lib/toolbox/guided";
import "./toolbox.css";

const CONFIDENCE_LABEL = {
  likely: "Most likely",
  possible: "Possible",
  info: "For information",
} as const;

/* ---------------- symptom picker ---------------- */

function SymptomPicker({ onPick }: { onPick: (key: string) => void }) {
  return (
    <section className="tcard ffg-pick">
      <h2 className="tct">What&apos;s it doing?</h2>
      <p className="tcs">Pick the closest match — the questions adapt from there.</p>
      <div className="ffg-grid">
        {SYMPTOMS.map((s) => (
          <button
            key={s.key}
            type="button"
            className="ffg-sym"
            style={{ "--sc2": s.color } as React.CSSProperties}
            onClick={() => onPick(s.key)}
          >
            <span className="ic">
              <Icon name={s.icon} size={20} />
            </span>
            <span className="tx">
              <b>{s.label}</b>
              <em>{s.blurb}</em>
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}

/* ---------------- the trail of answers so far ---------------- */

function Trail({
  steps,
  color,
  onBack,
}: {
  steps: TrailStep[];
  color: string;
  onBack: (index: number) => void;
}) {
  if (steps.length === 0) return null;
  return (
    <ol className="ffg-trail">
      {steps.map((s, i) => (
        <li key={s.questionId}>
          <button type="button" onClick={() => onBack(i)} title="Go back to this step">
            <span className="q">{s.ask}</span>
            <span className="a" style={{ color }}>
              {s.answer}
            </span>
            <Icon name="edit" size={12} />
          </button>
        </li>
      ))}
    </ol>
  );
}

/* ---------------- outcome ---------------- */

function OutcomeCard({ outcome, color }: { outcome: Outcome; color: string }) {
  return (
    <>
      <section className="ffg-outcome" style={{ "--sc2": color } as React.CSSProperties}>
        <span className="gl" />
        <div className="lab">
          {CONFIDENCE_LABEL[outcome.confidence]}
          {outcome.escalate && <span className="esc">Specialist work</span>}
        </div>
        <h2>{outcome.title}</h2>
        <p>{outcome.explain}</p>
      </section>

      {/* explaining it first, then doing it — on these calls the words are
          most of the job */}
      {outcome.customer && (
        <section className="tcard ffg-say" style={{ "--sc2": color } as React.CSSProperties}>
          <h3 className="tct">What to tell the customer</h3>
          <p>{outcome.customer}</p>
        </section>
      )}

      <section className="tcard ffg-actions">
        <h3 className="tct">What to do</h3>
        <ol>
          {outcome.actions.map((a) => (
            <li key={a}>{a}</li>
          ))}
        </ol>
        {outcome.tool && (
          <Link href={outcome.tool.href} className="tbtn ffg-tool">
            {outcome.tool.label}
            <Icon name="arrowR" size={16} />
          </Link>
        )}
      </section>
    </>
  );
}

/* ---------------- the walk ---------------- */

export function FaultFinder() {
  const [symptomKey, setSymptomKey] = useState<string | null>(null);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [trail, setTrail] = useState<TrailStep[]>([]);
  const [finished, setFinished] = useState<string | null>(null);

  const symptom = symptomKey ? getSymptom(symptomKey) : undefined;
  const color = symptom?.color ?? "#FF3366";
  const question = currentId ? getQuestion(currentId) : undefined;
  const outcome = finished ? getOutcome(finished) : undefined;

  const start = (key: string) => {
    const s = getSymptom(key);
    if (!s) return;
    setSymptomKey(key);
    setCurrentId(s.start);
    setTrail([]);
    setFinished(null);
  };

  const answer = (a: Answer) => {
    if (!question) return;
    setTrail((t) => [...t, { questionId: question.id, ask: question.ask, answer: a.label }]);
    if (isOutcomeRef(a.next)) {
      setFinished(outcomeId(a.next));
      setCurrentId(null);
    } else {
      setCurrentId(a.next);
    }
  };

  /** Rewind to a step in the trail — everything after it is discarded. */
  const backTo = (index: number) => {
    const step = trail[index];
    setTrail(trail.slice(0, index));
    setCurrentId(step.questionId);
    setFinished(null);
  };

  const backOne = () => {
    if (trail.length === 0) return restart();
    backTo(trail.length - 1);
  };

  const restart = () => {
    setSymptomKey(null);
    setCurrentId(null);
    setTrail([]);
    setFinished(null);
  };

  /* ---- state 1: pick a symptom ---- */
  if (!symptom) {
    return (
      <div className="ffg stgp">
        <SymptomPicker onPick={start} />
        <aside className="ffg-side">
          <section className="tcard">
            <h3 className="tct">Before you start</h3>
            <ul className="ffg-notes">
              {[
                "Ask when it last worked and what changed — filters, renovations, storms, power outages.",
                "Reproduce the fault yourself before changing anything.",
                "One change at a time, and retest between changes.",
                "Photograph data plates and any error pattern before you clear it.",
              ].map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          </section>
          <section className="tcard">
            <h3 className="tct">Related tools</h3>
            <div className="ffg-links">
              <Link href="/dashboard/toolbox/running-pressures">
                <span className="dot2" style={{ background: "#FF3366" }} />
                Running Pressures
                <Icon name="chevR" size={15} />
              </Link>
              <Link href="/dashboard/toolbox/heat-load">
                <span className="dot2" style={{ background: "#00E5C0" }} />
                Heat Load
                <Icon name="chevR" size={15} />
              </Link>
            </div>
          </section>
        </aside>
      </div>
    );
  }

  /* ---- states 2 & 3: questions, then the outcome ---- */
  return (
    <div className="ffg ffg-run stgp">
      <div className="ffg-main">
        {/* the symptom you're on, always visible, always changeable */}
        <div className="ffg-head" style={{ "--sc2": color } as React.CSSProperties}>
          <span className="ic">
            <Icon name={symptom.icon} size={18} />
          </span>
          <b>{symptom.label}</b>
          <span className="step">
            {outcome ? "Diagnosis" : `Question ${trail.length + 1}`}
          </span>
          {/* how much further — without it a long branch reads as endless */}
          {question && <span className="left">{remainingLabel(question.id)}</span>}
          <button type="button" className="chg" onClick={restart}>
            Change
          </button>
        </div>

        {symptom.safety && trail.length === 0 && (
          <div className="ffg-safety" role="alert">
            <Icon name="alert" size={18} />
            <span>{symptom.safety}</span>
          </div>
        )}

        <Trail steps={trail} color={color} onBack={backTo} />

        {question && (
          <section className="ffg-q" style={{ "--sc2": color } as React.CSSProperties}>
            <h2>{question.ask}</h2>
            {question.why && <p className="why">{question.why}</p>}
            {question.safety && (
              <div className="ffg-safety inline" role="alert">
                <Icon name="alert" size={16} />
                <span>{question.safety}</span>
              </div>
            )}
            <div className="ffg-answers">
              {question.answers.map((a) => (
                <button key={a.label} type="button" className="ffg-a" onClick={() => answer(a)}>
                  <span className="al">
                    <b>{a.label}</b>
                    {a.hint && <em>{a.hint}</em>}
                  </span>
                  <Icon name="chevR" size={18} />
                </button>
              ))}
            </div>
          </section>
        )}

        {outcome && <OutcomeCard outcome={outcome} color={color} />}

        <div className="ffg-nav">
          <button type="button" className="tbtn ghost" onClick={backOne}>
            <Icon name="chevL" size={15} />
            Back
          </button>
          <button type="button" className="tbtn ghost" onClick={restart}>
            Start over
          </button>
        </div>
      </div>
    </div>
  );
}
