"use client";

/* CALCULATOR SETTINGS, a dialog (rule 36): what you charge now, where you
   are and the on-costs, the working year, reviewing your rates, how the
   rates are worked out, and Start fresh. Engine keys verbatim.

   Edits live in a draft until Save settings; Cancel, Escape and the scrim
   throw it away, so a half-made change never silently sticks. That is why
   payroll tax is a tick here and not a switch: a switch saves itself
   (rule 32), and nothing in this dialog does. */

import React from "react";
import { DEFAULT_WORKING_WEEKS, PAYROLL_TAX, type CalcSettings } from "./engine";
import type { RateCalcState } from "./state";
import { money } from "./format";
import { Amount, SettingRow, parseRate } from "./ui";
import { Button } from "@/components/parts/button";
import { Chooser } from "@/components/parts/chooser";
import { Dialog } from "@/components/parts/dialog";
import { TextInput } from "@/components/parts/field";
import { StateWord } from "@/components/parts/state";
import { Tick } from "@/components/parts/tick";

const STATE_NAMES: Record<string, string> = {
  NSW: "New South Wales", VIC: "Victoria", QLD: "Queensland", SA: "South Australia",
  WA: "Western Australia", TAS: "Tasmania", ACT: "Australian Capital Territory", NT: "Northern Territory",
};
const STATES = Object.keys(PAYROLL_TAX).map(code => ({ value: code, label: STATE_NAMES[code] ?? code }));

/* Hours in a full day: typed, never started from a figure of ours — blank
   until the business says (Isaac, 2026-10-04). Blank again clears it. */
function HoursField({ value, onChange }: { value: number | null; onChange: (v: number | null) => void }) {
  const [text, setText] = React.useState(value == null ? "" : String(value));
  const commit = (raw: string) => {
    const n = Number(raw);
    if (raw.trim() === "") return onChange(null);
    if (Number.isFinite(n) && n >= 1 && n <= 24) onChange(Math.round(n * 4) / 4);
    else setText(value == null ? "" : String(value));
  };
  return (
    <>
      <TextInput
        aria-label="Hours in a full day on site"
        inputMode="decimal"
        className="rc-num rc-w-sm"
        value={text}
        placeholder="Not set"
        onChange={e => setText(e.target.value)}
        onBlur={e => commit(e.target.value)}
        onKeyDown={e => { if (e.key === "Enter") commit((e.target as HTMLInputElement).value); }}
      />
      <span className="rc-unit">hours</span>
    </>
  );
}

/** What you charge now, $ an hour, blank when not known. */
function RateField({ label, value, onChange }: { label: string; value: number | null; onChange: (v: number | null) => void }) {
  return (
    <>
      <TextInput aria-label={label} inputMode="decimal" className="rc-num rc-w-sm" value={value == null ? "" : String(value)} onChange={e => onChange(parseRate(e.target.value))} />
      <span className="rc-unit">$ an hour</span>
    </>
  );
}

/* HOW THE RATES ARE WORKED OUT, shown on request: what goes in, what's left
   out on purpose, and the arithmetic, so a figure can be checked by hand. */
function HowItsWorkedOut() {
  return (
    <div className="rc-how">
      <p><b>What goes in.</b> Wages and the on-costs every employer carries: super, workers comp, and paid leave for permanent staff, with leave loading. Overtime at its real cost when timesheets show it. The fleet&apos;s running cost, loaded onto the work each driver does. Overheads: rent, software, accounting, phones, insurance, marketing. Payroll tax, only above your state&apos;s threshold.</p>
      <p><b>The hours.</b> Costs are spread over the hours you can invoice, not the hours you pay for. Timesheets measure that share; until they do, the calculator takes 75% and says so.</p>
      <p><b>What&apos;s left out.</b> Job materials, which are quoted per job. Super and workers comp as their own lines, since they&apos;re added to wages already. Depreciation, which isn&apos;t cash. Tax, dividends, interest and finance, which come out of profit. Employee on-costs for casuals and subcontractors.</p>
      <ol>
        <li>Each side&apos;s year of cost: its labour, its share of the fleet and of the overheads.</li>
        <li>Divided by the hours it can bill.</li>
        <li>The risk buffer on top, at your percentages: that&apos;s break-even.</li>
        <li>Your margin, as a share of the price: that&apos;s the recommended rate. After hours and emergency are the service rate times their multipliers.</li>
      </ol>
      <p><b>Checking it yourself.</b> A year of running costs, not materials, divided by the hours you really bill, is about break-even an hour. The recommended rate sits above it by about your margin. A long way off usually means the billable share, or a cost in the wrong step.</p>
      <p>A planning tool, not financial advice: check pricing and tax decisions with your accountant.</p>
    </div>
  );
}

/* START FRESH: the one destructive control in the calculator, so it asks
   before it fires, and the second press names the act. */
function StartFresh({ onReset }: { onReset: () => Promise<boolean> }) {
  const [armed, setArmed] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);
  const run = async () => {
    setBusy(true);
    setErr(null);
    const ok = await onReset();
    // On success the whole calculator remounts and this dialog goes with it —
    // touching state here would be a write into an unmounting tree.
    if (!ok) { setBusy(false); setErr("Couldn't clear your setup. Check your connection and try again."); }
  };
  return (
    <div>
      <SettingRow name="Start fresh" line="Clears every step, what you charge and these settings. Your team's wages stay on Team.">
        {!armed ? (
          <Button kind="delete" size={32} onClick={() => setArmed(true)}>Start fresh</Button>
        ) : (
          <>
            <Button size={32} disabled={busy} onClick={() => { setArmed(false); setErr(null); }}>Keep my setup</Button>
            <Button kind="danger" size={32} disabled={busy} onClick={run}>{busy ? "Clearing everything" : "Yes, clear everything"}</Button>
          </>
        )}
      </SettingRow>
      {err && <StateWord tone="wrong">{err}</StateWord>}
    </div>
  );
}

