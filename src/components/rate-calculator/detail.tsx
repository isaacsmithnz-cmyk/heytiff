"use client";

/* Detailed bodies: they edit the engine's REAL lists, and every figure on a
   row comes from the engine's breakdowns. */

import React from "react";
import type { BusinessCost, CalcResult, VehicleCosts } from "./engine";
import { SUGGESTED_BUSINESS_COSTS, suggestedBusinessCosts, XERO_COVERED_VEHICLE_FIELDS, type RateCalcState } from "./state";
import { money, normUtil } from "./format";
import { NumberInput } from "./ui";
import { Button, LinkButton } from "@/components/parts/button";
import { Chooser } from "@/components/parts/chooser";
import { Field, TextInput } from "@/components/parts/field";
import { Initials } from "@/components/parts/initials";
import { StateWord } from "@/components/parts/state";

export interface StepBodyProps {
  s: RateCalcState;
  patch: (p: Partial<RateCalcState>) => void;
  calc: CalcResult;
  /** Show Simple or Detailed (host-gated per step). */
  showToggle?: boolean;
  /** Whether this workspace has a live Xero grant. Only a boolean reaches the
      calculator: the connection itself is owner business. */
  xeroConnected?: boolean;
}

/** What a cost is charged to: shared costs pool with admin labour and split
    by the labour ratio; install or service load onto that rate only. */
export const CHARGED_TO = [
  { value: "shared", label: "Shared" },
  { value: "install", label: "Install" },
  { value: "service", label: "Service" },
] as const;

