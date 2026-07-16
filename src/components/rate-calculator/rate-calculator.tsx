"use client";

/* Rate Calculator workspace — HeyTiff admin.
   Three-pane layout: setup rail · step body · live rates rail. State mirrors
   the engine's documented shape exactly; every number comes from runEngine.

   The outer <RateCalculator> owns persistence (debounced org-scoped save via
   server action, localStorage crash buffer) and the example-data mode; the
   inner <CalculatorApp> is the calculator itself and is remounted (key) when
   switching between real and example data so all view state resets. */

import React from "react";
import "./rate-calculator.css";
import type { CalcResult } from "./engine";
import {
  allStepsDone,
  daysSinceReviewed,
  DONE_COMPLETIONS,
  emptyState,
  hydrateState,
  runEngine,
  timesheetWeeks,
  type RateCalcState,
} from "./state";
import { buildDemoState } from "./demo-data";
import { RC } from "./theme";
import { money, rate0, gstOf } from "./format";
import { HEALTH_COLORS, RcIcon, WsEyebrow } from "./ui";
import { StaffStep, BusinessStep, VehiclesStep, RiskStep, ProfitStep } from "./steps";
import { Overview } from "./overview";
import { InsightsView } from "./insights";
import { HelpModal } from "./help-modal";
import { SettingsPanel } from "./settings-panel";
import { NotifBanner } from "./notif-banner";

// Lazy-load the server action module so importing this component never drags
// the auth0 runtime into client bundles/tests (studio.tsx pattern).
const actions = () => import("@/app/actions/rate-calc");

const BUFFER_KEY = "heytiff.rate-calc.buffer";
const HELP_DISMISSED_KEY = "rc-help-dismissed";

const STEP_META = [
  { key: "staff", title: "Staff & wages" },
  { key: "business", title: "Business costs" },
  { key: "vehicles", title: "Vehicles" },
  { key: "risk", title: "HVAC risk" },
  { key: "profit", title: "Profit target" },
] as const;

// step summary lines (engine-derived)
function stepSummary(key: string, s: RateCalcState, calc: CalcResult): string {
  switch (key) {
    case "staff": return `${s.mode.staff === "Simple" ? (s.simpleLabour.staff_count || s.staff.length) : s.staff.length} staff · ${money(calc.instLab + calc.svcLab + calc.adminLab)}/yr`;
    case "business": return `${money(calc.enteredBiz)}/yr overheads`;
    case "vehicles": return `${s.vehicles.length} vehicles · ${money(calc.instVehicle + calc.svcVehicle + calc.adminVehicle)}/yr`;
    case "risk": return `Install ${s.risk.warranty + s.risk.defect}% · Service ${s.risk.callback + s.risk.diagnostic}%`;
    case "profit": return `${s.profit.margin}% margin`;
    default: return "";
  }
}

// completion → rail node visuals. Solid teal ✓ = data entered (complete /
// customised); outlined teal ✓ = running on sensible defaults (a valid
// choice, still "done"); blue = editing now / in progress; gray = untouched.
function nodeStyle(completion: string, cur: boolean) {
  if (cur) return { bg: RC.install, border: "none", fg: "#fff", icon: null };
  if (completion === "complete" || completion === "customised") return { bg: RC.service, border: "none", fg: "#fff", icon: "✓" };
  if (completion === "defaults") return { bg: "#fff", border: `2px solid ${RC.service}`, fg: RC.service, icon: "✓" };
  if (completion === "in_progress") return { bg: RC.installSoft, border: `2px solid ${RC.install}`, fg: RC.install, icon: null };
  return { bg: "#fff", border: `2px solid ${RC.lineStrong}`, fg: RC.faint, icon: null };
}

