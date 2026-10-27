"use client";

/* The five steps. Each is a title, then its questions as groups under a
   hairline (rule 35), every one on the page at once: the figures are typed,
   and Your rates beside them moves as they are. Simple asks for totals;
   Detailed (detail.tsx) edits the engine's own lists.

   `showToggle` (per step, gated by the host): Simple or Detailed is hidden
   on the first run and returns on later visits once the step has data that
   Detailed can actually edit. */

import React from "react";
import type { RiskSettings, Multipliers } from "./engine";
import { costsToXeroPatch, fleetCosted, fleetOnXero, fleetSourceMixed, snapshotTotal, sourceSwitchVisible, type EntryMode } from "./state";
import { money, rate0 } from "./format";
import { Amount, Bar, Facts, MoneyField, SettingRow } from "./ui";
import { BusinessDetail, StaffDetail, VehiclesDetail, type StepBodyProps } from "./detail";
import { XeroCostsPanel } from "./xero-costs";
import { XeroFleetPanel } from "./xero-fleet";
import { Button } from "@/components/parts/button";
import { StateWord } from "@/components/parts/state";
import { Tray } from "@/components/parts/tabs";

/* The lazy import lives OUT HERE, not in the component. The deferral is
   unchanged — the module is still fetched on the first call — but React
   Compiler 1.0 cannot lower an `import()` expression inside a component
   and gives up on the WHOLE component when it meets one. */
const rateCalcActions = () => import("@/app/actions/rate-calc");

const MODES = [
  { value: "Simple", label: "Simple" },
  { value: "Detailed", label: "Detailed" },
] as const;

const SOURCES = [
  { value: "manual", label: "Enter them myself" },
  { value: "xero", label: "Use figures from Xero" },
] as const;

/** A step's title, and Simple or Detailed beside it where there is a choice. */
function StepHead({ title, mode, onMode }: { title: string; mode?: EntryMode; onMode?: (v: EntryMode) => void }) {
  return (
    <div className="rc-steptop">
      <h2>{title}</h2>
      {mode && onMode && <Tray options={MODES} value={mode} onChange={onMode} ariaLabel="How much detail" />}
    </div>
  );
}

const MONTH_LABELS = ["This month", "Last month", "2 months ago"];

/** The three months every Simple step asks for. */
function MonthFields({ months, onChange }: { months: number[]; onChange: (m: number[]) => void }) {
  return (
    <div className="rc-months">
      {MONTH_LABELS.map((l, i) => (
        <MoneyField key={l} label={l} value={months[i] || 0} onChange={n => { const m = [...months]; m[i] = n; onChange(m); }} />
      ))}
    </div>
  );
}

/** Whole numbers between two bounds, for a figure typed into a step. */
const between = (lo: number, hi: number) => (n: number) => Math.max(lo, Math.min(hi, Math.round(n)));

/** Xero is the source but the grant has gone: say so, and what to do. */
function Disconnected() {
  return (
    <div className="rc-say">
      <StateWord tone="wrong">Xero is disconnected</StateWord>
      <p>These figures are as Xero last gave them, and Refresh can&apos;t run. Enter them yourself, or reconnect Xero in Settings, Integrations.</p>
    </div>
  );
}

