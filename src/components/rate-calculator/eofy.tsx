"use client";

/* EOFY comparison (reference-only) — math verbatim from the handoff. */

import React from "react";
import { PAYROLL_TAX, type CalcResult } from "./engine";
import type { RateCalcState, EofyData } from "./state";
import { RC } from "./theme";
import { money, rate0 } from "./format";
import { InsightCard, WsEyebrow } from "./ui";

const EOFY_EMPTY = { revenue: 0, cost_of_sales: 0, staff_costs: 0, vehicle_costs: 0, business_overheads: 0, operating_profit: 0, last_install_rate: null as number | null, last_service_rate: null as number | null };

export function EofyMoneyInput({ label, sub, value, onChange, suffix }: {
  label: string; sub?: string; value: number | null; onChange: (v: number) => void; suffix?: string;
}) {
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState("");
  const formatted = value ? (Number.isInteger(value) ? value.toLocaleString() : String(value)) : "";
  const display = editing ? draft : formatted;
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14, padding: "10px 0", borderBottom: `1px solid ${RC.line}` }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 13, color: RC.ink, fontWeight: 700, whiteSpace: "nowrap" }}>{label}</div>
        {sub && <div style={{ fontSize: 11.5, color: RC.faint, marginTop: 1 }}>{sub}</div>}
      </div>
      <div style={{ display: "inline-flex", alignItems: "baseline", gap: 2, background: RC.card2, borderRadius: 10, padding: "7px 11px", border: `1px solid ${RC.lineStrong}`, flexShrink: 0 }}>
        <span style={{ fontSize: 12.5, color: RC.faint }}>$</span>
        <input value={display} placeholder="0"
          onFocus={() => { setEditing(true); setDraft(value ? String(value) : ""); }}
          onBlur={() => setEditing(false)}
          onChange={e => {
            let raw = e.target.value.replace(/[^0-9.]/g, "");
            const parts = raw.split(".");
            if (parts.length > 2) raw = parts[0] + "." + parts.slice(1).join("");
            setDraft(raw);
            const n = parseFloat(raw);
            onChange(isNaN(n) ? 0 : n);
          }}
          style={{ border: "none", background: "transparent", outline: "none", fontFamily: RC.head, fontWeight: 800, fontSize: 15, color: RC.ink, width: 104, textAlign: "right", padding: 0 }} />
        {suffix && <span style={{ fontSize: 12, color: RC.faint }}>{suffix}</span>}
      </div>
    </div>
  );
}

function GrowthBadge({ pct }: { pct: number | null }) {
  if (pct == null) return null;
  const col = pct > 8 ? { bg: RC.amberSoft, c: RC.amberInk } : pct > 0 ? { bg: RC.card2, c: RC.ink2 } : { bg: RC.serviceSoft, c: RC.service };
  return <span style={{ fontSize: 11.5, fontWeight: 700, padding: "3px 10px", borderRadius: 100, background: col.bg, color: col.c, whiteSpace: "nowrap" }}>{pct > 0 ? "+" : ""}{pct.toFixed(1)}%</span>;
}

function RateCompare({ label, last, rec, diff, diffPct, c }: {
    label: string; last: number | null; rec: number | null | undefined; diff: number | null; diffPct: string | null; c: string;
  }) {
  return last ? (
    <div style={{ flex: 1, background: RC.card2, borderRadius: 13, padding: "12px 15px", display: "flex", alignItems: "center", gap: 14 }}>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 10, color: RC.faint, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.07em" }}>{label} · last year</div>
        <div style={{ fontFamily: RC.head, fontWeight: 800, fontSize: 23, letterSpacing: "-0.01em", color: RC.faint }}>${last}<span style={{ fontSize: 13 }}>/hr</span></div>
      </div>
      <span style={{ fontSize: 17, color: RC.faint }}>→</span>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 10, color: c, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.07em" }}>Recommended now</div>
        <div style={{ fontFamily: RC.head, fontWeight: 800, fontSize: 23, letterSpacing: "-0.01em", color: c }}>{rate0(rec)}<span style={{ fontSize: 13 }}>/hr</span></div>
        {diff != null && <div style={{ fontSize: 11.5, fontWeight: 700, color: diff > 0 ? RC.amberInk : RC.service }}>{diff > 0 ? `+$${diff}/hr (+${diffPct}%)` : "Already above recommended"}</div>}
      </div>
    </div>
  ) : null;
}

