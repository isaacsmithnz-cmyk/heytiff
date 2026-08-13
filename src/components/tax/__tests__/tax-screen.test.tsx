import { render, screen } from "@testing-library/react";
import { TaxScreen } from "../tax-screen";
import { totalsFor, type TaxItem } from "@/lib/tax/item";

/* The Tax & EOFY screen. What is checked here is not the layout but the three
   things it must never get wrong: which year it says it is showing, whether a
   line has its receipt, and that an unapproved claim is not presented as
   settled money. */

const TODAY = "2026-08-04"; // FY2026-27, one month in

const item = (over: Partial<TaxItem> = {}): TaxItem => ({
  id: "fuel:1",
  source: "fuel",
  date: "2026-07-31",
  supplier: "Shell Coburg",
  abn: "51824753556",
  category: "fuel",
  description: "Fuel — 62.4 L",
  amount: 158.4,
  gst: 14.4,
  staffName: "Jordan Mills",
  vehicle: "FRU397 — Hilux",
  receiptUrl: "https://example.test/signed",
  receiptIsImage: true,
  hasReceipt: true,
  provisional: false,
  ...over,
});

function view(items: TaxItem[], fy = 2027) {
  render(
    <TaxScreen
      year={{ fy, items, totals: totalsFor(items) }}
      choices={[2027, 2026, 2025, 2024, 2023]}
      today={TODAY}
    />,
  );
}

/* THE COLUMN HAS TO ADD UP TO THE FIGURE ABOVE IT.

   `totalsFor` rounds once at the end precisely so it does — and then the
   screen printed the three headline stats through a whole-dollar formatter and
   everything under them through a cents one. "Total spend $565" sat directly
   above $152.35 + $412.90, and "GST $51" above $13.85 + $37.54. Nobody can
   reconcile that, and reconciling is the entire job of the person reading it.

   Read off the RENDERED text, not the totals object: the bug was never in the
   arithmetic, it was in the formatting, so a test against `totalsFor` would
   have passed throughout. */
describe("the figures reconcile", () => {
  const parse = (s: string) => Number(s.replace(/[^0-9.]/g, ""));
  const sumOf = (sel: string) =>
    [...document.querySelectorAll(sel)].reduce((n, el) => n + parse(el.textContent ?? ""), 0);
  const statValue = (label: string) =>
    parse(
      (screen.getByText(label).closest(".tx-stat") as HTMLElement).querySelector(".tx-statval")!
        .textContent ?? "",
    );

  const spread = [
    item({ id: "a", amount: 158.4, gst: 14.4, category: "fuel" }),
    item({ id: "b", amount: 412.9, gst: 37.54, category: "materials", source: "expense" }),
    item({ id: "c", amount: 27.35, gst: 2.49, category: "meals", source: "expense" }),
  ];

  it("totals the same as its own category rows, to the cent", () => {
    view(spread);
    expect(statValue("Total spend")).toBeCloseTo(sumOf(".tx-catamt"), 2);
    expect(statValue("Total spend")).toBeCloseTo(598.65, 2);
  });

  it("does the same for GST", () => {
    view(spread);
    expect(statValue("GST recorded")).toBeCloseTo(sumOf(".tx-catgst"), 2);
  });

  it("totals the same as the item rows underneath", () => {
    view(spread);
    expect(statValue("Total spend")).toBeCloseTo(sumOf(".tx-amt b"), 2);
  });
});

describe("TaxScreen", () => {
  it("names the years the way a tax return does", () => {
    view([item()]);
    expect(screen.getByRole("link", { name: /2026–27/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /2022–23/ })).toBeInTheDocument();
  });

  it("marks the running year as incomplete rather than implying closed books", () => {
    view([item()]);
    expect(screen.getByText(/still running/)).toBeInTheDocument();
  });

  it("says nothing about a part-year when the year is closed", () => {
    view([item({ date: "2025-09-01" })], 2026);
    expect(screen.queryByText(/still running/)).not.toBeInTheDocument();
  });

  it("leads with how many items are substantiated", () => {
    view([item(), item({ id: "fuel:2", hasReceipt: false })]);
    expect(screen.getByText("1 of 2")).toBeInTheDocument();
    expect(screen.getByText("1 without a receipt")).toBeInTheDocument();
  });

  it("opens a stored receipt, and refuses to pretend a missing one exists", () => {
    view([item(), item({ id: "fuel:2", hasReceipt: false, receiptUrl: null })]);
    expect(screen.getByRole("link", { name: /Receipt/ })).toHaveAttribute(
      "href",
      "https://example.test/signed",
    );
    expect(screen.getByText("No receipt")).toBeInTheDocument();
  });

  it("says when a receipt showed no GST rather than deriving one", () => {
    view([item({ gst: null })]);
    expect(screen.getByText("no GST shown")).toBeInTheDocument();
  });

  it("flags an unapproved claim, on the row and in the total", () => {
    view([item({ id: "expense:1", source: "expense", category: "tools", provisional: true })]);
    expect(screen.getByText("awaiting approval")).toBeInTheDocument();
    expect(screen.getByText(/hasn’t accepted it/)).toBeInTheDocument();
  });

  it("points the export at the year on screen", () => {
    view([item()], 2026);
    expect(screen.getByRole("link", { name: /Export CSV/ })).toHaveAttribute(
      "href",
      "/dashboard/admin/tax/export?fy=2026",
    );
  });

  it("offers no export for a year with nothing in it", () => {
    view([], 2024);
    expect(screen.queryByRole("link", { name: /Export CSV/ })).not.toBeInTheDocument();
    expect(screen.getByText(/Nothing recorded in 2023–24/)).toBeInTheDocument();
  });
});