// ── Step 1 · Staff and wages ────────────────────────────────────────────
export function StaffStep({ s, patch, calc, showToggle }: StepBodyProps) {
  const sl = s.simpleLabour;
  const totalLabour = calc.instLab + calc.svcLab + calc.adminLab;
  const wagesEntered = (sl.months || []).some(m => m > 0);
  // The true cost, as gross wages projected to a year plus the on-costs the
  // engine loads on top.
  const bd = calc.staffBreakdown[0];
  const superPct = s.settings.super_pct ?? 12;
  const wcPct = s.settings.workers_comp_pct ?? 2;
  const grossWages = bd?.base ?? 0;
  // Work split: Install and Service are the two typed shares; Admin is always
  // the remainder (100 − the two), so the split can never total anything but
  // 100%. Each field refuses a share past what's left.
  const install = sl.install_pct || 0;
  const service = sl.service_pct || 0;
  const admin = Math.max(0, 100 - install - service);
  const setInstall = (i: number) => patch({ simpleLabour: { ...sl, install_pct: i, admin_pct: 100 - i - service } });
  const setService = (v: number) => patch({ simpleLabour: { ...sl, service_pct: v, admin_pct: 100 - install - v } });
  // Heal a legacy split that doesn't total 100 (older ± builds could persist
  // e.g. 65/30/10) by pinning admin to the remainder once, on load.
  const healSplit = React.useEffectEvent(() => {
    if (install + service + (sl.admin_pct || 0) !== 100) {
      patch({ simpleLabour: { ...sl, admin_pct: 100 - install - service } });
    }
  });
  React.useEffect(() => {
    healSplit();
  }, [install, service, sl.admin_pct]);

  const head = (
    <StepHead title="Staff and wages"
      mode={showToggle ? s.mode.staff : undefined}
      onMode={showToggle ? (v => patch({ mode: { ...s.mode, staff: v } })) : undefined} />
  );
  if (s.mode.staff === "Detailed") return <>{head}<StaffDetail s={s} patch={patch} calc={calc} /></>;

  return (
    <>
      {head}
      <div className="rc-q">
        <h3>What did you pay in wages over the last 3 months?</h3>
        <MonthFields months={sl.months} onChange={m => patch({ simpleLabour: { ...sl, months: m } })} />
        {wagesEntered && (
          <Facts rows={[
            ["Gross wages", money(grossWages)],
            [`Super, ${superPct}%`, money(grossWages * superPct / 100)],
            [`Workers comp, ${wcPct}%`, money(grossWages * wcPct / 100)],
            ["Leave loading", money(bd?.leaveLoading ?? 0)],
            ["True cost a year", money(totalLabour)],
          ]} />
        )}
      </div>
      <div className="rc-q">
        <SettingRow name="How many staff in total?">
          <Amount label="How many staff" unit="people" value={sl.staff_count || 1} clamp={between(1, 999)}
            onChange={n => patch({ simpleLabour: { ...sl, staff_count: n } })} />
        </SettingRow>
      </div>
      <div className="rc-q">
        <h3>Split that time across the work</h3>
        <Bar parts={[
          { name: "Install", share: install, hue: "purple", figure: `${install}%` },
          { name: "Service", share: service, hue: "pink", figure: `${service}%` },
          { name: "Admin", share: admin, hue: "grey", figure: `${admin}%` },
        ]} />
        <div>
          <SettingRow name="Install">
            <Amount label="Install percent" unit="%" value={install} clamp={between(0, 100 - service)} onChange={setInstall} />
          </SettingRow>
          <SettingRow name="Service">
            <Amount label="Service percent" unit="%" value={service} clamp={between(0, 100 - install)} onChange={setService} />
          </SettingRow>
          <SettingRow name="Admin">
            <span className="rc-ro">{admin}%</span>
            <span className="rc-unit" />
          </SettingRow>
        </div>
      </div>
      <div className="rc-q">
        <SettingRow name="Billable time" line="75% is usual for a trade">
          <Amount label="Billable time" unit="% of paid hours" value={sl.billable_pct ?? 75} clamp={between(40, 95)}
            onChange={n => patch({ simpleLabour: { ...sl, billable_pct: n } })} />
        </SettingRow>
      </div>
    </>
  );
}

// ── Step 2 · Business costs ─────────────────────────────────────────────
export function BusinessStep({ s, patch, calc, showToggle, xeroConnected }: StepBodyProps) {
  const sb = s.simpleBusiness;
  const onXero = s.costsSource === "xero";
  const entered = (sb.months || []).some(m => m > 0);
  const monthly = Math.round(snapshotTotal(s.xeroCosts) / 12);
  return (
    <>
      <StepHead title="Business costs"
        // Simple or Detailed is about how you TYPE costs in, so it has
        // nothing to say while Xero is the source.
        mode={showToggle && !onXero ? s.mode.business : undefined}
        onMode={showToggle && !onXero ? (v => patch({ mode: { ...s.mode, business: v } })) : undefined} />

      {/* The source. Shown whenever there is a choice to make: a grant to
          switch onto, or a snapshot to walk away from. Hiding it while the
          source was "xero" and the grant was dead trapped the calculator on a
          frozen snapshot with no way back to manual — the audit's A8. */}
      {sourceSwitchVisible(!!xeroConnected, s.costsSource) && (
        <div className="rc-src">
          <Tray options={SOURCES} value={onXero ? "xero" : "manual"} ariaLabel="Where the costs come from"
            onChange={v => {
              if (v === "manual") patch({ costsSource: "manual" });
              else if (xeroConnected) patch(costsToXeroPatch(s));
            }} />
          {!xeroConnected && !onXero && <span className="rc-note">Xero isn&apos;t connected</span>}
        </div>
      )}
      {onXero && !xeroConnected && <Disconnected />}

      {onXero ? (
        <XeroCostsPanel
          s={s}
          patch={patch}
          onFetch={async (choice) =>
            (await rateCalcActions()).fetchXeroBusinessCosts(choice)
          }
        />
      ) : s.mode.business === "Detailed" ? <BusinessDetail s={s} patch={patch} calc={calc} /> : (
        <div className="rc-q">
          <h3>What did the business spend on overheads over the last 3 months?</h3>
          <MonthFields months={sb.months} onChange={m => patch({ simpleBusiness: { ...sb, months: m } })} />
          {/* One-way seed: the Xero snapshot already knows the overheads these
              three ask for. A suggestion the admin presses, never a silent
              write — pricing keeps owning its inputs. */}
          {!entered && s.xeroCosts && (
            <div className="rc-adds">
              <Button kind="quiet" size={32} onClick={() => patch({ simpleBusiness: { ...sb, months: [monthly, monthly, monthly] } })}>
                {`Use Xero's figures, about ${money(monthly)} a month`}
              </Button>
            </div>
          )}
          {entered && <Facts rows={[["Overheads a year", money(calc.enteredBiz)]]} />}
        </div>
      )}
    </>
  );
}

