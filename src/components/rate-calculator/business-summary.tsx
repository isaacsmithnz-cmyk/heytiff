"use client";

/* Business Summary panel — renders the narrative from summary.ts. */

import React from "react";
import type { CalcResult } from "./engine";
import type { RateCalcState } from "./state";
import { RC } from "./theme";
import { generateSummary, toPlainText } from "./summary";
import { InsightCard, WsEyebrow } from "./ui";

function Section({ label, color, children }: { label: string; color: string; children: React.ReactNode }) {
  return (
    <div>
      <WsEyebrow color={color} style={{ marginBottom: 9 }}>{label}</WsEyebrow>
      {children}
    </div>
  );
}

export function BusinessSummaryPanel({ s, calc }: { s: RateCalcState; calc: CalcResult }) {
  const [copied, setCopied] = React.useState(false);
  const summary = React.useMemo(
    () => generateSummary(calc, s.eofy, s.settings, s.profit, s.currentRates),
    [calc, s.eofy, s.settings, s.profit, s.currentRates]
  );
  const handleCopy = () => {
    const text = toPlainText(summary);
    const fallback = () => {
      const el = document.createElement("textarea");
      el.value = text; document.body.appendChild(el); el.select();
      document.execCommand("copy"); document.body.removeChild(el);
      setCopied(true); setTimeout(() => setCopied(false), 2500);
    };
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2500); }).catch(fallback);
    } else fallback();
  };
  return (
    <InsightCard title="Business summary" sub={`Plain-language read of your position · ${summary.generatedAt}`} accent={RC.ink}
      right={<button className={copied ? "rca-btn sm ghost" : "rca-btn sm primary"} onClick={handleCopy} style={copied ? { color: RC.service, borderColor: RC.serviceSoft, background: RC.serviceSoft } : undefined}>{copied ? "✓ Copied" : "Copy summary"}</button>}>
      <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
        <Section label="Where you stand" color={RC.install}>
          <p style={{ fontSize: 13.5, color: RC.ink, lineHeight: 1.65, margin: 0, maxWidth: 760 }}>{summary.whereStand}</p>
        </Section>
        <Section label="What needs attention" color={RC.amberInk}>
          {summary.attentionItems.length === 0 ? (
            <p style={{ fontSize: 13.5, color: RC.service, fontWeight: 600, margin: 0 }}>No immediate concerns — your rates, costs and utilisation are all in a healthy position.</p>
          ) : summary.attentionItems.map((item, i) => (
            <div key={i} style={{ display: "flex", gap: 11, marginBottom: i < summary.attentionItems.length - 1 ? 12 : 0 }}>
              <span style={{ width: 22, height: 22, borderRadius: "50%", flexShrink: 0, background: RC.amberSoft, color: RC.amberInk, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: RC.head, fontWeight: 800, fontSize: 11.5, marginTop: 1 }}>{i + 1}</span>
              <div>
                <div style={{ fontSize: 13.5, fontWeight: 700, color: RC.ink, marginBottom: 2 }}>{item.heading}</div>
                <div style={{ fontSize: 13, color: RC.ink2, lineHeight: 1.6, maxWidth: 720 }}>{item.text}</div>
              </div>
            </div>
          ))}
        </Section>
        <Section label="What's working" color={RC.service}>
          {summary.workingItems.map((item, i) => (
            <div key={i} style={{ display: "flex", gap: 11, marginBottom: i < summary.workingItems.length - 1 ? 8 : 0 }}>
              <span style={{ width: 20, height: 20, borderRadius: "50%", flexShrink: 0, background: RC.serviceSoft, color: RC.service, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10.5, fontWeight: 800, marginTop: 1 }}>✓</span>
              <div style={{ fontSize: 13, color: RC.ink2, lineHeight: 1.6, maxWidth: 720 }}>{item}</div>
            </div>
          ))}
        </Section>
      </div>
    </InsightCard>
  );
}
