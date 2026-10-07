import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { priceBuildUp } from "@/lib/quotes/buildup";
import type { QuoteLine } from "@/lib/quotes/lines";
import { buildLineOf } from "@/lib/quotes/lines-price";
import type { QuotePrice } from "@/lib/quotes/quote-price-server";
import { QuoteLinesFace } from "../quote-lines-face";

/* The quote by hand on its kept lines (the engine rebuild, slice 2.3, to
   Isaac's mock-ups of 7 October), on 3377's downstairs units. */

const settings = { unitMarkupPct: 25, materialMarkupPct: 40, chargeOutCents: 14000, dayHours: 8, contingency: null };
const line = (o: Partial<QuoteLine>): QuoteLine => ({
  id: "l1",
  version: 1,
  updatedAt: "",
  updatedBy: "u-isaac",
  optionIndex: 0,
  system: "Downstairs",
  group: "Units",
  position: 0,
  name: "Ducted indoor, under the floor",
  code: "PEA-M125HAA",
  supplierKey: "mitsubishi",
  kind: "unit",
  qty: 1,
  unit: "",
  costCents: 106750,
  sellCents: null,
  source: "said",
  why: "“underfloor ducted 10 to 12 kW”",
  duct: false,
  ...o,
});
const indoor = line({});
const core = line({ id: "l2", system: "Core holes", group: "Core holes", name: "Core hole 200 mm", code: null, supplierKey: null, kind: "material", costCents: 0, source: "unknown", why: "" });
const build = priceBuildUp([buildLineOf(indoor)], [], settings);
const price: QuotePrice = { ok: true, options: [{ name: "Option 1", build, unpriced: [{ name: "Core hole 200 mm", qty: "1", why: "Not known yet" }], rows: 2, labourFrom: "none", profit: { costCents: 106750, profitCents: 26688, pct: 20, targetPct: 20, hourCostCents: 11200, short: null } }] };

let posted: Record<string, unknown>[] = [];
const view = (lines: QuoteLine[]) => ({
  ok: true,
  engine: "lines",
  lines,
  changes: [{ id: 7, lineId: "l1", action: "change", before: { qty: 2 }, after: { qty: 1 }, why: "", madeBy: "u-luke", madeAt: "2026-10-08T00:00:00Z" }],
  names: { "u-luke": "Luke Bennett" },
  me: "u-isaac",
});

beforeEach(() => {
  posted = [];
  (global as unknown as { fetch: unknown }).fetch = jest.fn(async (url: string, init?: { body?: string }) => ({
    json: async () => {
      if (init?.body) posted.push(JSON.parse(init.body));
      if (String(url).startsWith("/api/workboard/quote-lookup"))
        return { ok: true, hits: [{ product: { key: "aad|CMADJ", name: "ANTI VIBRATION FEET", category: "parts", offers: [], cheapest: { supplierKey: "aad", supplierName: "AAD", code: "CMADJ", name: "ANTI VIBRATION FEET", netCents: 1372 }, preferred: null, brand: null, quotes: 3 }, why: "On your quotes", buyCents: 1372 }] };
      return view([indoor, core]);
    },
  }));
});

const face = (onPriced = jest.fn()) => render(<QuoteLinesFace job="job-3377" price={price} actionsEl={null} onPriced={onPriced} onSwitchBack={jest.fn()} />);

it("shows the total in its card, each system with its total, and every line's qty, cost and sell", async () => {
  face();
  expect(await screen.findByText("Ducted indoor, under the floor")).toBeInTheDocument();
  expect(document.querySelector(".ql-tot b")).toHaveTextContent("$1,334.38");
  expect(screen.getByText("Profit $266.88, 20%")).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Downstairs" })).toBeInTheDocument();
  expect(screen.getByLabelText("Quantity of Ducted indoor, under the floor")).toHaveValue("1");
  expect(screen.getByLabelText("What one Ducted indoor, under the floor costs you")).toHaveValue("1067.50");
  expect(screen.getByLabelText("What one Ducted indoor, under the floor sells for")).toHaveValue("1334.38");
  /* a line nobody knows the price of shows a dash, never $0 */
  expect(screen.getByRole("heading", { name: "Core holes" })).toBeInTheDocument();
  expect(screen.getAllByText("—")).toHaveLength(1);
  /* the progress line from the lines: the core hole, and labour nobody's set */
  expect(screen.getByText("1 unknown")).toBeInTheDocument();
  expect(screen.getByText("2 to price")).toBeInTheDocument();
});

