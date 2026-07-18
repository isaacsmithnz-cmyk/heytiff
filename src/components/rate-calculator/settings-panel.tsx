"use client";

/* Settings slide-over — engine keys verbatim.
   Overlay is position:absolute within the .rca root (which is
   position:relative and viewport-height) — do NOT switch to position:fixed
   without portalling to document.body; the shell's animated ancestors break
   fixed positioning (see room-modal.tsx / timepay settings for the pattern). */

import React from "react";
import { DEFAULT_WORKING_WEEKS, PAYROLL_TAX, type CalcSettings } from "./engine";
import type { RateCalcState } from "./state";
import { RC } from "./theme";
import { money } from "./format";
import { RateNumberInput, RcIcon, WsEyebrow } from "./ui";

function SettingsHint({ text, up }: { text: string; up?: boolean }) {
  return (
    <span className={"rca-tip" + (up ? " up" : "")} data-tip={text} style={{ marginTop: 1 }}>
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="12" cy="12" r="10"></circle><path d="M12 16v-5"></path><path d="M12 8h.01"></path></svg>
    </span>
  );
}

function Field({ label, hint, tip, tipUp, children }: {
  label: string; hint?: string; tip?: string; tipUp?: boolean; children: React.ReactNode;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 14, padding: "13px 0", borderBottom: `1px solid ${RC.line}` }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 13.5, color: RC.ink, fontWeight: 700, whiteSpace: "nowrap" }}>{label}{tip && <SettingsHint text={tip} up={tipUp} />}</div>
        {hint && <div style={{ fontSize: 12, color: RC.faint, marginTop: 2, lineHeight: 1.4 }}>{hint}</div>}
      </div>
      <div style={{ flexShrink: 0 }}>{children}</div>
    </div>
  );
}

// `max` is optional — left undefined the clamp is a no-op beyond `min`, so the
// steppers that don't pass one behave exactly as before.
function Stepper({ value, onChange, suffix = "", step = 1, min = 0, max }: {
  value: number; onChange: (v: number) => void; suffix?: string; step?: number; min?: number; max?: number;
}) {
  const clamp = (v: number) => {
    const r = Math.max(min, Math.round(v * 100) / 100);
    return max != null ? Math.min(max, r) : r;
  };
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 3, background: RC.card2, borderRadius: 10, padding: 4, border: `1px solid ${RC.line}`, flexShrink: 0 }}>
      <button className="rca-stepbtn" style={{ width: 26, height: 26, borderRadius: 7, fontSize: 16, border: "none", background: "#fff", boxShadow: "0 1px 2px rgba(10,12,20,.08)" }} onClick={() => onChange(clamp(value - step))}>−</button>
      <span style={{ minWidth: 54, textAlign: "center", fontFamily: RC.head, fontWeight: 800, fontSize: 14.5, color: RC.ink, whiteSpace: "nowrap" }}>{value}{suffix}</span>
      <button className="rca-stepbtn" style={{ width: 26, height: 26, borderRadius: 7, fontSize: 16, border: "none", background: "#fff", boxShadow: "0 1px 2px rgba(10,12,20,.08)" }} onClick={() => onChange(clamp(value + step))}>+</button>
    </div>
  );
}

function MiniToggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button onClick={() => onChange(!on)} style={{ width: 46, height: 26, borderRadius: 100, border: "none", cursor: "pointer", background: on ? RC.service : RC.lineStrong, position: "relative", transition: "background .2s" }}>
      <span style={{ position: "absolute", top: 3, left: on ? 23 : 3, width: 20, height: 20, borderRadius: "50%", background: "#fff", transition: "left .2s", boxShadow: "0 1px 3px rgba(10,12,20,0.25)" }} />
    </button>
  );
}

// Collapsible "How rates are calculated" — plain-English methodology.
function ExplainerRow({ q, children, open, onToggle }: {
  q: string; children: React.ReactNode; open: boolean; onToggle: () => void;
}) {
  return (
    <div style={{ borderBottom: `1px solid ${RC.lineStrong}` }}>
      <button onClick={onToggle} style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "13px 0", background: "transparent", border: "none", cursor: "pointer", textAlign: "left", fontFamily: RC.body }}>
        <span style={{ fontSize: 13, color: RC.ink, fontWeight: 700 }}>{q}</span>
        <span style={{ display: "flex", color: RC.ink2, transform: open ? "rotate(270deg)" : "rotate(90deg)", transition: "transform .2s", flexShrink: 0 }}><RcIcon name="chevR" size={14} /></span>
      </button>
      {open && <div style={{ fontSize: 12.5, color: RC.ink2, lineHeight: 1.6, padding: "0 0 14px" }}>{children}</div>}
    </div>
  );
}

