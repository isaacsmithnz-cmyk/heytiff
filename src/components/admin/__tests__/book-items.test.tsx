/* The price book's items: the most used first, a shelf in families that
   open onto their sizes, and a supplier's price pressed to prefer it — said
   at once, sent with the part's other codes, and put back if refused. */
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { BookItems } from "../book-items";
import type { BookView, Product } from "@/lib/quotes/families";

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
  jobLines: 0,
  bought: 0,
  ...over,
});

const coil = product({
  key: "aad|PC1412",
  name: "PAIRED COIL 1/4+1/2X20M",
  offers: [offer("reece", "Reece", "9800006-1", "ARDENT PR CU 1/4 X 1/2", 18000), offer("aad", "AAD", "PC1412", "PAIRED COIL 1/4+1/2X20M", 19100)],
  jobLines: 38,
  bought: 2,
});
const small = product({ key: "aad|PC1438", name: "PAIRED COIL 1/4+3/8X20M", offers: [offer("aad", "AAD", "PC1438", "PAIRED COIL 1/4+3/8X20M", 15747)] });

const counts = { used: 1, preferred: 0, shelves: [{ key: "pipe" as const, label: "Pipe and coil", count: 2 }] };
const USED: BookView = {
  sections: [{ key: "pipe", label: "Pipe and coil", families: [{ key: "PAIRED COIL", label: "Paired coil", products: [coil] }] }],
  total: 1,
  shown: 1,
};
const SHELF: BookView = {
  sections: [{ key: "pipe", label: "Pipe and coil", families: [{ key: "PAIRED COIL", label: "Paired coil", products: [small, coil] }] }],
  total: 2,
  shown: 2,
};

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
    /* a search reads only what matches, so it brings no counts */
    const searching = new URL(url, "http://x").searchParams.get("q");
    return answer({ ok: true, ...(url.includes("view=pipe") ? SHELF : USED), counts: searching ? null : counts });
  }) as unknown as typeof fetch;
  return { posted, asked };
}

it("opens on the most used, each part with how often it's used and every supplier's price", async () => {
  serve();
  render(<BookItems />);
  expect(await screen.findByText("PAIRED COIL 1/4+1/2X20M")).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Most used" })).toBeInTheDocument();
  expect(screen.getByText("9800006-1, PC1412. On 38 job lines, bought 2 times")).toBeInTheDocument();
  /* the lowest price is in the state's green */
  expect(screen.getByRole("button", { name: "Prefer Reece's 9800006-1 at $180.00" })).toHaveClass("ok");
});

it("prefers a supplier's price at once, sending the part's other codes to clear", async () => {
  const { posted } = serve();
  render(<BookItems />);
  const aad = await screen.findByRole("button", { name: "Prefer AAD's PC1412 at $191.00" });
  await act(async () => {
    fireEvent.click(aad);
  });
  /* the server works out the part's other codes; the page sends only its own */
  expect(posted).toEqual([{ ref: "aad|PC1412", on: true }]);
  const on = screen.getByRole("button", { name: "Preferred AAD's PC1412 at $191.00" });
  expect(on).toHaveAttribute("aria-pressed", "true");
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
  const { asked } = serve();
  render(<BookItems />);
  await screen.findByText("PAIRED COIL 1/4+1/2X20M");
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Pipe and coil 2" }));
  });
  expect(asked.at(-1)).toContain("view=pipe");
  const family = screen.getByRole("button", { name: /Paired coil/ });
  expect(family).toHaveAttribute("aria-expanded", "false");
  expect(within(family).getByText("$157.47 to $180.00")).toBeInTheDocument();
  expect(screen.getByText("2 parts in 1 family")).toBeInTheDocument();
  expect(screen.queryByText("PAIRED COIL 1/4+3/8X20M")).not.toBeInTheDocument();
  fireEvent.click(family);
  expect(screen.getByText("PAIRED COIL 1/4+3/8X20M")).toBeInTheDocument();
});

it("keeps the view chosen while the first one was still coming", async () => {
  let first: ((r: Response) => void) | null = null;
  global.fetch = jest.fn((url: string) =>
    url.includes("view=used")
      ? new Promise<Response>((done) => {
          first = done;
        })
      : Promise.resolve(answer({ ok: true, ...SHELF, counts }))
  ) as unknown as typeof fetch;
  render(<BookItems />);
  /* the rail has no shelves until an answer lands: open Preferred, then the first answer arrives late */
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Preferred" }));
  });
  expect(await screen.findByRole("heading", { name: "Preferred" })).toBeInTheDocument();
  await act(async () => {
    first!(answer({ ok: true, ...USED, counts: { ...counts, used: 7 } }));
  });
  expect(screen.getByRole("heading", { name: "Preferred" })).toBeInTheDocument();
  /* its counts are still the book's, and the rail takes them */
  expect(screen.getByRole("button", { name: "Most used 7" })).toBeInTheDocument();
  expect(screen.getByText("2 parts")).toBeInTheDocument();
});

it("keeps the rail's counts through a search, which can't count the shelves", async () => {
  serve();
  render(<BookItems />);
  await screen.findByText("PAIRED COIL 1/4+1/2X20M");
  jest.useFakeTimers();
  try {
    fireEvent.change(screen.getByLabelText("Search the price book"), { target: { value: "coil" } });
    await act(async () => {
      jest.advanceTimersByTime(300);
    });
  } finally {
    jest.useRealTimers();
  }
  expect(await screen.findByRole("heading", { name: "The whole price book" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Pipe and coil 2" })).toBeInTheDocument();
});