export function SettingsDialog({ st: committed, patch: commit, onClose, onReset, superOwned = false }: {
  st: RateCalcState; patch: (p: Partial<RateCalcState>) => void; onClose: () => void;
  /** Wipe the org's saved setup and start over. Resolves false if the clear
      failed, so the dialog can say so instead of pretending. */
  onReset: () => Promise<boolean>;
  /** pay_settings owns the super rate — it shows here, read-only. */
  superOwned?: boolean;
}) {
  type Draft = Pick<RateCalcState, "settings" | "currentRates" | "profit">;
  const [st, setDraft] = React.useState<Draft>({
    settings: committed.settings, currentRates: committed.currentRates, profit: committed.profit,
  });
  const [showHow, setShowHow] = React.useState(false);
  const patch = (p: Partial<Draft>) => setDraft(d => ({ ...d, ...p }));
  const save = () => { commit(st); onClose(); };

  const g = st.settings;
  const set = (k: keyof CalcSettings, v: CalcSettings[keyof CalcSettings]) => patch({ settings: { ...g, [k]: v } });
  const setState = (code: string) => {
    const t = PAYROLL_TAX[code];
    patch({ settings: { ...g, state: code, payroll_tax_threshold: t?.threshold, payroll_tax_rate: t?.rate } });
  };
  const pt = PAYROLL_TAX[g.state || ""];
  return (
    <Dialog
      heading="Calculator settings"
      onClose={onClose}
      width={720}
      foot={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button kind="main" onClick={save}>Save settings</Button>
        </>
      }
    >
      <div className="rc-dlg">
        <div>
          <h3>What you charge now</h3>
          <SettingRow name="Install">
            <RateField label="Settings install rate" value={st.currentRates.install} onChange={v => patch({ currentRates: { ...st.currentRates, install: v } })} />
          </SettingRow>
          <SettingRow name="Service">
            <RateField label="Settings service rate" value={st.currentRates.service} onChange={v => patch({ currentRates: { ...st.currentRates, service: v } })} />
          </SettingRow>
        </div>

        <div>
          <h3>Where you are and on-costs</h3>
          <SettingRow name="State" line={pt ? `Payroll tax ${pt.rate}% over ${money(pt.threshold)}, ${pt.fy}` : undefined}>
            <Chooser size={36} aria-label="State" options={STATES} value={g.state ?? null} onChange={setState} />
          </SettingRow>
          {/* pay_settings owns this figure since the audit — a pricing edit
              here used to change what every My Pay card showed as super. */}
          <SettingRow name="Super" line={superOwned ? "From Pay and holidays" : undefined}>
            {superOwned ? (
              <><span className="rc-ro">{g.super_pct ?? 12}%</span><span className="rc-unit" /></>
            ) : (
              <Amount label="Super" unit="% of wages" value={g.super_pct ?? 12} clamp={n => Math.max(0, Math.min(30, n))} onChange={v => set("super_pct", v)} />
            )}
          </SettingRow>
          <SettingRow name="Workers comp">
            <Amount label="Workers comp" unit="% of wages" value={g.workers_comp_pct ?? 2} clamp={n => Math.max(0, Math.min(20, n))} onChange={v => set("workers_comp_pct", v)} />
          </SettingRow>
          <div className="rc-set">
            <Tick label="Registered for payroll tax" checked={!!g.payroll_tax_enabled} onChange={v => set("payroll_tax_enabled", v)} />
          </div>
        </div>

        <div>
          <h3>The working year</h3>
          <SettingRow name="Working weeks">
            <Amount label="Working weeks" unit="a year" value={g.working_weeks ?? DEFAULT_WORKING_WEEKS} clamp={n => Math.max(1, Math.min(52, Math.round(n)))} onChange={v => set("working_weeks", v)} />
          </SettingRow>
          <SettingRow name="A full day on site">
            <HoursField value={g.working_hours ?? null} onChange={v => set("working_hours", v)} />
          </SettingRow>
        </div>

        <div>
          <h3>Reviewing your rates</h3>
          <SettingRow name="Costs rise each year by">
            <Amount label="Costs rise each year by" unit="%" value={st.profit.costIncrease ?? 3} clamp={n => Math.max(0, Math.min(20, n))}
              onChange={v => patch({ profit: { ...st.profit, costIncrease: v }, settings: { ...g, annual_cost_increase_pct: v } })} />
          </SettingRow>
          <SettingRow name="Remind me every">
            <Amount label="Remind me every" unit="months" value={g.review_reminder_months ?? 6} clamp={n => Math.max(1, Math.min(24, Math.round(n)))} onChange={v => set("review_reminder_months", v)} />
          </SettingRow>
        </div>

        <div>
          <SettingRow name="How the rates are worked out">
            <Button kind="quiet" size={32} aria-expanded={showHow} onClick={() => setShowHow(v => !v)}>{showHow ? "Hide the working" : "Show the working"}</Button>
          </SettingRow>
          {showHow && <HowItsWorkedOut />}
        </div>

        <StartFresh onReset={onReset} />
      </div>
    </Dialog>
  );
}