function ExplainerSection() {
  const [open, setOpen] = React.useState(false);
  const [row, setRow] = React.useState<number | null>(null);
  const toggle = (i: number) => setRow(row === i ? null : i);
  const b: React.CSSProperties = { fontWeight: 700, color: RC.ink };
  return (
    <>
      <WsEyebrow color={RC.install} style={{ marginTop: 24, marginBottom: 4 }}>Transparency</WsEyebrow>
      <button onClick={() => setOpen(!open)} style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "13px 0", background: "transparent", border: "none", borderBottom: open ? "none" : `1px solid ${RC.line}`, cursor: "pointer", textAlign: "left", fontFamily: RC.body }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13.5, color: RC.ink, fontWeight: 700 }}>How rates are calculated</div>
          <div style={{ fontSize: 12, color: RC.faint, marginTop: 2, lineHeight: 1.4 }}>What goes in, what&apos;s left out, and why</div>
        </div>
        <span style={{ width: 28, height: 28, borderRadius: 9, border: `1px solid ${RC.lineStrong}`, background: "#fff", boxShadow: "0 1px 2px rgba(10,12,20,.06)", display: "flex", alignItems: "center", justifyContent: "center", color: RC.ink, transform: open ? "rotate(270deg)" : "rotate(90deg)", transition: "transform .2s", flexShrink: 0 }}><RcIcon name="chevR" size={15} /></span>
      </button>

      {open && (
        <div style={{ background: RC.card2, borderRadius: 12, padding: "6px 16px", marginBottom: 4 }}>
          <div style={{ fontSize: 12.5, color: RC.ink2, lineHeight: 1.6, padding: "13px 0 4px" }}>
            We add up what it truly costs to put a chargeable hour in front of a customer, spread it across the hours you can actually bill, then add your profit margin. Here&apos;s exactly what that includes — and what it deliberately leaves out.
          </div>

          <ExplainerRow q="What goes into the cost" open={row === 0} onToggle={() => toggle(0)}>
            <p style={{ margin: "0 0 8px" }}><span style={b}>Labour</span> — wages plus the on-costs every employer carries: superannuation and workers comp at your state&apos;s rates, and paid leave for permanent staff (they&apos;re paid across the whole year, including leave weeks, with leave loading where it applies). Overtime is captured at its real cost when your timesheets show it. Full-timers, casuals and subcontractors are each costed the way the award and ATO actually treat them.</p>
            <p style={{ margin: "0 0 8px" }}><span style={b}>Vehicles</span> — the cash to run your fleet: fuel, servicing, rego, insurance, tyres, tolls. Each vehicle loads onto the rate for the work its driver does.</p>
            <p style={{ margin: "0 0 8px" }}><span style={b}>Overheads</span> — rent, admin, software, accounting, phones, insurance, marketing. Spread fairly across all your chargeable work.</p>
            <p style={{ margin: 0 }}><span style={b}>Payroll tax</span> — only the amount above your state&apos;s threshold, only if you cross it. Taxable wages include super and leave loading, the way state revenue offices count them.</p>
          </ExplainerRow>

          <ExplainerRow q="Billable hours — the honest part" open={row === 1} onToggle={() => toggle(1)}>
            <p style={{ margin: 0 }}>Not every paid hour is chargeable — travel, quoting, paperwork, training and downtime all eat into the week. We divide your costs across the hours you can <span style={b}>actually invoice</span>, not the hours you pay for. When you give us real timesheets we measure this from your tagged hours; until then we use a conservative industry assumption and tell you plainly that we have. This is the piece most &quot;just double your wages&quot; rules get wrong.</p>
          </ExplainerRow>

          <ExplainerRow q="What's deliberately left OUT" open={row === 2} onToggle={() => toggle(2)}>
            <p style={{ margin: "0 0 8px" }}><span style={b}>Job materials &amp; consumables</span> — quoted per job, not baked into a labour rate. Including them would double-charge customers.</p>
            <p style={{ margin: "0 0 8px" }}><span style={b}>Super &amp; workers comp as separate lines</span> — we add these to wages ourselves, so on import we take wages only. Counting them twice would inflate your rate.</p>
            <p style={{ margin: "0 0 8px" }}><span style={b}>Vehicle depreciation</span> — a non-cash accounting entry. We work on real cash spent. (Saving to replace a vehicle is a separate optional thing.)</p>
            <p style={{ margin: "0 0 8px" }}><span style={b}>Tax, dividends, interest, financing</span> — these come out of profit; they&apos;re not a cost of delivering an hour.</p>
            <p style={{ margin: 0 }}><span style={b}>Casual leave loading &amp; subbie on-costs</span> — casuals get loading in their wage already; subcontractors invoice you. Adding employee on-costs would double-count.</p>
          </ExplainerRow>

          <ExplainerRow q="How the pieces combine" open={row === 3} onToggle={() => toggle(3)}>
            <p style={{ margin: "0 0 8px" }}>1. Total each side&apos;s real annual cost (labour + its vehicle share + its share of overheads).</p>
            <p style={{ margin: "0 0 8px" }}>2. Divide by the hours you can genuinely bill — fewer billable hours means each one carries more cost, so the rate rises.</p>
            <p style={{ margin: "0 0 8px" }}>3. Add a small buffer for the realities of the trade — warranty, callbacks, defects, diagnostics — at the percentages you set.</p>
            <p style={{ margin: "0 0 8px" }}>4. That&apos;s your break-even — every cost covered, no profit.</p>
            <p style={{ margin: 0 }}>5. Add your target margin (taken as a share of the final price, the way margin is properly defined) to get the recommended rate. After-hours and emergency rates scale off your service rate by the multipliers you choose.</p>
          </ExplainerRow>

          <ExplainerRow q="How to sanity-check it yourself" open={row === 4} onToggle={() => toggle(4)}>
            <p style={{ margin: "0 0 8px" }}>Take your total annual running costs (wages + on-costs + vehicles + overheads — not job materials), estimate the hours you genuinely bill in a year, and divide one by the other. That&apos;s roughly your break-even per hour, and the recommended rate should sit above it by about your target margin.</p>
            <p style={{ margin: 0 }}>If your own estimate lands a long way off, it usually means an input needs a look — most often the billable-hours figure or a cost in the wrong section. If it still looks wrong, tell us: a real discrepancy genuinely helps improve the tool.</p>
          </ExplainerRow>

          <div style={{ fontSize: 11.5, color: RC.faint, lineHeight: 1.55, padding: "12px 0 4px" }}>
            This is a planning tool, not financial advice. It estimates from the figures you enter — check pricing and tax decisions with a qualified adviser.
          </div>
        </div>
      )}
    </>
  );
}

