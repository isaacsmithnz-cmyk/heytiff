/* The price book's items: the whole book once, then Most used (by quotes),
   a shelf in families, units by maker and type, and a search — all sorted
   in the browser with nothing more asked of the server. A supplier's price
   pressed prefers it at once, and is put back if refused. */
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { BookItems } from "../book-items";
import type { Product } from "@/lib/quotes/families";

const offer = (supplierKey: string, supplierName: string, code: string, name: string, netCents: number) => ({
  supplierKey,
  supplierName,
  code,
  name,
  netCents,
  pricedOn: null,
});
const product = (over: Partial<Product> & Pick<Product, "key" | "name" | "offers">): Product => ({
  category: "pipe",
  cheapest: over.offers[0] ?? null,
  preferred: null,
  brand: null,
  quotes: 0,
  ...over,
});

const coil = product({
  key: "aad|PC1412",
  name: "PAIRED COIL 1/4+1/2X20M",
  offers: [offer("reece", "Reece", "9800006-1", "ARDENT PR CU 1/4 X 1/2", 18000), offer("aad", "AAD", "PC1412", "PAIRED COIL 1/4+1/2X20M", 19100)],
  quotes: 30,
});
const small = product({ key: "aad|PC1438", name: "PAIRED COIL 1/4+3/8X20M", offers: [offer("aad", "AAD", "PC1438", "PAIRED COIL 1/4+3/8X20M", 15747)] });
const daikin = product({
  key: "aad|FTXZ25",
  name: "DAIKIN ZENA HWS IND 2.5KW R32",
  category: "units",
  brand: "Daikin",
  offers: [offer("aad", "AAD", "FTXZ25", "DAIKIN ZENA HWS IND 2.5KW R32", 100000)],
});
const daikinBig = product({
  key: "aad|FTXZ50",
  name: "DAIKIN ZENA HWS IND 5KW R32",
  category: "units",
  brand: "Daikin",
  offers: [offer("aad", "AAD", "FTXZ50", "DAIKIN ZENA HWS IND 5KW R32", 150000)],
});
const fujitsu = product({
  key: "aad|ASTG09KMTC",
  name: "FUJITSU LIFESTYLE R/C HWS IND 2.5KW",
  category: "units",
  brand: "Fujitsu",
  offers: [offer("aad", "AAD", "ASTG09KMTC", "FUJITSU LIFESTYLE R/C HWS IND 2.5KW", 22248)],
});
const BOOK = [coil, small, daikin, daikinBig, fujitsu];

const answer = (body: unknown) => ({ json: async () => body }) as Response;

function serve(preferOk = true) {
  const posted: unknown[] = [];
  const asked: string[] = [];
  global.fetch = jest.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === "POST") {
      posted.push(JSON.parse(String(init.body)));
      return answer(preferOk ? { ok: true } : { ok: false, reason: "The price book needs money access." });
    }
    asked.push(url);
    return answer({ ok: true, products: BOOK });
  }) as unknown as typeof fetch;
  return { posted, asked };
}

it("opens on the parts on the most quotes, with every supplier's price", async () => {
  serve();
  render(<BookItems />);
  expect(await screen.findByText("PAIRED COIL 1/4+1/2X20M")).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Most used" })).toBeInTheDocument();
  expect(screen.getByText("9800006-1, PC1412. On 30 quotes")).toBeInTheDocument();
  /* a part on no quote isn't most used */
  expect(screen.queryByText("PAIRED COIL 1/4+3/8X20M")).toBeNull();
  /* the lowest price is in the state's green */
  expect(screen.getByRole("button", { name: "Prefer Reece's 9800006-1 at $180.00" })).toHaveClass("ok");
});

it("asks the server once: shelves and searches are sorted here", async () => {
  const { asked } = serve();
  render(<BookItems />);
  await screen.findByText("PAIRED COIL 1/4+1/2X20M");
  fireEvent.click(screen.getByRole("button", { name: "Pipe and coil 2" }));
  fireEvent.change(screen.getByLabelText("Search the price book"), { target: { value: "zena" } });
  fireEvent.click(screen.getByRole("button", { name: "Most used 1" }));
  expect(screen.getByText("DAIKIN ZENA HWS IND 2.5KW R32")).toBeInTheDocument();
  expect(asked).toEqual(["/api/quoting/price-book"]);
});

it("prefers a supplier's price at once, the server working out the part's other codes", async () => {
  const { posted } = serve();
  render(<BookItems />);
  const aad = await screen.findByRole("button", { name: "Prefer AAD's PC1412 at $191.00" });
  await act(async () => {
    fireEvent.click(aad);
  });
  expect(posted).toEqual([{ ref: "aad|PC1412", on: true }]);
  expect(screen.getByRole("button", { name: "Preferred AAD's PC1412 at $191.00" })).toHaveAttribute("aria-pressed", "true");
  expect(within(screen.getByRole("navigation", { name: "Price book views" })).getByRole("button", { name: "Preferred 1" })).toBeInTheDocument();
});

it("puts a refused preference back and says why", async () => {
  serve(false);
  render(<BookItems />);
  const aad = await screen.findByRole("button", { name: "Prefer AAD's PC1412 at $191.00" });
  await act(async () => {
    fireEvent.click(aad);
  });
  expect(screen.getByText("The price book needs money access.")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Prefer AAD's PC1412 at $191.00" })).toHaveAttribute("aria-pressed", "false");
});

it("shows a shelf as families that open onto their sizes", async () => {
  serve();
  render(<BookItems />);
  await screen.findByText("PAIRED COIL 1/4+1/2X20M");
  fireEvent.click(screen.getByRole("button", { name: "Pipe and coil 2" }));
  const family = screen.getByRole("button", { name: /Paired coil/ });
  expect(family).toHaveAttribute("aria-expanded", "false");
  expect(within(family).getByText("$157.47 to $180.00")).toBeInTheDocument();
  expect(screen.getByText("2 parts in 1 family")).toBeInTheDocument();
  expect(screen.queryByText("PAIRED COIL 1/4+3/8X20M")).not.toBeInTheDocument();
  fireEvent.click(family);
  expect(screen.getByText("PAIRED COIL 1/4+3/8X20M")).toBeInTheDocument();
});

/* Isaac, 2026-10-05: "the unit section is very messy. Needs to be sorted by brand" */
it("shows units by maker, A to Z, each maker's units by type in kW order", async () => {
  serve();
  render(<BookItems />);
  await screen.findByText("PAIRED COIL 1/4+1/2X20M");
  fireEvent.click(screen.getByRole("button", { name: "Units 3" }));
  expect(screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual(["Daikin2", "Fujitsu1"]);
  const daikinSection = screen.getByRole("region", { name: "Daikin" });
  fireEvent.click(within(daikinSection).getByRole("button", { name: /Wall split indoor/ }));
  expect(within(daikinSection).getAllByText(/DAIKIN ZENA/).map((e) => e.textContent)).toEqual(["DAIKIN ZENA HWS IND 2.5KW R32", "DAIKIN ZENA HWS IND 5KW R32"]);
});