it("changes a line against the version it was read at, and reads the price again", async () => {
  const onPriced = jest.fn();
  face(onPriced);
  const qty = await screen.findByLabelText("Quantity of Ducted indoor, under the floor");
  fireEvent.change(qty, { target: { value: "2" } });
  await act(async () => {
    fireEvent.blur(qty);
  });
  expect(posted).toContainEqual({ job: "job-3377", op: "change", id: "l1", version: 1, patch: { qty: 2 } });
  expect(onPriced).toHaveBeenCalled();
});

it("a sell price cleared goes back to the markup", async () => {
  face();
  const sell = await screen.findByLabelText("What one Ducted indoor, under the floor sells for");
  fireEvent.change(sell, { target: { value: "" } });
  await act(async () => {
    fireEvent.blur(sell);
  });
  expect(posted).toContainEqual({ job: "job-3377", op: "change", id: "l1", version: 1, patch: { sellCents: null } });
});

it("adds a line from the book, searched as the business buys", async () => {
  face();
  await screen.findByText("Ducted indoor, under the floor");
  await act(async () => {
    fireEvent.change(screen.getByLabelText("Search your book for a line to add"), { target: { value: "feet" } });
  });
  await act(async () => {
    fireEvent.click(await screen.findByRole("button", { name: /ANTI VIBRATION FEET/ }));
  });
  await waitFor(() =>
    expect(posted).toContainEqual(expect.objectContaining({ op: "add", line: expect.objectContaining({ name: "ANTI VIBRATION FEET", code: "CMADJ", costCents: 1372, kind: "material", group: "Materials" }) }))
  );
});

it("lists every change with who made it, and undoes one", async () => {
  face();
  expect(await screen.findByText("Luke Bennett")).toBeInTheDocument();
  expect(screen.getByText("changed qty")).toBeInTheDocument();
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
  });
  expect(posted).toContainEqual({ job: "job-3377", op: "undo", change: 7 });
});

it("takes a line off with its version", async () => {
  face();
  await screen.findByText("Ducted indoor, under the floor");
  await act(async () => {
    fireEvent.click(screen.getByLabelText("Take Ducted indoor, under the floor off"));
  });
  expect(posted).toContainEqual({ job: "job-3377", op: "remove", id: "l1", version: 1 });
});

/* kits as data, slice 1.3: a whole install kit in one press */
it("adds a kit for a system: the outdoor named, the runs given, the rest read off its data pack", async () => {
  face();
  await screen.findByText("Ducted indoor, under the floor");
  fireEvent.click(screen.getByRole("button", { name: "Add a kit" }));
  fireEvent.change(screen.getByLabelText("The system it's for"), { target: { value: "Living room" } });
  fireEvent.change(screen.getByLabelText("Outdoor model"), { target: { value: "MUZ-AP60VG2" } });
  fireEvent.change(screen.getByLabelText("Pipe run"), { target: { value: "20" } });
  fireEvent.change(screen.getByLabelText("Power run"), { target: { value: "25" } });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Add the kit" }));
  });
  expect(posted).toContainEqual(
    expect.objectContaining({
      op: "kit",
      kit: "split",
      optionIndex: 0,
      system: "Living room",
      brand: "mitsubishi-electric",
      model: "MUZ-AP60VG2",
      facts: expect.objectContaining({ pipeM: "20", powerM: "25", pipe: "", mount: "ground" }),
    })
  );
});
