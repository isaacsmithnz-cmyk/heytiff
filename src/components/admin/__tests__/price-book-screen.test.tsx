import { act, fireEvent, render, screen, within } from "@testing-library/react";

const refresh = jest.fn();
jest.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
jest.mock("@/app/actions/quote-settings", () => ({ saveQuoteSettings: jest.fn() }));

import { ToastProvider } from "@/components/parts/toast";
import { PriceBookScreen, type PricedPartsData } from "../price-book-screen";
import { DEFAULT_QUOTE_SETTINGS } from "@/lib/quotes/settings";
import type { SupplierView } from "@/lib/quotes/price-book-server";

/* Settings › Price book (v2, 25 October 2026; the mock's board): its title
   with Add items, four views of it as soft tabs, the Items first. What
   prices each part moved here from Quoting, and streams into its own tab. */

const aad: SupplierView = {
  key: "aad",
  name: "AAD",
  pricing: "net",
  file: "csv",
  format: "aad_csv",
  discountPct: 0,
  rules: [],
  columns: null,
  fileName: null,
  importedAt: null,
  itemCount: null,
};

const parts: PricedPartsData = { settings: DEFAULT_QUOTE_SETTINGS, components: [], ranges: [], habits: [] };

beforeEach(() => {
  global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ ok: true, products: [], rules: [], proposals: [], confirmed: 0, links: [] }) })) as unknown as typeof fetch;
});

const draw = (suppliers: SupplierView[]) =>
  render(
    <ToastProvider>
      <PriceBookScreen suppliers={suppliers} markupPct={40} parts={Promise.resolve(parts)} />
    </ToastProvider>
  );

it("draws the title with Add items, and the four views as soft tabs with no numbers", async () => {
  await act(async () => {
    draw([aad]);
  });
  expect(screen.getByRole("heading", { level: 1, name: "Price book" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Add items" })).toBeInTheDocument();
  const tabs = within(screen.getByRole("tablist", { name: "Price book" })).getAllByRole("tab");
  expect(tabs.map((t) => t.textContent)).toEqual(["Items", "Suppliers", "Matching", "What prices each part"]);
  expect(tabs[0]).toHaveAttribute("aria-selected", "true");
  expect(within(screen.getByRole("search")).getByLabelText("Search the price book")).toBeInTheDocument();
});

it("streams what prices each part into its own tab", async () => {
  await act(async () => {
    draw([aad]);
  });
  await act(async () => {
    fireEvent.click(screen.getByRole("tab", { name: "What prices each part" }));
  });
  expect(await screen.findByRole("table", { name: "Common install items" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Open Ductwork" })).toBeInTheDocument();
});

it("asks which supplier Add items is for, and opens it on Suppliers", async () => {
  await act(async () => {
    draw([aad]);
  });
  fireEvent.click(screen.getByRole("button", { name: "Add items" }));
  const picker = within(screen.getByRole("dialog", { name: "Which supplier are they from?" }));
  await act(async () => {
    fireEvent.click(picker.getByRole("button", { name: "AAD" }));
  });
  expect(screen.getByRole("tab", { name: "Suppliers" })).toHaveAttribute("aria-selected", "true");
  expect(screen.getByRole("dialog", { name: "AAD" })).toBeInTheDocument();
  expect(screen.getByLabelText("Upload AAD price list")).toBeInTheDocument();
});

it("with no supplier yet, Add items goes straight to adding one", async () => {
  await act(async () => {
    draw([]);
  });
  fireEvent.click(screen.getByRole("button", { name: "Add items" }));
  expect(screen.getByRole("dialog", { name: "Add a supplier" })).toBeInTheDocument();
  expect(screen.getByRole("tab", { name: "Suppliers" })).toHaveAttribute("aria-selected", "true");
});
