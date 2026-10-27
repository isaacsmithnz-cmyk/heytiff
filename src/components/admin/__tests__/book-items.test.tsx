/* The price book's items: the whole book once, then Most used (by quotes),
   a shelf in families, units by maker and type, and a search — all sorted
   in the browser with nothing more asked of the server. A part is a row of
   the table, with what it costs and what it sells at; opened, every
   supplier's price, and Make preferred puts one forward at once, put back
   if refused. */
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BookItems } from "../book-items";
import { countsOf, type Product } from "@/lib/quotes/families";
import { packBook, type FirstBook } from "@/lib/quotes/book-pack";

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
  offers: [offer("reece", "Reece", "9800006-1", "ARDENT PR CU 1/4 X 1/2 20M", 18000), offer("aad", "AAD", "PC1412", "PAIRED COIL 1/4+1/2X20M", 19100)],
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

/** The route: the book packed, as it goes over the wire. `book: "never"`
    holds it back for good, `book: "fail"` refuses it. */
function serve(preferOk = true, book: "ok" | "never" | "fail" = "ok") {
  const posted: unknown[] = [];
  const asked: string[] = [];
  global.fetch = jest.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === "POST") {
      posted.push(JSON.parse(String(init.body)));
      return answer(preferOk ? { ok: true } : { ok: false, reason: "The price book needs money access." });
    }
    asked.push(url);
    if (book === "never") return new Promise<Response>(() => {});
    if (book === "fail") return answer({ ok: false });
    return answer({ ok: true, book: packBook(BOOK) });
  }) as unknown as typeof fetch;
  return { posted, asked };
}

/** What the page sends: the Most used parts and the chooser's counts. */
const FIRST: FirstBook = { used: [coil], counts: countsOf(BOOK) };

const show = async (user: ReturnType<typeof userEvent.setup>, option: string) => {
  await user.click(screen.getByRole("combobox", { name: "Show" }));
  await user.click(within(screen.getByRole("listbox")).getByRole("option", { name: option }));
};

it("opens on the parts on the most quotes, the item a quote takes and what it sells at", async () => {
  serve();
  render(<BookItems markupPct={40} />);
  const name = await screen.findByRole("button", { name: "PAIRED COIL 1/4+1/2X20M" });
  expect(screen.getByRole("combobox", { name: "Show" })).toHaveTextContent("Most used");
  const row = name.closest(".st2-pb-row") as HTMLElement;
  /* the lowest is what a quote takes: Reece's, a 20 m roll, sold by the metre at 40% */
  expect(within(row).getByText("9800006-1, 20 m, on 30 quotes")).toBeInTheDocument();
  expect(within(row).getByText("Reece and 1 more")).toBeInTheDocument();
  expect(within(row).getByText("$180.00")).toBeInTheDocument();
  expect(within(row).getByText("$12.60 a metre")).toBeInTheDocument();
  /* a part on no quote isn't most used */
  expect(screen.queryByText("PAIRED COIL 1/4+3/8X20M")).toBeNull();
});

it("opens a part onto every supplier's price, the lowest in the state's green", async () => {
  serve();
  render(<BookItems />);
  fireEvent.click(await screen.findByRole("button", { name: "PAIRED COIL 1/4+1/2X20M" }));
  const offers = within(screen.getByRole("list", { name: "PAIRED COIL 1/4+1/2X20M at each supplier" }));
  expect(offers.getAllByRole("listitem")).toHaveLength(2);
  expect(offers.getByText("$180.00")).toHaveClass("st2-pb-low");
  expect(offers.getByText("$191.00")).not.toHaveClass("st2-pb-low");
  /* no markup set: nothing is said to sell at a figure of ours */
  expect(screen.queryByText(/a metre$/)).toBeNull();
});

