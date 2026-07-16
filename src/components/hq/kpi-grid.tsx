import type { ReactNode } from "react";

/* Presentational KPI cards for the HQ overview. No client interactivity, so it
   renders in the server page and unit-tests with plain props. */

export interface Kpi {
  label: string;
  value: string | number;
  sub?: ReactNode;
}

export function KpiGrid({ items }: { items: Kpi[] }) {
  return (
    <div className="hq-kpis">
      {items.map((k) => (
        <div className="hq-kpi" key={k.label}>
          <div className="hq-kpi-label">{k.label}</div>
          <div className="hq-kpi-value hq-num">{k.value}</div>
          {k.sub ? <div className="hq-kpi-sub">{k.sub}</div> : null}
        </div>
      ))}
    </div>
  );
}
