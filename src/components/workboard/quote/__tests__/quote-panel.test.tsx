import { render, screen, within } from "@testing-library/react";
import { priceBuildUp } from "@/lib/quotes/buildup";
import type { QuoteLine } from "@/lib/quotes/lines";
import { buildLineOf } from "@/lib/quotes/lines-price";
import type { OptionPrice, QuotePrice } from "@/lib/quotes/quote-price-server";
import { linesSteps } from "@/lib/quotes/quote-steps";
import { cents2 } from "@/lib/quotes/quote-sum";
import { OptionPick, QuoteTotal, WhereUpTo } from "../quote-rail";

/* THE QUOTE TAB'S PANEL, AS AN IPHONE'S SCREEN (Isaac, 20 and 21 November
   2026: "and the right panel is on an iphone", "make total spread across
   full width", "B but better", "Build all three" to
   https://claude.ai/artifact/EAB8Y8FsbnPbcuBXKDhT93). */

const settings = { unitMarkupPct: 25, materialMarkupPct: 40, chargeOutCents: 14000, dayHours: 8, contingency: null };
const line = (o: Partial<QuoteLine>): QuoteLine => ({ id: "l1", version: 1, updatedAt: "", updatedBy: "u", optionIndex: 0, system: "", group: "Materials", position: 0, name: "Refrigerant", code: null, supplierKey: null, kind: "material", qty: 1, unit: "", costCents: 5000, sellCents: null, source: "said", why: "", duct: false, ...o });
const repair = priceBuildUp([buildLineOf(line({}))], [{ stage: "Commissioning", people: 1, days: 0.625 }], settings);
const install = priceBuildUp([buildLineOf(line({ id: "u1", group: "Units", kind: "unit", name: "Outdoor unit", costCents: 100000 }))], [{ stage: "Install", people: 1, days: 1 }], settings);
const option = (build: OptionPrice["build"], profit: OptionPrice["profit"]): OptionPrice => ({ name: "Option 1", build, unpriced: [], rows: 1, labourFrom: "you", profit });
const priceOf = (o: OptionPrice): QuotePrice => ({ ok: true, chargeOutCents: 14000, options: [o] });
const profit = { costCents: 1, profitCents: 21117, pct: 22.3, targetPct: 20, hourCostCents: 11200, short: null };

describe("the total, one card the panel's width", () => {
  it("says Total ex GST with its figure across the card, Inc GST under it, then the parts, and no Units row at $0", () => {
    const o = option(repair, profit);
    render(<QuoteTotal price={priceOf(o)} option={o} optionLabel="Option 2" left={false} hours={5} variation={null} building={null} />);
    expect(screen.getByText("Option 2")).toBeInTheDocument();
    expect(screen.getByText("Total ex GST").nextElementSibling).toHaveTextContent(cents2(repair.exGstCents));
    expect(screen.getByText("Inc GST").nextElementSibling).toHaveTextContent(cents2(repair.incGstCents));
    expect(screen.queryByText("Units")).toBeNull();
    expect(screen.getByText("Materials")).toBeInTheDocument();
    expect(screen.getByText("Labour, 5 hours")).toBeInTheDocument();
    /* over its target the figure is green and says no more */
    expect(screen.getByText("Profit in that, 22.3%").nextElementSibling).toHaveClass("good");
    expect(screen.queryByText(/your 20%/)).toBeNull();
  });

  it("keeps Units where there are any, and says one hour as one", () => {
    const o = option(install, null);
    render(<QuoteTotal price={priceOf(o)} option={o} optionLabel={null} left={false} hours={1} variation={null} building={null} />);
    expect(screen.getByText("Units")).toBeInTheDocument();
    expect(screen.getByText("Labour, 1 hour")).toBeInTheDocument();
  });

  it("says how far under the target it is, and only then", () => {
    const o = option(repair, { ...profit, pct: 12, short: { cents: 7500, priceCents: 102000 } });
    render(<QuoteTotal price={priceOf(o)} option={o} optionLabel={null} left={false} hours={5} variation={null} building={null} />);
    expect(screen.getByText("Profit in that, 12%").nextElementSibling).toHaveClass("look");
    expect(screen.getByText("Under your 20% target by $75.00. $1,020.00 ex GST would meet it")).toBeInTheDocument();
  });

  it("is the total alone beside the Proposal, and so far while something is still to price", () => {
    const o = option(repair, profit);
    const { rerender } = render(<QuoteTotal price={priceOf(o)} option={o} optionLabel={null} left={false} hours={5} variation={null} building={null} parts={false} />);
    expect(screen.getByText("Total ex GST")).toBeInTheDocument();
    expect(screen.queryByText("Materials")).toBeNull();
    expect(screen.queryByText(/^Profit/)).toBeNull();
    rerender(<QuoteTotal price={priceOf(o)} option={o} optionLabel={null} left hours={5} variation={null} building={null} />);
    expect(screen.getByText("Total ex GST, so far")).toBeInTheDocument();
    expect(screen.getByText("Profit so far, 22.3%").nextElementSibling).not.toHaveClass("good");
  });

  it("says a variation as the difference it makes, with the new total under it", () => {
    const now = option(install, null);
    const was = option(repair, null);
    render(<QuoteTotal price={priceOf(now)} option={now} optionLabel={null} left={false} hours={8} variation={{ n: 1, of: was, hours: 5 }} building={null} />);
    expect(screen.getByText("Variation 1, ex GST").nextElementSibling).toHaveTextContent(`+${cents2(install.exGstCents - repair.exGstCents)}`);
    expect(screen.getByText("New total").nextElementSibling).toHaveTextContent(cents2(install.exGstCents));
    expect(screen.getByText("Labour, +3 hours")).toBeInTheDocument();
  });
});

