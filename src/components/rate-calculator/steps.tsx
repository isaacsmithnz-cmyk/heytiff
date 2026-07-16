"use client";

/* Step bodies. Simple mode edits simpleLabour/simpleBusiness/simpleVehicle;
   totals always come from `calc`. */

import React from "react";
import type { RiskSettings, Multipliers } from "./engine";
import type { EntryMode } from "./state";
import { RC } from "./theme";
import { money, rate0 } from "./format";
import { RcIcon, WsEyebrow, WsHelpNote, WsSlider, WsToggle, NumInput } from "./ui";
import { BusinessDetail, StaffDetail, VehiclesDetail, type StepBodyProps } from "./detail";

function StepHead({ eyebrow, title, mode, onMode, desc }: {
  eyebrow: string; title: string; mode?: string; onMode?: (v: string) => void; desc?: string;
}) {
  return (
    <div>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 14 }}>
        <div>
          <WsEyebrow color={RC.install}>{eyebrow}</WsEyebrow>
          <div style={{ fontFamily: RC.head, fontWeight: 800, fontSize: 25, letterSpacing: "-0.02em", color: RC.ink, lineHeight: 1.1, marginTop: 5, whiteSpace: "nowrap" }}>{title}</div>
        </div>
        {mode && onMode && <WsToggle value={mode} onChange={onMode} />}
      </div>
      {desc && <div style={{ fontSize: 13.5, color: RC.label, lineHeight: 1.55, maxWidth: 600, marginTop: 8 }}>{desc}</div>}
    </div>
  );
}

const NoteInfoIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" style={{ flexShrink: 0, marginTop: 2 }}>
    <circle cx="12" cy="12" r="10"></circle><path d="M12 16v-5"></path><path d="M12 8h.01"></path>
  </svg>
);
const Note = ({ children }: { children: React.ReactNode }) => (
  <div style={{ marginTop: 14, background: RC.installSoft, borderRadius: 12, padding: "12px 16px", fontSize: 12.5, color: "#1D4FD7", lineHeight: 1.55, display: "flex", gap: 9, alignItems: "flex-start" }}>
    <NoteInfoIcon /><span>{children}</span>
  </div>
);
const Body = ({ children }: { children: React.ReactNode }) => (
  <div style={{ marginTop: 20, display: "flex", flexDirection: "column" }}>{children}</div>
);
const MONTH_LABELS = ["This month", "Last month", "2 months ago"];

const stepBtnStyle: React.CSSProperties = { width: 28, height: 28, borderRadius: 8, fontSize: 16 };

// 3-month entry row used by every simple mode
function MonthInputs({ months, onChange }: { months: number[]; onChange: (m: number[]) => void }) {
  return (
    <div style={{ display: "flex", gap: 14 }}>
      {MONTH_LABELS.map((l, i) => (
        <div key={l} style={{ flex: 1 }}>
          <div style={{ fontSize: 12, color: RC.label, fontWeight: 600, marginBottom: 6 }}>{l}</div>
          <NumInput value={months[i] || 0} onChange={n => { const m = [...months]; m[i] = n; onChange(m); }} />
        </div>
      ))}
    </div>
  );
}

