"use client";

/* INSIGHTS, for reference: last financial year, billable time, profit, and
   where the business stands. Nothing here changes a rate. The arithmetic is
   the handoff's, verbatim. */

import React from "react";
import type { CalcResult } from "./engine";
import type { RateCalcState } from "./state";
import { listed, money, normUtil, rate0 } from "./format";
import { Facts } from "./ui";
import { EofyPanel } from "./eofy";
import { BusinessSummaryPanel } from "./business-summary";
import { Button } from "@/components/parts/button";
import { StateWord, type Tone } from "@/components/parts/state";

/** Billable time's verdict, in the handoff's bands. */
function verdict(p: number): { word: string; tone: Tone } {
  return p < 35 ? { word: "Critical", tone: "wrong" }
    : p < 50 ? { word: "Low", tone: "look" }
    : p < 65 ? { word: "Below target", tone: "look" }
    : { word: "Healthy", tone: "good" };
}

/** A share of paid hours, with the 65% and 80% marks across it. */
function Gauge({ label, pct, hue }: { label: string; pct: number; hue: "purple" | "pink" | "green" }) {
  return (
    <>
      <div className="rc-hours-l"><span>{label}</span><span>{pct.toFixed(0)}%</span></div>
      <div className="rc-gauge" role="img" aria-label={`${label}, ${pct.toFixed(0)}% of paid hours`}>
        <span className={`rc-c-${hue}`} style={{ width: `${Math.min(pct, 100)}%` }} />
        <i style={{ left: "65%" }} />
        <i style={{ left: "80%" }} />
      </div>
    </>
  );
}

export function BillableTime({ calc }: { calc: CalcResult }) {
  const instUtil = normUtil(calc.instUtil);
  const svcUtil = normUtil(calc.svcUtil);
  const together = instUtil + svcUtil;
  const isDefault = calc.utilFromDefault;
  const v = verdict(together);
  const low = [
    { label: "Install", pct: instUtil },
    { label: "Service", pct: svcUtil },
  ].filter(u => !isDefault && u.pct < 65);
  return (
    <div className="rc-q">
      <div className="rc-qhead">
        <h3>Billable time</h3>
        {isDefault ? <StateWord tone="info">The usual 75%</StateWord> : <StateWord tone={v.tone}>{v.word}</StateWord>}
      </div>
      <div className="rc-hours">
        <Gauge label="Install" pct={instUtil} hue="purple" />
        <Gauge label="Service" pct={svcUtil} hue="pink" />
        <Gauge label="Together" pct={together} hue="green" />
      </div>
      {isDefault && <p className="rc-note">Until timesheets measure it.</p>}
      {low.length > 0 && (
        <p className="rc-note">
          {`Every point more of ${listed(low.map(u => u.label.toLowerCase()))} time takes about ${rate0((calc.recInst ?? 0) * 0.012)} off the rate an hour needs.`}
        </p>
      )}
      <Facts sum={false} rows={[
        ["Paid hours a year", calc.totalAnnualPaid.toLocaleString("en-AU")],
        ["Billable hours a year", Math.round(calc.effInst + calc.effSvc).toLocaleString("en-AU")],
      ]} />
    </div>
  );
}

export function Profit({ calc }: { calc: CalcResult }) {
  const profInstHr = calc.profInst ?? 0;
  const profSvcHr = calc.profSvc ?? 0;
  const annualInst = profInstHr * calc.effInst;
  const annualSvc = profSvcHr * calc.effSvc;
  return (
    <div className="rc-q">
      <h3>Profit</h3>
      <Facts rows={[
        ["An install hour", rate0(profInstHr)],
        ["A service hour", rate0(profSvcHr)],
        ["Install next year", `${rate0(calc.projInst)} an hour`],
        ["Service next year", `${rate0(calc.projSvc)} an hour`],
        ["Install a year", money(annualInst)],
        ["Service a year", money(annualSvc)],
        ["At the recommended rates", money(annualInst + annualSvc)],
      ]} />
    </div>
  );
}

export function InsightsView({ s, patch, calc, ready, go }: {
  s: RateCalcState; patch: (p: Partial<RateCalcState>) => void; calc: CalcResult;
  ready: boolean; go: (step: number) => void;
}) {
  if (!ready) {
    return (
      <div className="rc-wide">
        <div className="rc-empty">
          <p>Insights show once your rates are worked out, after the first step.</p>
          <Button kind="main" onClick={() => go(0)}>Back to the steps</Button>
        </div>
      </div>
    );
  }
  return (
    <div className="rc-wide">
      <div className="rc-steptop">
        <h2>Insights</h2>
        <Button kind="quiet" onClick={() => go(5)}>Back to your rates</Button>
      </div>
      <EofyPanel s={s} patch={patch} calc={calc} />
      <div className="rc-pair">
        <BillableTime calc={calc} />
        <Profit calc={calc} />
      </div>
      <BusinessSummaryPanel s={s} calc={calc} />
    </div>
  );
}
