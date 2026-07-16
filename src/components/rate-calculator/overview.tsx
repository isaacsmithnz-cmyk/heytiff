"use client";

/* Results screen — all figures from `calc`. */

import React from "react";
import type { CalcResult, HealthStatusResult } from "./engine";
import type { RateCalcState } from "./state";
import { RC } from "./theme";
import { money, rate0, gstOf, normUtil } from "./format";
import { HEALTH_COLORS, RcIcon, WsEyebrow } from "./ui";

type Segment = [string, number, string];

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
  return { segments: [["Wages", lab, RC.install], ["Vehicles", veh, RC.service], ["Overheads", pool + direct, RC.violet], ["Risk", risk, RC.amber], ["Profit", profit, RC.ink2]], rec };
}

function Hero({ label, c, soft, rec, be, cur, proj }: {
    label: string; c: string; soft: string; rec: number | null; be: number | null; cur: number | null; proj: number | null;
  }) {
  return (
    <div style={{ flex: "1 1 280px", minWidth: 0, background: "#fff", borderRadius: 18, border: `1px solid ${RC.line}`, boxShadow: "0 8px 30px rgba(0,0,0,.03)", padding: "20px 22px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <WsEyebrow color={c}>{label} rate</WsEyebrow><span style={{ width: 9, height: 9, borderRadius: "50%", background: c }} />
      </div>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginTop: 10 }}>
        <div style={{ fontFamily: RC.head, fontWeight: 800, fontSize: 46, letterSpacing: "-0.03em", lineHeight: 0.9, color: RC.ink }}>
          {rec == null ? "—" : <><span style={{ fontSize: 22, verticalAlign: "12px", color: RC.faint, letterSpacing: 0 }}>$</span>{Math.round(rec)}<span style={{ fontSize: 15, fontWeight: 700, color: RC.faint, letterSpacing: 0 }}>/hr</span></>}
        </div>
        {rec != null && cur != null && <div style={{ fontFamily: RC.head, fontWeight: 800, fontSize: 15, color: c, paddingBottom: 5, whiteSpace: "nowrap" }}>{Math.round(rec) - cur >= 0 ? "+" : ""}${Math.round(rec) - cur}/hr vs now</div>}
      </div>
      <div style={{ fontSize: 12.5, color: RC.label, marginTop: 6 }}>+ GST <b style={{ color: RC.ink2, fontWeight: 700 }}>{gstOf(rec)}</b> · next year <b style={{ color: RC.ink2, fontWeight: 700 }}>{rate0(proj)}</b></div>
      <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
        {([["Break-even", rate0(be)], ["You charge", cur != null ? "$" + cur : "—"]] as [string, string][]).map(([l, v]) => (
          <div key={l} style={{ flex: 1, background: RC.card2, borderRadius: 11, padding: "9px 12px" }}>
            <div style={{ fontSize: 10, color: RC.faint, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.07em" }}>{l}</div>
            <div style={{ fontFamily: RC.head, fontWeight: 800, fontSize: 19, letterSpacing: "-0.01em", color: RC.ink2, marginTop: 2 }}>{v}</div>
          </div>
        ))}
      </div>
      {cur == null && <div style={{ marginTop: 10, fontSize: 12, color: "#1D4FD7", background: soft, borderRadius: 9, padding: "8px 11px", lineHeight: 1.45 }}>Set what you currently charge (top-right settings, or the first-run prompt) to see your gap.</div>}
    </div>
  );
}
function Bar({ label, d }: { label: string; d: { segments: Segment[]; rec: number } | null }) {
  return d && (
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 9 }}>
        <span style={{ fontFamily: RC.head, fontWeight: 800, fontSize: 13.5, letterSpacing: "-0.01em", color: RC.ink }}>{label}</span>
        <span style={{ fontFamily: RC.head, fontWeight: 800, fontSize: 13.5, color: RC.ink2 }}>{rate0(d.rec)}<span style={{ color: RC.label, fontWeight: 700, fontSize: 11.5 }}>/hr</span></span>
      </div>
      <div style={{ display: "flex", height: 20, borderRadius: 7, overflow: "hidden" }}>
        {d.segments.map(([l, v, c]) => {
          const p = (v / d.rec) * 100;
          return p > 0.4 && <div key={l} style={{ width: `${p}%`, background: c }} />;
        })}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 14px", marginTop: 10 }}>
        {d.segments.map(([l, v, c]) => v >= 0.5 && (
          <span key={l} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11.5, color: RC.ink2, whiteSpace: "nowrap" }}>
            <span style={{ width: 8, height: 8, borderRadius: 3, background: c, flexShrink: 0 }} />{l} <b style={{ fontFamily: RC.head, fontWeight: 800, color: RC.ink }}>${Math.round(v)}</b>
          </span>
        ))}
      </div>
    </div>
  );
}

