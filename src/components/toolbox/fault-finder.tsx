"use client";

/* Fault Finder — Toolbox diagnostic tool. Pick a symptom, work the causes in
   likelihood order (Common → Possible → Rare), rule lines out as you clear
   them. Content lives in lib/toolbox/fault-finder.ts; ruled-out state is
   per-visit on purpose — a diagnosis session, not a document. */

import { useState } from "react";
import Link from "next/link";
import { Icon } from "@/components/shell/icon";
import {
  LIKELIHOOD_LABELS,
  LIKELIHOOD_ORDER,
  SYMPTOMS,
  type Cause,
  type Symptom,
} from "@/lib/toolbox/fault-finder";

function CauseCard({
  cause,
  open,
  ruledOut,
  onToggleOpen,
  onToggleRuled,
}: {
  cause: Cause;
  open: boolean;
  ruledOut: boolean;
  onToggleOpen: () => void;
  onToggleRuled: () => void;
}) {
  return (
    <div className={"ff-cause" + (open ? " open" : "") + (ruledOut ? " out" : "")}>
      <button type="button" className="ff-chead" onClick={onToggleOpen} aria-expanded={open}>
        <span className={"ff-lk " + cause.likelihood}>{LIKELIHOOD_LABELS[cause.likelihood]}</span>
        <b>{cause.title}</b>
        {cause.escalate && <span className="ff-esc">Specialist</span>}
        <span className="chev">
          <Icon name="chevR" size={16} />
        </span>
      </button>
      {open && (
        <div className="ff-cbody">
          <div className="ff-step">
            <span className="k">Check</span>
            <p>{cause.check}</p>
          </div>
          <div className="ff-step">
            <span className="k">Fix</span>
            <p>{cause.fix}</p>
          </div>
          <button type="button" className="ff-rule" onClick={onToggleRuled}>
            <span className="bx">
              <Icon name="check" size={12} />
            </span>
            {ruledOut ? "Ruled out — tap to restore" : "Rule this out"}
          </button>
        </div>
      )}
    </div>
  );
}

function SymptomDetail({ symptom }: { symptom: Symptom }) {
  const [openIdx, setOpenIdx] = useState<number | null>(0);
  const [ruled, setRuled] = useState<Set<number>>(new Set());

  const ordered = symptom.causes
    .map((c, i) => ({ c, i }))
    .sort((a, b) => LIKELIHOOD_ORDER[a.c.likelihood] - LIKELIHOOD_ORDER[b.c.likelihood]);

  const toggleRuled = (i: number) =>
    setRuled((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });

  return (
    <section className="tcard">
      <h2 className="tct">{symptom.label}</h2>
      <p className="tcs">Work top to bottom — most likely first. Rule lines out as you clear them.</p>
      {symptom.safety && (
        <div className="ff-safety" role="alert">
          <Icon name="alert" size={18} />
          <span>{symptom.safety}</span>
        </div>
      )}
      {ordered.map(({ c, i }) => (
        <CauseCard
          key={i}
          cause={c}
          open={openIdx === i}
          ruledOut={ruled.has(i)}
          onToggleOpen={() => setOpenIdx((o) => (o === i ? null : i))}
          onToggleRuled={() => toggleRuled(i)}
        />
      ))}
    </section>
  );
}

export function FaultFinder() {
  const [selected, setSelected] = useState<string | null>(null);
  const symptom = SYMPTOMS.find((s) => s.key === selected) ?? null;

  return (
    <div className="tcols stgp">
      <div>
        <section className="tcard">
          <h2 className="tct">What&apos;s it doing?</h2>
          <p className="tcs">Pick the symptom that best matches.</p>
          <div className="ff-grid">
            {SYMPTOMS.map((s) => (
              <button
                key={s.key}
                type="button"
                className={"ff-sym" + (selected === s.key ? " on" : "")}
                onClick={() => setSelected((k) => (k === s.key ? null : s.key))}
                aria-pressed={selected === s.key}
              >
                <span className="ic">
                  <Icon name={s.icon} size={20} />
                </span>
                <span>
                  <b>{s.label}</b>
                  <em>{s.blurb}</em>
                </span>
              </button>
            ))}
          </div>
        </section>

        {symptom && <SymptomDetail key={symptom.key} symptom={symptom} />}
      </div>

      <div className="tstick">
        <section className="tcard">
          <h2 className="tct">Before you start</h2>
          <ul style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 8 }}>
            {[
              "Ask when it last worked and what changed — filters cleaned, renovations, storms, power outages.",
              "Reproduce the fault yourself before changing anything.",
              "One change at a time, retest between changes.",
              "Photograph data plates, error patterns and anything you disturb.",
            ].map((n) => (
              <li key={n} className="tnote" style={{ margin: 0 }}>
                {n}
              </li>
            ))}
          </ul>
        </section>

        <section className="tcard">
          <h2 className="tct">Related tools</h2>
          <div className="ff-links">
            <Link href="/dashboard/toolbox/running-pressures">
              <span className="dot2" style={{ background: "#FF3366" }} />
              Running Pressures
              <Icon name="chevR" size={15} />
            </Link>
            <Link href="/dashboard/toolbox/heat-load">
              <span className="dot2" style={{ background: "#00E5C0" }} />
              Heat Load calculator
              <Icon name="chevR" size={15} />
            </Link>
          </div>
        </section>

        <section className="tcard">
          <p className="tnote" style={{ margin: 0 }}>
            Generic split / ducted guidance. Error codes are brand-specific —
            always confirm against the unit&apos;s service manual, and treat
            electrical or refrigerant work as licensed work.
          </p>
        </section>
      </div>
    </div>
  );
}