// ── Step 3 · Vehicles ───────────────────────────────────────────────────
const YES_NO = [
  { value: "yes", label: "Yes" },
  { value: "no", label: "No vehicles" },
] as const;

export function VehiclesStep({ s, patch, calc, showToggle, xeroConnected }: StepBodyProps) {
  const sv = s.simpleVehicle;
  const fleetTotal = calc.instVehicle + calc.svcVehicle + calc.adminVehicle;
  const hasCosts = fleetCosted(s);
  /* fleetOnXero, not the raw source: an explicit "no vehicles" must win the
     render, or a legacy row could show the Xero panel with the source switch
     hidden (it hides under noVehicles) and no way back to the question. */
  const onXeroFleet = fleetOnXero(s);
  // Local "yes we run vehicles"; a yes once costs exist, so a returning user
  // with a costed fleet sees the question answered.
  const [saidYes, setSaidYes] = React.useState(hasCosts);
  // A fleet on Xero, or one being costed vehicle by vehicle, is a yes too.
  const runsVehicles = saidYes || hasCosts || onXeroFleet || s.mode.vehicles === "Detailed";
  const answer = s.noVehicles ? "no" : runsVehicles ? "yes" : null;
  const xeroOffered = !!xeroConnected || !!s.xeroCosts;

  return (
    <>
      <StepHead title="Vehicles"
        /* Simple or Detailed is about how you TYPE a fleet cost in, so it
           has nothing to say while Xero is the source — the Business step's
           rule. */
        mode={showToggle && !onXeroFleet ? s.mode.vehicles : undefined}
        onMode={showToggle && !onXeroFleet ? (v => patch({ mode: { ...s.mode, vehicles: v } })) : undefined} />

      <div className="rc-q">
        <div className="rc-qhead">
          <h3>Do you run vehicles for the business?</h3>
          <Tray options={YES_NO} value={answer as "yes" | "no"} ariaLabel="Do you run vehicles"
            onChange={v => {
              if (v === "yes") { setSaidYes(true); if (s.noVehicles) patch({ noVehicles: false }); }
              else { setSaidYes(false); patch({ noVehicles: true, simpleVehicle: { ...sv, months: [0, 0, 0] } }); }
            }} />
        </div>
        {s.noVehicles && <p className="rc-note">Your rates carry no vehicle cost.</p>}
      </div>

      {/* Shown whenever there's a choice to make — a grant to switch onto, or
          a snapshot to walk away from: the trap the Business step's source
          switch was fixed for. */}
      {!s.noVehicles && runsVehicles && sourceSwitchVisible(!!xeroConnected, s.vehicleSource) && (
        <div className="rc-src">
          <Tray options={SOURCES} value={onXeroFleet ? "xero" : "manual"} ariaLabel="Where the fleet costs come from"
            onChange={v => {
              if (v === "manual") patch({ vehicleSource: "manual" });
              else if (xeroOffered) patch({ vehicleSource: "xero" });
            }} />
          {!xeroOffered && <span className="rc-note">Xero isn&apos;t connected</span>}
        </div>
      )}
      {onXeroFleet && !xeroConnected && <Disconnected />}

      {/* The one combination where a dollar can be doubled and another
          dropped in the same breath: reached only by switching off Xero here
          after the pull put the fleet on it, so it names both halves. */}
      {!s.noVehicles && fleetSourceMixed(s) && (
        <div className="rc-say">
          <StateWord tone="look">Business costs come from Xero, the fleet doesn&apos;t</StateWord>
          <p>Xero&apos;s vehicle lines left your business costs, so enter them below or they count nowhere. Your Insurance and Depreciation accounts stay in business costs: don&apos;t enter those here as well.</p>
          <Button size={32} onClick={() => patch({ vehicleSource: "xero" })}>Use Xero for the fleet too</Button>
        </div>
      )}

      {s.noVehicles || !runsVehicles ? null : onXeroFleet ? (
        <XeroFleetPanel
          s={s}
          patch={patch}
          onFetch={async (choice) =>
            (await rateCalcActions()).fetchXeroBusinessCosts(choice)
          }
        />
      ) : s.mode.vehicles === "Detailed" ? <VehiclesDetail s={s} patch={patch} calc={calc} /> : (
        <div className="rc-q">
          <h3>What did the fleet cost to run over the last 3 months?</h3>
          <MonthFields months={sv.months} onChange={m => patch({ simpleVehicle: { ...sv, months: m } })} />
          {hasCosts && <Facts rows={[["Fleet a year", money(fleetTotal)]]} />}
          {s.vehicles.length > 0 && (
            <ul className="rc-list">
              {s.vehicles.map(v => (
                <li key={v.vehicle_id}>
                  <span className="rc-list-w">
                    <b>{v.vehicle_name}, {v.rego_number}</b>
                    <span>{s.staff.find(p => p.id === v.assigned_driver_id)?.name ?? "Nobody assigned"}, {v.allocation}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </>
  );
}

// ── Step 4 · HVAC risk ──────────────────────────────────────────────────
/** One rate's break-even, as the cost an hour and the buffer on top. */
function Buffer({ label, hue, be, m }: { label: string; hue: "purple" | "pink"; be: number | null; m: number }) {
  if (be == null) return null;
  const base = be / m;
  const add = be - base;
  return (
    <div className="rc-hours">
      <div className="rc-hours-l"><span>{label}</span><span>{rate0(base)} + {rate0(add)} = {rate0(be)} to break even</span></div>
      <Bar parts={[
        { name: "Cost an hour", share: base, hue, figure: rate0(base) },
        { name: "Buffer", share: add, hue: "grey", figure: rate0(add) },
      ]} />
    </div>
  );
}

const RISK_ITEMS: [string, keyof RiskSettings, string][] = [
  ["Warranty", "warranty", "% on install"],
  ["Defects", "defect", "% on install"],
  ["Callbacks", "callback", "% on service"],
  ["Fault-finding", "diagnostic", "% on service"],
];

export function RiskStep({ s, patch, calc }: StepBodyProps) {
  const iM = 1 + (s.risk.warranty + s.risk.defect) / 100;
  const sM = 1 + (s.risk.callback + s.risk.diagnostic) / 100;
  return (
    <>
      <StepHead title="HVAC risk" />
      <div className="rc-q">
        <h3>How much buffer for the work nobody pays for?</h3>
        <div>
          {RISK_ITEMS.map(([name, k, unit]) => (
            <SettingRow key={k} name={name}>
              <Amount label={name} unit={unit} value={s.risk[k]} clamp={between(0, 25)} onChange={n => patch({ risk: { ...s.risk, [k]: n } })} />
            </SettingRow>
          ))}
        </div>
      </div>
      {calc.beInst != null && calc.beSvc != null && (
        <div className="rc-q">
          <h3>What the buffer adds</h3>
          <Buffer label="Install" hue="purple" be={calc.beInst} m={iM} />
          <Buffer label="Service" hue="pink" be={calc.beSvc} m={sM} />
        </div>
      )}
    </>
  );
}

// ── Step 5 · Profit target ──────────────────────────────────────────────
const MULTS: [string, keyof Multipliers][] = [
  ["After hours", "afterHours"],
  ["Emergency", "emergency"],
];

/** A multiplier to two places, between 1 and 3. */
const multiplier = (n: number) => Math.max(1, Math.min(3, Math.round(n * 100) / 100));

export function ProfitStep({ s, patch, calc }: StepBodyProps) {
  const figure = (k: keyof Multipliers) => (k === "afterHours" ? calc.afterHrs : calc.emergency);
  return (
    <>
      <StepHead title="Profit target" />
      <div className="rc-q">
        <SettingRow name="Profit margin">
          <Amount label="Profit margin" unit="%" value={s.profit.margin} clamp={between(0, 60)} onChange={n => patch({ profit: { ...s.profit, margin: n } })} />
        </SettingRow>
      </div>
      <div className="rc-q">
        <h3>Out of hours</h3>
        <div>
          {MULTS.map(([name, k]) => (
            <SettingRow key={k} name={name}>
              <Amount label={`${name}, times service`} unit={`× service${figure(k) != null ? `, ${rate0(figure(k))}` : ""}`}
                value={s.multipliers[k]} clamp={multiplier} onChange={n => patch({ multipliers: { ...s.multipliers, [k]: n } })} />
            </SettingRow>
          ))}
        </div>
      </div>
      <div className="rc-q">
        <SettingRow name="Costs rise each year by"
          line={calc.projInst != null && calc.projSvc != null ? `Next year: install ${rate0(calc.projInst)}, service ${rate0(calc.projSvc)}` : undefined}>
          <Amount label="Costs rise each year by" unit="%" value={s.profit.costIncrease ?? 3} clamp={between(0, 20)}
            onChange={n => patch({ profit: { ...s.profit, costIncrease: n } })} />
        </SettingRow>
      </div>
    </>
  );
}
