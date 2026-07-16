"use client";

/* "Detailed" mode step bodies — edit the engine's REAL arrays; per-row
   figures come from calc breakdowns. */

import React from "react";
import type { CalcResult, VehicleCosts } from "./engine";
import type { RateCalcState } from "./state";
import { RC } from "./theme";
import { money, normUtil } from "./format";
import { NumInput, RcIcon, WsEyebrow, WsHelpNote } from "./ui";

export interface StepBodyProps {
  s: RateCalcState;
  patch: (p: Partial<RateCalcState>) => void;
  calc: CalcResult;
  /** Show the Simple/Detailed toggle (host-gated per step). */
  showToggle?: boolean;
  /** Returning-user render — question stacks skip staging. */
  revealAll?: boolean;
}

const DBody = ({ children }: { children: React.ReactNode }) => (
  <div style={{ marginTop: 20, display: "flex", flexDirection: "column" }}>{children}</div>
);

interface TableCol { label: string; w: string; align?: "left" | "right" | "center" }

function Table({ cols, children }: { cols: TableCol[]; children: React.ReactNode }) {
  return (
    <div style={{ background: "#fff", borderRadius: 16, border: `1px solid ${RC.line}`, boxShadow: "0 8px 30px rgba(0,0,0,.03)", overflow: "hidden" }}>
      <div style={{ display: "grid", gridTemplateColumns: cols.map(c => c.w).join(" "), padding: "11px 18px", borderBottom: `1px solid ${RC.line}` }}>
        {cols.map(c => <div key={c.label} style={{ fontFamily: RC.head, fontWeight: 800, fontSize: 10.5, letterSpacing: "0.07em", textTransform: "uppercase", color: RC.faint, textAlign: c.align || "left" }}>{c.label}</div>)}
      </div>
      {children}
    </div>
  );
}

export const chipColor = (a: string | undefined) =>
  a === "install" || a === "Install" ? { c: RC.install, bg: RC.installSoft }
  : a === "service" || a === "Service" ? { c: RC.service, bg: RC.serviceSoft }
  : { c: RC.violet, bg: RC.violetSoft };

