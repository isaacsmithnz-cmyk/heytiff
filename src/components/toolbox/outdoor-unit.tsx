"use client";

/* Outdoor Unit Placement — Toolbox quick-check. One question: can this unit go
   here without council approval?

   Reading order is the layout: set the job (it decides which lines apply), work
   the list, read the answer beside it, check the drawing, and the fine print
   sits plainly at the bottom. The job strip lives at the TOP of the list card
   because it is the premise for everything under it — it was briefly a collapsed
   bar below the answer, which put an input after its own output and hid the
   reason the list changed length.

   Answers are tri-state on purpose. Every line has to pass, so plain checkboxes
   would read "approval needed" on first paint before anyone had answered
   anything. Unanswered is its own state. */

import { useState } from "react";
import { Icon } from "@/components/shell/icon";
import { PlacementDiagram } from "./outdoor-unit-diagram";
import {
  DEFAULT_PLACEMENT,
  QUIET_HOURS,
  QUIET_HOURS_PENALTY,
  QUIET_HOURS_RULE,
  SOURCE_NOTE,
  check,
  marksFor,
  rulesFor,
  type Answer,
  type Answers,
  type Floor,
  type Heritage,
  type Placement,
  type PropertyType,
} from "@/lib/toolbox/outdoor-unit";

const VERDICT = {
  clear: {
    cls: "clear",
    big: "Not needed",
    line: "Every line passes — it can go in as is.",
  },
  approval: {
    cls: "stop",
    big: "Needed",
    line: "Move the unit until every line passes, or lodge it with the council.",
  },
  unanswered: {
    cls: "wait",
    big: "—",
    line: "Work the list for a straight answer.",
  },
} as const;

const BUILDINGS: [PropertyType, string][] = [
  ["home", "A home"],
  ["business", "Shop / office"],
];
const HERITAGE: [Heritage, string][] = [
  ["none", "No"],
  ["area", "Conservation area"],
  ["item", "Heritage item"],
];
const FLOORS: [Floor, string][] = [
  ["ground", "Ground floor"],
  ["above", "Upper storey"],
];

/* This asks where the UNIT is bolted, not which rooms it serves — read the
   other way it would wrongly lift the 1.8 m cap off a ground-mounted unit. */
const TIP_HERITAGE =
  "A listed heritage item carries more restrictions than a property that merely sits inside a conservation area — on a home, only an item has to be ground-mounted.";

const TIP_LEVEL =
  "Where the outdoor unit itself is fixed — not which rooms it serves. A unit on an upper-storey balcony or wall has no height limit; one on the ground floor is capped at 1.8 m.";

export function OutdoorUnit() {
  const [place, setPlace] = useState<Placement>(DEFAULT_PLACEMENT);
  const [answers, setAnswers] = useState<Answers>({});

  const rules = rulesFor(place);
  const result = check(place, answers);
  const v = VERDICT[result.verdict];
  const done = result.total - result.unanswered.length;

  const answer = (id: string, a: Answer) =>
    setAnswers((prev) => ({ ...prev, [id]: prev[id] === a ? undefined : a }));

  return (
    <div className="oup stgp">
      {/* -------- the job, then the list it decides -------- */}
      <section className="tcard oup-list">
        <div className="oup-job">
          <div>
            <span className="tlab">Building</span>
            <div className="tseg" role="group" aria-label="Building type">
              {BUILDINGS.map(([k, label]) => (
                <button
                  key={k}
                  type="button"
                  className={place.property === k ? "on" : ""}
                  aria-pressed={place.property === k}
                  onClick={() => setPlace({ ...place, property: k })}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <span className="tlab">
              Unit sits on{" "}
              <i className="htip" data-tip={TIP_LEVEL}>
                i
              </i>
            </span>
            <div className="tseg" role="group" aria-label="Which level the unit sits on">
              {FLOORS.map(([k, label]) => (
                <button
                  key={k}
                  type="button"
                  className={place.floor === k ? "on" : ""}
                  aria-pressed={place.floor === k}
                  onClick={() => setPlace({ ...place, floor: k })}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          {/* three-way, not a switch: cl 2.6 asks less of a property that is
              merely inside a conservation area than of a listed item */}
          <div className="wide">
            <span className="tlab">
              Heritage{" "}
              <i className="htip" data-tip={TIP_HERITAGE}>
                i
              </i>
            </span>
            <div className="tseg" role="group" aria-label="Heritage status">
              {HERITAGE.map(([k, label]) => (
                <button
                  key={k}
                  type="button"
                  className={place.heritage === k ? "on" : ""}
                  aria-pressed={place.heritage === k}
                  onClick={() => setPlace({ ...place, heritage: k })}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="oup-lhead">
          <span className="tlab">Every line has to pass</span>
          <span className="ct">{rules.length} to check</span>
        </div>

        {rules.map((r) => {
          const [yes, no] = r.answerLabels ?? ["Yes", "No"];
          const a = answers[r.id];
          return (
            <div key={r.id} className={"oup-row" + (a ? " " + a : "")}>
              <span className="dot" aria-hidden="true" />
              <span className="lb">
                <b>{r.label}</b>
                <i className="htip" data-tip={r.tip ? `${r.detail} ${r.tip}` : r.detail}>
                  i
                </i>
              </span>
              <div className="oup-ans">
                <div className="tseg" role="group" aria-label={r.label}>
                  <button
                    type="button"
                    className={a === "yes" ? "on" : ""}
                    aria-pressed={a === "yes"}
                    onClick={() => answer(r.id, "yes")}
                  >
                    {yes}
                  </button>
                  <button
                    type="button"
                    className={a === "no" ? "on" : ""}
                    aria-pressed={a === "no"}
                    onClick={() => answer(r.id, "no")}
                  >
                    {no}
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </section>

      {/* -------- the answer -------- */}
      <section className={"oup-hero " + v.cls} aria-live="polite">
        <div className="lab">Council approval</div>
        <div className={"big" + (result.verdict === "unanswered" ? " empty" : "")}>{v.big}</div>
        <div className={"cls" + (result.verdict === "unanswered" ? " dim" : "")}>{v.line}</div>
        <div className="bar" aria-hidden="true">
          <i style={{ width: `${result.total ? (done / result.total) * 100 : 0}%` }} />
        </div>
        <div className="meta">
          {done} of {result.total} answered
          {result.failed.length > 0 && ` · ${result.failed.length} to fix`}
        </div>
      </section>

      {/* -------- where it sits -------- */}
      <section className="tcard oup-fig">
        <PlacementDiagram marks={marksFor(place, answers)} />
      </section>

      {/* -------- the fine print: on screen, not behind a fold -------- */}
      <section className="tcard oup-fine">
        <div>
          <h3 className="tct">
            <Icon name="alert" size={15} />
            When it can run
          </h3>
          {QUIET_HOURS.map((h) => (
            <div key={h.day} className="oup-hours">
              <b>{h.day}</b>
              <em>{h.window}</em>
            </div>
          ))}
          <p className="tnote">
            {QUIET_HOURS_RULE} {QUIET_HOURS_PENALTY}
          </p>
        </div>
        <div>
          <h3 className="tct">
            <Icon name="file" size={15} />
            Where this comes from
          </h3>
          <p className="tnote" style={{ marginTop: 0 }}>
            {SOURCE_NOTE}
          </p>
        </div>
      </section>
    </div>
  );
}
