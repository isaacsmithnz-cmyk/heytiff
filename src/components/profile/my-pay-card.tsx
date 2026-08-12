"use client";

import { Icon } from "@/components/shell/icon";
import type { MyPay } from "@/lib/staff/my-pay";
import type { RateRule } from "@/components/timepay/logic";
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

/* WHAT A DAY IS WORTH, said the way the pay run works it out.

   A penalty rule is not one multiplier. `splitDay` pays a stepped rule at its
   first rate for `up` hours and at 2× after that, so "Saturday ×1.5" described
   the first two hours of a Saturday and nothing else — on the default settings
   an eight-hour Saturday paid 25% more than this card said it would.

   So a stepped rule gets both rungs, in dollars, with the hours the step
   happens at. A flat rule is still one line, because that is genuinely all it
   is. `ruleSummary` is the settings screen's own wording, reused rather than
   re-phrased. */
const HOURS = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

function RuleDetail({ label, rate, rl }: { label: string; rate: number; rl: RateRule }) {
  const stepped = rl.rate === 1.5 && rl.up != null && rl.up > 0;
  return (
    <Detail
      label={label}
      value={stepped ? `${money(rate * 1.5)} → ${money(rate * 2)} / hour` : `${money(rate * rl.rate)} / hour`}
      sub={stepped ? `×1.5 first ${HOURS(rl.up!)}h, then ×2` : `×${rl.rate} all day`}
    />
  );
}

export function MyPayCard({ pay }: { pay: MyPay }) {
  const r = pay.rate;
  const penalties: [string, RateRule][] = r === null
    ? []
    : ([
        ["Saturday", pay.rules.sat],
        ["Sunday", pay.rules.sun],
        ["Public holiday", pay.rules.ph],
        ["Night shift", pay.rules.night],
      ] as [string, RateRule][]).filter(([, rl]) => rl.on);

  return (
    <StaticCard
      variant="section"
      icon="dollar"
      title="My pay"
      sub="The rates that apply to your hours"
    >
      {r === null ? (
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
          <DetailPanel title="Ordinary time">
            <Detail label="Base rate" value={`${money(r)} / hour`} />
            {/* AFTER WHAT. The card said "Overtime ×1.5" and never named the
                threshold, so a person couldn't tell whether it started after
                eight hours in a day or thirty-eight in a week — the two things
                the settings screen actually offers. */}
            <Detail
              label="Overtime"
              value={`${money(r * 1.5)} / hour`}
              sub={`×1.5 past ${HOURS(pay.otAfter)}h a ${pay.otUnit}`}
            />
            <Detail
              label="Double time"
              value={`${money(r * 2)} / hour`}
              sub={`×2 past ${HOURS(pay.dblAfter)}h in a day`}
            />
          </DetailPanel>

          <DetailPanel title="Super">
            <Detail label="Rate" value={`${pay.superPct}%`} sub={SUPER_COPY[pay.superSource]} />
          </DetailPanel>

          {/* Only the rules this workspace has switched on. A panel of "—"
              would imply a penalty exists and is unset, which is a different
              thing from there being none — and public holidays and nights were
              missing from this card altogether, though the engine has always
              paid them. */}
          {penalties.length > 0 && (
            <DetailPanel title="Higher rates" wide split>
              {penalties.map(([label, rl]) => (
                <RuleDetail key={label} label={label} rate={r} rl={rl} />
              ))}
            </DetailPanel>
          )}
        </DetailPanels>
      )}
      <p className="mypay-foot">Set by your admin — talk to them if something looks off.</p>
    </StaticCard>
  );
}
