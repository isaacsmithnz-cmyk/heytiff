"use client";

import { Icon } from "@/components/shell/icon";
import { rebalance, splitFrom } from "@/lib/staff/cost-split";
import { preValidate } from "@/lib/staff/pre-validate";
import { SectionCard } from "./section-card";
import { MoneyInput, Pct, PctInput, Seg, SelectInput, TextInput } from "./fields";
import { Detail, DetailPanel, DetailPanels } from "./detail";
import type { PayFields, SaveSection } from "./types";
import { EMPLOYMENT_TYPES } from "@/lib/staff/employment";

/* the one list, shared with the Rate Calculator and Time & Pay — a label
   added here has to classify there too */
const EMPLOYMENT = EMPLOYMENT_TYPES;

const SPLIT_KEYS = ["cost_install", "cost_service", "cost_admin"] as const;
const SPLIT_META = [
  { label: "Install", color: "var(--teal)" },
  { label: "Service", color: "var(--blue)" },
  { label: "Admin", color: "#8A2BE2" },
];

const num = (v: number | null | undefined) => (v === null || v === undefined ? "" : String(v));

/** "40h" · "37.5h" — trailing zeros dropped, because 38.00 reads as a
    precision this figure doesn't have. */
const fmtHours = (h: number) => `${Math.round(h * 100) / 100}h`;

export function payrollValues(p: PayFields | null): Record<string, string> {
  const [install, service, admin] = splitFrom(p?.cost_split);
  return {
    hourly_wage: num(p?.hourly_wage),
    pay_basis: p?.pay_basis === "salary" ? "salary" : "hourly",
    employment_type: p?.employment_type ?? "",
    contracted_hours: num(p?.contracted_hours),
    utilisation: num(p?.utilisation),
    super_override: num(p?.super_override),
    workers_comp_override: num(p?.workers_comp_override),
    cost_install: String(install),
    cost_service: String(service),
    cost_admin: String(admin),
  };
}

/* Payroll — owner-only, and only ever rendered when the page passed it (which
   it does only for a viewer holding `financials`).

   cost_split is one jsonb column but three sliders. Each carries its own field
   name and the action reassembles them; the percentages must total 100, which
   `rebalance` guarantees as you drag and buildAdminPatch re-checks on save. */
