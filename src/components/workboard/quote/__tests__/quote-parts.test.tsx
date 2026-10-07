import { render, renderHook, screen, waitFor } from "@testing-library/react";
import { priceBuildUp } from "@/lib/quotes/buildup";
import type { OptionPrice, QuotePrice } from "@/lib/quotes/quote-price-server";
import { PriceLines, PriceSummary, QuoteStepsLine, priceState, useQuotePrice } from "../quote-parts";
import { RUN_TO_ASK } from "@/lib/quotes/brief-rooms";

/* Isaac, 2026-10-04: "Switch it on now"; 2026-10-06: the quote page in
   Home's frame — each option's lines down the page, its price at the top of
   the list on the right */
const settings = { unitMarkupPct: 25, materialMarkupPct: 40, chargeOutCents: 14000, dayHours: 8, contingency: null };
const ap71 = { key: "row-0", group: "Units", name: "MSZ-AP71VGD2", code: "MSZ-AP71VGKD2-A2", supplierKey: "aad", qty: 1, unitBuyCents: 40000, kind: "unit" as const };
const option = (o: Partial<OptionPrice> & Pick<OptionPrice, "build">): OptionPrice => ({ name: "Split", unpriced: [], rows: 1, labourFrom: "brief", ...o });
const one = (o: OptionPrice): QuotePrice => ({ ok: true, options: [o] });

it("lists the option's lines by group, its labour, and what it couldn't price", () => {
  const build = priceBuildUp([ap71], [{ stage: "Install", people: 1, days: 1 }], settings);
  render(<PriceLines option={option({ build, unpriced: [{ name: "Mystery bracket", qty: "1", why: "Not in your price book" }], rows: 2 })} />);
  expect(screen.getByText("MSZ-AP71VGD2")).toBeInTheDocument();
  expect(screen.getAllByText("$500")).toHaveLength(2);
  expect(screen.getByText("1 person-day, from the brief")).toBeInTheDocument();
  expect(screen.getByText("$1,120")).toBeInTheDocument();
  expect(screen.getByText("Mystery bracket")).toBeInTheDocument();
  expect(screen.getByText("Not in your price book")).toBeInTheDocument();
});

it("prices the option ex and inc GST, a total so far until nothing is left to price", () => {
  const build = priceBuildUp([ap71], [{ stage: "Install", people: 1, days: 1 }], settings);
  const { rerender } = render(<PriceSummary price={one(option({ build, unpriced: [{ name: "Bracket", qty: "1", why: "Not in your price book" }] }))} at={0} names={["Option 1: Split"]} />);
  expect(screen.getByText("Option 1: Split, ex GST, so far")).toBeInTheDocument();
  expect(screen.getByText("$1,782 inc GST, so far")).toBeInTheDocument();
  rerender(<PriceSummary price={one(option({ build }))} at={0} names={["Option 1: Split"]} />);
  expect(screen.getByText("Option 1: Split, ex GST")).toBeInTheDocument();
  expect(screen.getByText("$1,782 inc GST")).toBeInTheDocument();
  expect(screen.getByText("Parts cost you")).toBeInTheDocument();
});

/* Isaac's walk, 2026-10-05: a $0 line read as a price */
it("says labour nothing gives is still to price, never a $0 line", () => {
  const wall = { key: "row-0", group: "Install kit", name: "Wall bracket", code: "CWB180", supplierKey: "aad", qty: 1, unitBuyCents: 3079, kind: "material" as const };
  const build = priceBuildUp([wall], [], settings);
  const o = option({ build, labourFrom: "none" });
  render(<PriceSummary price={one(o)} at={0} names={["Option 1: Split"]} />);
  expect(screen.getByText("Labour")).toBeInTheDocument();
  expect(screen.getByText("Still to price")).toBeInTheDocument();
  expect(screen.queryByText("$0")).toBeNull();
  render(<PriceLines option={o} />);
  expect(screen.getByText("Not in the brief, and not set on the option")).toBeInTheDocument();
});

it("shows no figures when there's nothing to price", () => {
  const o = option({ build: priceBuildUp([], [], settings), rows: 0, labourFrom: "none" });
  render(<PriceSummary price={one(o)} at={0} names={["Option 1: Split"]} />);
  expect(screen.getByText("Nothing to price yet")).toBeInTheDocument();
  expect(screen.queryByText(/GST/)).toBeNull();
});

