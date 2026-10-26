"use client";

/* LAST FINANCIAL YEAR, for reference only: what the P&L said, set beside
   what the calculator now recommends. Nothing here feeds the rates. The
   arithmetic is the handoff's, verbatim. */

import React from "react";
import { DEFAULT_WORKING_WEEKS, PAYROLL_TAX, classifyEmployment, type CalcResult } from "./engine";
import { snapshotTotal, type RateCalcState, type EofyData } from "./state";
import { money, rate0 } from "./format";
import { MoneyField } from "./ui";
import { Button } from "@/components/parts/button";
import { StateWord } from "@/components/parts/state";

const EOFY_EMPTY = { revenue: 0, cost_of_sales: 0, staff_costs: 0, vehicle_costs: 0, business_overheads: 0, operating_profit: 0, last_install_rate: null as number | null, last_service_rate: null as number | null };

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
  const boPositive = betterOff != null && betterOff > 0;
  // Overtime estimate (verbatim)
  const overtimeEst = (() => {
    const staff = s.staff || [];
    if (!staff.length || !eofy.staff_costs) return null;
    if (!staff.some(p => p.hourly_wage > 0)) return null;
    const stdWages = staff.reduce((a, p) => {
      // same boundary as the engine — permanents (incl. apprentices) are paid
      // 52 weeks, casuals/subbies only the weeks worked
      const paidWeeks = classifyEmployment(p.employment_type) === "permanent"
        ? 52
        : (s.settings?.working_weeks || DEFAULT_WORKING_WEEKS);
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


  const growth = growthRows.filter(r => r.last > 0);

  return (
    <div className="rc-q">
      <h3>Last financial year</h3>
      {showPtBackward && (
        <div className="rc-say">
          <StateWord tone={ptPctLY >= 100 ? "wrong" : "look"}>
            {ptPctLY >= 100 ? `Wages were over the ${ptState} payroll tax threshold` : `Wages were ${Math.round(ptPctLY)}% of the ${ptState} payroll tax threshold`}
          </StateWord>
          <p>
            {ptPctLY >= 100
              ? `${money(lastWages)} against ${money(ptThreshold)}. If payroll tax wasn't paid, speak to your accountant.`
              : `${money(lastWages)} against ${money(ptThreshold)}. Keep an eye on it as the business grows.`}
          </p>
        </div>
      )}
      <div className="rc-months">
        <MoneyField label="Total revenue" value={eofy.revenue} onChange={v => update("revenue", v)} />
        <MoneyField label="Cost of sales" value={eofy.cost_of_sales} onChange={v => update("cost_of_sales", v)} />
        <MoneyField label="Staff costs" value={eofy.staff_costs} onChange={v => update("staff_costs", v)} />
        <MoneyField label="Vehicle costs" value={eofy.vehicle_costs} onChange={v => update("vehicle_costs", v)} />
        <MoneyField label="Business overheads" value={eofy.business_overheads} onChange={v => update("business_overheads", v)} />
        <MoneyField label="Operating profit" value={eofy.operating_profit} onChange={v => update("operating_profit", v)} />
      </div>
      {/* The one figure the Xero snapshot already holds. A one-way seed the
          admin presses — the audit found this asking for hand-typed copies of
          numbers the P&L pull had. */}
      {!eofy.business_overheads && s.xeroCosts && (
        <div className="rc-adds">
          <Button kind="quiet" size={32} onClick={() => update("business_overheads", Math.round(snapshotTotal(s.xeroCosts)))}>
            {`Use Xero's overheads, ${money(Math.round(snapshotTotal(s.xeroCosts)))} for ${s.xeroCosts.period.label}`}
          </Button>
        </div>
      )}
      <div className="rc-two-fields">
        <MoneyField label="Install rate you charged" value={eofy.last_install_rate || 0} onChange={v => update("last_install_rate", v || null)} />
        <MoneyField label="Service rate you charged" value={eofy.last_service_rate || 0} onChange={v => update("last_service_rate", v || null)} />
      </div>

      {hasAnyInput && (
        <div className="rc-tiles is-four">
          {margin != null && (
            <div className="rc-tile">
              <span>Last year&apos;s margin</span>
              <b>{marginR?.toFixed(1)}%</b>
              <em><StateWord tone={mState === "success" ? "good" : mState === "danger" ? "wrong" : "look"}>{mState === "success" ? `At your ${profitTarget}%` : mState === "danger" ? "Costs beat revenue" : `Under your ${profitTarget}%`}</StateWord></em>
            </div>
          )}
          {hasRates && eofy.last_install_rate ? (
            <div className="rc-tile"><span>Install</span><b>${eofy.last_install_rate} → {rate0(recInst)}</b>{iDiff != null && iDiff > 0 && <em>{`+$${iDiff} an hour, ${iDiffPct}%`}</em>}</div>
          ) : null}
          {hasRates && eofy.last_service_rate ? (
            <div className="rc-tile"><span>Service</span><b>${eofy.last_service_rate} → {rate0(recSvc)}</b>{sDiff != null && sDiff > 0 && <em>{`+$${sDiff} an hour, ${sDiffPct}%`}</em>}</div>
          ) : null}
          {betterOff != null && hasRates && (
            <div className="rc-tile">
              <span>{boPositive ? "At the new rates" : "Short of your target"}</span>
              <b>{boPositive ? "+" : "−"}{money(Math.abs(betterOff))}</b>
              <em>{`Against ${money(targetProfit)}, your ${profitTarget}% of ${money(eofy.revenue)}`}</em>
            </div>
          )}
        </div>
      )}

      {overtimeEst && (
        <div className="rc-say">
          <StateWord tone="look">{`About ${money(overtimeEst.overtimeDollars)} of overtime, ${overtimeEst.overtimePct.toFixed(1)}% of staff costs`}</StateWord>
          <p>{`Against standard pay of about ${money(overtimeEst.stdTotal)}: ${overtimeEst.staffCount} staff at ${overtimeEst.avgContractedHrs} hours for 52 weeks. If it's always this high, check their contracted hours.`}</p>
        </div>
      )}

      {hasAnyInput && growth.length > 0 && (
        <dl className="rc-facts">
          {growth.map(r => {
            const g = pct(r.last, r.now);
            return (
              <div key={r.label}>
                <dt>{r.label}</dt>
                <dd>{money(r.last)} → {money(r.now)}{g != null ? `, ${g > 0 ? "+" : ""}${g.toFixed(1)}%` : ""}</dd>
              </div>
            );
          })}
        </dl>
      )}
    </div>
  );
}
