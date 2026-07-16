"use client";

/* Step bodies. Simple mode asks one question at a time (QuestionStack) and
   edits simpleLabour/simpleBusiness/simpleVehicle; totals always come from
   `calc`. Detailed bodies are unchanged power-user views.

   `showToggle` (per-step, gated by the host): the Simple/Detailed toggle is
   hidden on the first run and returns on later visits once the step has data
   that Detailed can actually edit. */

import React from "react";
import type { RiskSettings, Multipliers } from "./engine";
import { fleetCosted, type EntryMode } from "./state";
import { RC } from "./theme";
import { money, rate0 } from "./format";
import { QuestionStack, RcIcon, WsEyebrow, WsHelpNote, WsSlider, WsToggle, NumInput, type StackQuestion } from "./ui";
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

// stepper +/- row shared by count-style questions
function StepperRow({ value, display, onMinus, onPlus, minWidth = 44 }: {
  value: number; display?: string; onMinus: () => void; onPlus: () => void; minWidth?: number;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <button className="rca-stepbtn" style={stepBtnStyle} onClick={onMinus}>−</button>
      <span style={{ fontFamily: RC.head, fontWeight: 800, fontSize: 19, color: RC.ink, minWidth, textAlign: "center" }}>{display ?? value}</span>
      <button className="rca-stepbtn" style={stepBtnStyle} onClick={onPlus}>+</button>
    </div>
  );
}

// One editable percentage row for the work split. The field is CONTROLLED and
// its `onChange` runs through a clamping setter, so typing (or ±) can never push
// the value past what's available — the input snaps back on the spot.
function PctRow({ label, color, value, onChange }: {
  label: string; color: string; value: number; onChange: (v: number) => void;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, background: RC.card2, borderRadius: 12, border: `1px solid ${RC.line}`, padding: "9px 14px" }}>
      <span style={{ display: "flex", alignItems: "center", gap: 9, minWidth: 0 }}>
        <span style={{ width: 9, height: 9, borderRadius: "50%", background: color, flexShrink: 0 }} />
        <span style={{ fontSize: 13, color: RC.ink, fontWeight: 700 }}>{label}</span>
      </span>
      <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
        <button className="rca-stepbtn" style={{ width: 26, height: 26, borderRadius: 7, fontSize: 15 }} onClick={() => onChange(value - 5)}>−</button>
        <div style={{ display: "inline-flex", alignItems: "baseline", gap: 1, background: "#fff", borderRadius: 9, border: `1px solid ${RC.lineStrong}`, padding: "5px 10px", minWidth: 58, justifyContent: "center" }}>
          <input value={String(value)} inputMode="numeric" aria-label={`${label} percent`}
            onChange={e => { const d = e.target.value.replace(/[^0-9]/g, ""); onChange(d === "" ? 0 : parseInt(d, 10)); }}
            style={{ width: 28, border: "none", background: "transparent", outline: "none", textAlign: "right", fontFamily: RC.head, fontWeight: 800, fontSize: 15, color, padding: 0 }} />
          <span style={{ fontSize: 13, color: RC.faint, fontWeight: 700 }}>%</span>
        </div>
        <button className="rca-stepbtn" style={{ width: 26, height: 26, borderRadius: 7, fontSize: 15 }} onClick={() => onChange(value + 5)}>+</button>
      </div>
    </div>
  );
}