it("says what isn't set, with the way to Quoting, and prices nothing", () => {
  render(<PriceSummary price={{ ok: false, unset: ["rate", "unit_markup"] }} at={0} names={[]} />);
  expect(screen.getByText("Set a charge-out rate and a markup on units in Quoting to price this quote.")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Set in Quoting" })).toHaveAttribute("href", "/dashboard/admin/quoting");
  expect(screen.queryByText(/GST/)).toBeNull();
});

/* Isaac, 2026-10-05: "Anything that's a pair should come from one supplier" */
it("says which supplier a unit is from, and when no one supplier has the whole system", () => {
  const build = priceBuildUp(
    [
      { key: "row-0", group: "Units", name: "MSZ-AP50VGD", code: "MSZ-AP50VGKD2-A2", supplierKey: "mitsubishi", supplierName: "Mitsubishi Electric", qty: 1, unitBuyCents: 52000, kind: "unit", features: ["Wi-Fi built in"] },
      { key: "row-1", group: "Units", name: "AOTH24KBCA3", code: "AOTH24KBCA3", supplierKey: "aad", supplierName: "AAD", qty: 1, unitBuyCents: 90000, kind: "unit", because: "no one supplier has the whole system" },
    ],
    [{ stage: "Install", people: 1, days: 1 }],
    settings
  );
  render(<PriceLines option={option({ build, rows: 2 })} />);
  expect(screen.getByText("1 at $520 buy, from Mitsubishi Electric, Wi-Fi built in")).toBeInTheDocument();
  expect(screen.getByText("1 at $900 buy, from AAD, no one supplier has the whole system")).toBeInTheDocument();
});

it("reads the price for each version, and nothing without the money grant", async () => {
  const fetchMock = jest.fn(async () => ({ json: async () => ({ ok: true, price: { ok: true, options: [] } }) }));
  (global as unknown as { fetch: unknown }).fetch = fetchMock;
  const { result, rerender } = renderHook(({ v, on }) => useQuotePrice("j-1", on, v), { initialProps: { v: "v1", on: true } });
  await waitFor(() => expect(result.current).toEqual({ ok: true, options: [] }));
  rerender({ v: "v2", on: true });
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  rerender({ v: "v2", on: false });
  expect(result.current).toBeUndefined();
});

it("tells the progress line what the price says", () => {
  const build = priceBuildUp([ap71], [{ stage: "Install", people: 1, days: 1 }], settings);
  expect(priceState(undefined)).toEqual({ kind: "hidden" });
  expect(priceState({ ok: false, unset: ["rate"] })).toEqual({ kind: "unset" });
  expect(priceState(one(option({ build: priceBuildUp([], [], settings), rows: 0, labourFrom: "none" })))).toEqual({ kind: "empty" });
  expect(priceState(one(option({ build, unpriced: [{ name: "x", qty: "1", why: "y" }] })))).toEqual({ kind: "priced", left: 1 });
});

it("draws the steps in their states, and offers Undo on the last one marked by hand", () => {
  const onUndo = jest.fn();
  render(
    <QuoteStepsLine
      onUndo={onUndo}
      steps={[
        { key: "brief", label: "Brief", state: "done", words: "Drafted" },
        { key: "approved", label: "Approved", state: "done", words: "Approved Tue 6 Oct" },
        { key: "sent", label: "Sent", state: "next", words: "Not yet" },
      ]}
    />
  );
  screen.getByRole("button", { name: "Undo approved" }).click();
  expect(onUndo).toHaveBeenCalledWith("approved");
  expect(screen.getByText("Sent").closest("li")).toHaveAttribute("aria-current", "step");
});

it("takes nothing back on the line once the client said yes: that's the option's own Accepted", () => {
  render(
    <QuoteStepsLine
      onUndo={jest.fn()}
      steps={[
        { key: "approved", label: "Approved", state: "done", words: "Approved Tue 6 Oct" },
        { key: "sent", label: "Sent", state: "todo", words: "Not marked" },
        { key: "accepted", label: "Accepted", state: "done", words: "Option 1" },
      ]}
    />
  );
  expect(screen.queryByRole("button", { name: /^Undo/ })).toBeNull();
});

it("leaves a length not known yet out of the quantity: its why says so", () => {
  const build = priceBuildUp([ap71], [{ stage: "Install", people: 1, days: 1 }], settings);
  render(<PriceLines option={option({ build, unpriced: [{ name: "Pipe cover", qty: RUN_TO_ASK, why: "Its length isn't known yet" }], rows: 2 })} />);
  const row = screen.getByText("Pipe cover").closest("tr")!;
  expect(row).not.toHaveTextContent(RUN_TO_ASK);
  expect(row).toHaveTextContent("Its length isn't known yet");
});

/* Isaac, 2026-10-07: "if it's over then great, if it's under it needs a warning" */
it("shows the profit against the target, and warns only a finished quote under it", () => {
  const build = priceBuildUp([ap71], [{ stage: "Install", people: 1, days: 1 }], settings);
  const over = { costCents: 129600, profitCents: 32400, pct: 20, targetPct: 20, hourCostCents: 11200, short: null };
  const { rerender } = render(<PriceSummary price={one(option({ build, profit: over }))} at={0} names={["Option 1: Split"]} />);
  expect(screen.getByText("Profit, target 20%")).toBeInTheDocument();
  expect(screen.getByText("$324, 20%")).toBeInTheDocument();
  expect(screen.queryByRole("status")).toBeNull();
  const under = { ...over, profitCents: 20000, pct: 12.3, short: { cents: 5000, priceCents: 167000 } };
  rerender(<PriceSummary price={one(option({ build, profit: under }))} at={0} names={["Option 1: Split"]} />);
  expect(screen.getByRole("status")).toHaveTextContent("Profit 12.3%, under your 20% target by $50. $1,670 ex GST would meet it.");
  rerender(<PriceSummary price={one(option({ build, profit: under, unpriced: [{ name: "Bracket", qty: "1", why: "Not in your price book" }] }))} at={0} names={["Option 1: Split"]} />);
  expect(screen.queryByRole("status")).toBeNull();
  expect(screen.getByText("$200, 12.3%")).toBeInTheDocument();
});
