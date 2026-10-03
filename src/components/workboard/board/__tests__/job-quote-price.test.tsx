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
  answer({ ok: true, build, unpriced: [{ name: "Mystery bracket", qty: "1", why: "Not in your price book" }], labourFrom: "brief", rows: 2 });
  render(<JobQuotePrice job="j-1" visible />);
  expect(await screen.findByText("MSZ-AP71VGD2")).toBeInTheDocument();
  expect(screen.getByText("$500")).toBeInTheDocument();
  expect(screen.getByText("1 person-day, from the brief")).toBeInTheDocument();
  expect(screen.getByText("$1,120")).toBeInTheDocument();
  expect(screen.getByText("Inc GST")).toBeInTheDocument();
  expect(screen.getByText("$1,782")).toBeInTheDocument();
  expect(screen.getByText("Not priced: 1 of the job's materials")).toBeInTheDocument();
  expect(screen.getByText("Not in your price book")).toBeInTheDocument();
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