// ── persistent live-rates rail ──────────────────────────────────────────
function RailTile({ label, c, soft, rec, be, cur, ready }: {
  label: string; c: string; soft: string; rec: number | null; be: number | null; cur: number | null; ready: boolean;
}) {
  return (
    <div style={{ background: "#fff", borderRadius: 16, border: `1px solid rgba(10,12,20,.06)`, boxShadow: "0 1px 2px rgba(10,12,20,.04), 0 20px 50px -30px rgba(10,12,20,.18)", padding: "15px 17px", marginBottom: 12 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <WsEyebrow color={c}>{label}</WsEyebrow><span style={{ width: 8, height: 8, borderRadius: "50%", background: c }} />
      </div>
      <div style={{ fontFamily: RC.head, fontWeight: 800, fontSize: 40, letterSpacing: "-0.03em", lineHeight: 0.95, color: RC.ink, marginTop: 8 }}>
        {!ready ? <span className="rca-shimmer" style={{ display: "inline-block", width: 104, height: 30, verticalAlign: "-4px" }} />
          : rec == null ? <span style={{ color: RC.faint, fontSize: 26 }}>—</span> : <>
          <span style={{ fontSize: 19, verticalAlign: "10px", color: RC.faint, letterSpacing: 0 }}>$</span>{Math.round(rec)}<span style={{ fontSize: 14, fontWeight: 700, color: RC.faint, letterSpacing: 0 }}>/hr</span></>}
      </div>
      <div style={{ fontSize: 12, color: RC.label, marginTop: 3 }}>{!ready ? <span className="rca-pulse">waiting for your numbers…</span> : rec != null ? <>+ GST <b style={{ color: RC.ink2, fontWeight: 700 }}>{gstOf(rec)}</b></> : "awaiting inputs"}</div>
      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <div style={{ flex: 1, background: soft, borderRadius: 10, padding: "8px 10px" }}>
          <div style={{ fontSize: 9.5, color: c, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.07em", whiteSpace: "nowrap" }}>{cur != null ? `vs now $${cur}` : "vs now —"}</div>
          <div style={{ fontFamily: RC.head, fontWeight: 800, fontSize: 17, color: c }}>{!ready || rec == null || cur == null ? "—" : (Math.round(rec) - cur >= 0 ? "+" : "") + "$" + (Math.round(rec) - cur)}<span style={{ fontSize: 11, fontWeight: 700 }}>{ready && rec != null && cur != null ? "/hr" : ""}</span></div>
        </div>
        <div style={{ flex: 1, background: RC.card2, borderRadius: 10, padding: "8px 10px" }}>
          <div style={{ fontSize: 9.5, color: RC.faint, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.07em" }}>break-even</div>
          <div style={{ fontFamily: RC.head, fontWeight: 800, fontSize: 17, color: RC.ink2 }}>{ready ? rate0(be) : "—"}</div>
        </div>
      </div>
    </div>
  );
}

function RatesRail({ s, calc, uplift, ready, missing, onLoadDemo }: {
  s: RateCalcState; calc: CalcResult; uplift: number | null; ready: boolean;
  missing: string[]; onLoadDemo?: () => void;
}) {
  return (
    <div style={{ width: 300, flexShrink: 0, display: "flex", flexDirection: "column", overflowY: "auto", overflowX: "hidden", paddingTop: 19 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12, padding: "0 2px" }}>
        <WsEyebrow color={RC.label}>Live rates</WsEyebrow>
        <span style={{ fontSize: 11.5, color: RC.faint, display: "inline-flex", alignItems: "center", gap: 6, whiteSpace: "nowrap" }}><span className={ready ? undefined : "rca-pulse"} style={{ width: 6, height: 6, borderRadius: "50%", background: ready ? RC.teal : RC.install, boxShadow: ready ? `0 0 8px ${RC.teal}` : "none" }} />{ready ? "updates as you edit" : "awaiting inputs"}</span>
      </div>
      {!ready && (
        <div style={{ background: RC.installSoft, borderRadius: 13, padding: "13px 15px", marginBottom: 12, fontSize: 12.5, color: "#1D4FD7", lineHeight: 1.5 }}>
          <b>Almost there.</b> To see your rates, enter {missing.length === 1 ? missing[0] : missing.slice(0, -1).join(", ") + " and " + missing[missing.length - 1]}.
          {onLoadDemo && (
            <div style={{ marginTop: 8 }}>
              <button onClick={onLoadDemo} style={{ border: "none", background: "transparent", padding: 0, color: "#1D4FD7", fontFamily: RC.body, fontSize: 12.5, fontWeight: 700, textDecoration: "underline", cursor: "pointer" }}>Or explore with example data →</button>
            </div>
          )}
        </div>
      )}
      <RailTile label="Install" c={RC.install} soft={RC.installSoft} rec={calc.recInst} be={calc.beInst} cur={s.currentRates.install} ready={ready} />
      <RailTile label="Service" c={RC.service} soft={RC.serviceSoft} rec={calc.recSvc} be={calc.beSvc} cur={s.currentRates.service} ready={ready} />
      <div style={{ background: "#fff", borderRadius: 14, border: `1px solid rgba(10,12,20,.06)`, boxShadow: "0 1px 2px rgba(10,12,20,.04), 0 20px 50px -30px rgba(10,12,20,.18)", padding: "13px 15px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 9 }}>
          <span style={{ fontSize: 12.5, color: RC.ink2, whiteSpace: "nowrap" }}>Day rate (full day)</span>
          <span style={{ fontFamily: RC.head, fontWeight: 800, fontSize: 14, color: RC.ink }}>{ready ? money(calc.daily) : "—"}</span>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 9 }}>
          <span style={{ fontSize: 12.5, color: RC.ink2, whiteSpace: "nowrap" }}>After-hrs / emergency</span>
          <span style={{ fontFamily: RC.head, fontWeight: 800, fontSize: 14, color: RC.violet, whiteSpace: "nowrap" }}>{ready ? `${rate0(calc.afterHrs)} / ${rate0(calc.emergency)}` : "—"}</span>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <span style={{ fontSize: 12.5, color: RC.ink2, whiteSpace: "nowrap" }}>Confidence</span>
          <span style={{ fontSize: 12.5, fontWeight: 700, color: RC.service, whiteSpace: "nowrap" }}>{ready ? calc.confidence.label : "—"}</span>
        </div>
      </div>
      <div style={{ marginTop: "auto", paddingTop: 16 }}>
        {ready && uplift != null && uplift > 0 && (
          <div style={{ background: RC.serviceSoft, borderRadius: 13, padding: "12px 15px", fontSize: 12.5, color: "#00745F", lineHeight: 1.5 }}>
            Re-pricing to recommended recovers <b>+{money(uplift)}/yr</b>.
          </div>
        )}
      </div>
    </div>
  );
}

// ── Current-rates onboarding (after the help modal, empty mode) ──────────
// Overlay is position:absolute inside .rca — keep it that way (see help-modal).
function RatesIntro({ s, patch, onDone }: {
  s: RateCalcState; patch: (p: Partial<RateCalcState>) => void; onDone: () => void;
}) {
  const [inst, setInst] = React.useState(s.currentRates.install != null ? String(s.currentRates.install) : "");
  const [svc, setSvc] = React.useState(s.currentRates.service != null ? String(s.currentRates.service) : "");
  const save = () => {
    const i = parseFloat(inst), v = parseFloat(svc);
    patch({ currentRates: { install: isNaN(i) ? null : i, service: isNaN(v) ? null : v } });
    onDone();
  };
  const skip = () => { patch({ currentRates: { install: null, service: null } }); onDone(); };
  const fieldWrap: React.CSSProperties = { flex: 1 };
  const labelRow: React.CSSProperties = { display: "flex", alignItems: "center", gap: 8, marginBottom: 8 };
  const box: React.CSSProperties = { display: "flex", alignItems: "baseline", gap: 4, background: RC.card2, borderRadius: 12, padding: "13px 16px", border: `1px solid ${RC.lineStrong}` };
  const inputStyle: React.CSSProperties = { border: "none", background: "transparent", outline: "none", fontFamily: RC.head, fontWeight: 800, fontSize: 30, letterSpacing: "-0.02em", color: RC.ink, width: "100%", padding: 0 };
  return (
    <div style={{ position: "absolute", inset: 0, zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: RC.body }}>
      <div style={{ position: "absolute", inset: 0, background: "rgba(5,5,5,0.45)", backdropFilter: "blur(4px)", WebkitBackdropFilter: "blur(4px)" }} />
      <div style={{ position: "relative", width: 580, background: "#fff", borderRadius: 24, boxShadow: "0 40px 100px rgba(5,5,5,0.4)", overflow: "hidden" }}>
        <div style={{ padding: "28px 34px 0" }}>
          <WsEyebrow>Rate Calculator · Step 1</WsEyebrow>
          <div style={{ fontFamily: RC.head, fontWeight: 800, fontSize: 29, letterSpacing: "-0.03em", color: RC.ink, lineHeight: 1.1, marginTop: 12 }}>What do you charge right now?</div>
          <div style={{ fontSize: 14, color: RC.ink2, lineHeight: 1.6, marginTop: 9 }}>
            Enter your current hourly charge-out rates. This is the baseline we&apos;ll compare against — so you can see exactly where you stand versus what your costs say you should charge. You can change these any time.
          </div>
        </div>
        <div style={{ display: "flex", gap: 16, padding: "22px 34px" }}>
          <div style={fieldWrap}>
            <div style={labelRow}>
              <span style={{ width: 9, height: 9, borderRadius: "50%", background: RC.install }} />
              <span style={{ fontFamily: RC.head, fontWeight: 800, fontSize: 13, color: RC.ink }}>Install</span>
            </div>
            <div style={box}>
              <span style={{ fontSize: 18, color: RC.faint }}>$</span>
              <input value={inst} onChange={e => setInst(e.target.value.replace(/[^0-9.]/g, ""))} placeholder="0" inputMode="decimal" style={inputStyle} />
              <span style={{ fontSize: 14, color: RC.faint, fontWeight: 600 }}>/hr</span>
            </div>
          </div>
          <div style={fieldWrap}>
            <div style={labelRow}>
              <span style={{ width: 9, height: 9, borderRadius: "50%", background: RC.service }} />
              <span style={{ fontFamily: RC.head, fontWeight: 800, fontSize: 13, color: RC.ink }}>Service</span>
            </div>
            <div style={box}>
              <span style={{ fontSize: 18, color: RC.faint }}>$</span>
              <input value={svc} onChange={e => setSvc(e.target.value.replace(/[^0-9.]/g, ""))} placeholder="0" inputMode="decimal" style={inputStyle} />
              <span style={{ fontSize: 14, color: RC.faint, fontWeight: 600 }}>/hr</span>
            </div>
          </div>
        </div>
        <div style={{ padding: "0 34px 26px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <button onClick={skip} style={{ border: "none", background: "transparent", color: RC.faint, fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: RC.body, textDecoration: "underline" }}>I don&apos;t know yet — skip</button>
          <button className="rca-btn primary lg" onClick={save}>Start setup →</button>
        </div>
      </div>
    </div>
  );
}

type SaveState = "idle" | "saving" | "saved" | "local";

// ── Calculator app (remounted per data mode) ────────────────────────────
function CalculatorApp({ initial, hasData, demo, showOnboarding, onPersist, saveState, onLoadDemo, onExitDemo }: {
  initial: RateCalcState;
  hasData: boolean;
  demo: boolean;
  showOnboarding: boolean;
  onPersist: ((next: RateCalcState) => void) | null;
  saveState: SaveState;
  onLoadDemo?: () => void;
  onExitDemo?: () => void;
}) {
  // Returning users with a complete setup land on Results (the review moment);
  // first-run / incomplete data lands on Step 1. Example mode simulates a
  // returning user.
  const [step, setStep] = React.useState(() => {
    if (!hasData) return 0;
    const run = runEngine(initial);
    return run.ready && allStepsDone(run.steps) ? 5 : 0;
  }); // 0–4 steps, 5 = overview, 6 = insights
  // Onboarding chain (help → rates intro) runs once per fresh empty setup; a
  // manual "?" reopen must NOT re-trigger the intro. "Don't show again" is
  // remembered for the session via sessionStorage — read in an effect so the
  // server prerender and first client render agree.
  const [showHelp, setShowHelp] = React.useState(showOnboarding);
  const [showRatesIntro, setShowRatesIntro] = React.useState(false);
  const onboardRef = React.useRef(showOnboarding);
  React.useEffect(() => {
    if (!showOnboarding) return;
    let dismissed = false;
    try { dismissed = window.sessionStorage.getItem(HELP_DISMISSED_KEY) === "1"; } catch { /* storage unavailable */ }
    if (dismissed) {
      onboardRef.current = false;
      // eslint-disable-next-line react-hooks/set-state-in-effect -- sessionStorage is client-only; must diverge from the SSR-safe initial render
      setShowHelp(false);
      setShowRatesIntro(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [showSettings, setShowSettings] = React.useState(false);
  const [showBanner, setShowBanner] = React.useState(true);
  const [s, setS] = React.useState(initial);
  const patch = (p: Partial<RateCalcState>) => setS(prev => ({ ...prev, ...p }));
  // Persist AFTER render commits — calling the host mid-updater would set
  // parent state while this component renders (React error).
  const firstRender = React.useRef(true);
  React.useEffect(() => {
    if (firstRender.current) { firstRender.current = false; return; }
    if (onPersist) { try { onPersist(s); } catch { /* host handles save errors */ } }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s]);
  const { calc, health, steps, uplift, ready, missing } = runEngine(s);
  const hc = HEALTH_COLORS[health.type] || HEALTH_COLORS.neutral;
  const overview = step === 5;
  const insights = step === 6;
  const StepBody = [StaffStep, BusinessStep, VehiclesStep, RiskStep, ProfitStep][step] || StaffStep;
  const completions = [steps.staff.completion, steps.business.completion, steps.vehicles.completion, steps.risk.completion, steps.profit.completion];
  // Counter shows only genuinely-entered steps (not default-valid ones): staff/
  // business/vehicles when actually filled in, risk/profit only when customised.
  const enteredCount = [
    completions[0] === "complete",
    completions[1] === "complete",
    completions[2] === "complete",
    // risk/profit: "defaults" only survives runEngine once explicitly
    // accepted, so accepted-defaults and customised both count.
    completions[3] === "customised" || completions[3] === "defaults",
    completions[4] === "customised" || completions[4] === "defaults",
  ].filter(Boolean).length;
  const allDone = allStepsDone(steps);

  // Continue doubles as acceptance on the defaults steps, and the final
  // Continue only reaches Results when every step is done — otherwise it
  // walks the user back to the first incomplete step.
  const onContinue = () => {
    if (step === 3 && !s.riskAccepted) patch({ riskAccepted: true });
    if (step === 4) {
      if (!s.profitAccepted) patch({ profitAccepted: true });
      // patch is async — evaluate doneness with profit locally accepted
      const doneWithProfit = completions
        .map((c, i) => (i === 4 && c === "not_started") ? "defaults" : c)
        .every(c => DONE_COMPLETIONS.includes(c));
      if (doneWithProfit) { setStep(5); return; }
      const firstIncomplete = completions.findIndex((c, i) => i !== 4 && !DONE_COMPLETIONS.includes(c));
      setStep(firstIncomplete === -1 ? 5 : firstIncomplete);
      return;
    }
    setStep(step + 1);
  };

  // Simple/Detailed toggles are hidden for the first-run session and return
  // on later visits (hasData) — per step, only where Detailed has data it can
  // actually edit: Staff needs ~3 months of timesheets, Vehicles needs
  // vehicle records; Business is ungated. Gates control toggle VISIBILITY
  // only — a state already saved in Detailed keeps rendering Detailed.
  const allowToggles = demo || hasData;
  const toggleGates = [
    allowToggles && timesheetWeeks(s) >= 12,
    allowToggles,
    allowToggles && s.vehicles.length > 0,
    false, // risk — no Detailed mode
    false, // profit — no Detailed mode
  ];

  // Review reminder — derived from the stored timestamp, shown only once the
  // configured reminder period has actually elapsed.
  const daysSince = daysSinceReviewed(s.reviewState.lastReviewed);
  const reviewDue = daysSince != null && daysSince >= (s.settings.review_reminder_months ?? 6) * 30;

  const onHelpClose = (dontShow: boolean) => {
    setShowHelp(false);
    if (dontShow) { try { window.sessionStorage.setItem(HELP_DISMISSED_KEY, "1"); } catch { /* storage unavailable */ } }
    if (onboardRef.current) { onboardRef.current = false; setShowRatesIntro(true); }
  };

  const saveLabel = demo ? "example data — nothing is saved"
    : saveState === "saving" ? "saving…"
    : saveState === "local" ? "saved locally — will retry"
    : saveState === "saved" ? "saved"
    : "saves automatically";

  return (
    <div className="rca">
      {showHelp && <HelpModal onClose={onHelpClose} />}
      {showRatesIntro && <RatesIntro s={s} patch={patch} onDone={() => setShowRatesIntro(false)} />}
      {showSettings && <SettingsPanel st={s} patch={patch} onClose={() => setShowSettings(false)} />}

      {/* workspace header — mirrors the Design Studio topbar: accent chip, 23px title,
          600-weight sub, transparent on the well */}
      <div style={{ height: 70, flexShrink: 0, display: "flex", alignItems: "center", gap: 14, padding: "16px 24px 0", position: "relative", zIndex: 20 }}>
        <div style={{ flex: "1 1 0", minWidth: 0, display: "flex", alignItems: "center", gap: 13 }}>
          <div style={{ fontFamily: RC.head, fontSize: 23, fontWeight: 800, letterSpacing: "-0.01em", color: RC.ink, lineHeight: 1, whiteSpace: "nowrap" }}>Rate Calculator</div>
          <span style={{ width: 1, height: 22, background: "rgba(28,38,70,.12)", margin: "0 2px", flexShrink: 0 }} />
          <span style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 12.5, fontWeight: 700, color: hc.fg, background: hc.bg, padding: "6px 13px", borderRadius: 100, whiteSpace: "nowrap", flexShrink: 0 }}><span style={{ width: 7, height: 7, borderRadius: "50%", background: hc.dot }} />{health.status}</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
          {s.businessName && <span style={{ fontFamily: RC.head, fontSize: 12, fontWeight: 700, color: RC.label, background: "#fff", border: `1px solid rgba(10,12,20,.07)`, padding: "4px 9px", borderRadius: 6, whiteSpace: "nowrap" }}>{s.businessName}</span>}
          {demo && onExitDemo && <button className="rca-btn sm ghost" onClick={onExitDemo}>Exit example</button>}
          <button className="rca-iconbtn" onClick={() => setShowHelp(true)} title="How to use" style={{ fontWeight: 800, fontSize: 15 }}>?</button>
          <button className="rca-iconbtn" onClick={() => setShowSettings(true)} title="Settings"><RcIcon name="settings" size={16} /></button>
        </div>
      </div>

      {demo && (
        <div style={{ flexShrink: 0, margin: "10px 20px 0", background: RC.serviceSoft, border: `1px solid rgba(0,163,137,.25)`, borderRadius: 13, padding: "8px 14px", display: "flex", alignItems: "center", gap: 10, fontSize: 12.5, color: "#00745F", fontFamily: RC.body }}>
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: RC.service, flexShrink: 0 }} />
          You&apos;re exploring <b>example data</b> (Blue Sky Air Conditioning). Nothing here is saved — your own setup is untouched.
        </div>
      )}

      {showBanner && !overview && !insights && reviewDue && <NotifBanner daysSince={daysSince} message={s.reviewState.message || null} onReview={() => { setShowBanner(false); setStep(0); }} onDismiss={() => setShowBanner(false)} />}

      <div style={{ flex: 1, display: "flex", minHeight: 0, gap: 16, padding: "12px 20px 20px" }}>
        {/* setup path rail — floating card */}
        <div style={{ width: 236, flexShrink: 0, background: "#fff", borderRadius: 18, border: `1px solid rgba(10,12,20,.06)`, boxShadow: "0 1px 2px rgba(10,12,20,.04), 0 20px 50px -30px rgba(10,12,20,.18)", padding: "18px 16px 16px", display: "flex", flexDirection: "column", overflow: "hidden auto" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
            <WsEyebrow color={RC.label}>Setup path</WsEyebrow>
            <span style={{ fontFamily: RC.head, fontWeight: 800, fontSize: 13, color: RC.ink }}>{enteredCount}<span style={{ color: RC.faint }}> / 5</span></span>
          </div>
          {STEP_META.map((m, i) => {
            const cur = i === step && !overview && !insights;
            const comp = completions[i];
            const ns = nodeStyle(comp, cur);
            const last = i === STEP_META.length - 1;
            const lineDone = DONE_COMPLETIONS.includes(comp);
            return (
              <div key={m.key} className="rca-step" style={{ animationDelay: `${i * 60}ms` }} onClick={() => setStep(i)}>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: 28 }}>
                  <div style={{ width: 28, height: 28, borderRadius: "50%", flexShrink: 0, background: ns.bg, border: ns.border, display: "flex", alignItems: "center", justifyContent: "center", color: ns.fg, fontFamily: RC.head, fontWeight: 800, fontSize: 13, boxShadow: cur ? `0 0 0 5px ${RC.installSoft}` : "none", transition: "all .2s" }}>{ns.icon || i + 1}</div>
                  {!last && <div style={{ flex: 1, width: 2, background: lineDone ? RC.service : "#ECEEF1", minHeight: 24, transition: "background .2s" }} />}
                </div>
                <div style={{ flex: 1, paddingBottom: last ? 0 : 13, paddingTop: 3, opacity: lineDone || cur ? 1 : 0.65 }}>
                  <div className="rca-step-t" style={{ fontFamily: RC.head, fontWeight: 700, fontSize: 13.5, letterSpacing: "-0.01em", color: cur ? RC.install : RC.ink, whiteSpace: "nowrap", transition: "color .2s" }}>{m.title}</div>
                  <div style={{ fontSize: 11, color: RC.faint, marginTop: 1, whiteSpace: "nowrap" }}>{stepSummary(m.key, s, calc)}</div>
                  {cur && <div style={{ display: "inline-block", marginTop: 6, fontSize: 10.5, fontWeight: 700, color: RC.install, background: RC.installSoft, padding: "3px 9px", borderRadius: 100 }}>Editing now</div>}
                  {!cur && comp === "defaults" && <div style={{ display: "inline-block", marginTop: 6, fontSize: 10.5, fontWeight: 600, color: RC.faint, background: RC.card2, padding: "3px 9px", borderRadius: 100 }}>Using defaults</div>}
                </div>
              </div>
            );
          })}
          <div style={{ marginTop: "auto", paddingTop: 16, display: "flex", flexDirection: "column", gap: 8 }}>
            {allDone ? (
              <>
                <button className={"rca-railbtn" + (overview ? " on" : "")} onClick={() => setStep(5)}>View results <RcIcon name="arrowUR" size={13} /></button>
                <button className={"rca-railbtn" + (insights ? " on" : "")} onClick={() => setStep(6)}>Insights <RcIcon name="activity" size={13} /></button>
              </>
            ) : (
              <div style={{ fontSize: 11.5, color: RC.faint, lineHeight: 1.5, textAlign: "center", padding: "8px 6px", border: `1.5px dashed ${RC.lineStrong}`, borderRadius: 11 }}>
                Complete all 5 steps to see your results
              </div>
            )}
          </div>
        </div>

        {/* main */}
        {overview ? <Overview s={s} calc={calc} health={health} uplift={uplift} ready={ready} missing={missing} go={setStep} patch={patch} /> : insights ? <InsightsView s={s} patch={patch} calc={calc} ready={ready} go={setStep} /> : (
          <>
            <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
              <div className="rca-view" key={step} style={{ flex: 1, padding: "18px 10px 6px 2px", overflowY: "auto", overflowX: "hidden" }}>
                <StepBody s={s} patch={patch} calc={calc} showToggle={toggleGates[step] ?? false} revealAll={hasData} />
              </div>
              <div style={{ flexShrink: 0, padding: "14px 10px 0 2px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <button className="rca-btn ghost" disabled={step === 0} onClick={() => setStep(Math.max(0, step - 1))}>← Back</button>
                <span style={{ fontSize: 12.5, color: RC.faint, whiteSpace: "nowrap" }}>Step {step + 1} of 5 · {saveLabel}</span>
                <button className="rca-btn primary" style={{ padding: "0 26px" }} onClick={onContinue}>{step === 4 && completions.slice(0, 4).every(c => DONE_COMPLETIONS.includes(c)) ? "See results →" : "Continue →"}</button>
              </div>
            </div>
            <RatesRail s={s} calc={calc} uplift={uplift} ready={ready} missing={missing} onLoadDemo={demo ? undefined : onLoadDemo} />
          </>
        )}
      </div>
    </div>
  );
}

// ── Root: persistence + example-data mode ───────────────────────────────
export function RateCalculator({ initialState, initialUpdatedAt }: {
  initialState: unknown;
  initialUpdatedAt?: string | null;
}) {
  void initialUpdatedAt; // reserved for buffer-vs-server reconciliation
  const hasServerState = initialState != null;
  const [demo, setDemo] = React.useState(false);
  const [restored, setRestored] = React.useState<RateCalcState | null>(null);
  const [saveState, setSaveState] = React.useState<SaveState>("idle");
  const saveTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRef = React.useRef<RateCalcState | null>(null);

  const persist = React.useCallback((next: RateCalcState) => {
    // Crash buffer first — synchronous, survives tab close mid-debounce.
    try { window.localStorage.setItem(BUFFER_KEY, JSON.stringify({ state: next, savedAt: Date.now() })); } catch { /* storage full/blocked */ }
    pendingRef.current = next;
    setSaveState("saving");
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      saveTimer.current = null;
      const payload = pendingRef.current;
      pendingRef.current = null;
      if (!payload) return;
      try {
        const { saveRateCalcState } = await actions();
        await saveRateCalcState(payload);
        setSaveState("saved");
        try { window.localStorage.removeItem(BUFFER_KEY); } catch { /* ignore */ }
      } catch {
        setSaveState("local"); // buffer still holds it; next edit retries
      }
    }, 600);
  }, []);

  // Crash-buffer restore: only when the org has never saved — a buffer means
  // a previous session's edits never reached the server. Runs in an effect so
  // the server prerender and first client render agree.
  React.useEffect(() => {
    if (hasServerState) return;
    let buf: { state?: unknown } | null = null;
    try { const raw = window.localStorage.getItem(BUFFER_KEY); buf = raw ? JSON.parse(raw) : null; } catch { buf = null; }
    if (buf?.state == null) return;
    const state = hydrateState(buf.state);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- localStorage is client-only; must diverge from the SSR-safe initial render
    setRestored(state);
    persist(state); // push the recovered edits up immediately
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Flush a pending debounced save when navigating away.
  React.useEffect(() => () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    const payload = pendingRef.current;
    if (payload) { actions().then(({ saveRateCalcState }) => saveRateCalcState(payload)).catch(() => { /* buffer holds it */ }); }
  }, []);

  if (demo) {
    return (
      <CalculatorApp
        key="demo"
        initial={buildDemoState()}
        hasData
        demo
        showOnboarding={false}
        onPersist={null}
        saveState="idle"
        onExitDemo={() => setDemo(false)}
      />
    );
  }

  const initial = hasServerState ? hydrateState(initialState) : (restored ?? emptyState());
  const hasData = hasServerState || restored != null;
  return (
    <CalculatorApp
      key={hasServerState ? "server" : restored ? "buffer" : "fresh"}
      initial={initial}
      hasData={hasData}
      demo={false}
      showOnboarding={!hasData}
      onPersist={persist}
      saveState={saveState}
      onLoadDemo={() => setDemo(true)}
    />
  );
}