// ── Step 1 · Staff & wages ──────────────────────────────────────────────
export function StaffStep({ s, patch, calc }: StepBodyProps) {
  const sl = s.simpleLabour;
  const totalLabour = calc.instLab + calc.svcLab + calc.adminLab;
  const allocTotal = (sl.install_pct || 0) + (sl.service_pct || 0) + (sl.admin_pct || 0);
  type AllocKey = "install_pct" | "service_pct" | "admin_pct";
  const setAlloc = (k: AllocKey, delta: number) => {
    const next = Math.max(0, Math.min(100, (sl[k] || 0) + delta));
    patch({ simpleLabour: { ...sl, [k]: next } });
  };
  const alloc: [string, AllocKey, string][] = [["Install", "install_pct", RC.install], ["Service", "service_pct", RC.service], ["Admin", "admin_pct", RC.faint]];
  return (
    <>
      <StepHead eyebrow={`Step 1 of 5 · ${s.mode.staff}`} title="Staff & wages" mode={s.mode.staff} onMode={v => patch({ mode: { ...s.mode, staff: v as EntryMode } })} />
      {s.mode.staff === "Detailed" ? <StaffDetail s={s} patch={patch} calc={calc} /> : (
      <Body>
        <WsHelpNote id="staff-simple" style={{ marginBottom: 16 }}><b>Simple mode</b> projects from your last 3 months of payroll. For the sharpest result, switch to <b>Detailed</b> to price each person from real timesheets — it measures your true billable time instead of assuming it, and lifts your confidence rating.</WsHelpNote>
        <WsEyebrow style={{ marginBottom: 11 }}>Last 3 months of wages paid (before super)</WsEyebrow>
        <MonthInputs months={sl.months} onChange={m => patch({ simpleLabour: { ...sl, months: m } })} />

        {/* Staff count — drives billable-hours estimate */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: "#fff", borderRadius: 14, border: `1px solid ${RC.line}`, boxShadow: "0 8px 30px rgba(0,0,0,.03)", padding: "12px 16px", marginTop: 14 }}>
          <div>
            <div style={{ fontSize: 13.5, color: RC.ink, fontWeight: 700 }}>How many staff in total?</div>
            <div style={{ fontSize: 12, color: RC.faint, marginTop: 1 }}>Used to estimate billable hours and utilisation</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button className="rca-stepbtn" style={stepBtnStyle} onClick={() => patch({ simpleLabour: { ...sl, staff_count: Math.max(1, (sl.staff_count || 1) - 1) } })}>−</button>
            <span style={{ fontFamily: RC.head, fontWeight: 800, fontSize: 19, color: RC.ink, minWidth: 32, textAlign: "center" }}>{sl.staff_count || 1}</span>
            <button className="rca-stepbtn" style={stepBtnStyle} onClick={() => patch({ simpleLabour: { ...sl, staff_count: (sl.staff_count || 1) + 1 } })}>+</button>
          </div>
        </div>

        <div style={{ background: RC.serviceSoft, borderRadius: 14, padding: "15px 20px", marginTop: 14, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <WsEyebrow color={RC.service}>Projected yearly true cost</WsEyebrow>
            <div style={{ fontSize: 12.5, color: RC.service, opacity: 0.85, marginTop: 3 }}>wages + super + workers comp + leave loading</div>
          </div>
          <div style={{ fontFamily: RC.head, fontWeight: 800, fontSize: 28, letterSpacing: "-0.02em", color: RC.service }}>{money(totalLabour)}</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 22, marginBottom: 11 }}>
          <WsEyebrow>Split that time across the work <span style={{ color: RC.red }}>*</span></WsEyebrow>
          {allocTotal !== 100 && <span style={{ fontSize: 12, fontWeight: 700, color: RC.redInk }}>Must total 100% — currently {allocTotal}%</span>}
        </div>
        <div style={{ display: "flex", height: 40, borderRadius: 12, overflow: "hidden" }}>
          {alloc.map(([l, k, c]) => (sl[k] || 0) > 0 && <div key={k} style={{ width: `${sl[k]}%`, background: c, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontFamily: RC.head, fontWeight: 800, fontSize: 12.5, whiteSpace: "nowrap", overflow: "hidden", transition: "width .25s" }}>{(sl[k] || 0) >= 18 ? `${l} · ${sl[k]}%` : (sl[k] || 0) >= 8 ? `${sl[k]}%` : ""}</div>)}
        </div>
        <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
          {alloc.map(([l, k, c]) => (
            <div key={k} style={{ flex: 1, minWidth: 0, background: "#fff", borderRadius: 13, border: `1px solid ${RC.line}`, padding: "10px 9px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 5 }}>
              <span style={{ fontSize: 12, color: RC.ink, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>{l}</span>
              <div style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
                <button className="rca-stepbtn" style={{ width: 26, height: 26, borderRadius: 7, fontSize: 15 }} onClick={() => setAlloc(k, -5)}>−</button>
                <span style={{ fontFamily: RC.head, fontWeight: 800, fontSize: 15, color: c, minWidth: 31, textAlign: "center" }}>{sl[k]}%</span>
                <button className="rca-stepbtn" style={{ width: 26, height: 26, borderRadius: 7, fontSize: 15 }} onClick={() => setAlloc(k, 5)}>+</button>
              </div>
            </div>
          ))}
        </div>

        {/* Billability assumption — drives the whole rate */}
        <div style={{ background: "#fff", borderRadius: 14, border: `1px solid ${RC.line}`, boxShadow: "0 8px 30px rgba(0,0,0,.03)", padding: "14px 18px", marginTop: 16 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
            <div>
              <div style={{ fontSize: 13.5, color: RC.ink, fontWeight: 700 }}>Billable time assumption</div>
              <div style={{ fontSize: 12, color: RC.faint, marginTop: 2, maxWidth: 420, lineHeight: 1.5 }}>The share of paid hours spent on jobs you can invoice — the rest is travel, quoting, admin and downtime. This drives your rate, so set it close to reality.</div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <button className="rca-stepbtn" style={stepBtnStyle} onClick={() => patch({ simpleLabour: { ...sl, billable_pct: Math.max(40, (sl.billable_pct ?? 75) - 5) } })}>−</button>
              <span style={{ fontFamily: RC.head, fontWeight: 800, fontSize: 19, color: RC.install, minWidth: 54, textAlign: "center" }}>{sl.billable_pct ?? 75}%</span>
              <button className="rca-stepbtn" style={stepBtnStyle} onClick={() => patch({ simpleLabour: { ...sl, billable_pct: Math.min(95, (sl.billable_pct ?? 75) + 5) } })}>+</button>
            </div>
          </div>
        </div>

      </Body>
      )}
    </>
  );
}

// ── Step 2 · Business costs ─────────────────────────────────────────────
export function BusinessStep({ s, patch, calc }: StepBodyProps) {
  const sb = s.simpleBusiness;
  return (
    <>
      <StepHead eyebrow={`Step 2 of 5 · ${s.mode.business}`} title="Business costs" mode={s.mode.business} onMode={v => patch({ mode: { ...s.mode, business: v as EntryMode } })} />
      {s.mode.business === "Detailed" ? <BusinessDetail s={s} patch={patch} calc={calc} /> : (
      <Body>
        <WsHelpNote id="business-simple" style={{ marginBottom: 16 }}>Don&apos;t include wages or vehicle costs here — those live in their own steps, so nothing is double-counted. Switch to <b>Detailed</b> to itemise costs and choose whether each loads onto install, service, or both.</WsHelpNote>
        <WsEyebrow style={{ marginBottom: 11 }}>Last 3 months of overheads paid</WsEyebrow>
        <MonthInputs months={sb.months} onChange={m => patch({ simpleBusiness: { ...sb, months: m } })} />
        <div style={{ background: RC.installSoft, borderRadius: 14, padding: "15px 20px", marginTop: 14, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <WsEyebrow color={RC.install}>Projected overheads / yr</WsEyebrow>
            <div style={{ fontSize: 12.5, color: RC.install, opacity: 0.85, marginTop: 3 }}>spread across every billable hour</div>
          </div>
          <div style={{ fontFamily: RC.head, fontWeight: 800, fontSize: 28, letterSpacing: "-0.02em", color: RC.install }}>{money(calc.enteredBiz)}</div>
        </div>
      </Body>
      )}
    </>
  );
}

// ── Step 3 · Vehicles ───────────────────────────────────────────────────
export function VehiclesStep({ s, patch, calc }: StepBodyProps) {
  const sv = s.simpleVehicle;
  const fleetTotal = calc.instVehicle + calc.svcVehicle + calc.adminVehicle;
  return (
    <>
      <StepHead eyebrow={`Step 3 of 5 · ${s.mode.vehicles}`} title="Vehicles" mode={s.mode.vehicles} onMode={val => patch({ mode: { ...s.mode, vehicles: val as EntryMode } })} />
      {s.mode.vehicles === "Detailed" ? <VehiclesDetail s={s} patch={patch} calc={calc} /> : s.noVehicles ? (
      <Body>
        <div style={{ background: "#fff", borderRadius: 16, border: `1px solid ${RC.line}`, boxShadow: "0 8px 30px rgba(0,0,0,.03)", padding: "20px 22px", display: "flex", alignItems: "center", gap: 16 }}>
          <span style={{ width: 44, height: 44, borderRadius: 13, background: RC.serviceSoft, color: RC.service, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><RcIcon name="truck" size={22} /></span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontFamily: RC.head, fontWeight: 800, fontSize: 16, letterSpacing: "-0.01em", color: RC.ink }}>No vehicles</div>
            <div style={{ fontSize: 12.5, color: RC.label, marginTop: 2, lineHeight: 1.5 }}>Your rates carry no vehicle recovery. You can add fleet costs any time.</div>
          </div>
          <button className="rca-btn ghost sm" onClick={() => patch({ noVehicles: false })}>I do have vehicles</button>
        </div>
      </Body>
      ) : (
      <Body>
        <WsHelpNote id="vehicles-simple" style={{ marginBottom: 16 }}>Enter your fleet&apos;s running costs below — or if you don&apos;t run any vehicles, choose <b>No vehicles</b> and this step carries no vehicle recovery. <b>Detailed</b> mode costs each vehicle individually (replacement cycle, fuel, rego, fit-out).</WsHelpNote>
        <WsEyebrow style={{ marginBottom: 11 }}>Last 3 months of fleet running costs</WsEyebrow>
        <MonthInputs months={sv.months} onChange={m => patch({ simpleVehicle: { ...sv, months: m } })} />
        <div style={{ background: RC.serviceSoft, borderRadius: 14, padding: "15px 20px", marginTop: 14, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <WsEyebrow color={RC.service}>Projected fleet cost / yr</WsEyebrow>
            <div style={{ fontSize: 12.5, color: RC.service, opacity: 0.85, marginTop: 3 }}>split by each driver&apos;s install / service mix</div>
          </div>
          <div style={{ fontFamily: RC.head, fontWeight: 800, fontSize: 28, letterSpacing: "-0.02em", color: RC.service }}>{money(fleetTotal)}</div>
        </div>
        <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
          {s.vehicles.map(v => (
            <div key={v.vehicle_id} style={{ flex: 1, background: "#fff", borderRadius: 13, border: `1px solid ${RC.line}`, padding: "12px 15px", display: "flex", alignItems: "center", gap: 11 }}>
              <span style={{ width: 34, height: 34, borderRadius: 10, background: RC.installSoft, color: RC.install, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><RcIcon name="truck" size={17} /></span>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontFamily: RC.head, fontWeight: 800, fontSize: 13.5, letterSpacing: "-0.01em", color: RC.ink, whiteSpace: "nowrap" }}>{v.vehicle_name} · {v.rego_number}</div>
                <div style={{ fontSize: 11.5, color: RC.faint }}>{v.allocation} · driver: {s.staff.find(p => p.id === v.assigned_driver_id)?.name || "Unassigned"}</div>
              </div>
            </div>
          ))}
        </div>
        <button className="rca-btn ghost" style={{ marginTop: 16, alignSelf: "flex-start" }} onClick={() => patch({ noVehicles: true, simpleVehicle: { ...sv, months: [0, 0, 0] } })}>I don&apos;t run any vehicles</button>
      </Body>
      )}
    </>
  );
}

// ── Step 4 · HVAC risk ──────────────────────────────────────────────────
function RiskBar({ label, c, soft, be, m, barMax }: {
  label: string; c: string; soft: string; be: number | null; m: number; barMax: number;
}) {
  if (be == null) return <div style={{ flex: 1, fontSize: 12.5, color: RC.faint }}>{label}: — (complete earlier steps)</div>;
  const base = be / m, add = be - base;
  return (
    <div style={{ flex: 1 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6, gap: 12 }}>
        <span style={{ fontSize: 13, color: RC.ink, fontWeight: 700 }}>{label}</span>
        <span style={{ fontSize: 12, color: RC.faint, whiteSpace: "nowrap" }}>base <b style={{ color: RC.ink2 }}>${Math.round(base)}</b> + buffer <b style={{ color: c }}>${Math.round(add)}</b> = <b style={{ color: c }}>${Math.round(be)}</b> break-even</span>
      </div>
      <div style={{ display: "flex", height: 14, borderRadius: 7, overflow: "hidden", background: RC.card2 }}>
        <div style={{ width: `${(base / barMax) * 100}%`, background: c }} /><div style={{ width: `${(add / barMax) * 100}%`, background: soft, borderRight: `2px solid ${c}` }} />
      </div>
    </div>
  );
}

export function RiskStep({ s, patch, calc }: StepBodyProps) {
  const set = (k: keyof RiskSettings, val: number) => patch({ risk: { ...s.risk, [k]: val } });
  const items: [string, keyof RiskSettings, string, string][] = [
    ["Warranty allowance", "warranty", RC.install, "Manufacturer warranty re-visits"],
    ["Defect allowance", "defect", RC.install, "Rework on installs that fail"],
    ["Callback allowance", "callback", RC.service, "Return visits on service jobs"],
    ["Diagnostic downtime", "diagnostic", RC.service, "Fault-finding that isn't billable"],
  ];
  const iM = 1 + (s.risk.warranty + s.risk.defect) / 100;
  const sM = 1 + (s.risk.callback + s.risk.diagnostic) / 100;
  const barMax = Math.max(160, Math.ceil((Math.max(calc.beInst || 0, calc.beSvc || 0) * 1.15) / 20) * 20);
  return (
    <>
      <StepHead eyebrow="Step 4 of 5" title="HVAC risk buffer" desc="A margin for the unbillable realities of HVAC — callbacks, warranty returns and diagnostic time. Drag each to match your business." />
      <Body>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          {items.map(([l, k, c, desc]) => (
            <div key={k} style={{ background: "#fff", borderRadius: 16, border: `1px solid ${RC.line}`, boxShadow: "0 8px 30px rgba(0,0,0,.03)", padding: "16px 18px" }}>
              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10 }}>
                <span style={{ fontFamily: RC.head, fontWeight: 800, fontSize: 13.5, letterSpacing: "-0.01em", color: RC.ink, whiteSpace: "nowrap" }}>{l}</span>
                <span style={{ fontFamily: RC.head, fontWeight: 800, fontSize: 21, color: c }}>{s.risk[k]}%</span>
              </div>
              <div style={{ fontSize: 12, color: RC.faint, marginTop: 3, marginBottom: 14 }}>{desc}</div>
              <WsSlider value={s.risk[k]} min={0} max={10} onChange={val => set(k, val)} color={c} />
            </div>
          ))}
        </div>
        <div style={{ background: "#fff", borderRadius: 16, border: `1px solid ${RC.line}`, boxShadow: "0 8px 30px rgba(0,0,0,.03)", padding: "18px 20px", marginTop: 14 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
            <WsEyebrow>How the buffer shapes your break-even</WsEyebrow>
            <span style={{ fontSize: 12, color: RC.faint }}>Install +{s.risk.warranty + s.risk.defect}% · Service +{s.risk.callback + s.risk.diagnostic}%</span>
          </div>
          <div style={{ display: "flex", gap: 24 }}>
            <RiskBar label="Install" c={RC.install} soft={RC.installSoft} be={calc.beInst} m={iM} barMax={barMax} />
            <RiskBar label="Service" c={RC.service} soft={RC.serviceSoft} be={calc.beSvc} m={sM} barMax={barMax} />
          </div>
        </div>
        <Note>Defaults: Warranty 3% · Defect 2% · Callback 4% · Diagnostic 3%. Most HVAC firms run 6–10% combined across install and service.</Note>
      </Body>
    </>
  );
}

// ── Step 5 · Profit target ──────────────────────────────────────────────
export function ProfitStep({ s, patch, calc }: StepBodyProps) {
  const mults: [string, keyof Multipliers, number | null][] = [
    ["After-hours", "afterHours", calc.afterHrs],
    ["Emergency", "emergency", calc.emergency],
  ];
  return (
    <>
      <StepHead eyebrow="Step 5 of 5" title="Profit target" desc="Margin is applied to your fully-loaded break-even cost. Premium-time multipliers scale off the service rate." />
      <Body>
        <div style={{ background: "#fff", borderRadius: 16, border: `1px solid ${RC.line}`, boxShadow: "0 8px 30px rgba(0,0,0,.03)", padding: "20px 22px" }}>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
            <span style={{ fontFamily: RC.head, fontWeight: 800, fontSize: 15, letterSpacing: "-0.01em", color: RC.ink, whiteSpace: "nowrap" }}>Net profit margin</span>
            <span style={{ fontFamily: RC.head, fontWeight: 800, fontSize: 26, color: RC.install }}>{s.profit.margin}%</span>
          </div>
          <div style={{ fontSize: 12.5, color: RC.faint, marginTop: 3, marginBottom: 16 }}>Profit left after every cost is covered — rate = break-even ÷ (1 − margin).</div>
          <WsSlider value={s.profit.margin} min={0} max={40} onChange={v => patch({ profit: { ...s.profit, margin: v } })} color={RC.install} />
        </div>
        <WsEyebrow style={{ marginTop: 22, marginBottom: 11 }}>Premium-time multipliers</WsEyebrow>
        <div style={{ display: "flex", gap: 14 }}>
          {mults.map(([l, k, val]) => (
            <div key={k} style={{ flex: 1, background: "#fff", borderRadius: 16, border: `1px solid ${RC.line}`, boxShadow: "0 8px 30px rgba(0,0,0,.03)", padding: "16px 18px" }}>
              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
                <span style={{ fontSize: 13.5, color: RC.ink, fontWeight: 700, whiteSpace: "nowrap" }}>{l}</span>
                <span style={{ fontFamily: RC.head, fontWeight: 800, fontSize: 17, color: RC.violet }}>{s.multipliers[k].toFixed(2)}×</span>
              </div>
              <div style={{ fontFamily: RC.head, fontWeight: 800, fontSize: 27, letterSpacing: "-0.02em", color: RC.ink, margin: "6px 0 12px" }}>{rate0(val)}<span style={{ fontSize: 13, color: RC.faint, fontWeight: 600, letterSpacing: 0 }}>/hr</span></div>
              <WsSlider value={s.multipliers[k]} min={1} max={3} step={0.05} onChange={v => patch({ multipliers: { ...s.multipliers, [k]: v } })} color={RC.violet} />
            </div>
          ))}
        </div>
        <div style={{ background: "#fff", borderRadius: 16, border: `1px solid ${RC.line}`, boxShadow: "0 8px 30px rgba(0,0,0,.03)", padding: "16px 18px", marginTop: 14, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <span style={{ fontFamily: RC.head, fontWeight: 800, fontSize: 13.5, letterSpacing: "-0.01em", color: RC.ink }}>Annual cost increase</span>
            <div style={{ fontSize: 12.5, color: RC.faint, marginTop: 2 }}>Drives the next-year projection: install {rate0(calc.projInst)} · service {rate0(calc.projSvc)}</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <button className="rca-stepbtn" style={stepBtnStyle} onClick={() => patch({ profit: { ...s.profit, costIncrease: Math.max(0, (s.profit.costIncrease ?? 3) - 1) } })}>−</button>
            <span style={{ fontFamily: RC.head, fontWeight: 800, fontSize: 19, color: RC.install, minWidth: 52, textAlign: "center" }}>{s.profit.costIncrease ?? 3}%</span>
            <button className="rca-stepbtn" style={stepBtnStyle} onClick={() => patch({ profit: { ...s.profit, costIncrease: (s.profit.costIncrease ?? 3) + 1 } })}>+</button>
          </div>
        </div>
        <Note>You&apos;re on the last step — continue to see your full results and apply the new rates.</Note>
      </Body>
    </>
  );
}
