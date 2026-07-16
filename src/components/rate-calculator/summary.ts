/* Business Summary narrative engine — pure, date-injectable (math verbatim). */

import type { CalcResult, CalcSettings, ProfitSettings } from "./engine";
import type { CurrentRatesState, EofyData } from "./state";
import { money, rate0 } from "./format";

export interface AttentionItem {
  priority: number;
  heading: string;
  text: string;
}

export interface BusinessSummary {
  whereStand: string;
  attentionItems: AttentionItem[];
  workingItems: string[];
  generatedAt: string;
}

export function generateSummary(
  calc: CalcResult,
  eofy: EofyData | null,
  settings: CalcSettings | undefined,
  profit: ProfitSettings | undefined,
  currentRates: CurrentRatesState | undefined,
  now: Date = new Date(),
): BusinessSummary {
  const normU = (v: number | null | undefined) => v == null ? 0 : v > 100 ? v / 100 : v <= 1 ? v * 100 : v;
  const instUtil = normU(calc.instUtil);
  const svcUtil = normU(calc.svcUtil);
  const ci = currentRates?.install;
  const cs = currentRates?.service;
  const hasCurrentRates = ci != null || cs != null;
  const hasEofy = eofy != null && (eofy.revenue ?? 0) > 0;
  const targetMargin = profit?.margin ?? 20;
  const rI = calc.recInst;
  const rS = calc.recSvc;
  const hasRates = rI != null && rS != null;
  const rate = rate0;

  const iGap = (ci != null && rI != null) ? rI - ci : null;
  const iBEGap = (ci != null && calc.beInst != null) ? ci - calc.beInst : null;
  const belowBE = iBEGap != null && iBEGap < 0;
  const belowRec = !belowBE && iGap != null && iGap > 2;
  const atRec = hasCurrentRates && !belowBE && !belowRec;

  const criticalUtil = instUtil < 50 || svcUtil < 50;
  const belowHealthy = !criticalUtil && (instUtil < 65 || svcUtil < 65);
  const healthyUtil = instUtil >= 65 && svcUtil >= 65;

  const eofyRevenue = eofy?.revenue ?? 0;
  const eofyProfit = eofy?.operating_profit ?? 0;
  const eofyStaff = eofy?.staff_costs ?? 0;
  const lastYearMargin = hasEofy && eofyRevenue > 0 ? eofyProfit / eofyRevenue * 100 : null;
  const betterOff = hasEofy ? eofyRevenue * (targetMargin / 100) - eofyProfit : null;

  const thisYearStaff = calc.instLab + calc.svcLab + calc.adminLab;
  const labourGrowth = (hasEofy && eofyStaff > 0) ? (thisYearStaff - eofyStaff) / eofyStaff * 100 : null;

  const ptThreshold = settings?.payroll_tax_threshold || 1_200_000;
  const ptPct = ptThreshold > 0 ? calc.totalWages / ptThreshold * 100 : 0;
  const nearPT = !settings?.payroll_tax_enabled && ptPct >= 80;
  const stateName = settings?.state || "your state";
  const isJuly = now.getMonth() === 6;

  // ── Section 1: Where you stand ──
  let whereStand = "";
  if (!calc.hasStaff) {
    whereStand = "Add your staff records, wages and work allocations to generate your recommended rates. Once set up, this section will give you a complete picture of your business position.";
  } else if (!hasCurrentRates && hasRates) {
    whereStand = `The calculator has generated a recommended install rate of ${rate(rI)}/hr and service rate of ${rate(rS)}/hr based on your current costs and a ${targetMargin}% target margin. Enter what you currently charge to see how you compare and whether an increase is needed.`;
  } else if (belowBE && ci != null) {
    const lossPerHr = Math.abs(Math.round(iBEGap!));
    whereStand = `Your current install rate of $${ci}/hr is below the break-even rate of ${rate(calc.beInst)}/hr — every install hour currently costs the business approximately $${lossPerHr} more than it generates before any profit margin is applied.`;
    if (criticalUtil) {
      whereStand += ` Low utilisation is compounding the problem: only ${instUtil.toFixed(1)}% of paid install hours are billed to jobs, pushing the break-even rate higher.`;
    } else if (hasEofy && lastYearMargin != null) {
      whereStand += ` Last year the business made ${money(eofyProfit)} on ${money(eofyRevenue)} revenue — a ${lastYearMargin.toFixed(1)}% margin. Correcting the rates is the single highest-priority action.`;
    }
  } else if (belowRec && ci != null) {
    whereStand = `Your current install rate of $${ci}/hr covers costs but sits $${Math.round(iGap!)}/hr below the recommended ${rate(rI)}/hr needed to hit your ${targetMargin}% target margin.`;
    if (hasEofy && lastYearMargin != null && betterOff != null && betterOff > 0) {
      whereStand += ` Last year the business made ${money(eofyProfit)} on ${money(eofyRevenue)} revenue (${lastYearMargin.toFixed(1)}%). At your ${targetMargin}% target that's ${money(eofyRevenue * targetMargin / 100)} — an extra ${money(betterOff)} on the same volume.`;
    } else if (hasEofy && lastYearMargin != null) {
      whereStand += ` Last year's margin of ${lastYearMargin.toFixed(1)}% shows the business is covering costs — raising rates to the recommended level would push it to target.`;
    }
  } else if (atRec && ci != null) {
    whereStand = `Your rates are well positioned. Install is at $${ci}/hr against a recommended ${rate(rI)}/hr — comfortably covering costs with your ${targetMargin}% target margin.`;
    if (hasEofy && lastYearMargin != null) {
      const comp = lastYearMargin >= targetMargin ? "above" : "approaching";
      whereStand += ` Last year's margin of ${lastYearMargin.toFixed(1)}% was ${comp} your ${targetMargin}% target — the business is tracking in the right direction.`;
    } else if (healthyUtil) {
      whereStand += ` Utilisation is healthy at ${instUtil.toFixed(1)}% on install and ${svcUtil.toFixed(1)}% on service.`;
    }
  }

  // ── Section 2: What needs attention ──
  const attentionItems: AttentionItem[] = [];
  if (belowBE && ci != null && rI != null) {
    attentionItems.push({ priority: 1, heading: "Rate increase — urgent", text: `Your install rate must move to at least ${rate(calc.beInst)}/hr immediately — this is break-even, not profit. The full recommended rate of ${rate(rI)}/hr should be the target within 90 days. A phased approach works: move to ${rate(calc.beInst)}/hr now with 30 days written notice to existing clients, then to ${rate(rI)}/hr at the next review.` });
  }
  if (belowRec && ci != null && rI != null) {
    attentionItems.push({ priority: 2, heading: "Rate increase to target", text: `Moving install from $${ci}/hr to ${rate(rI)}/hr${hasEofy && betterOff != null && betterOff > 0 ? ` would add approximately ${money(betterOff)} to this year's profit at last year's revenue volume` : ` would bring your margin to the ${targetMargin}% target`}. Give existing clients 30 days written notice and update your quoting software and job management system to reflect the new rate.` });
  }
  if (criticalUtil) {
    const worstLabel = instUtil <= svcUtil ? `install (${instUtil.toFixed(1)}%)` : `service (${svcUtil.toFixed(1)}%)`;
    attentionItems.push({ priority: belowBE ? 2 : 1, heading: "Utilisation critically low", text: `Billable time is well below the 65% healthy minimum — ${worstLabel} is the bigger concern. Every percentage point gained reduces the required rate by approximately $${Math.round((rI ?? 0) * 0.015)}/hr. Review job scheduling, quote-to-job conversion, and travel time between jobs. More timesheet history will also sharpen the utilisation picture.` });
  }
  if (belowHealthy) {
    attentionItems.push({ priority: 4, heading: "Utilisation below healthy threshold", text: `${instUtil < 65 ? `Install utilisation is ${instUtil.toFixed(1)}%` : `Service utilisation is ${svcUtil.toFixed(1)}%`} — below the 65% healthy minimum. Tightening scheduling and reducing non-billable time would allow a slightly lower rate for the same margin, or improve profitability at the current rate.` });
  }
  if (labourGrowth != null && labourGrowth > 7) {
    attentionItems.push({ priority: 3, heading: "Staff costs growing above expectations", text: `Projected staff costs are up ${labourGrowth.toFixed(1)}% on last year — the main driver of this year's rate increase. If this reflects award wage increases or new hires, ensure your rates have been updated to match before the next round of quoting.` });
  }
  if (nearPT) {
    attentionItems.push({ priority: 5, heading: "Payroll tax threshold approaching", text: `Projected wages of ${money(calc.totalWages)} are ${Math.round(ptPct)}% of the ${stateName} payroll tax threshold (${money(ptThreshold)}). Payroll tax is currently off — enable it in Settings or speak to your accountant to ensure your rates cover a potential liability before it arrives.` });
  }
  if (calc.weeksSubmitted < 4 && calc.hasStaff) {
    attentionItems.push({ priority: 6, heading: "Limited timesheet data", text: `Only ${calc.weeksSubmitted} week${calc.weeksSubmitted !== 1 ? "s" : ""} of timesheet history — rates are using estimated utilisation rather than your actual billing pattern. Submit timesheets weekly and accuracy will improve automatically. Confidence reaches "Reliable" at 12 weeks.` });
  }
  if (isJuly) {
    attentionItems.push({ priority: 6, heading: "July award rate check", text: "Fair Work typically updates award rates in July. Check whether any staff wages have changed and update their records in People → Staff Records to keep your rates accurate." });
  }
  attentionItems.sort((a, b) => a.priority - b.priority);

  // ── Section 3: What's working ──
  const workingItems: string[] = [];
  if (atRec && hasCurrentRates) {
    workingItems.push(`Rates at or above recommended — install at $${ci}/hr covers all costs with your full ${targetMargin}% margin built in.`);
  } else if (!belowBE && hasCurrentRates) {
    workingItems.push(`Rates are above break-even — all cost categories are being covered and the business is trading profitably.`);
  }
  if (healthyUtil) {
    workingItems.push(`Utilisation is healthy at ${instUtil.toFixed(1)}% install and ${svcUtil.toFixed(1)}% service — overhead burden per billable hour is well managed.`);
  }
  if (calc.weeksSubmitted >= 24) {
    workingItems.push(`Timesheet data is highly accurate — ${calc.weeksSubmitted} weeks of history gives the engine a reliable picture of true labour costs and billing patterns.`);
  } else if (calc.weeksSubmitted >= 12) {
    workingItems.push(`Timesheet accuracy is building well at ${calc.weeksSubmitted} weeks — the engine is using your real billing pattern rather than estimates.`);
  }
  if (hasEofy && lastYearMargin != null && lastYearMargin >= targetMargin) {
    workingItems.push(`Last year's margin of ${lastYearMargin.toFixed(1)}% exceeded your ${targetMargin}% target — the business is fundamentally profitable and the rate correction this year builds on that foundation.`);
  }
  if (calc.adminLab > 0) {
    workingItems.push(`Admin costs are correctly separated and flowing into the business costs pool — overhead is recovered in your rates without being double-counted.`);
  }
  if ((calc.instVehicle + calc.svcVehicle + calc.adminVehicle) > 0) {
    workingItems.push(`Fleet costs are captured and split correctly by driver allocation — vehicles are fully accounted for in your rates.`);
  }
  if (!nearPT) {
    workingItems.push(`Wages are well below the ${stateName} payroll tax threshold — no liability to factor in at current staffing levels.`);
  }
  if (workingItems.length === 0) {
    workingItems.push("Keep submitting timesheets each week — as data accumulates the rates will sharpen and the insights here will become more specific to your business.");
  }

  return { whereStand, attentionItems, workingItems, generatedAt: now.toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric" }) };
}

export function toPlainText(summary: BusinessSummary): string {
  return [
    `Business Summary — ${summary.generatedAt}`, "",
    "WHERE YOU STAND", summary.whereStand, "",
    "WHAT NEEDS ATTENTION", ...summary.attentionItems.map((item, i) => `${i + 1}. ${item.heading}\n   ${item.text}`), "",
    "WHAT'S WORKING", ...summary.workingItems.map((item, i) => `${i + 1}. ${item}`),
  ].join("\n");
}