export function EofyPanel({ s, patch, calc }: {
  s: RateCalcState; patch: (p: Partial<RateCalcState>) => void; calc: CalcResult | null;
}) {
  const eofy = { ...EOFY_EMPTY, ...Object.fromEntries(Object.entries(s.eofy).filter(([, v]) => v != null)) } as typeof EOFY_EMPTY;
  const update = (k: keyof EofyData, v: number | null) => patch({ eofy: { ...s.eofy, [k]: v } });
  const profitTarget = s.profit?.margin ?? 20;
  const recInst = calc?.recInst, recSvc = calc?.recSvc;
  const hasRates = recInst != null && recSvc != null;

  // ── Derived figures (verbatim from EOFYModule.jsx) ───────────────────
  const hasRevenue = eofy.revenue > 0;
  const margin = hasRevenue ? eofy.operating_profit / eofy.revenue * 100 : null;
  const marginR = margin != null ? Math.round(margin * 10) / 10 : null;
  const targetProfit = hasRevenue ? eofy.revenue * (profitTarget / 100) : null;
  const betterOff = targetProfit != null ? targetProfit - eofy.operating_profit : null;
  const iDiff = (hasRates && eofy.last_install_rate) ? Math.round(recInst!) - eofy.last_install_rate : null;
  const sDiff = (hasRates && eofy.last_service_rate) ? Math.round(recSvc!) - eofy.last_service_rate : null;
  const iDiffPct = (iDiff != null && eofy.last_install_rate) ? (iDiff / eofy.last_install_rate * 100).toFixed(1) : null;
  const sDiffPct = (sDiff != null && eofy.last_service_rate) ? (sDiff / eofy.last_service_rate * 100).toFixed(1) : null;
  const thisYearStaff = calc ? calc.instLab + calc.svcLab + calc.adminLab : 0;
  const thisYearVehicle = calc ? calc.instVehicle + calc.svcVehicle + calc.adminVehicle : 0;
  const thisYearBiz = calc ? calc.enteredBiz : 0;
  const pct = (last: number, now: number) => last > 0 ? (now - last) / last * 100 : null;
  const growthRows = [
    { label: "Staff costs", sub: "Step 1 — Staff", last: eofy.staff_costs, now: thisYearStaff },
    { label: "Vehicle costs", sub: "Step 3 — Vehicles", last: eofy.vehicle_costs, now: thisYearVehicle },
    { label: "Business overheads", sub: "Step 2 — Business costs", last: eofy.business_overheads, now: thisYearBiz },
  ];
  // Payroll tax backward warning (verbatim)
  const ptState = s.settings?.state || "NSW";
  const ptThreshold = s.settings?.payroll_tax_threshold || PAYROLL_TAX[ptState]?.threshold || 1_200_000;
  const ptEnabled = s.settings?.payroll_tax_enabled;
  const lastWages = eofy.staff_costs;
  const ptPctLY = ptThreshold > 0 ? lastWages / ptThreshold * 100 : 0;
  const showPtBackward = !ptEnabled && lastWages > 0 && ptPctLY >= 80;
  // Margin health
  const mState = margin == null ? "empty" : margin >= profitTarget ? "success" : margin < 0 ? "danger" : "warning";
  const mColor = { success: RC.service, warning: RC.amber, danger: RC.red, empty: RC.faint }[mState];
  const boPositive = betterOff != null && betterOff > 0;
  // Overtime estimate (verbatim)
  const overtimeEst = (() => {
    const staff = s.staff || [];
    if (!staff.length || !eofy.staff_costs) return null;
    if (!staff.some(p => p.hourly_wage > 0)) return null;
    const stdWages = staff.reduce((a, p) => {
      const isSubbie = p.employment_type === "Subcontractor";
      const isCasual = p.employment_type === "Casual";
      const paidWeeks = (isSubbie || isCasual) ? (s.settings?.working_weeks || 48) : 52;
      return a + (p.hourly_wage || 0) * (p.contracted_hours_per_week || 38) * paidWeeks;
    }, 0);
    if (stdWages === 0) return null;
    const superPct = (s.settings?.super_pct || 12) / 100;
    const wcPct = (s.settings?.workers_comp_pct || 2.0) / 100;
    const leaveLoad = (4 / 52) * 0.175;
    const onCosts = stdWages * (superPct + wcPct + leaveLoad);
    const stdTotal = stdWages + onCosts;
    const overtimeDollars = eofy.staff_costs - stdTotal;
    if (overtimeDollars <= 0) return null;
    const overtimePct = (overtimeDollars / eofy.staff_costs) * 100;
    if (overtimePct < 0.5) return null;
    return { stdTotal, overtimeDollars, overtimePct, staffCount: staff.length, avgContractedHrs: Math.round(staff.reduce((a, p) => a + (p.contracted_hours_per_week || 38), 0) / staff.length) };
  })();
  const hasAnyInput = eofy.revenue > 0 || eofy.operating_profit > 0;


  return (
    <InsightCard title="Last financial year" sub="From your accounting reports — reference only, never feeds the calculator" accent={RC.ink}
      right={<span style={{ fontSize: 11.5, fontWeight: 700, color: RC.label, background: RC.card2, padding: "4px 12px", borderRadius: 100, whiteSpace: "nowrap" }}>Reference only</span>}>

      {showPtBackward && (
        <div style={{ background: ptPctLY >= 100 ? RC.redSoft : RC.amberSoft, borderRadius: 12, padding: "11px 15px", fontSize: 12.5, color: ptPctLY >= 100 ? RC.redInk : RC.amberInk, lineHeight: 1.5, marginBottom: 14 }}>
          {ptPctLY >= 100
            ? <>Last year your wages bill of <b>{money(lastWages)}</b> exceeded the {ptState} payroll tax threshold of {money(ptThreshold)}. If payroll tax wasn&apos;t applied, speak to your accountant.</>
            : <>Last year your wages bill of <b>{money(lastWages)}</b> was {Math.round(ptPctLY)}% of the {ptState} threshold ({money(ptThreshold)}). Monitor this as your business grows.</>}
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 22 }}>
        {/* left: inputs */}
        <div>
          <WsEyebrow style={{ marginBottom: 4 }}>P&amp;L figures</WsEyebrow>
          <EofyMoneyInput label="Total revenue" sub="Total income · top of P&L" value={eofy.revenue} onChange={v => update("revenue", v)} />
          <EofyMoneyInput label="Cost of sales" sub="Direct costs, consumables, subbies" value={eofy.cost_of_sales} onChange={v => update("cost_of_sales", v)} />
          <EofyMoneyInput label="Staff costs" sub="Wages, leave, super, workcover" value={eofy.staff_costs} onChange={v => update("staff_costs", v)} />
          <EofyMoneyInput label="Vehicle costs" sub="Running costs + depreciation" value={eofy.vehicle_costs} onChange={v => update("vehicle_costs", v)} />
          <EofyMoneyInput label="Business overheads" sub="Admin, occupancy, remaining depn" value={eofy.business_overheads} onChange={v => update("business_overheads", v)} />
          <EofyMoneyInput label="Operating profit" sub="Not net profit — exclude dividends, interest" value={eofy.operating_profit} onChange={v => update("operating_profit", v)} />
          <WsEyebrow style={{ margin: "16px 0 4px" }}>Average rates charged last year</WsEyebrow>
          <EofyMoneyInput label="Install rate" sub="Typical $/hr on installs" value={eofy.last_install_rate || 0} suffix="/hr" onChange={v => update("last_install_rate", v || null)} />
          <EofyMoneyInput label="Service rate" sub="Typical $/hr on service" value={eofy.last_service_rate || 0} suffix="/hr" onChange={v => update("last_service_rate", v || null)} />
        </div>

        {/* right: outputs */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {!hasAnyInput && <div style={{ background: RC.card2, borderRadius: 13, padding: "26px 18px", textAlign: "center", fontSize: 13, color: RC.faint }}>Enter your P&amp;L figures to unlock the comparison.</div>}

          {hasAnyInput && margin != null && (
            <div style={{ background: RC.card2, borderRadius: 13, padding: "13px 16px", borderLeft: `4px solid ${mColor}` }}>
              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
                <span style={{ fontSize: 10.5, color: RC.faint, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.07em" }}>Last year margin</span>
                <span style={{ fontFamily: RC.head, fontWeight: 800, fontSize: 25, letterSpacing: "-0.01em", color: mColor }}>{marginR?.toFixed(1)}%</span>
              </div>
              <div style={{ fontSize: 12.5, color: RC.ink2, lineHeight: 1.5, marginTop: 4 }}>
                {money(eofy.operating_profit)} profit on {money(eofy.revenue)} revenue · target is <b>{profitTarget}%</b>{mState === "success" ? " — you were hitting it." : mState === "danger" ? " — costs exceeded revenue; speak to your accountant." : ` — the recommended ${rate0(recInst)}/hr is designed to close the gap.`}
              </div>
            </div>
          )}

          {hasAnyInput && hasRates && (eofy.last_install_rate || eofy.last_service_rate) && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <RateCompare label="Install" last={eofy.last_install_rate} rec={recInst} diff={iDiff} diffPct={iDiffPct} c={RC.install} />
              <RateCompare label="Service" last={eofy.last_service_rate} rec={recSvc} diff={sDiff} diffPct={sDiffPct} c={RC.service} />
            </div>
          )}

          {overtimeEst && (
            <div style={{ background: RC.amberSoft, borderRadius: 13, padding: "12px 15px", borderLeft: `4px solid ${RC.amber}` }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
                <div>
                  <div style={{ fontSize: 10.5, fontWeight: 800, color: RC.amberInk, textTransform: "uppercase", letterSpacing: "0.07em" }}>≈ Estimated overtime</div>
                  <div style={{ fontSize: 11.5, color: RC.amberDeep, marginTop: 2 }}>{overtimeEst.staffCount} staff × {overtimeEst.avgContractedHrs}hrs × 52wks · standard pay ≈ {money(overtimeEst.stdTotal)}</div>
                </div>
                <div style={{ textAlign: "right", flexShrink: 0 }}>
                  <div style={{ fontFamily: RC.head, fontWeight: 800, fontSize: 20, color: RC.amberInk, lineHeight: 1 }}>{money(overtimeEst.overtimeDollars)}</div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: RC.amberInk, marginTop: 2 }}>{overtimeEst.overtimePct.toFixed(1)}% of staff costs</div>
                </div>
              </div>
              <div style={{ fontSize: 11, color: RC.amberDeep, lineHeight: 1.5, marginTop: 7 }}>Estimated from staff records. If overtime is consistently high, consider whether contracted hours need updating.</div>
            </div>
          )}

          {hasAnyInput && growthRows.some(r => r.last > 0) && (
            <div style={{ background: RC.card2, borderRadius: 13, padding: "11px 15px" }}>
              <div style={{ fontSize: 10.5, color: RC.faint, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 6 }}>Cost growth vs your calculator</div>
              {growthRows.filter(r => r.last > 0).map((r, i, arr) => (
                <div key={r.label} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "7px 0", borderBottom: i < arr.length - 1 ? `1px solid ${RC.lineStrong}` : "none" }}>
                  <span style={{ fontSize: 13, color: RC.ink, fontWeight: 600, whiteSpace: "nowrap" }}>{r.label}</span>
                  <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 12, color: RC.label, whiteSpace: "nowrap" }}>{money(r.last)} → {money(r.now)}</span>
                    <GrowthBadge pct={pct(r.last, r.now)} />
                  </span>
                </div>
              ))}
            </div>
          )}

          {hasAnyInput && betterOff != null && hasRates && (
            <div style={{ background: boPositive ? RC.serviceSoft : RC.amberSoft, borderRadius: 13, padding: "13px 16px" }}>
              <div style={{ fontSize: 10.5, fontWeight: 800, color: boPositive ? RC.service : RC.amberInk, textTransform: "uppercase", letterSpacing: "0.07em" }}>If you charge the recommended rate this year</div>
              <div style={{ display: "flex", alignItems: "baseline", gap: 9, marginTop: 5 }}>
                <span style={{ fontFamily: RC.head, fontWeight: 800, fontSize: 29, letterSpacing: "-0.02em", color: boPositive ? RC.service : RC.amberInk }}>{boPositive ? "+" : "−"}{money(Math.abs(betterOff))}</span>
                <span style={{ fontSize: 13, color: RC.ink2 }}>{boPositive ? "more profit vs last year" : "shortfall vs target"}</span>
              </div>
              <div style={{ fontSize: 12, color: RC.ink2, lineHeight: 1.55, marginTop: 5 }}>At your {profitTarget}% target on {money(eofy.revenue)} revenue that&apos;s {money(targetProfit)} — same work, same volume, just priced correctly.</div>
            </div>
          )}
        </div>
      </div>
    </InsightCard>
  );
}
