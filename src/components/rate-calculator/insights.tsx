"use client";

/* Insights view — math verbatim. */

import React from "react";
import type { CalcResult } from "./engine";
import type { RateCalcState } from "./state";
import { RC } from "./theme";
import { money, rate0 } from "./format";
import { InsightCard, RcIcon, WsEyebrow } from "./ui";
import { EofyPanel } from "./eofy";
import { BusinessSummaryPanel } from "./business-summary";

// normalise utilisation (verbatim guard)
const normUtilIns = (v: number | null | undefined): number => { if (v == null) return 0; if (v > 100) return v / 100; if (v <= 1) return v * 100; return v; };

function Gauge({ pct, color, height = 12, muted = false }: { pct: number; color: string; height?: number; muted?: boolean }) {
  const c = muted ? RC.lineStrong : (pct < 35 ? RC.red : pct < 65 ? RC.amber : color);
  return (
    <div style={{ position: "relative" }}>
      <div style={{ height, background: RC.card2, borderRadius: height / 2, overflow: "hidden", border: `1px solid ${RC.line}` }}>
        <div style={{ height: "100%", width: `${Math.min(pct, 100)}%`, background: c, borderRadius: height / 2, transition: "width 0.4s" }} />
      </div>
      {[65, 80].map(t => <div key={t} style={{ position: "absolute", left: `${t}%`, top: -2, width: 2, height: height + 4, background: RC.ink, opacity: 0.18, borderRadius: 1 }} />)}
    </div>
  );
}

export function UtilisationCard({ calc }: { calc: CalcResult }) {
  const instUtil = normUtilIns(calc.instUtil);
  const svcUtil = normUtilIns(calc.svcUtil);
  const nonBillPct = Math.max(0, 100 - instUtil - svcUtil);
  const isDefault = calc.utilFromDefault;
  const rows = [
    { label: "Install", pct: instUtil, hrs: calc.effInst, color: RC.install },
    { label: "Service", pct: svcUtil, hrs: calc.effSvc, color: RC.service },
  ];
  const statusOf = (p: number) => {
    if (isDefault) return { label: "Estimated", c: RC.label, bg: RC.card2 };
    return p < 35 ? { label: "Critical", c: RC.redInk, bg: RC.redSoft } : p < 50 ? { label: "Low", c: RC.amberInk, bg: RC.amberSoft } : p < 65 ? { label: "Below target", c: RC.amberInk, bg: RC.amberSoft } : { label: "Healthy", c: RC.service, bg: RC.serviceSoft };
  };
  return (
    <InsightCard title="Utilisation" sub="How much of your wage bill is recovered through billable work" accent={RC.ink}
      right={isDefault ? <span style={{ fontSize: 11.5, fontWeight: 700, color: RC.amberInk, background: RC.amberSoft, padding: "4px 12px", borderRadius: 100, whiteSpace: "nowrap" }}>Estimated from defaults</span> : null}>
      {isDefault && (
        <div style={{ background: RC.installSoft, borderRadius: 12, padding: "11px 15px", fontSize: 12.5, color: "#1D4FD7", lineHeight: 1.5, marginBottom: 16 }}>
          These figures are an industry-standard estimate (75% billability), not a measurement of your business. Switch the Staff step to <b>Detailed</b> and add timesheets to see your real utilisation.
        </div>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 22 }}>
        {rows.map(u => {
          const st = statusOf(u.pct);
          return (
            <div key={u.label}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ width: 9, height: 9, borderRadius: "50%", background: u.color }} />
                  <span style={{ fontSize: 13.5, fontWeight: 700, color: RC.ink }}>{u.label}</span>
                  <span style={{ fontSize: 11, fontWeight: 700, color: st.c, background: st.bg, padding: "3px 10px", borderRadius: 100 }}>{st.label}</span>
                </span>
                <span style={{ fontFamily: RC.head, fontWeight: 800, fontSize: 21, letterSpacing: "-0.01em", color: isDefault ? RC.ink2 : (u.pct < 65 ? RC.amberInk : u.color) }}>{u.pct.toFixed(1)}%</span>
              </div>
              <Gauge pct={u.pct} color={u.color} muted={isDefault} />
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: 7, fontSize: 11.5, color: RC.faint }}>
                <span>{Math.round(u.hrs).toLocaleString()} billable hrs/yr</span>
                <span>65% healthy · 80% strong</span>
              </div>
              {!isDefault && u.pct < 65 && (
                <div style={{ marginTop: 9, background: u.pct < 35 ? RC.redSoft : RC.amberSoft, borderRadius: 10, padding: "9px 12px", fontSize: 12, color: u.pct < 35 ? RC.redInk : RC.amberDeep, lineHeight: 1.5 }}>
                  {u.pct < 35
                    ? `${u.label} utilisation is critically low. Review job scheduling and timesheet tagging urgently.`
                    : `Every 1% gain in ${u.label.toLowerCase()} utilisation reduces the required rate by approximately ${rate0((calc.recInst ?? 0) * 0.012)}/hr.`}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {/* paid-hours allocation bar */}
      <div style={{ marginTop: 20 }}>
        <WsEyebrow style={{ marginBottom: 9 }}>How your team&apos;s paid hours are allocated</WsEyebrow>
        <div style={{ display: "flex", height: 24, borderRadius: 9, overflow: "hidden", border: `1px solid ${RC.line}` }}>
          {([[instUtil, RC.install], [svcUtil, RC.service], [nonBillPct, RC.card2]] as [number, string][]).map(([p, c], i) => (
            <div key={i} style={{ width: `${p}%`, background: c }} />
          ))}
        </div>
        <div style={{ display: "flex", gap: 16, marginTop: 8, flexWrap: "wrap" }}>
          {([[`Install billable (${instUtil.toFixed(1)}%)`, RC.install], [`Service billable (${svcUtil.toFixed(1)}%)`, RC.service], [`Admin & non-billable (${nonBillPct.toFixed(1)}%)`, RC.card2]] as [string, string][]).map(([l, c]) => (
            <span key={l} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: RC.ink2 }}><span style={{ width: 10, height: 10, borderRadius: 3, background: c, border: `1px solid ${RC.line}` }} />{l}</span>
          ))}
        </div>
        <div style={{ marginTop: 10, fontSize: 12.5, color: RC.ink2, lineHeight: 1.55 }}>
          Total paid hours: <b>{calc.totalAnnualPaid.toLocaleString()}/yr</b> across all staff. Of these, <b>{Math.round(calc.effInst + calc.effSvc).toLocaleString()}</b> are billable — the rest are admin, non-billable time and overhead recovered in your rates.
        </div>
      </div>
    </InsightCard>
  );
}