// ── Step 1 · Staff & wages ──────────────────────────────────────────────
export function StaffStep({ s, patch, calc, showToggle, revealAll }: StepBodyProps) {
  const sl = s.simpleLabour;
  const totalLabour = calc.instLab + calc.svcLab + calc.adminLab;
  const wagesEntered = (sl.months || []).some(m => m > 0);
  // Work split: Install and Service are the two editable shares; Admin is
  // always the remainder (100 − the two), so the split can never total
  // anything but 100%. Each setter clamps the edited share to what's left.
  const install = sl.install_pct || 0;
  const service = sl.service_pct || 0;
  const admin = Math.max(0, 100 - install - service);
  const setInstall = (v: number) => {
    const i = Math.max(0, Math.min(100 - service, Math.round(v) || 0));
    patch({ simpleLabour: { ...sl, install_pct: i, admin_pct: 100 - i - service } });
  };
  const setService = (v: number) => {
    const sv = Math.max(0, Math.min(100 - install, Math.round(v) || 0));
    patch({ simpleLabour: { ...sl, service_pct: sv, admin_pct: 100 - install - sv } });
  };
  // Heal a legacy split that doesn't total 100 (older ± builds could persist
  // e.g. 65/30/10) by pinning admin to the remainder once, on load.
  React.useEffect(() => {
    if (install + service + (sl.admin_pct || 0) !== 100) {
      patch({ simpleLabour: { ...sl, admin_pct: 100 - install - service } });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [install, service, sl.admin_pct]);

  const questions: StackQuestion[] = [
    {
      id: "wages",
      title: "What did you pay in wages over the last 3 months?",
      hint: "Gross pay before super — straight off your payroll totals",
      answered: wagesEntered,
      body: (
        <>
          <MonthInputs months={sl.months} onChange={m => patch({ simpleLabour: { ...sl, months: m } })} />
          {wagesEntered && (
            <div style={{ background: RC.serviceSoft, borderRadius: 14, padding: "13px 18px", marginTop: 14, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div>
                <WsEyebrow color={RC.service}>Projected yearly true cost</WsEyebrow>
                <div style={{ fontSize: 12.5, color: RC.service, opacity: 0.85, marginTop: 3 }}>wages + super + workers comp + leave loading</div>
              </div>
              <div style={{ fontFamily: RC.head, fontWeight: 800, fontSize: 26, letterSpacing: "-0.02em", color: RC.service }}>{money(totalLabour)}</div>
            </div>
          )}
        </>
      ),
    },
    {
      id: "staff-count",
      title: "How many staff in total?",
      hint: "Used to estimate billable hours and utilisation",
      answered: true,
      body: (
        <StepperRow value={sl.staff_count || 1}
          onMinus={() => patch({ simpleLabour: { ...sl, staff_count: Math.max(1, (sl.staff_count || 1) - 1) } })}
          onPlus={() => patch({ simpleLabour: { ...sl, staff_count: (sl.staff_count || 1) + 1 } })} />
      ),
    },
    {
      id: "split",
      title: "Split that time across the work",
      hint: "Roughly how the team's hours divide across install and service — Admin fills whatever's left",
      answered: true, // always 100% by construction — Admin is the remainder
      body: (
        <>
          {/* live proportion bar — always exactly full */}
          <div style={{ display: "flex", height: 40, borderRadius: 12, overflow: "hidden", marginBottom: 14 }}>
            {([["Install", install, RC.install], ["Service", service, RC.service], ["Admin", admin, RC.faint]] as [string, number, string][]).map(([l, v, c]) => v > 0 && (
              <div key={l} style={{ width: `${v}%`, background: c, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontFamily: RC.head, fontWeight: 800, fontSize: 12.5, whiteSpace: "nowrap", overflow: "hidden", transition: "width .2s" }}>{v >= 18 ? `${l} · ${v}%` : v >= 8 ? `${v}%` : ""}</div>
            ))}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <PctRow label="Install" color={RC.install} value={install} onChange={setInstall} />
            <PctRow label="Service" color={RC.service} value={service} onChange={setService} />
            {/* Admin — the remainder, shown but not editable */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, background: RC.card2, borderRadius: 12, border: `1px dashed ${RC.lineStrong}`, padding: "11px 14px" }}>
              <span style={{ display: "flex", alignItems: "center", gap: 9, minWidth: 0 }}>
                <span style={{ width: 9, height: 9, borderRadius: "50%", background: RC.faint, flexShrink: 0 }} />
                <span style={{ fontSize: 13, color: RC.ink, fontWeight: 700 }}>Admin</span>
                <span style={{ fontSize: 11.5, color: RC.faint, whiteSpace: "nowrap" }}>the rest — overhead &amp; non-billable</span>
              </span>
              <span style={{ fontFamily: RC.head, fontWeight: 800, fontSize: 17, color: RC.ink2, flexShrink: 0 }}>{admin}%</span>
            </div>
          </div>
        </>
      ),
    },
    {
      id: "billable",
      title: "Billable time assumption",
      hint: "The share of paid hours spent on jobs you can invoice — the rest is travel, quoting, admin and downtime",
      answered: true,
      body: (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
          <div style={{ fontSize: 12, color: RC.faint, maxWidth: 420, lineHeight: 1.5 }}>This drives your rate, so set it close to reality. 75% is the industry norm.</div>
          <StepperRow value={sl.billable_pct ?? 75} display={`${sl.billable_pct ?? 75}%`} minWidth={54}
            onMinus={() => patch({ simpleLabour: { ...sl, billable_pct: Math.max(40, (sl.billable_pct ?? 75) - 5) } })}
            onPlus={() => patch({ simpleLabour: { ...sl, billable_pct: Math.min(95, (sl.billable_pct ?? 75) + 5) } })} />
        </div>
      ),
    },
  ];

  return (
    <>
      <StepHead eyebrow={`Step 1 of 5 · ${s.mode.staff}`} title="Staff & wages"
        mode={showToggle ? s.mode.staff : undefined}
        onMode={showToggle ? (v => patch({ mode: { ...s.mode, staff: v as EntryMode } })) : undefined} />
      {s.mode.staff === "Detailed" ? <StaffDetail s={s} patch={patch} calc={calc} /> : (
      <Body>
        <WsHelpNote id="staff-simple" style={{ marginBottom: 16 }}><b>Simple mode</b> projects from your last 3 months of payroll — answer each question and your rates build live on the right.{showToggle && <> For the sharpest result, switch to <b>Detailed</b> to price each person from real timesheets.</>}</WsHelpNote>
        <QuestionStack questions={questions} revealAll={revealAll} />
      </Body>
      )}
    </>
  );
}

// ── Step 2 · Business costs ─────────────────────────────────────────────
export function BusinessStep({ s, patch, calc, showToggle, revealAll }: StepBodyProps) {
  const sb = s.simpleBusiness;
  const entered = (sb.months || []).some(m => m > 0);
  const questions: StackQuestion[] = [
    {
      id: "overheads",
      title: "What did the business spend on overheads over the last 3 months?",
      hint: "Rent, insurance, software, phones, accounting — not wages or vehicles, they have their own steps",
      answered: entered,
      body: (
        <>
          <MonthInputs months={sb.months} onChange={m => patch({ simpleBusiness: { ...sb, months: m } })} />
          {entered && (
            <div style={{ background: RC.installSoft, borderRadius: 14, padding: "13px 18px", marginTop: 14, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div>
                <WsEyebrow color={RC.install}>Projected overheads / yr</WsEyebrow>
                <div style={{ fontSize: 12.5, color: RC.install, opacity: 0.85, marginTop: 3 }}>spread across every billable hour</div>
              </div>
              <div style={{ fontFamily: RC.head, fontWeight: 800, fontSize: 26, letterSpacing: "-0.02em", color: RC.install }}>{money(calc.enteredBiz)}</div>
            </div>
          )}
        </>
      ),
    },
  ];
  return (
    <>
      <StepHead eyebrow={`Step 2 of 5 · ${s.mode.business}`} title="Business costs"
        mode={showToggle ? s.mode.business : undefined}
        onMode={showToggle ? (v => patch({ mode: { ...s.mode, business: v as EntryMode } })) : undefined} />
      {s.mode.business === "Detailed" ? <BusinessDetail s={s} patch={patch} calc={calc} /> : (
      <Body>
        <WsHelpNote id="business-simple" style={{ marginBottom: 16 }}>Don&apos;t include wages or vehicle costs here — those live in their own steps, so nothing is double-counted.{showToggle && <> Switch to <b>Detailed</b> to itemise costs and choose whether each loads onto install, service, or both.</>}</WsHelpNote>
        <QuestionStack questions={questions} revealAll={revealAll} />
      </Body>
      )}
    </>
  );
}

// ── Step 3 · Vehicles ───────────────────────────────────────────────────
export function VehiclesStep({ s, patch, calc, showToggle, revealAll }: StepBodyProps) {
  const sv = s.simpleVehicle;
  const fleetTotal = calc.instVehicle + calc.svcVehicle + calc.adminVehicle;
  const hasCosts = fleetCosted(s);
  // Local "yes we run vehicles" choice; derived yes once costs exist, so a
  // returning user with a costed fleet sees the whole stack answered.
  const [saidYes, setSaidYes] = React.useState(hasCosts);
  const runsVehicles = saidYes || hasCosts;

  const choiceBtn = (active: boolean): React.CSSProperties => ({
    flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 9, height: 52,
    borderRadius: 13, cursor: "pointer", fontFamily: RC.head, fontWeight: 800, fontSize: 14,
    border: active ? `1.5px solid ${RC.install}` : `1px solid ${RC.lineStrong}`,
    background: active ? RC.installSoft : "#fff", color: active ? RC.install : RC.ink2,
    boxShadow: active ? "none" : "0 1px 2px rgba(10,12,20,.04)", transition: "all .2s",
  });

  const q1: StackQuestion = {
    id: "have-vehicles",
    title: "Do you run vehicles for the business?",
    hint: "Utes, vans, trucks — anything the business pays to keep on the road",
    answered: s.noVehicles || runsVehicles,
    hideNext: true, // the Yes choice advances the stack itself
    body: (advance: () => void) => s.noVehicles ? (
      <div style={{ display: "flex", alignItems: "center", gap: 14, background: RC.serviceSoft, borderRadius: 13, padding: "13px 16px" }}>
        <span style={{ width: 38, height: 38, borderRadius: 11, background: "#fff", color: RC.service, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><RcIcon name="truck" size={19} /></span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: RC.head, fontWeight: 800, fontSize: 14, color: "#00745F" }}>No vehicles</div>
          <div style={{ fontSize: 12, color: "#00745F", opacity: 0.85, marginTop: 1 }}>Your rates carry no vehicle recovery. You can add fleet costs any time.</div>
        </div>
        <button className="rca-btn ghost sm" onClick={() => { setSaidYes(false); patch({ noVehicles: false }); }}>I do have vehicles</button>
      </div>
    ) : (
      <div style={{ display: "flex", gap: 12 }}>
        <button style={choiceBtn(runsVehicles)} onClick={() => { setSaidYes(true); if (s.noVehicles) patch({ noVehicles: false }); advance(); }}>
          <RcIcon name="truck" size={17} /> Yes — we run vehicles
        </button>
        <button style={choiceBtn(false)} onClick={() => { setSaidYes(false); patch({ noVehicles: true, simpleVehicle: { ...sv, months: [0, 0, 0] } }); }}>
          No vehicles
        </button>
      </div>
    ),
  };

  const q2: StackQuestion = {
    id: "fleet-costs",
    title: "What did the fleet cost to run over the last 3 months?",
    hint: "Fuel, servicing, rego, insurance, tolls — across all vehicles combined",
    answered: hasCosts,
    body: (
      <>
        <MonthInputs months={sv.months} onChange={m => patch({ simpleVehicle: { ...sv, months: m } })} />
        {hasCosts && (
          <div style={{ background: RC.serviceSoft, borderRadius: 14, padding: "13px 18px", marginTop: 14, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div>
              <WsEyebrow color={RC.service}>Projected fleet cost / yr</WsEyebrow>
              <div style={{ fontSize: 12.5, color: RC.service, opacity: 0.85, marginTop: 3 }}>split by each driver&apos;s install / service mix</div>
            </div>
            <div style={{ fontFamily: RC.head, fontWeight: 800, fontSize: 26, letterSpacing: "-0.02em", color: RC.service }}>{money(fleetTotal)}</div>
          </div>
        )}
        {s.vehicles.length > 0 && (
          <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
            {s.vehicles.map(v => (
              <div key={v.vehicle_id} style={{ flex: 1, background: RC.card2, borderRadius: 13, border: `1px solid ${RC.line}`, padding: "12px 15px", display: "flex", alignItems: "center", gap: 11 }}>
                <span style={{ width: 34, height: 34, borderRadius: 10, background: RC.installSoft, color: RC.install, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><RcIcon name="truck" size={17} /></span>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontFamily: RC.head, fontWeight: 800, fontSize: 13.5, letterSpacing: "-0.01em", color: RC.ink, whiteSpace: "nowrap" }}>{v.vehicle_name} · {v.rego_number}</div>
                  <div style={{ fontSize: 11.5, color: RC.faint }}>{v.allocation} · driver: {s.staff.find(p => p.id === v.assigned_driver_id)?.name || "Unassigned"}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </>
    ),
  };

  // Saying "No" collapses the stack to the single answered question.
  const questions = s.noVehicles ? [q1] : runsVehicles ? [q1, q2] : [q1];

  return (
    <>
      <StepHead eyebrow={`Step 3 of 5 · ${s.mode.vehicles}`} title="Vehicles"
        mode={showToggle ? s.mode.vehicles : undefined}
        onMode={showToggle ? (val => patch({ mode: { ...s.mode, vehicles: val as EntryMode } })) : undefined} />
      {s.mode.vehicles === "Detailed" ? <VehiclesDetail s={s} patch={patch} calc={calc} /> : (
      <Body>
        <WsHelpNote id="vehicles-simple" style={{ marginBottom: 16 }}>Vehicle costs load onto the rate for the work each driver does — so the fleet is recovered through your charged hours.{showToggle && <> <b>Detailed</b> mode costs each vehicle individually (replacement cycle, fuel, rego, fit-out).</>}</WsHelpNote>
        <QuestionStack key={questions.length} questions={questions} revealAll={revealAll} />
      </Body>
      )}
    </>
  );
}

// ── Step 4 · HVAC risk ──────────────────────────────────────────────────
// One full-width row per rate. Both rows share the same left edge and the
// same dollar scale (barMax), so the bars line up and compare directly:
// solid = base cost per hour, striped = the risk buffer added on top.
function RiskBar({ label, c, soft, be, m, barMax }: {
  label: string; c: string; soft: string; be: number | null; m: number; barMax: number;
}) {
  if (be == null) return <div style={{ fontSize: 12.5, color: RC.faint }}>{label}: — (complete earlier steps)</div>;
  const base = be / m, add = be - base;
  const stripe = `repeating-linear-gradient(135deg, ${soft} 0 5px, #fff 5px 8px)`;
  return (
    <div>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, marginBottom: 6 }}>
        <span style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 13, color: RC.ink, fontWeight: 700, flexShrink: 0 }}>
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: c }} />{label}
        </span>
        <span style={{ fontSize: 12, color: RC.faint, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          base <b style={{ color: RC.ink2 }}>${Math.round(base)}</b> + buffer <b style={{ color: RC.ink2 }}>${Math.round(add)}</b> {"→"} <b style={{ fontFamily: RC.head, fontSize: 13.5, color: c }}>${Math.round(be)}</b> break-even
        </span>
      </div>
      <div style={{ display: "flex", height: 16, borderRadius: 8, overflow: "hidden", background: RC.card2 }}>
        <div style={{ width: `${(base / barMax) * 100}%`, background: c, transition: "width .2s" }} />
        <div style={{ width: `${(add / barMax) * 100}%`, background: stripe, borderLeft: `2px solid #fff`, boxShadow: `inset 0 0 0 1px ${soft}`, transition: "width .2s" }} />
      </div>
    </div>
  );
}

function RiskLegend() {
  return (
    <div style={{ display: "flex", gap: 16, alignItems: "center", fontSize: 11.5, color: RC.label }}>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
        <span style={{ width: 18, height: 9, borderRadius: 3, background: RC.ink2, opacity: 0.55 }} /> base cost per hour
      </span>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
        <span style={{ width: 18, height: 9, borderRadius: 3, background: `repeating-linear-gradient(135deg, ${RC.lineStrong} 0 4px, #fff 4px 7px)`, boxShadow: `inset 0 0 0 1px ${RC.lineStrong}` }} /> risk buffer added
      </span>
    </div>
  );
}

export function RiskStep({ s, patch, calc, revealAll }: StepBodyProps) {
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

  const questions: StackQuestion[] = [
    {
      id: "risk-buffers",
      title: "How much buffer for the unbillable realities of HVAC?",
      hint: "Callbacks, warranty returns and diagnostic time — the defaults suit most firms, drag to match yours",
      answered: true,
      body: (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            {items.map(([l, k, c, desc]) => (
              <div key={k} style={{ background: RC.card2, borderRadius: 14, border: `1px solid ${RC.line}`, padding: "14px 16px" }}>
                <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10 }}>
                  <span style={{ fontFamily: RC.head, fontWeight: 800, fontSize: 13.5, letterSpacing: "-0.01em", color: RC.ink, whiteSpace: "nowrap" }}>{l}</span>
                  <span style={{ fontFamily: RC.head, fontWeight: 800, fontSize: 21, color: c }}>{s.risk[k]}%</span>
                </div>
                <div style={{ fontSize: 12, color: RC.faint, marginTop: 3, marginBottom: 14 }}>{desc}</div>
                <WsSlider value={s.risk[k]} min={0} max={10} onChange={val => set(k, val)} color={c} />
              </div>
            ))}
          </div>
          <div style={{ background: RC.card2, borderRadius: 14, border: `1px solid ${RC.line}`, padding: "16px 18px", marginTop: 12 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
              <WsEyebrow>How the buffer shapes your break-even</WsEyebrow>
              <span style={{ fontSize: 12, color: RC.faint }}>Install +{s.risk.warranty + s.risk.defect}% · Service +{s.risk.callback + s.risk.diagnostic}%</span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <RiskBar label="Install" c={RC.install} soft={RC.installSoft} be={calc.beInst} m={iM} barMax={barMax} />
              <RiskBar label="Service" c={RC.service} soft={RC.serviceSoft} be={calc.beSvc} m={sM} barMax={barMax} />
              <RiskLegend />
            </div>
          </div>
        </>
      ),
    },
  ];

  return (
    <>
      <StepHead eyebrow="Step 4 of 5" title="HVAC risk buffer" />
      <Body>
        <QuestionStack questions={questions} revealAll={revealAll} stageFromTop={!revealAll} />
        <Note>Defaults: Warranty 3% · Defect 2% · Callback 4% · Diagnostic 3%. Most HVAC firms run 6–10% combined across install and service.</Note>
      </Body>
    </>
  );
}

// ── Step 5 · Profit target ──────────────────────────────────────────────
export function ProfitStep({ s, patch, calc, revealAll }: StepBodyProps) {
  const mults: [string, keyof Multipliers, number | null][] = [
    ["After-hours", "afterHours", calc.afterHrs],
    ["Emergency", "emergency", calc.emergency],
  ];

  const questions: StackQuestion[] = [
    {
      id: "margin",
      title: "What profit margin are you targeting?",
      hint: "Profit left after every cost is covered — rate = break-even ÷ (1 − margin). 20% is a healthy target",
      answered: true,
      body: (
        <>
          <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 10 }}>
            <span style={{ fontFamily: RC.head, fontWeight: 800, fontSize: 26, color: RC.install }}>{s.profit.margin}%</span>
          </div>
          <WsSlider value={s.profit.margin} min={0} max={40} onChange={v => patch({ profit: { ...s.profit, margin: v } })} color={RC.install} />
        </>
      ),
    },
    {
      id: "multipliers",
      title: "Premium-time multipliers",
      hint: "After-hours and emergency rates scale off your service rate",
      answered: true,
      body: (
        <div style={{ display: "flex", gap: 12 }}>
          {mults.map(([l, k, val]) => (
            <div key={k} style={{ flex: 1, background: RC.card2, borderRadius: 14, border: `1px solid ${RC.line}`, padding: "14px 16px" }}>
              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
                <span style={{ fontSize: 13.5, color: RC.ink, fontWeight: 700, whiteSpace: "nowrap" }}>{l}</span>
                <span style={{ fontFamily: RC.head, fontWeight: 800, fontSize: 17, color: RC.violet }}>{s.multipliers[k].toFixed(2)}×</span>
              </div>
              <div style={{ fontFamily: RC.head, fontWeight: 800, fontSize: 27, letterSpacing: "-0.02em", color: RC.ink, margin: "6px 0 12px" }}>{rate0(val)}<span style={{ fontSize: 13, color: RC.faint, fontWeight: 600, letterSpacing: 0 }}>/hr</span></div>
              <WsSlider value={s.multipliers[k]} min={1} max={3} step={0.05} onChange={v => patch({ multipliers: { ...s.multipliers, [k]: v } })} color={RC.violet} />
            </div>
          ))}
        </div>
      ),
    },
    {
      id: "cost-increase",
      title: "Annual cost increase",
      hint: "How much you expect wages and costs to rise each year — feeds the next-year projection",
      answered: true,
      body: (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
          <div style={{ fontSize: 12.5, color: RC.faint }}>Next-year projection: install {rate0(calc.projInst)} · service {rate0(calc.projSvc)}</div>
          <StepperRow value={s.profit.costIncrease ?? 3} display={`${s.profit.costIncrease ?? 3}%`} minWidth={52}
            onMinus={() => patch({ profit: { ...s.profit, costIncrease: Math.max(0, (s.profit.costIncrease ?? 3) - 1) } })}
            onPlus={() => patch({ profit: { ...s.profit, costIncrease: (s.profit.costIncrease ?? 3) + 1 } })} />
        </div>
      ),
    },
  ];

  return (
    <>
      <StepHead eyebrow="Step 5 of 5" title="Profit target" />
      <Body>
        <QuestionStack questions={questions} revealAll={revealAll} stageFromTop={!revealAll} />
        <Note>You&apos;re on the last step — continue to see your full results and apply the new rates.</Note>
      </Body>
    </>
  );
}
