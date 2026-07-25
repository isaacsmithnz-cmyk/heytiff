"use client";

import { Icon } from "@/components/shell/icon";
import type { MyPay } from "@/lib/staff/my-pay";
import { StaticCard } from "./section-card";

/* My pay — the rates that apply to YOU.

   SELF MODE ONLY. It is never rendered on an admin's view of someone else, and
   the data behind it never comes through a `financials`-gated read; getMyPay
   resolves the signed-in user's own row and nothing else.

   Deliberately read-only and deliberately rate-only: your admin sets these,
   and no total is shown. The same refusal as My timesheet — a figure that
   looks like pay but isn't a payslip is worse than no figure.

   AUD, two decimals, tabular numerals so a column of rates lines up. */
export const money = (n: number): string =>
  `$${n.toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const SUPER_COPY: Record<MyPay["superSource"], string> = {
  override: "your override",
  org: "org default",
  default: "standard rate",
};

export function MyPayCard({ pay }: { pay: MyPay }) {
  return (
    <StaticCard
      icon="dollar"
      title="My pay"
      sub="The rates that apply to your hours"
    >
      {pay.rate === null ? (
        <div className="ro-empty">
          <span className="ei">
            <Icon name="dollar" size={20} />
          </span>
          <b>No pay rate set yet</b>
          <em>
            Once your admin records your hourly rate it shows here, along with the overtime and
            super that go with it.
          </em>
        </div>
      ) : (
        <>
          <div className="mypay">
            <Tile label="Base rate" value={money(pay.rate)} unit="per hour" accent="teal" />
            <Tile
              label="Overtime"
              value={money(pay.rate * pay.otMultiplier)}
              unit={`×${pay.otMultiplier} per hour`}
            />
            <Tile
              label="Double time"
              value={money(pay.rate * pay.dblMultiplier)}
              unit={`×${pay.dblMultiplier} per hour`}
            />
            <Tile
              label="Super"
              value={`${pay.superPct}%`}
              unit={SUPER_COPY[pay.superSource]}
            />
          </div>
          {(pay.weekend.sat !== null || pay.weekend.sun !== null) && (
            <div className="mypay-chips">
              {pay.weekend.sat !== null && (
                <span className="dchip2 ok">
                  Saturday ×{pay.weekend.sat} · {money(pay.rate * pay.weekend.sat)}/h
                </span>
              )}
              {pay.weekend.sun !== null && (
                <span className="dchip2 ok">
                  Sunday ×{pay.weekend.sun} · {money(pay.rate * pay.weekend.sun)}/h
                </span>
              )}
            </div>
          )}
        </>
      )}
      <p className="mypay-foot">Set by your admin — talk to them if something looks off.</p>
    </StaticCard>
  );
}

function Tile({
  label,
  value,
  unit,
  accent,
}: {
  label: string;
  value: string;
  unit: string;
  accent?: "teal";
}) {
  return (
    <div className={accent ? `mpt ${accent}` : "mpt"}>
      <em>{label}</em>
      <b>{value}</b>
      <span>{unit}</span>
    </div>
  );
}