function Stat({ label, value, sub, color }: { label: string; value: string; sub: string; color: string }) {
  return (
    <div style={{ background: RC.card2, borderRadius: 13, padding: "12px 15px" }}>
      <div style={{ fontSize: 10, color: RC.faint, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.07em", whiteSpace: "nowrap" }}>{label}</div>
      <div style={{ fontFamily: RC.head, fontWeight: 800, fontSize: 21, letterSpacing: "-0.01em", color, marginTop: 3, whiteSpace: "nowrap" }}>{value}</div>
      <div style={{ fontSize: 11, color: RC.faint, marginTop: 2 }}>{sub}</div>
    </div>
  );
}

export function ProfitabilityCard({ calc, hoursPerDay = 8 }: { calc: CalcResult; hoursPerDay?: number }) {
  const profInstHr = calc.profInst ?? 0;
  const profSvcHr = calc.profSvc ?? 0;
  const annualInstProfit = profInstHr * calc.effInst;
  const annualSvcProfit = profSvcHr * calc.effSvc;
  const totalAnnualProfit = annualInstProfit + annualSvcProfit;
  return (
    <InsightCard title="Profitability" sub="Profit built into each hour at recommended rates" accent={RC.ink}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
        <Stat label="Profit / install hr" value={"+" + rate0(profInstHr)} sub="Above break-even" color={RC.service} />
        <Stat label="Profit / service hr" value={"+" + rate0(profSvcHr)} sub="Above break-even" color={RC.service} />
        <Stat label="Day rate (full day on site)" value={money(calc.daily)} sub={`Blended hourly × ${hoursPerDay}hrs`} color={RC.ink} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 12 }}>
        <Stat label="Install profit / yr" value={money(annualInstProfit)} sub={`${Math.round(calc.effInst).toLocaleString()} hrs × ${rate0(profInstHr)}/hr`} color={RC.install} />
        <Stat label="Service profit / yr" value={money(annualSvcProfit)} sub={`${Math.round(calc.effSvc).toLocaleString()} hrs × ${rate0(profSvcHr)}/hr`} color={RC.service} />
      </div>
      <div style={{ marginTop: 12, background: RC.serviceSoft, borderRadius: 13, padding: "13px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <div>
          <div style={{ fontFamily: RC.head, fontWeight: 800, fontSize: 12, textTransform: "uppercase", letterSpacing: "0.07em", color: RC.service }}>Total profit at recommended rates</div>
          <div style={{ fontSize: 11.5, color: RC.service, opacity: 0.85, marginTop: 1 }}>At your current volume</div>
        </div>
        <div style={{ fontFamily: RC.head, fontWeight: 800, fontSize: 26, letterSpacing: "-0.02em", color: RC.service, whiteSpace: "nowrap" }}>{money(totalAnnualProfit)}</div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 12 }}>
        <Stat label="Projected install rate" value={rate0(calc.projInst) + "/hr"} sub="Next year, with cost increase allowance" color={RC.install} />
        <Stat label="Projected service rate" value={rate0(calc.projSvc) + "/hr"} sub="Next year, with cost increase allowance" color={RC.service} />
      </div>
    </InsightCard>
  );
}

