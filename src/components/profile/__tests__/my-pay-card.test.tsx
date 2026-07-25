import { render, screen } from "@testing-library/react";
import type { MyPay } from "@/lib/staff/my-pay";
import { MyPayCard } from "../my-pay-card";

/* My pay — the rates, never a total. Same refusal as My timesheet: a figure
   that looks like pay but isn't a payslip is worse than no figure. */

const pay = (over: Partial<MyPay> = {}): MyPay => ({
  rate: 45,
  superPct: 12,
  otMultiplier: 1.5,
  dblMultiplier: 2,
  superSource: "org",
  weekend: { sat: null, sun: null },
  ...over,
});

describe("derivations", () => {
  it("shows the base rate and both penalty rates in dollars", () => {
    render(<MyPayCard pay={pay()} />);
    expect(screen.getByText("$45.00")).toBeInTheDocument();
    expect(screen.getByText("$67.50")).toBeInTheDocument(); // x1.5
    expect(screen.getByText("$90.00")).toBeInTheDocument(); // x2
  });

  it("holds two decimals on a rate that isn't round", () => {
    render(<MyPayCard pay={pay({ rate: 38.5 })} />);
    expect(screen.getByText("$38.50")).toBeInTheDocument();
    expect(screen.getByText("$57.75")).toBeInTheDocument();
  });

  it("says where the super figure came from", () => {
    const { rerender } = render(<MyPayCard pay={pay()} />);
    expect(screen.getByText("12%")).toBeInTheDocument();
    expect(screen.getByText("org default")).toBeInTheDocument();

    rerender(<MyPayCard pay={pay({ superPct: 15, superSource: "override" })} />);
    expect(screen.getByText("your override")).toBeInTheDocument();
  });

  it("shows weekend chips only for rules the org has switched on", () => {
    const { rerender } = render(<MyPayCard pay={pay()} />);
    expect(screen.queryByText(/Saturday/)).not.toBeInTheDocument();

    rerender(<MyPayCard pay={pay({ weekend: { sat: 1.5, sun: 2 } })} />);
    expect(screen.getByText(/Saturday ×1.5 · \$67.50\/h/)).toBeInTheDocument();
    expect(screen.getByText(/Sunday ×2 · \$90.00\/h/)).toBeInTheDocument();

    rerender(<MyPayCard pay={pay({ weekend: { sat: null, sun: 2 } })} />);
    expect(screen.queryByText(/Saturday/)).not.toBeInTheDocument();
    expect(screen.getByText(/Sunday/)).toBeInTheDocument();
  });
});

describe("empty and read-only", () => {
  it("says no rate is set rather than showing $0.00", () => {
    render(<MyPayCard pay={pay({ rate: null })} />);
    expect(screen.getByText("No pay rate set yet")).toBeInTheDocument();
    expect(screen.queryByText(/\$0\.00/)).not.toBeInTheDocument();
  });

  it("has no edit cycle — these are set by an admin", () => {
    const { container } = render(<MyPayCard pay={pay()} />);
    expect(screen.queryByRole("button", { name: /Edit/ })).not.toBeInTheDocument();
    expect(container.querySelector(".card2")).toHaveAttribute("data-static");
    expect(screen.getByText("Set by your admin — talk to them if something looks off.")).toBeInTheDocument();
  });
});
