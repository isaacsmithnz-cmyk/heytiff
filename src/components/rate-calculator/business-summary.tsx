"use client";

/* WHERE YOU STAND: the narrative from summary.ts, as a list of what to look
   at and what's working, each a state word beside a line (rule 17), and a
   copy of it all for an accountant or a partner. */

import React from "react";
import type { CalcResult } from "./engine";
import type { RateCalcState } from "./state";
import { generateSummary, toPlainText } from "./summary";
import { Button } from "@/components/parts/button";
import { StateWord } from "@/components/parts/state";

export function BusinessSummaryPanel({ s, calc }: { s: RateCalcState; calc: CalcResult }) {
  const [copied, setCopied] = React.useState(false);
  const summary = React.useMemo(
    () => generateSummary(calc, s.eofy, s.settings, s.profit, s.currentRates),
    [calc, s.eofy, s.settings, s.profit, s.currentRates]
  );
  const done = () => { setCopied(true); setTimeout(() => setCopied(false), 2500); };
  const handleCopy = () => {
    const text = toPlainText(summary);
    const fallback = () => {
      const el = document.createElement("textarea");
      el.value = text; document.body.appendChild(el); el.select();
      document.execCommand("copy"); document.body.removeChild(el);
      done();
    };
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(done).catch(fallback);
    else fallback();
  };
  return (
    <div className="rc-q">
      <div className="rc-qhead">
        <h3>Where you stand</h3>
        <Button size={32} onClick={handleCopy}>{copied ? "Summary copied" : "Copy summary"}</Button>
      </div>
      <p className="rc-note">{summary.whereStand}</p>
      <ul className="rc-list">
        {summary.attentionItems.map((item, i) => (
          <li key={`a${i}`}>
            <StateWord tone="look">Look at</StateWord>
            <span className="rc-list-w"><b>{item.heading}</b><span>{item.text}</span></span>
          </li>
        ))}
        {summary.workingItems.map((item, i) => (
          <li key={`w${i}`}>
            <StateWord tone="good">Working</StateWord>
            <span className="rc-list-w"><span>{item}</span></span>
          </li>
        ))}
      </ul>
    </div>
  );
}