export function PayrollCard({
  pay,
  rosteredWeek = null,
  onSave,
}: {
  pay: PayFields | null;
  /** What Time & Pay actually presumes onto this person's week, or null when
      there is no rostered week to state. */
  rosteredWeek?: number | null;
  onSave: SaveSection;
}) {
  const values = payrollValues(pay);
  const readSplit = SPLIT_KEYS.map((k) => Number(values[k]) || 0);

  /* Hours / week has a twin, and they used to be strangers. This field is a
     COSTING input — it prices a charge-out rate and nothing reads it for pay —
     while the timesheet fills every week in from the roster in Time & Pay. A
     card reading 38 beside a roster that presumes 40 is not an error either
     module can detect on its own, so the card states both and names the gap.
     Neither figure is corrected automatically: which one is wrong is a
     question about this business, not about this code. */
  const typedHours = Number(values.contracted_hours);
  const hoursNote =
    rosteredWeek == null
      ? undefined
      : !values.contracted_hours || !Number.isFinite(typedHours)
        ? `Time & Pay rosters ${fmtHours(rosteredWeek)} a week`
        : Math.abs(typedHours - rosteredWeek) < 0.01
          ? `Matches the ${fmtHours(rosteredWeek)} week rostered in Time & Pay`
          : `Time & Pay rosters ${fmtHours(rosteredWeek)} a week — this figure only costs jobs`;

  return (
    <SectionCard
      variant="section"
      icon="dollar"
      iconStyle={{ background: "rgba(255,51,102,.1)", color: "#e0264f" }}
      title="Payroll"
      sub="Drives charge-out rate & job costing"
      pill={
        <span className="pill2 adminpill">
          <Icon name="lock" size={11} />
          Owner only
        </span>
      }
      values={values}
      onSave={(fields) => onSave("payroll", fields)}
      validate={(fields) => preValidate("admin", "payroll", fields)}
      body={({ editing, draft, set, setMany, invalid, edit, errorFor }) => {
        const vals = SPLIT_KEYS.map((k) => Number(draft[k]) || 0);
        const split = editing ? vals : readSplit;
        const drag = (idx: number, v: number) => {
          const next = rebalance(vals, idx, v);
          setMany(Object.fromEntries(SPLIT_KEYS.map((k, i) => [k, String(next[i])])));
        };

        return (
          <DetailPanels>
            <DetailPanel title="Pay">
              <Detail
                label="Hourly wage"
                req
                editing={editing}
                value={values.hourly_wage ? `$${values.hourly_wage}` : ""}
                onAdd={edit}
                addLabel="Set"
                error={errorFor("hourly_wage", "Plain figures only")}
                control={
                  <MoneyInput
                    name="hourly_wage"
                    placeholder="e.g. 45.00"
                    value={draft.hourly_wage}
                    invalid={invalid("hourly_wage")}
                    onChange={(v) => set("hourly_wage", v)}
                  />
                }
              />
              <Detail
                label="Pay basis"
                editing={editing}
                value={values.pay_basis === "salary" ? "Salaried" : "Hourly"}
                control={
                  <Seg
                    value={draft.pay_basis === "salary" ? "Salaried" : "Hourly"}
                    options={["Hourly", "Salaried"]}
                    onChange={(v) => set("pay_basis", v === "Salaried" ? "salary" : "hourly")}
                  />
                }
              />
              <Detail
                label="Employment type"
                editing={editing}
                value={values.employment_type}
                onAdd={edit}
                addLabel="Select"
                control={
                  <SelectInput
                    name="employment_type"
                    placeholder="Select employment type"
                    options={EMPLOYMENT}
                    value={draft.employment_type}
                    onChange={(v) => set("employment_type", v)}
                  />
                }
              />
              <Detail
                label="Hours / week"
                editing={editing}
                value={values.contracted_hours}
                sub={hoursNote}
                onAdd={edit}
                addLabel="Set"
                error={errorFor("contracted_hours", "Plain figures only")}
                control={
                  <TextInput
                    name="contracted_hours"
                    placeholder="e.g. 38"
                    value={draft.contracted_hours}
                    invalid={invalid("contracted_hours")}
                    onChange={(v) => set("contracted_hours", v)}
                  />
                }
              />
              {/* THE SLIDER IS THERE IN BOTH MODES. It was a percentage you
                  could only reach by clicking "+ Set" and then typing into a
                  box on a different screen — and utilisation is a proportion,
                  which has a shape that a bare "85%" makes you reconstruct. */}
              <Detail
                label="Utilisation"
                editing={editing}
                value={<Pct name="utilisation" value={values.utilisation} label="Utilisation" />}
                error={errorFor("utilisation", "Plain figures only")}
                control={
                  <Pct
                    name="utilisation"
                    value={draft.utilisation}
                    label="Utilisation"
                    editing
                    onChange={(v) => set("utilisation", v)}
                  />
                }
              />
            </DetailPanel>

            <DetailPanel title="Overrides">
              <Detail
                label="Super"
                editing={editing}
                value={values.super_override ? `${values.super_override}%` : ""}
                onAdd={edit}
                addLabel="Set"
                sub={values.super_override ? undefined : "Using the org default"}
                error={errorFor("super_override", "Plain figures only")}
                control={
                  <PctInput
                    name="super_override"
                    placeholder="Default"
                    value={draft.super_override}
                    invalid={invalid("super_override")}
                    onChange={(v) => set("super_override", v)}
                  />
                }
              />
              <Detail
                label="Workers comp"
                editing={editing}
                value={
                  values.workers_comp_override ? `${values.workers_comp_override}%` : ""
                }
                onAdd={edit}
                addLabel="Set"
                sub={values.workers_comp_override ? undefined : "Using the org default"}
                error={errorFor("workers_comp_override", "Plain figures only")}
                control={
                  <PctInput
                    name="workers_comp_override"
                    placeholder="Default"
                    value={draft.workers_comp_override}
                    invalid={invalid("workers_comp_override")}
                    onChange={(v) => set("workers_comp_override", v)}
                  />
                }
              />
            </DetailPanel>

            {/* a chart, not a fact list — hence the plain panel. The three
                tracks fill in both modes; editing only puts the thumbs back. */}
            <DetailPanel
              title="Cost split"
              note={editing ? "must total 100%" : undefined}
              wide
              plain
            >
              <div className="csgrid">
                <div className="costsplit">
                  {SPLIT_META.map((m, i) => (
                    <div key={m.label} className="csrow">
                      <span className="csdot" style={{ background: m.color }} />
                      <span className="cslbl">{m.label}</span>
                      <div className="cspct">
                        <span className="cstrack">
                          <span
                            className="csfill"
                            style={{ width: `${split[i]}%`, background: m.color }}
                          />
                          {editing && (
                            <input
                              className="csrange"
                              name={SPLIT_KEYS[i]}
                              aria-label={`${m.label} share`}
                              type="range"
                              min="0"
                              max="100"
                              value={vals[i]}
                              onChange={(e) => drag(i, Number(e.target.value))}
                            />
                          )}
                        </span>
                        <span className="csval">{split[i]}%</span>
                      </div>
                    </div>
                  ))}
                </div>
                <Donut values={split} />
              </div>
            </DetailPanel>
          </DetailPanels>
        );
      }}
    />
  );
}

function Donut({ values }: { values: number[] }) {
  // each arc starts where the ones before it ended
  const segs = values.map((v, i) => ({
    v,
    i,
    offset: -values.slice(0, i).reduce((a, b) => a + b, 0),
  }));
  const colors = ["var(--teal)", "var(--blue)", "#8A2BE2"];
  const total = values.reduce((a, b) => a + b, 0);
  return (
    <div className="cspie">
      <svg viewBox="0 0 36 36">
        <circle className="csbg" cx="18" cy="18" r="15.915" fill="none" stroke="#eef0f4" strokeWidth="4" />
        {segs.map((s) => (
          <circle
            key={s.i}
            className={`csseg s${s.i}`}
            cx="18"
            cy="18"
            r="15.915"
            fill="none"
            stroke={colors[s.i]}
            strokeWidth="4"
            strokeDasharray={`${s.v} ${100 - s.v}`}
            strokeDashoffset={s.offset}
            transform="rotate(-90 18 18)"
          />
        ))}
      </svg>
      <div className={total === 100 ? "cstot" : "cstot over"}>
        <b>{total}</b>
        <em>%</em>
      </div>
    </div>
  );
}