// ── DETAILED · Staff ────────────────────────────────────────────────────
export function StaffDetail({ s, patch, calc }: StepBodyProps) {
  const cols: TableCol[] = [{ label: "Team member", w: "1.6fr" }, { label: "Hourly wage", w: "1fr", align: "right" }, { label: "Weeks of data", w: "0.9fr", align: "right" }, { label: "True cost / yr", w: "1fr", align: "right" }, { label: "Split I/S/A", w: "1fr", align: "right" }];
  const bd = Object.fromEntries((calc.staffBreakdown || []).map(b => [b.id, b]));
  const totalTrue = (calc.staffBreakdown || []).reduce((a, b) => a + b.annualCost, 0);
  const setWage = (i: number, v: number) => patch({ staff: s.staff.map((p, j) => j === i ? { ...p, hourly_wage: v } : p) });
  return (
    <DBody>
      <WsHelpNote id="staff-detailed" style={{ marginBottom: 16 }}><b>Detailed mode</b> prices each person from their real timesheet weeks (incl. overtime at 1.5× / 2×), adds super, workers comp and leave loading, and measures billable utilisation instead of assuming it. Edit a wage and watch the rates move.</WsHelpNote>
      <WsEyebrow style={{ marginBottom: 11 }}>Per-person wages · {s.staff.length} staff · priced from timesheets</WsEyebrow>
      <Table cols={cols}>
        {s.staff.map((p, i) => {
          const b = bd[p.id];
          return (
            <div key={p.id} style={{ display: "grid", gridTemplateColumns: cols.map(c => c.w).join(" "), alignItems: "center", padding: "10px 18px", borderBottom: `1px solid ${RC.line}` }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ width: 30, height: 30, borderRadius: "50%", flexShrink: 0, background: `hsl(${(String(p.name).split("").reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) % 360, 0))} 64% 42%)`, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: RC.head, fontWeight: 800, fontSize: 12.5 }}>{p.name[0]}</span>
                <div><div style={{ fontSize: 13.5, color: RC.ink, fontWeight: 700 }}>{p.name}</div><div style={{ fontSize: 11.5, color: RC.faint }}>{p.role || p.employment_type}</div></div>
              </div>
              <div style={{ textAlign: "right" }}><NumInput value={p.hourly_wage} w={92} size={14} onChange={v => setWage(i, v)} /></div>
              <div style={{ textAlign: "right", fontSize: 13, color: b?.weeksSubmitted ? RC.ink2 : RC.faint, fontWeight: 600 }}>{b?.weeksSubmitted || 0} wks</div>
              <div style={{ textAlign: "right", fontFamily: RC.head, fontWeight: 800, fontSize: 14.5, color: RC.ink }}>{money(b?.annualCost)}</div>
              <div style={{ textAlign: "right", fontFamily: RC.head, fontWeight: 700, fontSize: 13, color: RC.ink2, whiteSpace: "nowrap" }}>
                <span style={{ color: RC.install }}>{p.install_pct}</span> / <span style={{ color: RC.service }}>{p.service_pct}</span> / <span style={{ color: RC.faint }}>{p.admin_pct}</span>
              </div>
            </div>
          );
        })}
        <div style={{ display: "grid", gridTemplateColumns: cols.map(c => c.w).join(" "), alignItems: "center", padding: "13px 18px", background: RC.card2 }}>
          <div style={{ fontFamily: RC.head, fontWeight: 800, fontSize: 12.5, letterSpacing: "-0.01em", color: RC.ink }}>Total true labour cost</div>
          <div /><div />
          <div style={{ textAlign: "right", fontFamily: RC.head, fontWeight: 800, fontSize: 18, color: RC.service }}>{money(totalTrue)}</div>
          <div />
        </div>
      </Table>
      <div style={{ display: "flex", gap: 14, marginTop: 12 }}>
        <div style={{ flex: 1, background: "#fff", borderRadius: 13, border: `1px solid ${RC.line}`, padding: "11px 15px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: 12.5, color: RC.label }}>Utilisation (from timesheets)</span>
          <span style={{ fontFamily: RC.head, fontWeight: 800, fontSize: 14.5, color: RC.ink }}><span style={{ color: RC.install }}>{Math.round(normUtil(calc.instUtil))}%</span> install · <span style={{ color: RC.service }}>{Math.round(normUtil(calc.svcUtil))}%</span> service{calc.utilFromDefault ? " (default)" : ""}</span>
        </div>
        <div style={{ flex: 1, background: "#fff", borderRadius: 13, border: `1px solid ${RC.line}`, padding: "11px 15px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: 12.5, color: RC.label }}>Confidence</span>
          <span style={{ fontFamily: RC.head, fontWeight: 800, fontSize: 14.5, color: RC.service }}>{calc.confidence.label}</span>
        </div>
      </div>
    </DBody>
  );
}

// ── DETAILED · Business ─────────────────────────────────────────────────
export function BusinessDetail({ s, patch }: StepBodyProps) {
  const cols: TableCol[] = [{ label: "Cost", w: "1.8fr" }, { label: "Recover via", w: "1fr", align: "center" }, { label: "Amount / yr", w: "1fr", align: "right" }, { label: "", w: "44px", align: "right" }];
  const cycle: Record<string, string> = { shared: "install", install: "service", service: "shared" };
  const setCost = (i: number, p: Partial<RateCalcState["businessCosts"][number]>) =>
    patch({ businessCosts: s.businessCosts.map((c, j) => j === i ? { ...c, ...p } : c) });
  const total = s.businessCosts.reduce((a, c) => a + c.amount, 0);
  return (
    <DBody>
      <WsHelpNote id="business-detailed" style={{ marginBottom: 16 }}><b>shared</b> costs pool with admin labour and split by your labour ratio; <b>install</b> / <b>service</b> costs load directly onto that rate only — so a service-only phone plan never inflates your install rate.</WsHelpNote>
      <WsEyebrow style={{ marginBottom: 11 }}>Overheads · itemised &amp; allocated — click a tag to change recovery</WsEyebrow>
      <Table cols={cols}>
        {s.businessCosts.map((o, i) => {
          const ch = chipColor(o.allocated_to);
          return (
            <div key={i} style={{ display: "grid", gridTemplateColumns: cols.map(c => c.w).join(" "), alignItems: "center", padding: "9px 18px", borderBottom: `1px solid ${RC.line}` }}>
              <span style={{ fontSize: 13.5, color: RC.ink, fontWeight: 600 }}>{o.name}</span>
              <div style={{ textAlign: "center" }}>
                <button className="rca-chipbtn" onClick={() => setCost(i, { allocated_to: cycle[o.allocated_to] || "shared" })}
                  style={{ fontSize: 11.5, fontWeight: 700, color: ch.c, background: ch.bg, padding: "5px 12px", borderRadius: 100, textTransform: "capitalize" }}>{o.allocated_to}</button>
              </div>
              <div style={{ textAlign: "right" }}><NumInput value={o.amount} w={120} size={14} onChange={n => setCost(i, { amount: n })} /></div>
              <button onClick={() => patch({ businessCosts: s.businessCosts.filter((_, j) => j !== i) })} title="Remove" className="rca-stepbtn" style={{ width: 28, height: 28, borderRadius: 8, fontSize: 12, justifySelf: "end", color: RC.faint }}>✕</button>
            </div>
          );
        })}
        <div style={{ display: "grid", gridTemplateColumns: cols.map(c => c.w).join(" "), alignItems: "center", padding: "13px 18px", background: RC.card2 }}>
          <div style={{ fontFamily: RC.head, fontWeight: 800, fontSize: 12.5, letterSpacing: "-0.01em", color: RC.ink }}>Total overheads / yr</div>
          <div />
          <div style={{ textAlign: "right", fontFamily: RC.head, fontWeight: 800, fontSize: 18, color: RC.install }}>{money(total)}</div>
          <div />
        </div>
      </Table>
      <button onClick={() => patch({ businessCosts: [...s.businessCosts, { name: "New cost", amount: 0, allocated_to: "shared" }] })}
        style={{ marginTop: 12, border: `1.5px dashed ${RC.lineStrong}`, background: "transparent", color: RC.install, borderRadius: 12, padding: "12px 0", width: "100%", fontFamily: RC.body, fontWeight: 700, fontSize: 13, cursor: "pointer" }}>+ Add a cost</button>
    </DBody>
  );
}

function Hint({ text, up }: { text: string; up?: boolean }) {
  return (
    <span className={"rca-tip" + (up ? " up" : "")} data-tip={text}>
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="10"></circle><path d="M12 16v-5"></path><path d="M12 8h.01"></path></svg>
    </span>
  );
}

// ── DETAILED · Vehicles ─────────────────────────────────────────────────
export function VehiclesDetail({ s, patch, calc }: StepBodyProps) {
  const bd = Object.fromEntries((calc.vehicleBreakdown || []).map(b => [b.id, b]));
  // [key, label, hint?] — hint renders a small ⓘ with a hover tooltip
  const fields: [keyof VehicleCosts, string, string?][] = [
    ["replacement_value", "Replacement value", "What a like-for-like replacement would cost new today — not what you paid."],
    ["resale_value", "Resale value", "Expected trade-in or resale when you replace it at the end of the cycle."],
    ["cycle_years", "Cycle (years)", "How many years you keep the vehicle before replacing it. (Replacement − resale) is spread over this."],
    ["fuel_per_week", "Fuel / week"], ["insurance", "Insurance / yr"], ["rego", "Rego / yr"], ["servicing", "Servicing / yr"], ["tolls", "Tolls / yr"],
    ["fitout", "Fit-out", "Racking, shelving, ladder racks, signage — spread over the same replacement cycle."],
  ];
  const setCost = (vi: number, k: keyof VehicleCosts, v: number) =>
    patch({ vehicles: s.vehicles.map((x, j) => j === vi ? { ...x, costs: { ...x.costs, [k]: v } } : x) });
  return (
    <DBody>
      <WsHelpNote id="vehicles-detailed" style={{ marginBottom: 16 }}>Annual cost = (replacement − resale) ÷ cycle + fuel × 52 + insurance + rego + servicing + tolls + fit-out ÷ cycle. Each vehicle&apos;s cost follows its driver&apos;s install/service mix.</WsHelpNote>
      <WsEyebrow style={{ marginBottom: 11 }}>Fleet · {s.vehicles.length} vehicles · costed individually</WsEyebrow>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {s.vehicles.map((v, vi) => {
          const driver = s.staff.find(p => p.id === v.assigned_driver_id);
          const ch = chipColor(v.allocation);
          const annual = bd[v.vehicle_id]?.annual;
          const costs = v.costs || {};
          return (
            <div key={v.vehicle_id} style={{ background: "#fff", borderRadius: 16, border: `1px solid ${RC.line}`, boxShadow: "0 8px 30px rgba(0,0,0,.03)", overflow: "hidden" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 13, padding: "13px 18px", borderBottom: `1px solid ${RC.line}` }}>
                <span style={{ width: 38, height: 38, borderRadius: 11, background: ch.bg, color: ch.c, display: "flex", alignItems: "center", justifyContent: "center" }}><RcIcon name="truck" size={19} /></span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontFamily: RC.head, fontWeight: 800, fontSize: 14.5, letterSpacing: "-0.01em", color: RC.ink }}>{v.vehicle_name} · {v.rego_number}</div>
                  <div style={{ fontSize: 12, color: RC.faint }}>Driver: {driver ? `${driver.name} (${driver.install_pct}/${driver.service_pct}/${driver.admin_pct} I/S/A)` : v.allocation}</div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: 10, color: RC.faint, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.07em" }}>Annual cost</div>
                  <div style={{ fontFamily: RC.head, fontWeight: 800, fontSize: 20, letterSpacing: "-0.01em", color: ch.c }}>{money(annual)}</div>
                </div>
              </div>
              {(costs.resale_value || 0) > (costs.replacement_value || 0) && (
                <div style={{ padding: "8px 18px", background: RC.amberSoft, fontSize: 12, color: RC.amberDeep, fontWeight: 600, borderBottom: `1px solid ${RC.line}` }}>
                  Resale is higher than replacement — depreciation goes negative and understates this vehicle&apos;s true cost. Check the two values.
                </div>
              )}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)" }}>
                {fields.map(([k, label, hint], fi) => (
                  <div key={k} style={{ padding: "11px 18px", borderBottom: fi < 6 ? `1px solid ${RC.line}` : "none", borderRight: fi % 3 < 2 ? `1px solid ${RC.line}` : "none" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11.5, color: RC.label, fontWeight: 600, marginBottom: 6 }}>{label}{hint && <Hint text={hint} up={k === "fitout"} />}</div>
                    <NumInput value={costs[k] || 0} size={14} prefix={k === "cycle_years" ? "" : "$"} onChange={n => setCost(vi, k, n)} />
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </DBody>
  );
}