it("asks the server once: shelves and searches are sorted here", async () => {
  const user = userEvent.setup();
  const { asked } = serve();
  render(<BookItems />);
  await screen.findByRole("button", { name: "PAIRED COIL 1/4+1/2X20M" });
  await show(user, "Pipe and coil");
  fireEvent.change(screen.getByLabelText("Search the price book"), { target: { value: "zena" } });
  await show(user, "Most used");
  expect(screen.getByText("DAIKIN ZENA HWS IND 2.5KW R32")).toBeInTheDocument();
  expect(asked).toEqual(["/api/quoting/price-book"]);
});

it("prefers a supplier's price at once, the server working out the part's other codes", async () => {
  const user = userEvent.setup();
  const { posted } = serve();
  render(<BookItems />);
  fireEvent.click(await screen.findByRole("button", { name: "PAIRED COIL 1/4+1/2X20M" }));
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Prefer AAD's PC1412 at $191.00" }));
  });
  expect(posted).toEqual([{ ref: "aad|PC1412", on: true }]);
  expect(screen.getAllByText("Preferred")).toHaveLength(2);
  expect(screen.getByRole("button", { name: "Stop preferring AAD's PC1412" })).toBeInTheDocument();
  /* the row now shows the preferred item, not the lowest */
  const row = screen.getByRole("button", { name: "PAIRED COIL 1/4+1/2X20M" }).closest(".st2-pb-row") as HTMLElement;
  expect(within(row).getByText("$191.00")).toBeInTheDocument();
  /* and the preferred view holds it */
  await show(user, "Preferred");
  expect(screen.getByRole("button", { name: "PAIRED COIL 1/4+1/2X20M" })).toBeInTheDocument();
});

it("puts a refused preference back and says why", async () => {
  serve(false);
  render(<BookItems />);
  fireEvent.click(await screen.findByRole("button", { name: "PAIRED COIL 1/4+1/2X20M" }));
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Prefer AAD's PC1412 at $191.00" }));
  });
  expect(screen.getByRole("alert")).toHaveTextContent("The price book needs money access.");
  expect(screen.getByRole("button", { name: "Prefer AAD's PC1412 at $191.00" })).toBeInTheDocument();
  expect(screen.queryByText("Preferred")).toBeNull();
});

it("shows a shelf as families that open onto their sizes", async () => {
  const user = userEvent.setup();
  serve();
  render(<BookItems />);
  await screen.findByRole("button", { name: "PAIRED COIL 1/4+1/2X20M" });
  await show(user, "Pipe and coil");
  const family = screen.getByRole("button", { name: /Paired coil/ });
  expect(family).toHaveAttribute("aria-expanded", "false");
  const row = family.closest(".st2-pb-row") as HTMLElement;
  expect(within(row).getByText("$157.47 to $180.00")).toBeInTheDocument();
  expect(within(row).getByText("2 sizes")).toBeInTheDocument();
  expect(screen.queryByText("PAIRED COIL 1/4+3/8X20M")).not.toBeInTheDocument();
  fireEvent.click(family);
  expect(screen.getByText("PAIRED COIL 1/4+3/8X20M")).toBeInTheDocument();
});