export function Overview({ s, calc, health, uplift, ready, missing, go, patch }: {
  s: RateCalcState; calc: CalcResult; health: HealthStatusResult;
  uplift: number | null; ready: boolean; missing: string[];
  go: (step: number) => void; patch: (p: Partial<RateCalcState>) => void;
}) {
  const hc = HEALTH_COLORS[health.type] || HEALTH_COLORS.neutral;

  // Not enough data yet — friendly placeholder instead of $null rates.
  if (!ready) {
    return (
      <div className="rca-view" style={{ flex: 1, minWidth: 0, padding: "26px 32px", overflowY: "auto", overflowX: "hidden", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
        <div style={{ maxWidth: 460, textAlign: "center" }}>
          <div style={{ width: 54, height: 54, borderRadius: 16, background: "#f3f4f7", color: "#aeb4c0", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 18px" }}><RcIcon name="calc" size={24} /></div>
          <div style={{ fontFamily: RC.head, fontWeight: 800, fontSize: 22, letterSpacing: "-0.02em", color: RC.ink, lineHeight: 1.15 }}>A little more to go</div>
          <div style={{ fontSize: 13.5, color: RC.ink2, lineHeight: 1.6, marginTop: 10 }}>
            Your recommended rates will appear here once you&apos;ve entered {missing.length === 1 ? missing[0] : missing.slice(0, -1).join(", ") + " and " + missing[missing.length - 1]}. It only takes a moment.
          </div>
          <button className="rca-btn primary lg" style={{ marginTop: 20 }} onClick={() => go(0)}>Go to setup →</button>
        </div>
      </div>
    );
  }

  const applied = calc.recInst != null && calc.recSvc != null && s.currentRates.install === Math.round(calc.recInst) && s.currentRates.service === Math.round(calc.recSvc);
  const apply = () => {
    if (calc.recInst == null || calc.recSvc == null) return;
    patch({
      currentRates: { install: Math.round(calc.recInst), service: Math.round(calc.recSvc) },
      reviewState: { ...s.reviewState, lastReviewed: new Date().toISOString() },
    });
  };
  return (
    <div className="rca-view" style={{ flex: 1, minWidth: 0, padding: "18px 10px 6px 2px", overflowY: "auto", overflowX: "hidden", display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginBottom: 18 }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            {[s.businessName, calc.confidence.label, calc.weeksSubmitted > 0 ? `${calc.weeksSubmitted} weeks of data` : "Simple-mode estimate"].filter(Boolean).map(t => (
              <span key={t} style={{ fontSize: 11, fontWeight: 700, color: RC.label, background: "#fff", border: "1px solid rgba(10,12,20,.08)", padding: "3px 10px", borderRadius: 100, whiteSpace: "nowrap", boxShadow: "0 1px 2px rgba(10,12,20,.03)" }}>{t}</span>
            ))}
          </div>
          <div style={{ fontFamily: RC.head, fontWeight: 800, fontSize: 27, letterSpacing: "-0.02em", color: RC.ink, lineHeight: 1.1, marginTop: 8 }}>Your recommended rates</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 12.5, fontWeight: 700, color: hc.fg, background: hc.bg, padding: "7px 14px", borderRadius: 100, whiteSpace: "nowrap" }}><span style={{ width: 7, height: 7, borderRadius: "50%", background: hc.dot }} />{health.status}</span>
          <button className="rca-btn ghost" onClick={() => go(0)}>← Back to edit</button>
        </div>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 14 }}>
        <Hero label="Install" c={RC.install} soft={RC.installSoft} rec={calc.recInst} be={calc.beInst} cur={s.currentRates.install} proj={calc.projInst} />
        <Hero label="Service" c={RC.service} soft={RC.serviceSoft} rec={calc.recSvc} be={calc.beSvc} cur={s.currentRates.service} proj={calc.projSvc} />
        <div style={{ flex: "0 1 340px", minWidth: 300, background: RC.inkDeep, borderRadius: 18, padding: "20px 22px", color: "#fff", display: "flex", flexDirection: "column", position: "relative", overflow: "hidden" }}>
          <div style={{ position: "absolute", top: -70, right: -50, width: 190, height: 190, borderRadius: "50%", background: RC.teal, filter: "blur(90px)", opacity: 0.22, pointerEvents: "none" }} />
          <span style={{ display: "inline-flex", alignItems: "center", gap: 7, fontFamily: RC.head, fontSize: 10.5, fontWeight: 800, color: RC.teal, alignSelf: "flex-start", letterSpacing: "0.07em", textTransform: "uppercase", position: "relative" }}><span style={{ width: 7, height: 7, borderRadius: "50%", background: RC.teal }} />{applied ? "Rates applied" : "Ready to apply"}</span>
          <div style={{ fontFamily: RC.head, fontWeight: 800, fontSize: 20, letterSpacing: "-0.02em", lineHeight: 1.15, marginTop: 12, position: "relative" }}>{applied ? "You're priced right" : "You could recover"}</div>
          <div style={{ fontFamily: RC.head, fontWeight: 800, fontSize: 42, letterSpacing: "-0.03em", color: RC.teal, lineHeight: 1, marginTop: 6, position: "relative" }}>{applied ? "✓" : "+" + money(uplift)}</div>
          {!applied && <div style={{ fontSize: 12.5, color: "rgba(255,255,255,0.72)", lineHeight: 1.55, marginTop: 8, position: "relative" }}>per year, by moving from what you charge today to your recommended rates.</div>}
          <button onClick={apply} disabled={applied}
            style={{ marginTop: "auto", position: "relative", border: "none", background: applied ? "rgba(255,255,255,0.16)" : "#fff", color: applied ? "rgba(255,255,255,0.6)" : RC.inkDeep, borderRadius: 12, padding: "13px 0", fontFamily: RC.head, fontWeight: 800, fontSize: 14, cursor: applied ? "default" : "pointer", transition: "all .25s" }}
            onMouseEnter={e => { if (!applied) { e.currentTarget.style.background = RC.teal; } }}
            onMouseLeave={e => { if (!applied) { e.currentTarget.style.background = "#fff"; } }}>{applied ? "Applied" : "Apply these rates →"}</button>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 14, marginTop: 14 }}>
        {([["After-hours", rate0(calc.afterHrs) + "/hr", RC.violet], ["Emergency", rate0(calc.emergency) + "/hr", RC.violet], ["Day rate · full day", money(calc.daily), RC.ink]] as [string, string, string][]).map(([l, v, c]) => (
          <div key={l} style={{ background: "#fff", borderRadius: 14, border: `1px solid ${RC.line}`, boxShadow: "0 8px 30px rgba(0,0,0,.03)", padding: "15px 17px" }}>
            <div style={{ fontSize: 10.5, color: RC.faint, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.07em", whiteSpace: "nowrap" }}>{l}</div>
            <div style={{ fontFamily: RC.head, fontWeight: 800, fontSize: 23, letterSpacing: "-0.02em", color: c, marginTop: 5, whiteSpace: "nowrap" }}>{v}</div>
          </div>
        ))}
        <div style={{ background: "#fff", borderRadius: 14, border: `1px solid ${RC.line}`, boxShadow: "0 8px 30px rgba(0,0,0,.03)", padding: "15px 17px" }}>
          <div style={{ fontSize: 10.5, color: RC.faint, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.07em", whiteSpace: "nowrap" }}>Utilisation</div>
          <div style={{ display: "flex", gap: 18, marginTop: 5 }}>
            {([["Install", Math.round(normUtil(calc.instUtil)), RC.install], ["Service", Math.round(normUtil(calc.svcUtil)), RC.service]] as [string, number, string][]).map(([l, v, c]) => (
              <div key={l}>
                <div style={{ fontFamily: RC.head, fontWeight: 800, fontSize: 23, letterSpacing: "-0.02em", color: c, whiteSpace: "nowrap" }}>{v}%</div>
                <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 10.5, color: RC.label, fontWeight: 700, marginTop: 2 }}><span style={{ width: 7, height: 7, borderRadius: "50%", background: c }} />{l}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div style={{ marginTop: 14, background: "#fff", borderRadius: 16, border: `1px solid ${RC.line}`, boxShadow: "0 8px 30px rgba(0,0,0,.03)", padding: "18px 22px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
          <WsEyebrow>Where each charged hour goes</WsEyebrow>
          {calc.payrollTax > 0 && <span style={{ fontSize: 11.5, color: RC.label }}>incl. payroll tax {money(calc.payrollTax)}/yr across labour pools</span>}
        </div>
        <div style={{ display: "flex", gap: 28 }}>
          <Bar label="Install" d={decompose(calc, "i")} />
          <span style={{ width: 1, background: RC.line, flexShrink: 0 }} />
          <Bar label="Service" d={decompose(calc, "s")} />
        </div>
      </div>
    </div>
  );
}