// ── Insights view (full-width, replaces work area + rates rail) ─────────
export function InsightsView({ s, patch, calc, ready, go }: {
  s: RateCalcState; patch: (p: Partial<RateCalcState>) => void; calc: CalcResult;
  ready: boolean; go: (step: number) => void;
}) {
  if (!ready) {
    return (
      <div className="rca-view" style={{ flex: 1, minWidth: 0, padding: "26px 32px", overflowY: "auto", overflowX: "hidden", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
        <div style={{ maxWidth: 460, textAlign: "center" }}>
          <div style={{ width: 54, height: 54, borderRadius: 16, background: "#f3f4f7", color: "#aeb4c0", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 18px" }}><RcIcon name="activity" size={24} /></div>
          <div style={{ fontFamily: RC.head, fontWeight: 800, fontSize: 22, letterSpacing: "-0.02em", color: RC.ink, lineHeight: 1.15 }}>Insights unlock with your data</div>
          <div style={{ fontSize: 13.5, color: RC.ink2, lineHeight: 1.6, marginTop: 10 }}>
            Utilisation, profitability and your business summary appear once your rates are calculated. Finish the Staff step to get started.
          </div>
          <button className="rca-btn primary lg" style={{ marginTop: 20 }} onClick={() => go(0)}>Go to setup →</button>
        </div>
      </div>
    );
  }
  return (
    <div className="rca-view" style={{ flex: 1, minWidth: 0, padding: "18px 10px 6px 2px", overflowY: "auto", overflowX: "hidden" }}>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginBottom: 18 }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            {[s.businessName, "Reference & analysis"].filter(Boolean).map(t => (
              <span key={t} style={{ fontSize: 11, fontWeight: 700, color: RC.label, background: "#fff", border: "1px solid rgba(10,12,20,.08)", padding: "3px 10px", borderRadius: 100, whiteSpace: "nowrap", boxShadow: "0 1px 2px rgba(10,12,20,.03)" }}>{t}</span>
            ))}
          </div>
          <div style={{ fontFamily: RC.head, fontWeight: 800, fontSize: 27, letterSpacing: "-0.02em", color: RC.ink, lineHeight: 1.1, marginTop: 8 }}>Insights</div>
        </div>
        <button className="rca-btn ghost" onClick={() => go(5)}>← Back to results</button>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 14, maxWidth: 1120 }}>
        <EofyPanel s={s} patch={patch} calc={calc} />
        <UtilisationCard calc={calc} />
        <ProfitabilityCard calc={calc} hoursPerDay={s.settings?.working_hours ?? 8} />
        <BusinessSummaryPanel s={s} calc={calc} />
      </div>
    </div>
  );
}