/* Isaac, 2026-10-05: "the unit section is very messy. Needs to be sorted by brand" */
it("shows units by maker, A to Z, each maker's units by type in kW order", async () => {
  const user = userEvent.setup();
  serve();
  render(<BookItems />);
  await screen.findByRole("button", { name: "PAIRED COIL 1/4+1/2X20M" });
  await show(user, "Units");
  expect(screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual(["Daikin", "Fujitsu"]);
  const daikinSection = screen.getByRole("region", { name: "Daikin" });
  fireEvent.click(within(daikinSection).getByRole("button", { name: /Wall split indoor/ }));
  expect(within(daikinSection).getAllByText(/DAIKIN ZENA/).map((e) => e.textContent)).toEqual(["DAIKIN ZENA HWS IND 2.5KW R32", "DAIKIN ZENA HWS IND 5KW R32"]);
});

it("says when nothing matches a search", async () => {
  serve();
  render(<BookItems />);
  await screen.findByRole("button", { name: "PAIRED COIL 1/4+1/2X20M" });
  fireEvent.change(screen.getByLabelText("Search the price book"), { target: { value: "nothing like this" } });
  expect(screen.getByText("Nothing in the price book matches")).toBeInTheDocument();
});

/* The page sends the Most used parts the tab opens on (27 October 2026,
   "make it fast"): the table draws from them while the whole book is still
   on its way, and the book follows from the route, packed. */
it("draws Most used from the page's read while the book is still coming", async () => {
  const user = userEvent.setup();
  const { asked } = serve(true, "never");
  render(<BookItems markupPct={40} first={Promise.resolve(FIRST)} />);
  const name = await screen.findByRole("button", { name: "PAIRED COIL 1/4+1/2X20M" });
  expect(within(name.closest(".st2-pb-row") as HTMLElement).getByText("$12.60 a metre")).toBeInTheDocument();
  /* the chooser already knows the shelves, from the server's counts */
  await show(user, "Units");
  /* a shelf needs the whole book, and says it's waiting for it (after the
     Loading part's half second, rule 41) */
  expect(await screen.findByRole("status", {}, { timeout: 2000 })).toHaveTextContent("Reading the whole price book");
  expect(asked).toEqual(["/api/quoting/price-book"]);
});

it("searches once the whole book lands", async () => {
  serve();
  render(<BookItems first={Promise.resolve(FIRST)} />);
  await screen.findByRole("button", { name: "PAIRED COIL 1/4+1/2X20M" });
  fireEvent.change(screen.getByLabelText("Search the price book"), { target: { value: "zena" } });
  expect(await screen.findByText("DAIKIN ZENA HWS IND 2.5KW R32")).toBeInTheDocument();
});

it("keeps a preference made before the book landed when it lands", async () => {
  let land: (r: Response) => void = () => {};
  const posted: unknown[] = [];
  global.fetch = jest.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === "POST") {
      posted.push(JSON.parse(String(init.body)));
      return answer({ ok: true });
    }
    return new Promise<Response>((r) => (land = r));
  }) as unknown as typeof fetch;
  render(<BookItems first={Promise.resolve(FIRST)} />);
  fireEvent.click(await screen.findByRole("button", { name: "PAIRED COIL 1/4+1/2X20M" }));
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Prefer AAD's PC1412 at $191.00" }));
  });
  expect(posted).toEqual([{ ref: "aad|PC1412", on: true }]);
  /* the book was read before the press, so it doesn't know */
  await act(async () => {
    land(answer({ ok: true, book: packBook(BOOK) }));
  });
  expect(screen.getByRole("button", { name: "Stop preferring AAD's PC1412" })).toBeInTheDocument();
});

it("still draws Most used when the book can't be read, and says so on a search", async () => {
  serve(true, "fail");
  render(<BookItems first={Promise.resolve(FIRST)} />);
  await screen.findByRole("button", { name: "PAIRED COIL 1/4+1/2X20M" });
  fireEvent.change(screen.getByLabelText("Search the price book"), { target: { value: "zena" } });
  expect(await screen.findByText(/couldn.t be read/)).toBeInTheDocument();
});

it("draws from the book when the page's read fails", async () => {
  serve();
  render(<BookItems first={Promise.reject(new Error("down"))} />);
  expect(await screen.findByRole("button", { name: "PAIRED COIL 1/4+1/2X20M" })).toBeInTheDocument();
});

it("says so when nothing can be read", async () => {
  serve(true, "fail");
  render(<BookItems first={Promise.reject(new Error("down"))} />);
  expect(await screen.findByText(/couldn.t be read/)).toBeInTheDocument();
});

/* What the browser really gets from the page: React's own thenable, whose
   `then` calls back and returns nothing. Chaining `.catch` on it threw and
   the whole page fell to its error screen (26 October 2026). */
it("draws from React's own thenable, whose then returns nothing", async () => {
  serve(true, "never");
  const flight = { then: (ok: (v: FirstBook) => void) => void ok(FIRST) } as unknown as Promise<FirstBook>;
  render(<BookItems markupPct={40} first={flight} />);
  expect(await screen.findByRole("button", { name: "PAIRED COIL 1/4+1/2X20M" })).toBeInTheDocument();
});
