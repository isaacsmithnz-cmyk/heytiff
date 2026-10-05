import { render, screen } from "@testing-library/react";
import { JobQuotePrice } from "../job-quote-price";
import { priceBuildUp } from "@/lib/quotes/buildup";
import type { QuotePrice } from "@/lib/quotes/quote-price-server";

/* Isaac, 2026-10-04: "Switch it on now". */
const answer = (price: QuotePrice | null, status = 200) => {
  (global as unknown as { fetch: unknown }).fetch = jest.fn(async () => ({
    json: async () => (status === 200 ? { ok: true, price } : { ok: false, reason: "no" }),
  }));
};
const settings = { unitMarkupPct: 25, materialMarkupPct: 40, chargeOutCents: 14000, dayHours: 8, contingency: null };

it("prices the job's own list and labour, with GST, and lists what it couldn't", async () => {
  const build = priceBuildUp(
    [{ key: "row-0", group: "Units", name: "MSZ-AP71VGD2", code: "MSZ-AP71VGKD2-A2", supplierKey: "aad", qty: 1, unitBuyCents: 40000, kind: "unit" }],
    [{ stage: "Install", people: 1, days: 1 }],
    settings
  );
  answer({ ok: true, labourFrom: "brief", options: [{ name: "Split", build, unpriced: [{ name: "Mystery bracket", qty: "1", why: "Not in your price book" }], rows: 2 }] });
  render(<JobQuotePrice job="j-1" visible />);
  expect(await screen.findByText("MSZ-AP71VGD2")).toBeInTheDocument();
  expect(screen.getByText("$500")).toBeInTheDocument();
  expect(screen.getByText("1 person-day, from the brief")).toBeInTheDocument();
  expect(screen.getByText("$1,120")).toBeInTheDocument();
  expect(screen.getByText("Inc GST, so far")).toBeInTheDocument();
  expect(screen.getByText("$1,782")).toBeInTheDocument();
  expect(screen.getByText("Part priced: 1 still to price")).toBeInTheDocument();
  expect(screen.getByText("Not in your price book")).toBeInTheDocument();
});

it("calls a total whole only when nothing is left to price", async () => {
  const build = priceBuildUp(
    [{ key: "row-0", group: "Units", name: "MSZ-AP71VGD2", code: "MSZ-AP71VGKD2-A2", supplierKey: "aad", qty: 1, unitBuyCents: 40000, kind: "unit" }],
    [{ stage: "Install", people: 1, days: 1 }],
    settings
  );
  answer({ ok: true, labourFrom: "brief", options: [{ name: "Split", build, unpriced: [], rows: 1 }] });
  render(<JobQuotePrice job="j-1" visible />);
  expect(await screen.findByText("Its materials and labour, at your prices")).toBeInTheDocument();
  expect(screen.getByText("Inc GST")).toBeInTheDocument();
  expect(screen.queryByText("Still to price")).toBeNull();
});

/* Isaac's walk, 2026-10-05: a $0 line read as a price. */
it("lists labour nothing gives as still to price, never a $0 line", async () => {
  const build = priceBuildUp(
    [{ key: "row-0", group: "Install kit", name: "Wall bracket", code: "CWB180", supplierKey: "aad", qty: 1, unitBuyCents: 3079, kind: "material" }],
    [],
    settings
  );
  answer({ ok: true, labourFrom: "none", options: [{ name: "Split", build, unpriced: [], rows: 1 }] });
  render(<JobQuotePrice job="j-1" visible />);
  expect(await screen.findByText("Part priced: 1 still to price")).toBeInTheDocument();
  expect(screen.getByText("Labour")).toBeInTheDocument();
  expect(screen.getByText("Not in the brief, and no typical yet")).toBeInTheDocument();
  expect(screen.queryByText("$0")).toBeNull();
});

it("shows no figures when there's nothing to price", async () => {
  answer({ ok: true, labourFrom: "none", options: [{ name: "Split", build: priceBuildUp([], [], settings), unpriced: [], rows: 0 }] });
  render(<JobQuotePrice job="j-1" visible />);
  expect(await screen.findByText("Nothing to price yet")).toBeInTheDocument();
  expect(screen.queryByText(/GST/)).toBeNull();
});

it("says what isn't set, with the way to Quoting, and prices nothing", async () => {
  answer({ ok: false, unset: ["rate", "unit_markup"] });
  render(<JobQuotePrice job="j-1" visible />);
  expect(await screen.findByText("Set a charge-out rate and a markup on units in Quoting to price this quote.")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Set in Quoting" })).toHaveAttribute("href", "/dashboard/admin/quoting");
  expect(screen.queryByText("Inc GST")).toBeNull();
});

it("shows nothing to someone without money access", async () => {
  answer(null, 403);
  const { container } = render(<JobQuotePrice job="j-1" visible />);
  await new Promise((r) => setTimeout(r, 0));
  expect(container).toBeEmptyDOMElement();
});

/* Isaac, 2026-10-05: "essentially you're building two quotes on one page" */
it("prices each option on its own", async () => {
  const one = priceBuildUp(
    [{ key: "row-0", group: "Units", name: "MXZ-4F71VGD", code: "MXZ-4F71VGD", supplierKey: "aad", qty: 1, unitBuyCents: 200000, kind: "unit" }],
    [{ stage: "Install", people: 2, days: 1 }],
    settings
  );
  const two = priceBuildUp(
    [{ key: "row-0", group: "Units", name: "MSZ-AP25VGD2", code: "MSZ-AP25VGKD2-A2", supplierKey: "aad", qty: 3, unitBuyCents: 30000, kind: "unit" }],
    [{ stage: "Install", people: 2, days: 1 }],
    settings
  );
  answer({ ok: true, labourFrom: "brief", options: [
    { name: "One multi", build: one, unpriced: [], rows: 1 },
    { name: "Three splits", build: two, unpriced: [], rows: 1 },
  ] });
  render(<JobQuotePrice job="j-1" visible />);
  expect(await screen.findByText("Price, option 1: One multi")).toBeInTheDocument();
  expect(screen.getByText("Price, option 2: Three splits")).toBeInTheDocument();
  expect(screen.getByText("MXZ-4F71VGD")).toBeInTheDocument();
  expect(screen.getByText("MSZ-AP25VGD2")).toBeInTheDocument();
});

/* Isaac, 2026-10-05: "Anything that's a pair should come from one supplier" —
   a unit says who it's from, and when no one supplier has the whole system */
it("says which supplier a unit is from, and when no one supplier has the whole system", async () => {
  const build = priceBuildUp(
    [
      { key: "row-0", group: "Units", name: "MSZ-AP50VGD", code: "MSZ-AP50VGD-A1", supplierKey: "mitsubishi", supplierName: "Mitsubishi Electric", qty: 1, unitBuyCents: 52000, kind: "unit" },
      { key: "row-1", group: "Units", name: "AOTH24KBCA3", code: "AOTH24KBCA3", supplierKey: "aad", supplierName: "AAD", qty: 1, unitBuyCents: 90000, kind: "unit", because: "no one supplier has the whole system" },
    ],
    [{ stage: "Install", people: 1, days: 1 }],
    settings
  );
  answer({ ok: true, labourFrom: "brief", options: [{ name: "Split", build, unpriced: [], rows: 2 }] });
  render(<JobQuotePrice job="j-1" visible />);
  expect(await screen.findByText("1 at $520 buy, from Mitsubishi Electric")).toBeInTheDocument();
  expect(screen.getByText("1 at $900 buy, from AAD, no one supplier has the whole system")).toBeInTheDocument();
});
