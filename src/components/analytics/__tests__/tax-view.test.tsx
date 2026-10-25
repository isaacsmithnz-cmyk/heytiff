import { render, screen, within } from "@testing-library/react";
import { TaxView, type TaxState } from "../tax-view";
import { totalsFor, type TaxItem } from "@/lib/tax/item";

/* Reports › Tax and EOFY (it was Admin, Tax & EOFY). What is checked here is
   not the layout but the things it must never get wrong: which year it says
   it is showing, whether a line has its receipt, that an unapproved claim is
   not presented as settled money, and that the figures reconcile. How the
   view sits in Reports (its tab, its year in the head) is in
   analytics-screen.test. */

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

const taxState = (items: TaxItem[], fy = 2027): TaxState => ({
  year: { fy, items, totals: totalsFor(items) },
  choices: [2027, 2026, 2025, 2024, 2023],
  today: TODAY,
});

function view(items: TaxItem[], fy = 2027) {
  render(<TaxView tax={taxState(items, fy)} />);
}

/* THE COLUMN HAS TO ADD UP TO THE FIGURE ABOVE IT.

   `totalsFor` rounds once at the end precisely so it does — and then the
   screen once printed the headline figures through a whole-dollar formatter
   and everything under them through a cents one. "Total spend $565" sat
   directly above $152.35 + $412.90. Nobody can reconcile that, and
   reconciling is the entire job of the person reading it.

   Read off the RENDERED text, not the totals object: the bug was never in the
   arithmetic, it was in the formatting. */
describe("the figures reconcile", () => {
  const parse = (s: string) => Number(s.replace(/[^0-9.]/g, ""));
  const sumOf = (table: string, col: string) =>
    [...screen.getByRole("table", { name: table }).querySelectorAll(`tbody [data-col="${col}"]`)].reduce(
      (n, el) => n + parse(el.textContent ?? ""),
      0,
    );
  const fig = (name: string) => parse(document.querySelector(`[data-fig="${name}"]`)?.textContent ?? "");

  const spread = [
    item({ id: "a", amount: 158.4, gst: 14.4, category: "fuel" }),
    item({ id: "b", amount: 412.9, gst: 37.54, category: "materials", source: "expense" }),
    item({ id: "c", amount: 27.35, gst: 2.49, category: "meals", source: "expense" }),
  ];

  it("totals the same as its own category rows, to the cent", () => {
    view(spread);
    expect(fig("total")).toBeCloseTo(sumOf("By category", "amount"), 2);
    expect(fig("total")).toBeCloseTo(598.65, 2);
  });

  it("does the same for GST", () => {
    view(spread);
    expect(fig("gst")).toBeCloseTo(sumOf("By category", "gst"), 2);
  });

  it("totals the same as the item rows underneath", () => {
    view(spread);
    expect(fig("total")).toBeCloseTo(sumOf("Every item", "amount"), 2);
  });
});

describe("TaxView", () => {
  it("lines the figures up in columns: the category's, then every item's", () => {
    view([item()]);
    const heads = (name: string) => [...screen.getByRole("table", { name }).querySelectorAll("th")].map((h) => h.textContent);
    expect(heads("By category")).toEqual(["Category", "Items", "GST", "Spent"]);
    expect(heads("Every item")).toEqual(["Date", "Spent at", "Amount", "GST", "Receipt"]);
  });

  it("leads with how many items are substantiated, the missing in the colour of a look", () => {
    view([item(), item({ id: "fuel:2", hasReceipt: false, receiptUrl: null })]);
    expect(screen.getByText("1 of 2")).toBeInTheDocument();
    expect(screen.getByText("1 without a receipt")).toHaveClass("st2-rp-note--look");
  });

  it("opens a stored receipt, and refuses to pretend a missing one exists", () => {
    view([item(), item({ id: "fuel:2", hasReceipt: false, receiptUrl: null })]);
    expect(screen.getByRole("link", { name: "View receipt" })).toHaveAttribute("href", "https://example.test/signed");
    expect(screen.getByText("No receipt").closest(".pt-state")).toHaveClass("pt-state--look");
  });

  it("says a receipt is held when it couldn't be opened just now", () => {
    view([item({ receiptUrl: null })]);
    expect(screen.queryByRole("link", { name: "View receipt" })).not.toBeInTheDocument();
    expect(screen.getByText("Receipt held")).toBeInTheDocument();
  });

  it("says when a receipt showed no GST rather than deriving one", () => {
    view([item({ gst: null })]);
    expect(screen.getByText("No GST shown")).toBeInTheDocument();
  });

  it("says who spent it and on what, under the supplier", () => {
    view([item()]);
    const row = within(screen.getByRole("table", { name: "Every item" })).getAllByRole("row")[1]!;
    expect(row).toHaveTextContent("31 Jul 2026");
    expect(row).toHaveTextContent("Shell Coburg");
    expect(row).toHaveTextContent("Fuel — 62.4 L, FRU397 — Hilux, Jordan Mills, ABN 51 824 753 556");
  });

  it("flags an unapproved claim, on the row and in the total", () => {
    view([item({ id: "expense:1", source: "expense", category: "tools", provisional: true })]);
    expect(screen.getByText("Awaiting approval").closest(".pt-state")).toHaveClass("pt-state--look");
    expect(screen.getByText(/hasn’t accepted it/)).toBeInTheDocument();
  });

  it("points the export at the year on screen, as a second button", () => {
    view([item()], 2026);
    const exp = screen.getByRole("link", { name: "Export CSV" });
    expect(exp).toHaveAttribute("href", "/dashboard/admin/tax/export?fy=2026");
    expect(exp).toHaveClass("pt-btn--second");
  });

  it("offers no export for a year with nothing in it", () => {
    view([], 2024);
    expect(screen.queryByRole("link", { name: "Export CSV" })).not.toBeInTheDocument();
    expect(screen.getByText("Nothing recorded in 2023–24")).toBeInTheDocument();
  });

  it("wears no tinted box, pill or icon for a state", () => {
    view([item({ hasReceipt: false, receiptUrl: null, provisional: true })]);
    expect(document.querySelector(".tx-note, .tx-rcpt, .tx-flag, .tx-stat")).toBeNull();

  });
});
