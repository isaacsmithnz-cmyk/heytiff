"use client";

import { Icon } from "@/components/shell/icon";
import type { MyPay } from "@/lib/staff/my-pay";
import { StaticCard } from "./section-card";
import { Detail, DetailPanel, DetailPanels } from "./detail";

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
      variant="section"
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
        <DetailPanels>
          <DetailPanel title="Rates">
            <Detail label="Base rate" value={`${money(pay.rate)} / hour`} />
            <Detail
              label="Overtime"
              value={`${money(pay.rate * pay.otMultiplier)} / hour`}
              sub={`×${pay.otMultiplier}`}
            />
            <Detail
              label="Double time"
              value={`${money(pay.rate * pay.dblMultiplier)} / hour`}
              sub={`×${pay.dblMultiplier}`}
            />
          </DetailPanel>

          <DetailPanel title="Super">
            <Detail label="Rate" value={`${pay.superPct}%`} sub={SUPER_COPY[pay.superSource]} />
          </DetailPanel>

          {/* only when the org actually loads weekends — a panel of "—" would
              imply a penalty rate exists and is unset, which is a different
              thing from there being none */}
          {(pay.weekend.sat !== null || pay.weekend.sun !== null) && (
            <DetailPanel title="Weekend" wide split>
              {pay.weekend.sat !== null && (
                <Detail
                  label="Saturday"
                  value={`${money(pay.rate * pay.weekend.sat)} / hour`}
                  sub={`×${pay.weekend.sat}`}
                />
              )}
              {pay.weekend.sun !== null && (
                <Detail
                  label="Sunday"
                  value={`${money(pay.rate * pay.weekend.sun)} / hour`}
                  sub={`×${pay.weekend.sun}`}
                />
              )}
            </DetailPanel>
          )}
        </DetailPanels>
      )}
      <p className="mypay-foot">Set by your admin — talk to them if something looks off.</p>
    </StaticCard>
  );
}