describe("where it's up to, as rows", () => {
  it("says the last step done, each step that needs a look, what's to confirm, then what's next", () => {
    const steps = linesSteps({ lines: 3, unknown: 2, price: { kind: "priced", left: 1 }, design: "skipped" });
    render(
      <WhereUpTo steps={steps}>
        <ul aria-label="To confirm">
          <li>2 lines assumed</li>
        </ul>
      </WhereUpTo>,
    );
    const where = screen.getByRole("region", { name: "Where it's up to" });
    expect(Array.from(where.querySelectorAll("li")).map((li) => li.textContent)).toEqual(["BriefBy hand", "Scope2 to settle", "Priced1 to price", "2 lines assumed", "Ready to sendNot yet"]);
    expect(within(where).getByText("Scope").closest("li")).toHaveClass("look");
    expect(within(where).getByText("Ready to send").closest("li")).toHaveAttribute("aria-current", "step");
    /* not all seven */
    expect(within(where).queryByText("Sent")).toBeNull();
    expect(within(where).queryByText("Customer accepted")).toBeNull();
  });

  it("keeps Undo beside the customer's yes, and nothing after it", () => {
    const steps = linesSteps({ lines: 3, unknown: 0, price: { kind: "priced", left: 0 }, approved: true, accepted: [0] });
    const undo = jest.fn();
    render(<WhereUpTo steps={steps} onUndoAccepted={undo} />);
    const yes = screen.getByText("Customer accepted").closest("li")!;
    expect(yes).toHaveClass("done");
    within(yes).getByRole("button", { name: "Undo accepted" }).click();
    expect(undo).toHaveBeenCalled();
    expect(screen.queryByRole("list", { name: "Next" })).toBeNull();
  });
});

describe("which option the panel is on", () => {
  const rows = [
    { option: 0, name: "Option 1", line: "Ducted", total: "$6,995.00", on: false },
    { option: 1, name: "Option 2", line: "Repair", total: "$945.00", on: true },
  ];
  it("is the word alone on Breakdown, where the slider picks, and a menu of every option elsewhere", () => {
    const { rerender } = render(<OptionPick rows={rows} onPick={jest.fn()} pick={false} />);
    expect(screen.getByText("Option 2")).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
    rerender(<OptionPick rows={rows} onPick={jest.fn()} pick />);
    expect(screen.getByRole("button", { name: "Option 2" })).toHaveAttribute("aria-haspopup", "menu");
  });
  it("is nothing for a quote with one option", () => {
    const { container } = render(<OptionPick rows={rows.slice(1)} onPick={jest.fn()} pick />);
    expect(container).toBeEmptyDOMElement();
  });
});