export function SettingsPanel({ st, patch, onClose }: {
  st: RateCalcState; patch: (p: Partial<RateCalcState>) => void; onClose: () => void;
}) {
  const g = st.settings;
  const set = (k: keyof CalcSettings, v: CalcSettings[keyof CalcSettings]) => patch({ settings: { ...g, [k]: v } });
  const setState = (stCode: string) => {
    const t = PAYROLL_TAX[stCode];
    patch({ settings: { ...g, state: stCode, payroll_tax_threshold: t?.threshold, payroll_tax_rate: t?.rate } });
  };
  const states = Object.keys(PAYROLL_TAX);
  const pt = PAYROLL_TAX[g.state || ""] || {};
  return (
    <div onClick={onClose} style={{ position: "absolute", inset: 0, zIndex: 90, display: "flex", justifyContent: "flex-end", fontFamily: RC.body }}>
      <div style={{ position: "absolute", inset: 0, background: "rgba(5,5,5,0.4)", backdropFilter: "blur(2px)", WebkitBackdropFilter: "blur(2px)" }} />
      <div onClick={e => e.stopPropagation()} style={{ position: "relative", width: 460, height: "100%", background: RC.bg, boxShadow: "-20px 0 60px rgba(5,5,5,0.25)", display: "flex", flexDirection: "column" }}>
        <div style={{ flexShrink: 0, padding: "20px 26px", background: "#fff", borderBottom: `1px solid ${RC.line}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <WsEyebrow>Rate Calculator</WsEyebrow>
            <div style={{ fontFamily: RC.head, fontWeight: 800, fontSize: 22, letterSpacing: "-0.02em", color: RC.ink, lineHeight: 1.1, marginTop: 3 }}>Settings</div>
          </div>
          <button className="rca-iconbtn" onClick={onClose} title="Close"><RcIcon name="x" size={16} /></button>
        </div>

        <div style={{ flex: 1, overflow: "auto", padding: "8px 26px 26px" }}>
          <WsEyebrow color={RC.install} style={{ marginTop: 18, marginBottom: 4 }}>Your current rates</WsEyebrow>
          <Field label="Install rate" hint="What you charge per hour today">
            <RateNumberInput value={st.currentRates.install} color={RC.install} ariaLabel="Settings install rate"
              onChange={v => patch({ currentRates: { ...st.currentRates, install: v } })} />
          </Field>
          <Field label="Service rate" hint="What you charge per hour today">
            <RateNumberInput value={st.currentRates.service} color={RC.service} ariaLabel="Settings service rate"
              onChange={v => patch({ currentRates: { ...st.currentRates, service: v } })} />
          </Field>

          <WsEyebrow color={RC.install} style={{ marginTop: 24, marginBottom: 4 }}>Location &amp; on-costs</WsEyebrow>
          <Field label="State" hint={`Payroll tax ${pt.rate ?? "—"}% over ${pt.threshold ? money(pt.threshold) : "—"} (${pt.fy || ""})`}>
            <div style={{ display: "flex", gap: 3, background: "#ECEEF1", borderRadius: 10, padding: 3, flexWrap: "wrap", maxWidth: 232, justifyContent: "flex-end" }}>
              {states.map(x => <button key={x} onClick={() => setState(x)} style={{ fontSize: 11.5, fontWeight: 700, padding: "5px 8px", borderRadius: 7, border: "none", cursor: "pointer", fontFamily: RC.body, background: g.state === x ? "#fff" : "transparent", color: g.state === x ? RC.ink : RC.label, boxShadow: g.state === x ? "0 3px 8px -3px rgba(10,12,20,0.28)" : "none", transition: "all .2s" }}>{x}</button>)}
            </div>
          </Field>
          <Field label="Superannuation" hint="Paid on top of wages">
            <Stepper value={g.super_pct ?? 12} step={0.5} suffix="%" onChange={v => set("super_pct", v)} />
          </Field>
          <Field label="Workers comp" hint="As a % of wages">
            <Stepper value={g.workers_comp_pct ?? 2} step={0.5} suffix="%" onChange={v => set("workers_comp_pct", v)} />
          </Field>
          <Field label="Payroll tax" hint={g.payroll_tax_enabled ? `Applies above ${money(g.payroll_tax_threshold)} at ${g.payroll_tax_rate}%` : "Below threshold / exempt"}>
            <MiniToggle on={!!g.payroll_tax_enabled} onChange={v => set("payroll_tax_enabled", v)} />
          </Field>

          <WsEyebrow color={RC.install} style={{ marginTop: 24, marginBottom: 4 }}>Working pattern</WsEyebrow>
          <Field label="Working weeks / year" hint="After leave & public holidays · feeds the rate maths" tip="Weeks your techs actually work once annual leave and public holidays come out — 52, less 4 weeks leave, less about 2 for public holidays. This one drives the rates: it sets annual paid hours and casual/subbie paid weeks. Sick days aren't netted off here — if your crew usually takes their full personal leave, drop this to about 44.">
            <Stepper value={g.working_weeks ?? DEFAULT_WORKING_WEEKS} min={1} max={52} onChange={v => set("working_weeks", v)} />
          </Field>
          <Field label="Hours in a full day on-site" hint="Only sets the Day rate figure" tip="Hours billed when a tech spends the whole day on one job. Day rate = hourly rate × these hours. This isn't utilisation — travel, quoting and slow days are already priced into the hourly rate, so a full day on the tools bills all its hours.">
            <Stepper value={g.working_hours ?? 8} min={1} max={24} onChange={v => set("working_hours", v)} />
          </Field>
          <div style={{ background: RC.installSoft, borderRadius: 12, padding: "12px 15px", marginTop: 12, fontSize: 12, color: "#1D4FD7", lineHeight: 1.55 }}>
            <b>Where billable time comes from:</b> your rates divide costs by the hours you can invoice — set in the Staff step (Simple mode&apos;s billable-time %, or measured from timesheets in Detailed). These settings never scale it twice.
          </div>

          <WsEyebrow color={RC.install} style={{ marginTop: 24, marginBottom: 4 }}>Rate review</WsEyebrow>
          <Field label="Annual cost increase" hint="Used for next-year projection" tip="How much you expect wages and costs to rise each year — award increases, insurance, fuel. Feeds the projected next-year rates. 3–5% is typical." tipUp>
            <Stepper value={st.profit.costIncrease ?? 3} suffix="%" onChange={v => patch({ profit: { ...st.profit, costIncrease: v }, settings: { ...g, annual_cost_increase_pct: v } })} />
          </Field>
          <Field label="Remind me to review" hint="How often to check rates">
            <Stepper value={g.review_reminder_months ?? 6} min={1} suffix=" mo" onChange={v => set("review_reminder_months", v)} />
          </Field>

          <ExplainerSection />
        </div>

        <div style={{ flexShrink: 0, padding: "16px 26px", background: "#fff", borderTop: `1px solid ${RC.line}`, display: "flex", gap: 12 }}>
          <button className="rca-btn ghost" style={{ flex: 1 }} onClick={onClose}>Close</button>
          <button className="rca-btn primary" style={{ flex: 1.4 }} onClick={onClose}>Save settings</button>
        </div>
      </div>
    </div>
  );
}
