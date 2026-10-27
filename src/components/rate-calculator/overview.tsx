"use client";

/* YOUR RATES, once the five steps are done: the two rates, Use these rates,
   the out-of-hours and day figures, and where each charged hour goes. Every
   figure is the engine's. */

import React from "react";
import type { CalcResult } from "./engine";
import type { RateCalcState } from "./state";
import { listed, money, rate0, gstOf, normUtil } from "./format";
import { Bar, type BarHue } from "./ui";
import { Button } from "@/components/parts/button";
import { StateWord } from "@/components/parts/state";

type Segment = { name: string; value: number; hue: BarHue };

// Per-hour decomposition of one rate, purely from engine outputs.
export function decompose(calc: CalcResult, which: "i" | "s"): { segments: Segment[]; rec: number } | null {
  const eff = which === "i" ? calc.effInst : calc.effSvc;
  const rec = which === "i" ? calc.recInst : calc.recSvc;
  const be = which === "i" ? calc.beInst : calc.beSvc;
  if (!eff || rec == null || be == null) return null;
  const lab = (which === "i" ? calc.instLab : calc.svcLab) / eff;
  const veh = (which === "i" ? calc.instVehicle : calc.svcVehicle) / eff;
  const direct = (which === "i" ? calc.directInst : calc.directSvc) / eff;
  const totalHr = (which === "i" ? calc.totalInst : calc.totalSvc) / eff;
  const pool = Math.max(0, totalHr - lab - veh - direct);
  const risk = Math.max(0, be - totalHr);
  const profit = Math.max(0, rec - be);
  return {
    rec,
    segments: [
      { name: "Wages", value: lab, hue: "purple" },
      { name: "Vehicles", value: veh, hue: "yellow" },
      { name: "Overheads", value: pool + direct, hue: "orange" },
      { name: "Risk", value: risk, hue: "grey" },
      { name: "Profit", value: profit, hue: "green" },
    ],
  };
}

/** How the recommended rate sits against what you charge now. */
function AgainstNow({ rec, cur }: { rec: number; cur: number | null }) {
  if (cur == null) return null;
  const diff = Math.round(rec) - cur;
  if (diff > 0) return <StateWord tone="look">{`$${diff} more than now`}</StateWord>;
  return <StateWord tone="good">{diff < 0 ? `$${-diff} less than now` : "What you charge now"}</StateWord>;
}

function Rate({ label, rec, be, cur, proj }: { label: string; rec: number | null; be: number | null; cur: number | null; proj: number | null }) {
  return (
    <div className="rc-herorate">
      <span>{label}</span>
      <b>{rec == null ? "—" : `${rate0(rec)} an hour`}</b>
      {rec != null && (
        <div className="rc-line">
          <span>{gstOf(rec)} with GST{proj != null ? `, ${rate0(proj)} next year` : ""}</span>
          <AgainstNow rec={rec} cur={cur} />
        </div>
      )}
      <dl className="rc-rows">
        <div><dt>Breaks even at</dt><dd>{rate0(be)}</dd></div>
        <div><dt>You charge</dt><dd>{cur != null ? `$${cur}` : "Not set"}</dd></div>
      </dl>
    </div>
  );
}

function HourBar({ label, d }: { label: string; d: { segments: Segment[]; rec: number } | null }) {
  if (!d) return null;
  return (
    <div className="rc-hours">
      <div className="rc-hours-l"><span>{label}</span><span>{rate0(d.rec)} an hour</span></div>
      <Bar parts={d.segments.map(p => ({ name: p.name, share: p.value, hue: p.hue, figure: rate0(p.value) }))} />
    </div>
  );
}

export function YourRates({ s, calc, uplift, ready, missing, go, patch }: {
  s: RateCalcState; calc: CalcResult;
  uplift: number | null; ready: boolean; missing: string[];
  go: (step: number) => void; patch: (p: Partial<RateCalcState>) => void;
}) {
  // Not enough yet: say what's missing and lead with the way to it (rule 40).
  if (!ready) {
    return (
      <div className="rc-wide">
        <div className="rc-empty">
          <p>Your rates show once you&apos;ve entered {listed(missing)}.</p>
          <Button kind="main" onClick={() => go(0)}>Back to the steps</Button>
        </div>
      </div>
    );
  }

  const applied = calc.recInst != null && calc.recSvc != null && s.currentRates.install === Math.round(calc.recInst) && s.currentRates.service === Math.round(calc.recSvc);
  // Safeguard: uplift is only non-null when both current rates are set, and
  // it's floored at 0 — so 0 means the business already charges at or above
  // the recommended rates. Never offer Use there (it would LOWER the rates).
  const alreadyHealthy = !applied && uplift != null && uplift === 0;
  const apply = () => {
    if (calc.recInst == null || calc.recSvc == null) return;
    patch({
      currentRates: { install: Math.round(calc.recInst), service: Math.round(calc.recSvc) },
      reviewState: { ...s.reviewState, lastReviewed: new Date().toISOString() },
    });
  };
  const inst = Math.round(normUtil(calc.instUtil));
  const svc = Math.round(normUtil(calc.svcUtil));
  const sure = calc.weeksSubmitted > 0 ? `${calc.confidence.label}, ${calc.weeksSubmitted} weeks of timesheets` : `${calc.confidence.label}, from your totals`;

  return (
    <div className="rc-wide">
      <div className="rc-steptop">
        <div className="rc-steptop-w"><h2>Your recommended rates</h2><span>{sure}</span></div>
        <Button kind="quiet" onClick={() => go(0)}>Back to the steps</Button>
      </div>

      <div className="rc-hero">
        <Rate label="Install" rec={calc.recInst} be={calc.beInst} cur={s.currentRates.install} proj={calc.projInst} />
        <Rate label="Service" rec={calc.recSvc} be={calc.beSvc} cur={s.currentRates.service} proj={calc.projSvc} />
      </div>

      <div className="rc-apply">
        {applied ? (
          <div><b>These are the rates you charge</b></div>
        ) : alreadyHealthy ? (
          <div><b>You&apos;re priced right</b><span>What you charge already covers your costs and your margin, so no increase needed.</span></div>
        ) : (
          <>
            <div>
              <b>{uplift != null && uplift > 0 ? `Charging these recovers ${money(uplift)} a year` : "Charge these from now on"}</b>
            </div>
            <Button kind="main" onClick={apply}>Use these rates</Button>
          </>
        )}
      </div>

      <div className="rc-tiles is-four">
        <div className="rc-tile"><span>After hours</span><b>{rate0(calc.afterHrs)}</b></div>
        <div className="rc-tile"><span>Emergency</span><b>{rate0(calc.emergency)}</b></div>
        <div className="rc-tile"><span>A full day on site</span><b>{calc.daily != null ? money(calc.daily) : "—"}</b>{calc.daily == null && <em>Set the hours in Settings</em>}</div>
        <div className="rc-tile"><span>Billable</span><b>{inst + svc}%</b><em>Install {inst}%, service {svc}%</em></div>
      </div>

      <div className="rc-q">
        <h3>Where each charged hour goes</h3>
        <HourBar label="Install" d={decompose(calc, "i")} />
        <HourBar label="Service" d={decompose(calc, "s")} />
        {calc.payrollTax > 0 && <p className="rc-note">Wages include payroll tax, {money(calc.payrollTax)} a year.</p>}
      </div>
    </div>
  );
}
