import { render, screen, within } from "@testing-library/react";
import type { MyPay } from "@/lib/staff/my-pay";
import { MyPayCard } from "../my-pay-card";

/* My pay — the rates, never a total. Same refusal as My timesheet: a figure
   that looks like pay but isn't a payslip is worse than no figure. */

const OFF = { on: false, rate: 1.5 as const, up: null };
const rules = (over: Partial<MyPay["rules"]> = {}): MyPay["rules"] => ({
  sat: OFF, sun: OFF, ph: OFF, night: OFF, ...over,
});

const pay = (over: Partial<MyPay> = {}): MyPay => ({
  rate: 45,
  superPct: 12,
  superSource: "org",
  rules: rules(),
  otAfter: 8,
  otUnit: "day",
  dblAfter: 12,
  ...over,
});

/** The panel a penalty rule lands in. */
const higher = (c: HTMLElement) =>
  [...c.querySelectorAll<HTMLElement>(".pdlcard")].find(
    (p) => p.querySelector(".pdlh")?.textContent === "Higher rates",
  );

describe("derivations", () => {
  it("shows the base rate and both penalty rates in dollars", () => {
    render(<MyPayCard pay={pay()} />);
    expect(screen.getByText("$45.00 / hour")).toBeInTheDocument();
    expect(screen.getByText("$67.50 / hour")).toBeInTheDocument(); // x1.5
    expect(screen.getByText("$90.00 / hour")).toBeInTheDocument(); // x2
  });

  it("holds two decimals on a rate that isn't round", () => {
    render(<MyPayCard pay={pay({ rate: 38.5 })} />);
    expect(screen.getByText("$38.50 / hour")).toBeInTheDocument();
    expect(screen.getByText("$57.75 / hour")).toBeInTheDocument();
  });

  it("says where the super figure came from", () => {
    const { rerender } = render(<MyPayCard pay={pay()} />);
    expect(screen.getByText("12%")).toBeInTheDocument();
    expect(screen.getByText("org default")).toBeInTheDocument();

    rerender(<MyPayCard pay={pay({ superPct: 15, superSource: "override" })} />);
    expect(screen.getByText("your override")).toBeInTheDocument();
  });

  it("shows the higher-rate panel only for rules the org has switched on", () => {
    const { container, rerender } = render(<MyPayCard pay={pay()} />);
    // no panel at all: "—" would imply a penalty rate exists and is unset
    expect(higher(container)).toBeUndefined();

    rerender(
      <MyPayCard
        pay={pay({ rules: rules({ sun: { on: true, rate: 2, up: null } }) })}
      />,
    );
    expect(within(higher(container)!).getByText("Sunday")).toBeInTheDocument();
    expect(within(higher(container)!).queryByText("Saturday")).not.toBeInTheDocument();
  });

  /* THE BUG THIS CARD SHIPPED WITH. A penalty rule is not one multiplier:
     `splitDay` pays a STEPPED rule at its first rate for `up` hours and at 2×
     after that. The card read `rules.sat.rate` alone, so "Saturday ×1.5"
     described the first two hours of a Saturday and nothing else — on the
     default settings an 8h Saturday at $50 showed $600 and paid $750. */
  it("shows BOTH rungs of a stepped rule, not just the first", () => {
    const { container } = render(
      <MyPayCard pay={pay({ rate: 50, rules: rules({ sat: { on: true, rate: 1.5, up: 2 } }) })} />,
    );
    const panel = higher(container)!;
    expect(within(panel).getByText("$75.00 → $100.00 / hour")).toBeInTheDocument();
    expect(within(panel).getByText("×1.5 first 2h, then ×2")).toBeInTheDocument();
  });

  it("states a flat rule as flat", () => {
    const { container } = render(
      <MyPayCard pay={pay({ rate: 50, rules: rules({ sun: { on: true, rate: 2, up: null } }) })} />,
    );
    expect(within(higher(container)!).getByText("×2 all day")).toBeInTheDocument();
  });

  /* Both were missing from this card entirely. `rules.ph` is ON by default at
     2× all day and is the most valuable day anybody can work; a workspace that
     switches nights on had people whose own pay card never mentioned it. */
  it("shows public holidays and night shift, which it used to omit", () => {
    const { container } = render(
      <MyPayCard
        pay={pay({
          rate: 50,
          rules: rules({
            ph: { on: true, rate: 2, up: null },
            night: { on: true, rate: 2, up: null },
          }),
        })}
      />,
    );
    const panel = higher(container)!;
    expect(within(panel).getByText("Public holiday")).toBeInTheDocument();
    expect(within(panel).getByText("Night shift")).toBeInTheDocument();
  });

  /* "Overtime ×1.5" never said after WHAT — a day threshold and a week
     threshold are the two things the settings screen offers. */
  it("names the threshold overtime starts at, in the workspace's own unit", () => {
    const { rerender } = render(<MyPayCard pay={pay()} />);
    expect(screen.getByText("×1.5 past 8h a day")).toBeInTheDocument();
    expect(screen.getByText("×2 past 12h in a day")).toBeInTheDocument();

    rerender(<MyPayCard pay={pay({ otAfter: 38, otUnit: "week" })} />);
    expect(screen.getByText("×1.5 past 38h a week")).toBeInTheDocument();
  });
});

describe("empty and read-only", () => {
  it("says no rate is set rather than showing $0.00", () => {
    render(<MyPayCard pay={pay({ rate: null })} />);
    expect(screen.getByText("No pay rate set yet")).toBeInTheDocument();
    expect(screen.queryByText(/\$0\.00/)).not.toBeInTheDocument();
  });

  /* The framed `.card2` went when the tab became the section's title, so what
     "read-only" looks like is now the absence of the buttons rather than a
     `data-static` attribute on a frame. Assert the thing that matters: there
     is no way into an edit cycle from here. */
  it("has no edit cycle — these are set by an admin", () => {
    render(<MyPayCard pay={pay()} />);
    expect(screen.queryByRole("button", { name: /Edit/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Save\b/ })).not.toBeInTheDocument();
    expect(screen.getByText("Set by your admin — talk to them if something looks off.")).toBeInTheDocument();
  });
});