// ── DETAILED · Staff (read-only — wages come from Team) ─────────────────
export function StaffDetail({ s, calc }: StepBodyProps) {
  const bd = Object.fromEntries((calc.staffBreakdown || []).map(b => [b.id, b]));
  const totalTrue = (calc.staffBreakdown || []).reduce((a, b) => a + b.annualCost, 0);
  // Anyone the calculator can't price yet — no wage, type or split on their card.
  const gaps = s.staff.filter(p => p.payroll_complete === false);
  const inst = Math.round(normUtil(calc.instUtil));
  const svc = Math.round(normUtil(calc.svcUtil));

  if (s.staff.length === 0) {
    return (
      <div className="rc-q rc-empty">
        <p>The calculator prices the people on Team, and nobody is there yet.</p>
        <Button href="/dashboard/team" size={32}>Open Team</Button>
      </div>
    );
  }
  return (
    <>
      <div className="rc-q">
        <div className="rc-qhead"><h3>From the team</h3><LinkButton href="/dashboard/team">Open Team</LinkButton></div>
        <table className="rc-table">
          <thead>
            <tr><th>Person</th><th className="rc-r">Wage an hour</th><th className="rc-r">Weeks</th><th className="rc-r">True cost a year</th><th className="rc-r">Install, service, admin</th></tr>
          </thead>
          <tbody>
            {s.staff.map(p => {
              const b = bd[p.id];
              return (
                <tr key={p.id}>
                  <td>
                    <span className="rc-who">
                      <Initials name={p.name} size={24} beside />
                      <span><b>{p.name}</b><em>{p.role || p.employment_type}</em></span>
                    </span>
                  </td>
                  <td className="rc-r">{p.hourly_wage > 0 ? `${money(p.hourly_wage)}` : "—"}</td>
                  <td className="rc-r">{b?.weeksSubmitted || 0}</td>
                  <td className="rc-r">{money(b?.annualCost)}</td>
                  <td className="rc-r">{p.payroll_complete === false ? "Not set" : `${p.install_pct}, ${p.service_pct}, ${p.admin_pct}`}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr><td>True labour cost</td><td /><td /><td className="rc-r">{money(totalTrue)}</td><td /></tr>
          </tfoot>
        </table>
        {gaps.length > 0 && (
          <div className="rc-say">
            <StateWord tone="look">
              {gaps.length === 1 ? `${gaps[0].name} has no wage, type or work split` : `${gaps.length} people have no wage, type or work split`}
            </StateWord>
            <LinkButton href="/dashboard/team">{gaps.length === 1 ? "Open their Team card" : "Open Team"}</LinkButton>
          </div>
        )}
      </div>
      <div className="rc-q">
        <div className="rc-tiles">
          <div className="rc-tile">
            <span>{calc.utilFromDefault ? "Billable, the usual" : "Billable, from timesheets"}</span>
            <b>{inst + svc}%</b>
            <em>Install {inst}%, service {svc}%</em>
          </div>
          <div className="rc-tile"><span>How sure</span><b>{calc.confidence.label}</b></div>
        </div>
      </div>
    </>
  );
}

// ── DETAILED · Business ─────────────────────────────────────────────────
export function BusinessDetail({ s, patch }: StepBodyProps) {
  // Opening Detailed on an unpriced table fills it with the suggested
  // categories, so the step reads as a checklist to price. The moment any row
  // carries an amount the table is the user's — never seeded again, so a
  // deliberately removed category stays gone (the words below re-add it).
  const seeded = React.useRef(false);
  const seedTable = React.useEffectEvent(() => {
    if (seeded.current) return;
    seeded.current = true;
    if (s.businessCosts.some(c => (c.amount || 0) > 0)) return;
    const suggested = new Set(SUGGESTED_BUSINESS_COSTS.map(n => n.toLowerCase()));
    // Keep genuinely-named extras; drop blanks and the legacy "New cost" default.
    const kept = s.businessCosts.filter(c => {
      const n = c.name.trim().toLowerCase();
      return n !== "" && n !== "new cost" && !suggested.has(n);
    });
    patch({ businessCosts: [...suggestedBusinessCosts(), ...kept] });
  });
  React.useEffect(() => {
    seedTable();
  }, []);

  const setCost = (i: number, p: Partial<BusinessCost>) =>
    patch({ businessCosts: s.businessCosts.map((c, j) => j === i ? { ...c, ...p } : c) });
  const total = s.businessCosts.reduce((a, c) => a + c.amount, 0);
  const have = new Set(s.businessCosts.map(c => c.name.trim().toLowerCase()));
  const suggestions = SUGGESTED_BUSINESS_COSTS.filter(n => !have.has(n.toLowerCase()));
  const add = (name: string) => patch({ businessCosts: [...s.businessCosts, { name, amount: 0, allocated_to: "shared" }] });
  return (
    <div className="rc-q">
      <div className="rc-cost-head"><span>Cost</span><span>Charged to</span><span className="rc-r">A year</span><span /></div>
      <div>
        {s.businessCosts.map((o, i) => (
          <div className="rc-cost" key={i}>
            <TextInput size={32} aria-label="Cost name" placeholder="Cost name" value={o.name} onChange={e => setCost(i, { name: e.target.value })} />
            <Chooser size={32} aria-label={`${o.name || "This cost"}, charged to`} options={CHARGED_TO} value={o.allocated_to}
              onChange={v => setCost(i, { allocated_to: v as BusinessCost["allocated_to"] })} />
            <NumberInput size={32} money aria-label={`${o.name || "This cost"}, a year`} value={o.amount} onChange={n => setCost(i, { amount: n })} />
            <Button kind="delete" size={32} onClick={() => patch({ businessCosts: s.businessCosts.filter((_, j) => j !== i) })}>Remove</Button>
          </div>
        ))}
      </div>
      <div className="rc-total"><span>Overheads a year</span><span>{money(total)}</span></div>
      <div className="rc-adds">
        <Button size={32} onClick={() => add("")}>Add a cost</Button>
        {suggestions.map(n => <Button key={n} kind="quiet" size={32} onClick={() => add(n)}>{n}</Button>)}
      </div>
    </div>
  );
}

// ── DETAILED · Vehicles ─────────────────────────────────────────────────
const VEHICLE_FIELDS: [keyof VehicleCosts, string][] = [
  ["replacement_value", "Replacement value"],
  ["resale_value", "Resale value"],
  ["cycle_years", "Years kept"],
  ["fuel_per_week", "Fuel a week"],
  ["insurance", "Insurance a year"],
  ["rego", "Rego a year"],
  ["servicing", "Servicing a year"],
  ["tolls", "Tolls a year"],
  ["fitout", "Fit-out"],
];

export function VehiclesDetail({ s, patch, calc }: StepBodyProps) {
  const bd = Object.fromEntries((calc.vehicleBreakdown || []).map(b => [b.id, b]));
  const setCost = (vi: number, k: keyof VehicleCosts, v: number) =>
    patch({ vehicles: s.vehicles.map((x, j) => j === vi ? { ...x, costs: { ...x.costs, [k]: v } } : x) });

  /* Business costs off a P&L already carry the org's Insurance and Depreciation
     accounts, ute included — neither has "vehicle" in the name, so neither
     leaves the overhead pool. Asking for them again per vehicle is how the same
     dollar gets charged twice, so those fields say where the money is instead.

     The engine ignores them regardless (`activeVehicles`), which is what
     actually closes the double count — a figure typed before Xero was connected
     is still in state, and comes straight back if Xero is left. */
  const covered = s.costsSource === "xero" && !!s.xeroCosts;
  const isCovered = (k: keyof VehicleCosts) =>
    covered && (XERO_COVERED_VEHICLE_FIELDS as readonly string[]).includes(k);
  const total = (calc.vehicleBreakdown || []).reduce((a, b) => a + (b.annual || 0), 0);

  if (s.vehicles.length === 0) {
    return (
      <div className="rc-q rc-empty">
        <p>There are no vehicles here to cost one by one.</p>
        <Button size={32} onClick={() => patch({ mode: { ...s.mode, vehicles: "Simple" } })}>Give the fleet&apos;s running cost</Button>
      </div>
    );
  }

  return (
    <div className="rc-q">
      {covered && <p className="rc-note">Insurance and depreciation are in your business costs from Xero, so they aren&apos;t asked for again here.</p>}
      {s.vehicles.map((v, vi) => {
        const driver = s.staff.find(p => p.id === v.assigned_driver_id);
        const costs = v.costs || {};
        /* read out here, not inside the `&&` below: React Compiler 1.0
           refuses a logical whose test is itself a logical, and gives up
           on the whole component when it meets one */
        const resale = costs.resale_value || 0;
        const replacement = costs.replacement_value || 0;
        return (
          <div className="rc-veh" key={v.vehicle_id}>
            <div className="rc-veh-top">
              <div>
                <b>{v.vehicle_name}</b>
                <span>{v.rego_number}, {driver ? `driven by ${driver.name} (${driver.install_pct}, ${driver.service_pct}, ${driver.admin_pct})` : `nobody assigned, so ${v.allocation} carries it`}</span>
              </div>
              <strong>{money(bd[v.vehicle_id]?.annual)} a year</strong>
            </div>
            {resale > replacement && (
              <div className="rc-say">
                <StateWord tone="look">Resale is more than replacement</StateWord>
                <p>That makes the write-down negative and under-prices this vehicle. Check the two values.</p>
              </div>
            )}
            <div className="rc-vgrid">
              {VEHICLE_FIELDS.map(([k, label]) => (
                <Field key={k} label={label}>
                  {isCovered(k) ? (
                    <span className="rc-ro">In business costs</span>
                  ) : (
                    <NumberInput size={32} money={k !== "cycle_years"} value={costs[k] || 0} onChange={n => setCost(vi, k, n)} />
                  )}
                </Field>
              ))}
            </div>
          </div>
        );
      })}
      <div className="rc-total"><span>Fleet a year</span><span>{money(total)}</span></div>
    </div>
  );
}
