import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
const price: QuotePrice = { ok: true, options: [{ name: "Option 1", build, unpriced: [{ name: "Core hole 200 mm", qty: "1", why: "Not known yet" }], rows: 2, labourFrom: "none", profit: { costCents: 106750, profitCents: 26688, pct: 20, targetPct: 20, hourCostCents: 11200, short: null } }], chargeOutCents: 14000 };
/* the indoor unit and a day's labour, every line priced: Approve shows (layout C) */
const wholeBuild = priceBuildUp([buildLineOf(indoor)], [{ stage: "Install", people: 1, days: 1 }], settings);
const pricedWhole: QuotePrice = { ok: true, options: [{ name: "Option 1", build: wholeBuild, unpriced: [], rows: 2, labourFrom: "you", profit: { costCents: 106750, profitCents: 26688, pct: 20, targetPct: 20, hourCostCents: 11200, short: null } }], chargeOutCents: 14000 };

let posted: Record<string, unknown>[] = [];
const view = (lines: QuoteLine[]) => ({
  ok: true,
  engine: "lines",
  lines,
  changes: [
    { id: 7, lineId: "l1", action: "change", before: { qty: 2 }, after: { qty: 1 }, why: "", madeBy: "u-luke", madeAt: "2026-10-08T00:00:00Z" },
    { id: 6, lineId: "l2", action: "add", before: null, after: { name: "Core hole 200 mm" }, why: "“thick sandstone”", madeBy: "tiff", madeAt: "2026-10-07T23:00:00Z" },
  ],
  names: { "u-luke": "Luke Bennett" },
  me: "u-isaac",
  packs: [
    { key: "daikin", name: "Daikin" },
    { key: "mitsubishi-electric", name: "Mitsubishi Electric" },
  ],
});

beforeEach(() => {
  posted = [];
  (global as unknown as { fetch: unknown }).fetch = jest.fn(async (url: string, init?: { body?: string }) => {
    if (init?.body) posted.push(JSON.parse(init.body));
    return {
    json: async () => {
      if (String(url).startsWith("/api/workboard/quote-lookup"))
        return { ok: true, hits: [{ product: { key: "aad|CMADJ", name: "ANTI VIBRATION FEET", category: "parts", offers: [], cheapest: { supplierKey: "aad", supplierName: "AAD", code: "CMADJ", name: "ANTI VIBRATION FEET", netCents: 1372 }, preferred: null, brand: null, quotes: 3 }, why: "On your quotes", buyCents: 1372 }] };
      return view([indoor, core]);
    },
  };
  });
});

const face = (onPriced = jest.fn()) => render(<QuoteLinesFace job="job-3377" price={price} onPriced={onPriced} />);
/* every group starts shut (Isaac, 2026-10-15): a test that reads a line
   opens its group first, as a person would; one that only needs the lines
   read waits for a group's band */
const openGroup = async (name: string) => fireEvent.click(await screen.findByRole("button", { name, expanded: false }));
const linesRead = () => screen.findByRole("button", { name: "Units" });

it("shows the total in its card, each system with its total, and every line's qty, cost and sell", async () => {
  face();
  await openGroup("Units");
  await openGroup("Core holes");
  expect(screen.getByText("Ducted indoor, under the floor")).toBeInTheDocument();
  /* the rail's card: the total, and the profit as a figure; with the core
     hole and the labour still to price, both are so far, and the profit
     claims no state against the target */
  const card = within(screen.getByRole("region", { name: "The quote" }));
  expect(card.getByText("Total ex GST, so far").nextElementSibling).toHaveTextContent("$1,334.38");
  expect(card.getByText("$1,467.82 inc GST")).toBeInTheDocument();
  const profit = card.getByText("20%, $266.88").closest(".qp-profit")!;
  expect(profit.querySelector(".pt-state")).toBeNull();
  expect(profit).toHaveTextContent(/^Profitso far/);
  expect(card.queryByText(/your 20%/)).toBeNull();
  expect(screen.getByRole("heading", { name: "Downstairs" })).toBeInTheDocument();
  expect(screen.getByLabelText("Quantity of Ducted indoor, under the floor")).toHaveValue("1");
  expect(screen.getByLabelText("What one Ducted indoor, under the floor costs you")).toHaveValue("1067.50");
  expect(screen.getByLabelText("What one Ducted indoor, under the floor sells for")).toHaveValue("1334.38");
  /* a line nobody knows the price of shows a dash, never $0 */
  expect(screen.getByRole("heading", { name: "Core holes" })).toBeInTheDocument();
  expect(screen.getAllByText("—")).toHaveLength(1);
  /* what's left, said once under Approve quote (layout B): the core hole,
     and labour nobody's set */
  expect(screen.getByText("2 lines to price")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Approve quote" })).toBeDisabled();
});

/* Isaac, 2026-10-15: "when you hit view line items, I think have everything
   collapsed first… so it doesn't take up so much space. Collapsed with the
   total next to it" */
describe("every group starts shut", () => {
  const band = (name: string) => screen.getByRole("button", { name }).closest("tr")!;

  it("shows each group as its name and its total on one band, and none of its lines", async () => {
    face();
    const units = await screen.findByRole("button", { name: "Units" });
    expect(units).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByRole("button", { name: "Core holes" })).toHaveAttribute("aria-expanded", "false");
    expect(band("Units")).toHaveTextContent(/^Units\$1,334\.38$/);
    expect(band("Core holes")).toHaveTextContent(/^Core holes\$0\.00$/);
    /* the rows it opens are named, and hold nothing while it's shut */
    expect(document.getElementById(units.getAttribute("aria-controls")!)).toBeEmptyDOMElement();
    expect(screen.queryByLabelText("Quantity of Ducted indoor, under the floor")).toBeNull();
    expect(screen.queryByLabelText("Quantity of Core hole 200 mm")).toBeNull();
    /* the system's own total stands as it was */
    expect(within(screen.getByRole("region", { name: "Downstairs" })).getByRole("heading", { name: "Downstairs" }).nextElementSibling).toHaveTextContent("$1,334.38");
  });

  it("opens a group on a press, its lines in the rows it names, and shuts it from anywhere on its band", async () => {
    face();
    const units = await screen.findByRole("button", { name: "Units" });
    fireEvent.click(units);
    expect(units).toHaveAttribute("aria-expanded", "true");
    const rows = document.getElementById(units.getAttribute("aria-controls")!)!;
    expect(within(rows).getByLabelText("Quantity of Ducted indoor, under the floor")).toHaveValue("1");
    /* the others stay shut */
    expect(screen.getByRole("button", { name: "Core holes" })).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByLabelText("Quantity of Core hole 200 mm")).toBeNull();
    /* its total is the band's too */
    fireEvent.click(within(band("Units")).getByText("$1,334.38"));
    expect(units).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByLabelText("Quantity of Ducted indoor, under the floor")).toBeNull();
  });

  it("opens the group a line just added lands in, and leaves the others shut", async () => {
    const byHand = line({ id: "l5", system: "", group: "Materials", name: "A line by hand", code: null, supplierKey: null, kind: "material", costCents: 0, source: "by_hand", why: "" });
    (global as unknown as { fetch: unknown }).fetch = jest.fn(async (_url: string, init?: { body?: string }) => {
      if (init?.body) posted.push(JSON.parse(init.body));
      return { json: async () => view(init?.body ? [indoor, core, byHand] : [indoor, core]) };
    });
    face();
    await linesRead();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Add a line by hand" }));
    });
    expect(posted).toContainEqual(expect.objectContaining({ op: "add", line: expect.objectContaining({ group: "Materials" }) }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Materials" })).toHaveAttribute("aria-expanded", "true"));
    expect(screen.getByLabelText("Quantity of A line by hand")).toHaveValue("1");
    expect(screen.getByRole("button", { name: "Units" })).toHaveAttribute("aria-expanded", "false");
  });

  it("shows a tech how many lines a group holds where its total would stand", async () => {
    const outdoor = line({ id: "od", name: "Outdoor, single phase", code: "PUZ-M125VKA2", costCents: 0 });
    (global as unknown as { fetch: unknown }).fetch = jest.fn(async () => ({ json: async () => ({ ...view([{ ...indoor, costCents: 0 }, outdoor, core]), money: false }) }));
    render(<QuoteLinesFace job="job-3377" price={null} onPriced={jest.fn()} money={false} />);
    await linesRead();
    expect(band("Units")).toHaveTextContent(/^Units2 lines$/);
    expect(band("Core holes")).toHaveTextContent(/^Core holes1 line$/);
  });
});

it("changes a line against the version it was read at, and reads the price again", async () => {
  const onPriced = jest.fn();
  face(onPriced);
  await openGroup("Units");
  const qty = screen.getByLabelText("Quantity of Ducted indoor, under the floor");
  fireEvent.change(qty, { target: { value: "2" } });
  await act(async () => {
    fireEvent.blur(qty);
  });
  expect(posted).toContainEqual({ job: "job-3377", op: "change", id: "l1", version: 1, patch: { qty: 2 } });
  expect(onPriced).toHaveBeenCalled();
});

it("a sell price cleared goes back to the markup", async () => {
  face();
  await openGroup("Units");
  const sell = screen.getByLabelText("What one Ducted indoor, under the floor sells for");
  fireEvent.change(sell, { target: { value: "" } });
  await act(async () => {
    fireEvent.blur(sell);
  });
  expect(posted).toContainEqual({ job: "job-3377", op: "change", id: "l1", version: 1, patch: { sellCents: null } });
});

it("adds a line from the book, searched as the business buys", async () => {
  face();
  await linesRead();
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

/* Isaac, 2026-10-15: "[MITSUBISHI ELEC. DUCT OUT 10KW 1P R32]. That's like
   a line code from a supplier… simplified to indoor unit, outdoor unit" */
it("adds a unit from the book named by what it is, its model the code", async () => {
  const shown = (global as unknown as { fetch: jest.Mock }).fetch.getMockImplementation()!;
  const outdoor = { supplierKey: "aad", supplierName: "AAD", code: "PUZ-ZM100VKA2", name: "MITSUBISHI ELEC. DUCT OUT 10KW 1P R32", netCents: 310000 };
  (global as unknown as { fetch: jest.Mock }).fetch.mockImplementation(async (url: string, init?: { body?: string }) =>
    String(url).startsWith("/api/workboard/quote-lookup")
      ? { json: async () => ({ ok: true, hits: [{ product: { key: "aad|PUZ-ZM100VKA2", name: outdoor.name, category: "units", offers: [outdoor], cheapest: outdoor, preferred: null, brand: "Mitsubishi Electric", quotes: 0 }, why: "In your book", buyCents: 310000 }] }) }
      : shown(url, init)
  );
  face();
  await openGroup("Units");
  await screen.findByText("Ducted indoor, under the floor");
  await act(async () => {
    fireEvent.change(screen.getByLabelText("Search your book for a line to add"), { target: { value: "duct out" } });
  });
  await act(async () => {
    fireEvent.click(await screen.findByRole("button", { name: /DUCT OUT 10KW/ }));
  });
  await waitFor(() =>
    expect(posted).toContainEqual(expect.objectContaining({ op: "add", line: expect.objectContaining({ name: "Outdoor unit", code: "PUZ-ZM100VKA2", kind: "unit", group: "Units" }) }))
  );
});

it("lists every change with who made it, and undoes one", async () => {
  face();
  expect(await screen.findByText("Luke Bennett")).toBeInTheDocument();
  expect(screen.getByText("changed qty")).toBeInTheDocument();
  /* Tiff's own changes say they're hers */
  expect(screen.getByText("Tiff")).toBeInTheDocument();
  await act(async () => {
    fireEvent.click(screen.getAllByRole("button", { name: "Undo" })[0]!);
  });
  expect(posted).toContainEqual({ job: "job-3377", op: "undo", change: 7 });
});

it("takes a line off with its version", async () => {
  face();
  await openGroup("Units");
  await act(async () => {
    fireEvent.click(screen.getByLabelText("Take Ducted indoor, under the floor off"));
  });
  expect(posted).toContainEqual({ job: "job-3377", op: "remove", id: "l1", version: 1 });
});

/* kits as data, slice 1.3: a whole install kit in one press */
it("adds a kit for a system: the outdoor named, the runs given, the rest read off its data pack", async () => {
  face();
  await linesRead();
  fireEvent.click(screen.getByRole("button", { name: "Add a kit" }));
  /* every installed pack, and none of them anyone's default (2026-10-15) */
  const pack = screen.getByLabelText("The outdoor's data pack");
  expect(pack).toHaveValue("");
  expect(within(pack).getAllByRole("option").map((o) => o.textContent)).toEqual(["None", "Daikin", "Mitsubishi Electric"]);
  fireEvent.change(pack, { target: { value: "mitsubishi-electric" } });
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
  /* a split has no zones */
  expect((posted.find((p) => p.op === "kit")!.facts as Record<string, unknown>)).not.toHaveProperty("zones");
  expect(screen.queryByLabelText("Zones")).toBeNull();
});

/* a zoned ducted kit, as Tiff's add_kit gives it (2026-10-13): the zones a
   whole number, the control by its word, WiFi yes or no */
it("adds a zoned ducted kit with its zones, their control and WiFi, as Tiff's tool gives them", async () => {
  face();
  await linesRead();
  fireEvent.click(screen.getByRole("button", { name: "Add a kit" }));
  fireEvent.change(screen.getByLabelText("Kit"), { target: { value: "ducted" } });
  /* the zone system is read off the unit's pack: named, as a zoned kit needs */
  fireEvent.change(screen.getByLabelText("The outdoor's data pack"), { target: { value: "mitsubishi-electric" } });
  fireEvent.change(screen.getByLabelText("Outdoor model"), { target: { value: "PUZ-ZM100YKA" } });
  /* a whole number: the keypad without a point */
  expect(screen.getByLabelText("Zones")).toHaveAttribute("inputmode", "numeric");
  fireEvent.change(screen.getByLabelText("Zones"), { target: { value: "5" } });
  fireEvent.change(screen.getByLabelText("Zone control"), { target: { value: "on_off" } });
  fireEvent.change(screen.getByLabelText("WiFi"), { target: { value: "yes" } });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Add the kit" }));
  });
  const sent = posted.find((p) => p.op === "kit")!;
  expect(sent).toMatchObject({ kit: "ducted", brand: "mitsubishi-electric", model: "PUZ-ZM100YKA", facts: { zones: 5, zoneControl: "on_off", wifi: true } });
  /* none said: none sent, and WiFi no */
  posted = [];
  fireEvent.click(screen.getByRole("button", { name: "Add a kit" }));
  fireEvent.change(screen.getByLabelText("Kit"), { target: { value: "ducted" } });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Add the kit" }));
  });
  const plain = posted.find((p) => p.op === "kit")!.facts as Record<string, unknown>;
  expect(plain).not.toHaveProperty("zones");
  expect(plain).toMatchObject({ zoneControl: "temperature", wifi: false });
});

/* options as whole jobs, slice 10.1 */
it("copies option 1 to a new option, and says what an option changed from it", async () => {
  const bigger = line({ id: "l9", optionIndex: 1, name: "XL Premium 9.5", code: "FTXM95WVMA", costCents: 76007 });
  const sameCore = { ...core, id: "l10", optionIndex: 1 };
  (global as unknown as { fetch: jest.Mock }).fetch = jest.fn(async (_url: string, init?: { body?: string }) => ({
    json: async () => {
      if (init?.body) posted.push(JSON.parse(init.body));
      return view([indoor, core, bigger, sameCore]);
    },
  }));
  face();
  await linesRead();
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Copy option 1 to a new option" }));
  });
  expect(posted).toContainEqual({ job: "job-3377", op: "copy", from: 0, to: 2 });
  fireEvent.click(screen.getByRole("tab", { name: /Option 2/ }));
  await openGroup("Units");
  expect(screen.getByText("Added")).toBeInTheDocument();
  expect(screen.getByText("Not in this option: Ducted indoor, under the floor")).toBeInTheDocument();
});

/* Select preferred item, slice 2.4 */
it("swaps a line for another item of its kind from the book, and makes it preferred from the next quote", async () => {
  face();
  await openGroup("Units");
  fireEvent.click(screen.getByRole("button", { name: "Ducted indoor, under the floor" }));
  expect(screen.getByLabelText("Search your book for another Ducted indoor, under the floor")).toHaveValue("Ducted indoor");
  const pick = await screen.findByRole("button", { name: /ANTI VIBRATION FEET/ }, { timeout: 2000 });
  await act(async () => {
    fireEvent.click(pick);
  });
  await waitFor(() =>
    expect(posted).toContainEqual({
      job: "job-3377",
      op: "change",
      id: "l1",
      version: 1,
      patch: { name: "ANTI VIBRATION FEET", code: "CMADJ", supplierKey: "aad", costCents: 1372, sellCents: null },
      why: "Select preferred item",
    })
  );
  await waitFor(() => expect(posted.map((b) => b.ref ?? b.op)).toContain("aad|CMADJ"));
});

/* Isaac, 2026-10-15: a multi's head, "indoor unit study, then model" */
it("keeps a unit named by what it is, in its room, when another unit is picked for it", async () => {
  const head = line({ id: "h1", name: "Indoor unit, Bed 1", code: "MSZ-AP25VGD2", kind: "unit" });
  const bigger = { supplierKey: "aad", supplierName: "AAD", code: "MSZ-AP35VGD2", name: "MITSUBISHI ELEC. HWS IND 3.5KW", netCents: 120000 };
  (global as unknown as { fetch: jest.Mock }).fetch = jest.fn(async (url: string, init?: { body?: string }) => {
    if (init?.body) posted.push(JSON.parse(init.body));
    return {
      json: async () =>
        String(url).startsWith("/api/workboard/quote-lookup")
          ? { ok: true, hits: [{ product: { key: "aad|MSZ-AP35VGD2", name: bigger.name, category: "units", offers: [bigger], cheapest: bigger, preferred: null, brand: "Mitsubishi Electric", quotes: 0 }, why: "In your book", buyCents: 120000 }] }
          : view([head]),
    };
  });
  face();
  await openGroup("Units");
  await screen.findByText("Indoor unit, Bed 1");
  fireEvent.click(screen.getByRole("button", { name: "Indoor unit, Bed 1" }));
  const pick = await screen.findByRole("button", { name: /HWS IND 3.5KW/ }, { timeout: 2000 });
  await act(async () => {
    fireEvent.click(pick);
  });
  await waitFor(() => expect(posted).toContainEqual(expect.objectContaining({ op: "change", id: "h1", patch: expect.objectContaining({ name: "Indoor unit, Bed 1", code: "MSZ-AP35VGD2" }) })));
});

/* provisional sums, slice 12.1 */
it("adds a provisional sum, and its price is its cost: nothing on top", async () => {
  const ps = line({ id: "p1", system: "", group: "Provisional sums", name: "Core hole 200 mm", code: null, supplierKey: null, kind: "material", costCents: 0, sellCents: null, source: "unknown", why: "" });
  (global as unknown as { fetch: jest.Mock }).fetch = jest.fn(async (_url: string, init?: { body?: string }) => {
    if (init?.body) posted.push(JSON.parse(init.body));
    return { json: async () => view([indoor, ps]) };
  });
  face();
  await linesRead();
  fireEvent.change(screen.getByLabelText("Search your book for a line to add"), { target: { value: "Ergovent round grille" } });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Add a provisional sum" }));
  });
  expect(posted).toContainEqual(expect.objectContaining({ op: "add", line: expect.objectContaining({ group: "Provisional sums", name: "Ergovent round grille", sellCents: null }) }));
  await openGroup("Provisional sums");
  const sell = screen.getByLabelText("What one Core hole 200 mm sells for");
  fireEvent.change(sell, { target: { value: "1300" } });
  await act(async () => {
    fireEvent.blur(sell);
  });
  expect(posted).toContainEqual({ job: "job-3377", op: "change", id: "p1", version: 1, patch: { sellCents: 130000, costCents: 130000 } });
});

/* fit checks on the page, slice 3.1 */
it("says under a part why it doesn't fit its system's outdoor unit", async () => {
  const iso = line({ id: "iso", group: "Pipe, power and controls", name: "Isolator 20 A", code: "ALSIPW201", kind: "material", costCents: 2279, source: "assumed" });
  (global as unknown as { fetch: jest.Mock }).fetch = jest.fn(async () => ({
    json: async () => ({ ...view([indoor, iso]), fits: [{ key: "iso", state: "misfit", why: "20 A is under the PUZ-ZM125VKA2-A's 28 A" }] }),
  }));
  face();
  /* it doesn't open its group: To confirm lists it */
  await linesRead();
  expect(screen.queryByText("20 A is under the PUZ-ZM125VKA2-A's 28 A")).toBeNull();
  expect(screen.getByText("Isolator 20 A: 20 A is under the PUZ-ZM125VKA2-A's 28 A")).toBeInTheDocument();
  await openGroup("Pipe, power and controls");
  expect(screen.getByText("20 A is under the PUZ-ZM125VKA2-A's 28 A")).toBeInTheDocument();
});

/* the review's own half, slice 11.1 */
it("lists what to confirm: what isn't known yet; the profit is the head's to say", async () => {
  face();
  expect(await screen.findByText("Core hole 200 mm: not known yet")).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "To confirm" })).toBeInTheDocument();
  expect(screen.queryByText("Profit 20%, target 20%")).toBeNull();
});

it("marks the option accepted from the rail once it's approved, says its parts went on the job, and shows what goes to ServiceM8", async () => {
  const onToast = jest.fn();
  let accepted: number[] = [];
  (global as unknown as { fetch: unknown }).fetch = jest.fn(async (_url: string, init?: { body?: string }) => {
    if (init?.body) {
      posted.push(JSON.parse(init.body));
      accepted = [0];
    }
    return { json: async () => ({ ...view([indoor]), approved: true, accepted, onJob: init?.body ? { added: 1, removed: 0 } : null }) };
  });
  render(
    <QuoteLinesFace job="job-3377" price={price} onPriced={jest.fn()} onToast={onToast} send={<p>To ServiceM8</p>} />
  );
  expect(screen.queryByText("To ServiceM8")).not.toBeInTheDocument();
  const mark = await screen.findByRole("button", { name: "Mark accepted" });
  await act(async () => {
    fireEvent.click(mark);
  });
  expect(posted).toContainEqual({ job: "job-3377", op: "accept", option: 0 });
  expect(onToast).toHaveBeenCalledWith("The accepted option's parts are on the job's materials list");
  expect(screen.getByRole("button", { name: "Accepted" })).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByText("To ServiceM8")).toBeInTheDocument();
});

/* which supplier, slice 3.2: the same item at another supplier, its own pick */
it("offers the same item from each supplier, and takes the one picked over the cheapest", async () => {
  const aad = { supplierKey: "aad", supplierName: "AAD", code: "CMADJ", name: "ANTI VIBRATION FEET", netCents: 1372 };
  const reece = { supplierKey: "reece", supplierName: "Reece", code: "9500123-1", name: "RUBBER FEET PAIR", netCents: 1490 };
  (global as unknown as { fetch: jest.Mock }).fetch = jest.fn(async (url: string, init?: { body?: string }) => {
    if (init?.body) posted.push(JSON.parse(init.body));
    return {
      json: async () =>
        String(url).startsWith("/api/workboard/quote-lookup")
          ? { ok: true, hits: [{ product: { key: "aad|CMADJ", name: "ANTI VIBRATION FEET", category: "parts", offers: [aad, reece], cheapest: aad, preferred: null, brand: null, quotes: 3 }, why: "Cheapest", buyCents: 1372 }] }
          : view([indoor, core]),
    };
  });
  face();
  await openGroup("Units");
  fireEvent.click(screen.getByRole("button", { name: "Ducted indoor, under the floor" }));
  const fromReece = await screen.findByRole("button", { name: /From Reece/ }, { timeout: 2000 });
  expect(fromReece).toHaveTextContent("$14.90 each");
  await act(async () => {
    fireEvent.click(fromReece);
  });
  await waitFor(() =>
    expect(posted).toContainEqual(expect.objectContaining({ op: "change", patch: { name: "ANTI VIBRATION FEET", code: "9500123-1", supplierKey: "reece", costCents: 1490, sellCents: null } }))
  );
});

/* the business's own task hours, a check in To confirm (slice 8.1) */
it("sets the business's task hours beside the quote's own", async () => {
  (global as unknown as { fetch: jest.Mock }).fetch = jest.fn(async () => ({ json: async () => ({ ...view([indoor]), tasks: [{ hours: 18, words: "3 zones and 4 outlets", quoted: 24 }] }) }));
  face();
  expect(await screen.findByText("Your task hours make it 18 h for 3 zones and 4 outlets; the quote has 24 h")).toBeInTheDocument();
});

/* option names and loading (mock-ups of 8 October) */
const labour = line({ id: "lab", system: "", group: "Labour", name: "Install", code: null, supplierKey: null, kind: "labour", qty: 16, unit: "h", costCents: 11200, source: "by_hand", why: "" });

it("names the option the proposal heads it with", async () => {
  face();
  const box = await screen.findByLabelText("Option 1, as the proposal names it");
  fireEvent.change(box, { target: { value: "Underfloor ducted, 12.5 kW" } });
  await act(async () => {
    fireEvent.blur(box);
  });
  expect(posted).toContainEqual({ job: "job-3377", op: "name", option: 0, name: "Underfloor ducted, 12.5 kW" });
});

it("adds a loading to the labour, keeps it with its reason, and takes it off", async () => {
  let loading: Record<number, { pct: number; reason: string }> = {};
  (global as unknown as { fetch: jest.Mock }).fetch = jest.fn(async (_u: string, init?: { body?: string }) => {
    if (init?.body) posted.push(JSON.parse(init.body));
    return { json: async () => ({ ...view([indoor, labour]), loading }) };
  });
  const { unmount } = face();
  const add = await screen.findByRole("button", { name: "Add a loading" });
  await act(async () => {
    fireEvent.click(add);
  });
  expect(posted).toContainEqual({ job: "job-3377", op: "loading", option: 0, pct: 10, reason: "" });
  /* its reason is typed on its row, under the labour: Labour opens to show it */
  expect(screen.getByRole("button", { name: "Labour" })).toHaveAttribute("aria-expanded", "true");
  unmount();

  loading = { 0: { pct: 12, reason: "Parapet access" } };
  face();
  await openGroup("Labour");
  expect(screen.getByText("Hidden from the customer")).toBeInTheDocument();
  expect(screen.getByLabelText("Why the loading")).toHaveValue("Parapet access");
  expect(screen.queryByRole("button", { name: "Add a loading" })).toBeNull();
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Take the loading off" }));
  });
  expect(posted).toContainEqual({ job: "job-3377", op: "loading", option: 0, pct: null, reason: "" });
});

/* compare (slice 10.2): from a unit line, never its outdoor */
it("opens compare from an indoor unit's line", async () => {
  const outdoor = line({ id: "od", name: "Outdoor, single phase", code: "PUZ-M125VKA2", kind: "unit", costCents: 222320 });
  (global as unknown as { fetch: jest.Mock }).fetch = jest.fn(async (url: string) => ({
    json: async () => (String(url).startsWith("/api/workboard/quote-compare") ? { ok: false, reason: "Compare works from a unit on the quote." } : view([indoor, outdoor])),
  }));
  face();
  await openGroup("Units");
  const buttons = screen.getAllByRole("button", { name: "Compare" });
  expect(buttons).toHaveLength(1);
  await act(async () => {
    fireEvent.click(buttons[0]!);
  });
  expect(await screen.findByLabelText("Compare")).toBeInTheDocument();
});

/* one supplier for the whole job (8 October) */
it("picks the supplier the job buys from, and says where a line it doesn't sell comes from", async () => {
  (global as unknown as { fetch: jest.Mock }).fetch = jest.fn(async (_u: string, init?: { body?: string }) => {
    if (init?.body) posted.push(JSON.parse(init.body));
    return {
      json: async () => ({
        ...view([indoor, line({ id: "tps", group: "Pipe, power and controls", name: "TPS 2.5 mm²", code: "CBT2.5TEWH", supplierKey: "rexel", kind: "material", costCents: 198 })]),
        supplier: "aad",
        suppliers: [
          { key: "aad", name: "AAD" },
          { key: "rexel", name: "Rexel" },
        ],
      }),
    };
  });
  face();
  await openGroup("Pipe, power and controls");
  expect(screen.getByText("Not at AAD: Rexel")).toBeInTheDocument();
  const pick = screen.getByLabelText("Buy from, for this job");
  expect(pick).toHaveValue("aad");
  await act(async () => {
    fireEvent.change(pick, { target: { value: "rexel" } });
  });
  expect(posted).toContainEqual({ job: "job-3377", op: "supplier", key: "rexel" });
});

describe("the proposal (7.1)", () => {
  const mountPriced = (p: QuotePrice = pricedWhole) => {
    (global as unknown as { fetch: unknown }).fetch = jest.fn(async (_url: string, init?: { body?: string }) => {
      if (init?.body) posted.push(JSON.parse(init.body));
      return { json: async () => view([indoor]) };
    });
    render(<QuoteLinesFace job="job-3377" price={p} onPriced={jest.fn()} meta={{ title: "Air conditioning for 12 Smith St", client: "Jo Bloggs", site: "12 Smith St", jobNumber: "3377" }} />);
  };

  it("Preview quote shows the paper, Approve quote says this version is right", async () => {
    mountPriced();
    fireEvent.click(await screen.findByRole("button", { name: "Preview quote" }));
    expect(screen.getByRole("article", { name: "The proposal" })).toHaveTextContent("Jo Bloggs");
    expect(screen.getByRole("heading", { name: "Air conditioning for 12 Smith St" })).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Approve quote" }));
    });
    expect(posted.at(-1)).toMatchObject({ op: "approve" });
    /* no conversation here (Tiff isn't on): the way back is to the line items */
    fireEvent.click(screen.getByRole("button", { name: "Back to the line items" }));
    expect(screen.queryByRole("article", { name: "The proposal" })).not.toBeInTheDocument();
  });

  /* layout B (Isaac, 21 October 2026): "Price on top, buttons pinned" */
  it("pins Preview quote and Approve quote at the rail's foot, out of its scroll, Approve the main button on the right", async () => {
    mountPriced();
    await linesRead();
    const group = screen.getByRole("group", { name: "The quote's buttons" });
    const approve = within(group).getByRole("button", { name: "Approve quote" });
    expect(approve).toHaveClass("pt-btn--main", "pt-btn--36");
    expect(approve).toBeEnabled();
    const preview = within(group).getByRole("button", { name: "Preview quote" });
    expect(preview).toHaveClass("pt-btn--second", "pt-btn--36");
    expect(preview.nextElementSibling).toBe(approve);
    const rail = screen.getByRole("complementary", { name: "On this quote" });
    expect(rail.lastElementChild).toBe(group);
    expect(group.closest(".qc-scroll")).toBeNull();
    /* nothing left: no orange line */
    expect(within(group).queryByText(/to price|to answer/)).toBeNull();
  });

  it("holds Approve quote back while anything on the option is left to price, and says what in orange", async () => {
    mountPriced(price);
    await linesRead();
    expect(screen.getByRole("button", { name: "Preview quote" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Approve quote" })).toBeDisabled();
    expect(screen.getByText("2 lines to price").closest(".pt-state")).toHaveClass("pt-state--look");
  });

  it("holds Approve back while the quote has no lines", async () => {
    (global as unknown as { fetch: unknown }).fetch = jest.fn(async () => ({ json: async () => view([]) }));
    render(<QuoteLinesFace job="job-3377" price={pricedWhole} onPriced={jest.fn()} />);
    await screen.findByText("No lines yet.");
    expect(screen.queryByRole("button", { name: /^Approve/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Preview quote" })).toBeNull();
  });

  it("turns Approve quote into a solid green Approved that can't be pressed, once it is", async () => {
    (global as unknown as { fetch: unknown }).fetch = jest.fn(async () => ({ json: async () => ({ ...view([indoor]), approved: true, proposal: null }) }));
    render(<QuoteLinesFace job="job-3377" price={pricedWhole} onPriced={jest.fn()} />);
    const given = (await screen.findByText("Approved", { selector: ".pt-btn__word" })).closest(".qc-given")!;
    expect(given).toHaveClass("pt-btn--36");
    expect(given.tagName).toBe("SPAN");
    expect(screen.queryByRole("button", { name: /Approve/ })).toBeNull();
    /* the client can say yes now, and the quote can change */
    expect(screen.getByRole("button", { name: "Mark accepted" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Update quote" })).toBeInTheDocument();
  });

  /* Isaac, 21 October 2026: "share becomes available once approved" */
  it("offers Share only once it's approved: the PDF, or the quote's link", async () => {
    const first = render(<QuoteLinesFace job="job-3377" price={pricedWhole} onPriced={jest.fn()} />);
    expect(await screen.findByRole("button", { name: "Approve quote" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Share" })).toBeNull();
    first.unmount();
    (global as unknown as { fetch: unknown }).fetch = jest.fn(async () => ({ json: async () => ({ ...view([indoor]), approved: true, proposal: null }) }));
    render(<QuoteLinesFace job="job-3377" price={pricedWhole} onPriced={jest.fn()} />);
    const share = await within(await screen.findByRole("group", { name: "The quote's buttons" })).findByRole("button", { name: "Share" });
    fireEvent.click(share);
    const menu = within(screen.getByRole("menu", { name: "Share the quote" }));
    expect(menu.getByRole("menuitem", { name: /Download PDF/ })).toBeInTheDocument();
    expect(menu.getByRole("menuitem", { name: /Copy the quote's link/ })).toBeInTheDocument();
  });

  it("puts Send to ServiceM8 under Approved, told whether it went", async () => {
    const sendQuote = jest.fn((_onSent: () => void, sentAt: string | null) => <button type="button">{sentAt ? `Sent ${sentAt}` : "Send to ServiceM8"}</button>);
    let sent: Record<string, unknown> | null = null;
    (global as unknown as { fetch: unknown }).fetch = jest.fn(async () => ({ json: async () => ({ ...view([indoor]), approved: true, proposal: null, sent }) }));
    const { unmount } = render(<QuoteLinesFace job="job-3377" price={pricedWhole} onPriced={jest.fn()} sendQuote={sendQuote} />);
    const group = within(await screen.findByRole("group", { name: "The quote's buttons" }));
    expect(await group.findByRole("button", { name: "Send to ServiceM8" })).toBeInTheDocument();
    unmount();
    /* a trial run went nowhere: still to send */
    sent = { at: "2026-10-21T04:00:00Z", by: "u-isaac", trial: true };
    const trial = render(<QuoteLinesFace job="job-3377" price={pricedWhole} onPriced={jest.fn()} sendQuote={sendQuote} />);
    expect(await screen.findByRole("button", { name: "Send to ServiceM8" })).toBeInTheDocument();
    trial.unmount();
    sent = { at: "2026-10-21T04:00:00Z", by: "u-isaac", trial: false };
    render(<QuoteLinesFace job="job-3377" price={pricedWhole} onPriced={jest.fn()} sendQuote={sendQuote} />);
    expect(await screen.findByRole("button", { name: "Sent 2026-10-21T04:00:00Z" })).toBeInTheDocument();
    /* and the job in ServiceM8 says this quote went, and what it came to */
    const card = within(screen.getByRole("region", { name: "In ServiceM8" }));
    expect(card.getByText("This quote, sent Wed 21 Oct")).toBeInTheDocument();
    expect(card.getByText("This quote, sent Wed 21 Oct").nextElementSibling).toHaveTextContent(/^\$[\d,]+\.\d{2} inc GST$/);
  });

  it("holds Approve quote back while Tiff's questions are open, and counts them", async () => {
    (global as unknown as { fetch: unknown }).fetch = jest.fn(async (url: string) => ({
      json: async () =>
        String(url).startsWith("/api/workboard/quote-session")
          ? {
              ok: true,
              on: true,
              working: false,
              me: "u-isaac",
              names: {},
              events: [
                { id: 1, turnId: "t1", kind: "question", author: "tiff", at: "", body: { question: "Single or three phase?", answers: [] } },
                { id: 2, turnId: "t1", kind: "question", author: "tiff", at: "", body: { question: "How far to the board?", answers: [] } },
              ],
              questions: { 1: { deltas: [], answered: null }, 2: { deltas: [], answered: null } },
            }
          : view([indoor]),
    }));
    render(<QuoteLinesFace job="job-3377" price={pricedWhole} onPriced={jest.fn()} />);
    expect(await screen.findByText("2 questions to answer")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Approve quote" })).toBeDisabled();
  });
});

describe("watching her build it (5.2)", () => {
  it("lists her parts under the total: done with its price, the one she's on, what's to come", async () => {
    const plan = { name: "plan_parts", label: "Planned the quote", ok: true, detail: { option: 0, parts: [{ system: "Downstairs", group: "Units", detail: "PEA-M125HAA" }, { system: "Core holes", group: "Core holes" }, { system: "", group: "Labour" }] } };
    (global as unknown as { fetch: unknown }).fetch = jest.fn(async (url: string) => ({
      json: async () =>
        String(url).startsWith("/api/workboard/quote-session")
          ? { ok: true, on: true, working: true, spentUsd: 0, me: "u-isaac", names: {}, events: [{ id: 1, turnId: "t1", kind: "tool", author: "tiff", at: "", body: plan }] }
          : view([indoor, core]),
    }));
    face();
    const list = await screen.findByRole("region", { name: "Building the quote" });
    expect(list).toHaveTextContent("1 of 3 parts done");
    const rows = within(list).getAllByRole("listitem");
    expect(rows[0]).toHaveClass("done");
    expect(rows[0]).toHaveTextContent("$1,334.38");
    expect(rows[1]).toHaveClass("now");
    expect(rows[1]).toHaveTextContent("1 item so far");
    expect(rows[2]).not.toHaveClass("done");
  });
});

it("on the proposal, reviews every option before it's approved (11.1)", async () => {
  const second = { ...core, id: "l3", optionIndex: 1, name: "Core hole 100 mm" };
  (global as unknown as { fetch: unknown }).fetch = jest.fn(async () => ({ json: async () => view([indoor, core, second]) }));
  render(<QuoteLinesFace job="job-3377" price={price} onPriced={jest.fn()} />);
  fireEvent.click(await screen.findByRole("button", { name: "Preview quote" }));
  expect(screen.getByRole("heading", { name: "Before you approve" })).toBeInTheDocument();
  expect(screen.getByText("Option 1: Core hole 200 mm: not known yet")).toBeInTheDocument();
  expect(screen.getByText("Option 2: Core hole 100 mm: not known yet")).toBeInTheDocument();
});

describe("a labour line's tasks under it (slice 8.2)", () => {
  const visit = {
    stage: "Rough-in",
    people: 2,
    dayHours: 8,
    tasks: [
      { task: "Travel and setup", hours: 5, was: null, byHand: false },
      { task: "Sandstone core hole", hours: 6, was: 4, byHand: true },
    ],
  };
  const rough = line({ id: "l9", system: "", group: "Labour", name: "Rough-in: 2 people, 1 day", code: null, supplierKey: null, kind: "labour", qty: 11, unit: "h", costCents: 11200, source: "assumed", why: "Worked out task by task", visit });
  const labourOnly = () => {
    (global as unknown as { fetch: unknown }).fetch = jest.fn(async (_url: string, init?: { body?: string }) => {
      if (init?.body) posted.push(JSON.parse(init.body));
      return { json: async () => view([rough]) };
    });
  };

  it("shows each task with its hours, says what a person changed, and the line's hours are its tasks'", async () => {
    labourOnly();
    face();
    await openGroup("Labour");
    const list = screen.getByRole("list", { name: "The tasks in Rough-in: 2 people, 1 day" });
    expect(within(list).getByLabelText("Hours for Travel and setup")).toHaveValue("5 h");
    expect(within(list).getByText("Changed, was 4 h")).toBeInTheDocument();
    expect(screen.getByText("11 h, 2 people for half a day")).toBeInTheDocument();
    /* read, not typed: a change is to a task */
    expect(screen.queryByLabelText("Quantity of Rough-in: 2 people, 1 day")).toBeNull();
  });

  it("an hour typed changes the line's tasks, keeping what Tiff had", async () => {
    labourOnly();
    face();
    await openGroup("Labour");
    const hours = screen.getByLabelText("Hours for Travel and setup");
    fireEvent.change(hours, { target: { value: "7" } });
    await act(async () => {
      fireEvent.blur(hours);
    });
    expect(posted).toContainEqual({
      job: "job-3377",
      op: "change",
      id: "l9",
      version: 1,
      patch: { visit: { ...visit, tasks: [{ task: "Travel and setup", hours: 7, was: 5, byHand: true }, visit.tasks[1]] } },
    });
  });

  it("adds a task with its hours, and takes one off", async () => {
    labourOnly();
    face();
    await openGroup("Labour");
    fireEvent.click(screen.getByRole("button", { name: "Add a task" }));
    fireEvent.change(screen.getByLabelText("The task"), { target: { value: "Scaffold" } });
    const h = screen.getByLabelText("Its hours");
    fireEvent.change(h, { target: { value: "3" } });
    await act(async () => {
      fireEvent.keyDown(h, { key: "Enter" });
    });
    expect(posted).toContainEqual(expect.objectContaining({ op: "change", id: "l9", patch: { visit: { ...visit, tasks: [...visit.tasks, { task: "Scaffold", hours: 3, was: null, byHand: true }] } } }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Take Travel and setup off" }));
    });
    expect(posted).toContainEqual(expect.objectContaining({ op: "change", id: "l9", patch: { visit: { ...visit, tasks: [visit.tasks[1]] } } }));
  });
});

/* the rail's card (Isaac, 2026-10-13, the chat-first page): it replaces the
   head's ledger of 10 October */
describe("the quote card", () => {
  const only = (lines: QuoteLine[], extra: Record<string, unknown> = {}) => {
    (global as unknown as { fetch: unknown }).fetch = jest.fn(async () => ({ json: async () => ({ ...view(lines), ...extra }) }));
  };
  const cardIn = () => within(screen.getByRole("region", { name: "The quote" }));
  /* the indoor unit and a day's labour, every line priced: nothing left */
  const whole = priceBuildUp([buildLineOf(indoor)], [{ stage: "Install", people: 1, days: 1 }], settings);
  const pricedAt = (profit: Record<string, unknown>) =>
    render(
      <QuoteLinesFace
        job="job-3377"
        price={{ ok: true, options: [{ name: "Option 1", build: whole, unpriced: [], rows: 2, labourFrom: "you", profit: { costCents: 106750, profitCents: 26688, pct: 20, targetPct: 20, hourCostCents: 11200, short: null, ...profit } }], chargeOutCents: 14000 }}
       
        onPriced={jest.fn()}
      />
    );

  it("says the profit stands, in green, at or over the target", async () => {
    only([indoor]);
    pricedAt({});
    await linesRead();
    expect(cardIn().getByText("At your 20%").closest(".pt-state")).toHaveClass("pt-state--good");
    expect(cardIn().getByText("At your 20%").closest(".qp-profit")).toHaveTextContent("20%, $266.88");
    /* the figure itself in green (layout B, 21 October 2026) */
    expect(cardIn().getByText("20%, $266.88")).toHaveClass("good");
    expect(within(cardIn().getByRole("list", { name: "Its parts" })).getByText("Units").parentElement).toHaveTextContent("$1,334.38");
  });

  /* it was a red sentence under the head (.qp-short) */
  it("says how far under the target it is, in amber, and the price that would meet it", async () => {
    only([indoor]);
    pricedAt({ targetPct: 30, short: { cents: 18062, priceCents: 152500 } });
    await linesRead();
    const word = cardIn().getByText("Under your 30% target by $180.62. $1,525.00 ex GST would meet it");
    expect(word.closest(".pt-state")).toHaveClass("pt-state--look");
    expect(word.closest(".qp-profit")).toHaveTextContent("20%, $266.88");
    expect(cardIn().getByText("20%, $266.88")).toHaveClass("look");
  });

  /* the red sentence waited until nothing was left to price: a price to
     meet the target, worked out from part of the quote, is a wrong price */
  it("claims no state, and no price to meet the target, while anything is still to price", async () => {
    only([indoor, core]);
    const short = { ...(price as Extract<QuotePrice, { ok: true }>).options[0]!, profit: { costCents: 106750, profitCents: 26688, pct: 20, targetPct: 30, hourCostCents: 11200, short: { cents: 18062, priceCents: 152500 } } };
    render(<QuoteLinesFace job="job-3377" price={{ ok: true, options: [short], chargeOutCents: 14000 }} onPriced={jest.fn()} />);
    await linesRead();
    const bar = cardIn().getByText("20%, $266.88").closest(".qp-profit")!;
    expect(bar.querySelector(".pt-state")).toBeNull();
    expect(bar).toHaveTextContent("Profitso far20%, $266.88");
    expect(cardIn().getByText("20%, $266.88")).not.toHaveClass("look");
    expect(cardIn().queryByText(/would meet it/)).toBeNull();
    expect(cardIn().queryByText(/under your/)).toBeNull();
  });

  /* layout B (21 October 2026): the groups are the line items' to say, once */
  it("leaves the groups to the line items, and with no target says the figures alone", async () => {
    only([indoor]);
    const damper = { key: "d", group: "Ductwork and grilles", name: "Damper", code: "QZD1024V", supplierKey: null, qty: 5, unitBuyCents: 4521, kind: "material" as const, duct: true };
    const pipe = { key: "p", group: "Pipe, power and controls", name: "Pipe", code: "9800008-1", supplierKey: null, qty: 1, unitBuyCents: 13694, kind: "material" as const };
    const b = priceBuildUp([buildLineOf(indoor), pipe, damper], [{ stage: "Install", people: 1, days: 2 }], { ...settings, contingency: { pct: 15, hours: 3 } });
    const profit = { costCents: 0, profitCents: 50000, pct: 12.3, targetPct: null, hourCostCents: 11200, short: null };
    render(<QuoteLinesFace job="job-3377" price={{ ok: true, options: [{ name: "Option 1", build: b, unpriced: [], rows: 3, labourFrom: "you", profit }], chargeOutCents: 14000 }} onPriced={jest.fn()} />);
    await linesRead();
    expect(cardIn().queryByRole("list", { name: "By group" })).toBeNull();
    /* no target: the figures alone, in no state's colour */
    expect(cardIn().getByText(/^12\.3%, /).closest(".qp-profit")!.querySelector(".pt-state")).toBeNull();
    expect(cardIn().queryByText(/your \d+%/)).toBeNull();
  });

  it("names each option on its button", async () => {
    only([indoor, { ...indoor, id: "l3", optionIndex: 1 }], { optionNames: ["Mitsubishi Electric ducted", ""] });
    face();
    expect(await screen.findByRole("tab", { name: /1\. Mitsubishi Electric ducted/ })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Option 2/ })).toBeInTheDocument();
  });

  it("says which option it totals when the quote has more than one: the one open", async () => {
    only([indoor, { ...indoor, id: "l3", optionIndex: 1 }]);
    face();
    fireEvent.click(await screen.findByRole("tab", { name: /Option 2/ }));
    expect(cardIn().getByText(/^Option 2, total ex GST/)).toBeInTheDocument();
  });

  it("keeps today's words while Quoting isn't set", async () => {
    only([indoor]);
    render(<QuoteLinesFace job="job-3377" price={{ ok: false, unset: ["rate", "hours"] }} onPriced={jest.fn()} />);
    await linesRead();
    expect(cardIn().getByText("Not set")).toBeInTheDocument();
    expect(cardIn().getByText("Set a charge-out rate and a working day in Quoting to price this quote.")).toBeInTheDocument();
  });
});

it("shows an estimate on its line and in To confirm, and confirms it from there", async () => {
  const cons = line({ id: "l7", system: "Downstairs", group: "Allowances", name: "Consumables", code: null, supplierKey: null, kind: "material", costCents: 1542, source: "assumed", why: "An estimate from your book: duct tape, cable ties, silicone", estimate: true });
  (global as unknown as { fetch: unknown }).fetch = jest.fn(async (_url: string, init?: { body?: string }) => {
    if (init?.body) posted.push(JSON.parse(init.body));
    return { json: async () => view([indoor, cons]) };
  });
  face();
  await openGroup("Allowances");
  expect(screen.getByText("Estimate")).toBeInTheDocument();
  expect(screen.getByText("Consumables: An estimate from your book: duct tape, cable ties, silicone")).toBeInTheDocument();
  /* the stage line is up to Scope: something's still to settle */
  expect(within(screen.getByRole("list", { name: "Where the quote is" })).getByText("Scope").closest("li")).toHaveClass("now");
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
  });
  expect(posted).toContainEqual({ job: "job-3377", op: "change", id: "l7", version: 1, patch: { estimate: false }, why: "Confirmed the estimate" });
});

/* Isaac, 2026-10-10: "show me how that workflow goes from a completed quote
   to update quote, even after it's been approved… it'll be variation then" */
describe("a variation to the accepted quote", () => {
  const settings2 = { unitMarkupPct: 25, materialMarkupPct: 40, chargeOutCents: 14000, dayHours: 8, contingency: null };
  const diffuser = line({ id: "d1", group: "Ductwork and grilles", name: "CONE DIFFUSER PLASTIC 200", code: "CD200", kind: "material", qty: 3, costCents: 1289, source: "assumed", why: "" });
  const varied = [line({ ...indoor, id: "v1", optionIndex: 1 }), line({ ...diffuser, id: "v2", optionIndex: 1, qty: 4 })];
  const priceFor = (ls: QuoteLine[]) => ({
    ok: true as const,
    chargeOutCents: 14000,
    options: [0, 1]
      .filter((i) => ls.some((l) => l.optionIndex === i))
      .map((i) => ({ name: `Option ${i + 1}`, build: priceBuildUp(ls.filter((l) => l.optionIndex === i).map(buildLineOf), [], settings2), unpriced: [], rows: 1, labourFrom: "none" as const, profit: null })),
  });
  const variation = { n: 1, option: 1, of: 0, what: "Client wants the upstairs hallway done too.", startedAt: "2026-10-15T00:00:00Z", startedBy: "u-isaac", approvedAt: null, acceptedAt: null };

  it("starts from Update quote on an accepted quote, asking what's changing", async () => {
    (global as unknown as { fetch: unknown }).fetch = jest.fn(async (_url: string, init?: { body?: string }) => {
      if (init?.body) posted.push(JSON.parse(init.body));
      return { json: async () => (init?.body ? { ...view([indoor, diffuser, ...varied]), accepted: [0], variations: [variation], opened: 1 } : { ...view([indoor, diffuser]), accepted: [0] }) };
    });
    render(<QuoteLinesFace job="job-3377" price={priceFor([indoor, diffuser])} onPriced={jest.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Update quote" }));
    const dialog = screen.getByRole("dialog", { name: "Update quote" });
    expect(within(dialog).getByText(/is accepted, so this is a variation/)).toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText("What's changing"), { target: { value: "Client wants the upstairs hallway done too." } });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Start variation 1" }));
    });
    expect(posted).toContainEqual({ job: "job-3377", op: "variation", what: "Client wants the upstairs hallway done too." });
  });

  it("says its own price as the difference, what it adds or changes, and goes to the client on its own paper", async () => {
    (global as unknown as { fetch: unknown }).fetch = jest.fn(async (_url: string, init?: { body?: string }) => {
      if (init?.body) posted.push(JSON.parse(init.body));
      return { json: async () => ({ ...view([indoor, diffuser, ...varied]), accepted: [0], variations: [variation], ...(init?.body ? { onJob: { added: 1, removed: 0 } } : {}) }) };
    });
    const onToast = jest.fn();
    render(<QuoteLinesFace job="job-3377" price={priceFor([indoor, diffuser, ...varied])} onPriced={jest.fn()} onToast={onToast} meta={{ title: "Ducted", client: "Andrew", site: null, jobNumber: "3377" }} />);
    fireEvent.click(await screen.findByRole("tab", { name: /Variation 1/ }));
    /* one more diffuser at $12.89 + 40%, the line rounded to the cent */
    expect(screen.getByRole("tab", { name: /Variation 1/ })).toHaveTextContent("+$18.04");
    expect(screen.getByText("Variation 1, ex GST")).toBeInTheDocument();
    expect(screen.getByText(/^New total /)).toBeInTheDocument();
    await openGroup("Units");
    await openGroup("Ductwork and grilles");
    expect(document.querySelectorAll(".ql-vs")).toHaveLength(1);
    expect(document.querySelector(".ql-vs")).toHaveTextContent("Changed");
    expect(screen.queryByRole("button", { name: "Update quote" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Preview variation" }));
    const paper = within(screen.getByRole("article", { name: "Variation 1" }));
    expect(paper.getByText("Client wants the upstairs hallway done too.")).toBeInTheDocument();
    expect(paper.getByText("CONE DIFFUSER PLASTIC 200")).toBeInTheDocument();
    expect(paper.getByText("+$18.04")).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Approve variation" }));
    });
    expect(posted).toContainEqual({ job: "job-3377", op: "variation-approve", option: 1 });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Mark variation 1 accepted" }));
    });
    expect(posted).toContainEqual({ job: "job-3377", op: "variation-accept", option: 1 });
    expect(onToast).toHaveBeenCalledWith("The variation's new work is on the job's task list, and its new parts on the materials list");
  });
});

/* the round-2 mock: "Before it's accepted (approved or sent), the same
   button makes version 2 of the quote: the approval comes off and it goes
   back through Approve and Send" */
describe("version 2 before it's accepted", () => {
  const kept = {
    n: 1,
    what: "Client wants a bigger unit in the lounge.",
    approvedAt: "2026-10-11T01:00:00Z",
    madeAt: "2026-10-11T02:00:00Z",
    options: [{ name: "Option 1", exGstCents: 133438, incGstCents: 146782, lines: [{ name: "Ducted indoor, under the floor", code: "PEA-M125HAA", qty: 1, unit: "", totalCents: 133438 }] }],
  };
  const mount = (answer: Record<string, unknown>) => {
    (global as unknown as { fetch: unknown }).fetch = jest.fn(async (_url: string, init?: { body?: string }) => {
      if (init?.body) posted.push(JSON.parse(init.body));
      return { json: async () => ({ ...view([indoor, core]), ...answer }) };
    });
    render(<QuoteLinesFace job="job-3377" price={price} onPriced={jest.fn()} meta={{ title: "Ducted", client: "Andrew", site: null, jobNumber: "3377" }} />);
  };

  it("starts from Update quote on an approved quote nobody has accepted", async () => {
    mount({ approved: true });
    fireEvent.click(await screen.findByRole("button", { name: "Update quote" }));
    const dialog = screen.getByRole("dialog", { name: "Update quote" });
    expect(within(dialog).getByText(/is approved, so this is version 2\. Version 1 is kept as it stands, the approval comes off/)).toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText("What's changing"), { target: { value: "Client wants a bigger unit in the lounge." } });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Start version 2" }));
    });
    expect(posted).toContainEqual({ job: "job-3377", op: "version", what: "Client wants a bigger unit in the lounge." });
  });

  it("isn't offered on a quote not yet approved", async () => {
    mount({});
    await screen.findByRole("button", { name: "Preview quote" });
    expect(screen.queryByRole("button", { name: "Update quote" })).toBeNull();
  });

  /* the stage line said "Version 2" under Approved until layout B (21
     October 2026) took its words off: the versions are the line items' */
  it("opens a past version as it stood, read only", async () => {
    mount({ versions: [kept] });
    /* at the line items' foot */
    const rail = within(await screen.findByRole("list", { name: "Versions" }));
    expect(rail.getByText("Option 1: $1,467.82 inc GST")).toBeInTheDocument();
    fireEvent.click(rail.getByRole("button", { name: "Open" }));
    const paper = within(screen.getByRole("article", { name: "Version 1" }));
    expect(paper.getByText("Client wants a bigger unit in the lounge.")).toBeInTheDocument();
    expect(paper.getByText("What changed for version 2")).toBeInTheDocument();
    expect(paper.getByText("Ducted indoor, under the floor")).toBeInTheDocument();
    expect(paper.getByText("$1,467.82")).toBeInTheDocument();
    /* nothing to approve or accept on a kept version */
    expect(screen.queryByRole("button", { name: /^Approve/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Mark accepted" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Back to the line items" }));
    expect(screen.queryByRole("article", { name: "Version 1" })).not.toBeInTheDocument();
  });
});

/* Isaac, 2026-10-11 (3343): "it says its length isn't known yet… doesn't actually give me anywhere to put that" */
it("takes a line nobody knows the price of from To confirm to its own cost box", async () => {
  face();
  const price = await screen.findByRole("button", { name: "Price it" });
  fireEvent.click(price);
  expect(screen.getByLabelText("What one Core hole 200 mm costs you")).toHaveFocus();
});

/* Isaac, 2026-10-12: "For techs who are quoting a job… the money visibility can be hidden" */
it("shows a tech the work without its money: no price head, no cost or sell, no pricing or approving", async () => {
  (global as unknown as { fetch: unknown }).fetch = jest.fn(async () => ({ json: async () => ({ ...view([{ ...indoor, costCents: 0, sellCents: null }]), money: false }) }));
  render(<QuoteLinesFace job="job-3377" price={null} onPriced={jest.fn()} />);
  await openGroup("Units");
  expect(screen.getByLabelText("Quantity of Ducted indoor, under the floor")).toHaveValue("1");
  expect(screen.queryByLabelText("What one Ducted indoor, under the floor costs you")).toBeNull();
  expect(screen.queryByLabelText("What one Ducted indoor, under the floor sells for")).toBeNull();
  expect(screen.queryByRole("columnheader", { name: "Sell each" })).toBeNull();
  expect(screen.queryByRole("region", { name: "The quote" })).toBeNull();
  expect(document.querySelector(".qp-card")).toBeNull();
  expect(screen.queryByRole("button", { name: /^Approve/ })).toBeNull();
  expect(screen.queryByLabelText("Search your book for a line to add")).toBeNull();
  expect(screen.queryByRole("button", { name: "Preview quote" })).toBeNull();
  expect(screen.queryByRole("group", { name: "The quote's buttons" })).toBeNull();
  expect(screen.queryByRole("button", { name: /Mark accepted/ })).toBeNull();
  /* the work is still theirs */
  expect(screen.getByRole("button", { name: "Add a line by hand" })).toBeInTheDocument();
});

/* Isaac, 2026-10-03: "if a quote has been generated in sm8 it should show on
   our quote page"; since layout B (21 October 2026), a card headed In
   ServiceM8 under the quote's price, its buttons never an underlined link */
it("shows ServiceM8's quote in the rail's In ServiceM8, its value and day as a row, its PDF and the job opening from it", async () => {
  const paper = {
    remoteId: "att-q",
    name: "Quote #3377",
    fileType: ".pdf",
    kind: "document" as const,
    origin: "Quote",
    takenAt: "2026-10-01 14:25:35",
    url: "https://files.example/q.pdf",
    width: null,
    height: null,
    fromClaim: null,
  };
  const onOpenPaper = jest.fn();
  const job = "a3539c01-9527-42a6-893b-24376269efbb";
  render(<QuoteLinesFace job={job} price={price} onPriced={jest.fn()} sm8={{ papers: [paper], sentOn: "2026-10-01", value: "$45,430 inc GST" }} onOpenPaper={onOpenPaper} />);
  const group = await screen.findByRole("region", { name: "In ServiceM8" });
  expect(within(group).getByRole("heading", { name: "In ServiceM8" })).toBeInTheDocument();
  expect(within(group).getByText("Their quote, sent Thu 1 Oct").parentElement).toHaveTextContent("$45,430 inc GST");
  /* the rail's card follows the price it sits under */
  const before = (a: Element, b: Element) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
  expect(before(screen.getByRole("region", { name: "The quote" }), group)).toBe(true);
  expect(within(group).getByRole("link", { name: "Open in ServiceM8" })).toHaveAttribute("href", `https://go.servicem8.com/OpenJob/${job}`);
  expect(group.querySelector(".pt-link")).toBeNull();
  fireEvent.click(within(group).getByRole("button", { name: "Open their PDF" }));
  expect(onOpenPaper).toHaveBeenCalledWith(paper);
});

/* the row opens its PDF only once it's brought across: until then the PDF
   is a row of its own, with its name and its "not brought across yet" */
it("keeps a ServiceM8 PDF not brought across yet on the page, with nothing to open", async () => {
  const paper = { remoteId: "att-q", name: "Quote #3377", fileType: ".pdf", kind: "document" as const, origin: "Quote", takenAt: "2026-10-01 14:25:35", url: null, width: null, height: null, fromClaim: null };
  render(<QuoteLinesFace job="job-3377" price={price} onPriced={jest.fn()} sm8={{ papers: [paper], sentOn: "2026-10-01", value: null }} />);
  const group = within(await screen.findByRole("region", { name: "In ServiceM8" }));
  expect(group.getByText("Their quote, sent Thu 1 Oct")).toBeInTheDocument();
  expect(group.getByText("Quote #3377")).toBeInTheDocument();
  expect(group.getByText(/not brought across yet/)).toBeInTheDocument();
  expect(group.queryByRole("button")).toBeNull();
});

it("shows no ServiceM8 quote on a job ServiceM8 never quoted", async () => {
  render(<QuoteLinesFace job="job-3377" price={price} onPriced={jest.fn()} sm8={{ papers: [], sentOn: null, value: null }} />);
  expect(await linesRead()).toBeInTheDocument();
  expect(screen.queryByText("In ServiceM8")).toBeNull();
});

/* 2026-10-14: the page knew a tech had no money only once the lines came
   back, so the money columns, the book search and an estimate's Confirm
   (whose change the route strips) showed until then, and the Confirm after */
it("shows no money and no estimate to confirm to someone the server says doesn't see it", async () => {
  const est = line({ id: "l3", system: "Downstairs", group: "Allowances", name: "Consumables", code: null, supplierKey: null, kind: "material", costCents: 6850, source: "assumed", why: "An estimate from your book", estimate: true });
  (global as unknown as { fetch: unknown }).fetch = jest.fn(async () => ({ json: async () => view([indoor, est]) }));
  render(<QuoteLinesFace job="job-3377" price={null} onPriced={jest.fn()} money={false} />);
  expect(screen.queryByPlaceholderText("Add a line from your book")).toBeNull();
  await openGroup("Units");
  expect(screen.getByText("Ducted indoor, under the floor")).toBeInTheDocument();
  expect(screen.queryByRole("columnheader", { name: "Cost each" })).toBeNull();
  expect(screen.queryByPlaceholderText("Add a line from your book")).toBeNull();
  expect(screen.queryByRole("button", { name: "Confirm" })).toBeNull();
});

/* THE PAGE TURNED ROUND (Isaac, 2026-10-13, the chat-first quote page): the
   conversation is the main column, the line items a tab away, the rail the
   quote's card */
describe("the page turned round", () => {
  const session = { ok: true, on: true, working: false, spentUsd: 0.71, me: "u-isaac", names: {}, events: [{ id: 1, turnId: "t1", kind: "reply", author: "tiff", at: "", body: { text: "Priced from your book." } }], questions: {} };
  const tiffOn = (spentUsd: number | null = 0.71) => {
    (global as unknown as { fetch: unknown }).fetch = jest.fn(async (url: string, init?: { body?: string }) => {
      if (init?.body) posted.push(JSON.parse(init.body));
      return { json: async () => (String(url).startsWith("/api/workboard/quote-session") ? { ...session, ...(spentUsd == null ? { spentUsd: undefined } : { spentUsd }) } : view([indoor, core])) };
    });
  };
  const before = (a: Element, b: Element) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;

  /* layout C (Isaac, 18 October): no view tabs; layout B (21 October): the
     rail's Line items, under the price, swaps the left to the line items,
     and says Back to the conversation */
  it("fills the left with the conversation, and the rail's Line items swaps it for the line items and back", async () => {
    tiffOn();
    face();
    expect(await screen.findByText("Priced from your book.")).toBeVisible();
    expect(screen.queryByRole("tablist", { name: "Conversation and line items" })).toBeNull();
    expect(screen.queryByRole("tab", { name: "Conversation" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Units" })).toBeNull();
    /* what's to confirm is the conversation's own tab (Isaac, 27 October
       2026), never at its foot: the rail has none */
    const rail = within(screen.getByRole("complementary", { name: "On this quote" }));
    expect(rail.queryByRole("region", { name: "To confirm" })).toBeNull();
    expect(screen.queryByText("Core hole 200 mm: not known yet")).toBeNull();
    fireEvent.click(screen.getByRole("radio", { name: /^To confirm/ }));
    expect(screen.getByText("Core hole 200 mm: not known yet")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: "Conversation" }));

    /* the rail's buttons wait on knowing whether she's on */
    const items = await rail.findByRole("button", { name: "Line items" });
    /* under the price, full width, out of the pinned buttons */
    expect(before(rail.getByRole("region", { name: "The quote" }), items)).toBe(true);
    expect(items.closest('[role="group"]')).toBeNull();
    fireEvent.click(items);
    expect(screen.getByRole("button", { name: "Units" })).toBeInTheDocument();
    expect(rail.queryByRole("button", { name: "Line items" })).toBeNull();
    /* the Add buttons over the table, the history at its foot */
    expect(before(screen.getByRole("region", { name: "Add a line" }), screen.getByRole("button", { name: "Units" }))).toBe(true);
    expect(before(screen.getByRole("region", { name: "Add a line" }), screen.getByRole("heading", { name: "Changes" }))).toBe(true);
    /* her column stays mounted under them, so her work still lands */
    expect(screen.getByText("Priced from your book.")).not.toBeVisible();

    fireEvent.click(rail.getByRole("button", { name: "Back to the conversation" }));
    expect(screen.queryByRole("button", { name: "Units" })).toBeNull();
    expect(screen.getByText("Priced from your book.")).toBeVisible();
    expect(rail.getByRole("button", { name: "Line items" })).toBeInTheDocument();
  });

  /* "open groups stay open while you're on the page" (2026-10-15) */
  it("keeps a group open while the page is up, to the conversation and back", async () => {
    tiffOn();
    face();
    fireEvent.click(await screen.findByRole("button", { name: "Line items" }));
    await openGroup("Units");
    fireEvent.click(screen.getByRole("button", { name: "Back to the conversation" }));
    expect(screen.queryByRole("button", { name: "Units" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Line items" }));
    expect(screen.getByRole("button", { name: "Units" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByLabelText("Quantity of Ducted indoor, under the floor")).toHaveValue("1");
  });

  /* layout C: the progress at the top of the rail, Q7's steps; layout B (21
     October 2026): in colour, names only */
  it("puts the stage line at the top of the rail, done in green and the step it's up to in orange, names only", async () => {
    tiffOn();
    face();
    await screen.findByText("Priced from your book.");
    const rail = screen.getByRole("complementary", { name: "On this quote" });
    const steps = within(rail).getByRole("list", { name: "Where the quote is" });
    expect(rail.firstElementChild).toContainElement(steps);
    expect(within(steps).getAllByRole("listitem").map((li) => li.querySelector("b")!.textContent)).toEqual(["Brief", "Scope", "Priced", "Approved", "Sent", "Accepted"]);
    const [brief, scope, ...rest] = within(steps).getAllByRole("listitem");
    expect(brief).toHaveClass("done");
    expect(scope).toHaveClass("now");
    expect(scope).toHaveAttribute("aria-current", "step");
    expect(scope).toHaveTextContent(/^Scope$/);
    /* the rest grey, though Priced has something to price too */
    for (const li of rest) expect(li.className).toBe("");
    expect(before(steps, within(rail).getByRole("region", { name: "The quote" }))).toBe(true);
  });

  it("tells the page the quote's state word for the line under the job's name", async () => {
    tiffOn();
    const onStage = jest.fn();
    render(<QuoteLinesFace job="job-3377" price={price} onStage={onStage} onPriced={jest.fn()} />);
    await screen.findByText("Priced from your book.");
    expect(onStage).toHaveBeenLastCalledWith({ word: "1 to settle", settle: true });
  });

  /* 11.1 with her on: the paper stands where the conversation was, so the
     review that was the conversation's foot stands beside it in the rail,
     her open questions counted in it */
  it("reviews every option beside the paper while Tiff is on, her open questions with them (11.1)", async () => {
    const second = { ...core, id: "l3", optionIndex: 1, name: "Core hole 100 mm" };
    const asking = {
      ...session,
      events: [...session.events, { id: 2, turnId: "t1", kind: "question", author: "tiff", at: "", body: { question: "Single or three phase?", answers: [] } }],
      questions: { 2: { deltas: [], answered: null } },
    };
    (global as unknown as { fetch: unknown }).fetch = jest.fn(async (url: string) => ({
      json: async () => (String(url).startsWith("/api/workboard/quote-session") ? asking : view([indoor, core, second])),
    }));
    render(<QuoteLinesFace job="job-3377" price={price} onPriced={jest.fn()} />);
    fireEvent.click(await screen.findByRole("radio", { name: /^To confirm/ }));
    expect(await screen.findByText("Single or three phase?")).toBeVisible();
    fireEvent.click(await screen.findByRole("button", { name: "Preview quote" }));
    const rail = within(screen.getByRole("complementary", { name: "On this quote" }));
    const review = within(rail.getByRole("region", { name: "Before you approve" }));
    expect(review.getByText("Tiff's question: not answered yet")).toBeVisible();
    expect(review.getByText("Option 1: Core hole 200 mm: not known yet")).toBeVisible();
    expect(review.getByText("Option 2: Core hole 100 mm: not known yet")).toBeVisible();
    /* once, beside the paper: the conversation behind it holds no copy */
    expect(screen.getAllByText("Option 1: Core hole 200 mm: not known yet")).toHaveLength(1);
  });

  /* layout B (21 October 2026): what she cost left the rail */
  it("says nothing of what Tiff has cost, even to someone who sees money", async () => {
    tiffOn();
    face();
    expect(await screen.findByText("Priced from your book.")).toBeInTheDocument();
    expect(screen.queryByText(/Tiff on this quote/)).toBeNull();
  });

  it("says nothing of what Tiff has cost to a tech", async () => {
    tiffOn(null);
    render(<QuoteLinesFace job="job-3377" price={null} onPriced={jest.fn()} money={false} />);
    expect(await screen.findByText("Priced from your book.")).toBeInTheDocument();
    expect(screen.queryByText(/Tiff on this quote/)).toBeNull();
    expect(screen.queryByRole("region", { name: "The quote" })).toBeNull();
  });

  it("takes Price it from what's to confirm to the line's cost box in the line items", async () => {
    tiffOn();
    face();
    fireEvent.click(await screen.findByRole("radio", { name: /^To confirm/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Price it" }));
    expect(screen.getByRole("button", { name: "Back to the conversation" })).toBeInTheDocument();
    expect(screen.getByLabelText("What one Core hole 200 mm costs you")).toHaveFocus();
  });

  it("lays the line items out on the left where Tiff isn't on, and To confirm heads the rail under the progress", async () => {
    face();
    expect(await linesRead()).toBeInTheDocument();
    const rail = within(screen.getByRole("complementary", { name: "On this quote" }));
    expect(before(rail.getByRole("list", { name: "Where the quote is" }), rail.getByRole("region", { name: "To confirm" }))).toBe(true);
    expect(before(rail.getByRole("region", { name: "To confirm" }), rail.getByRole("region", { name: "The quote" }))).toBe(true);
    /* the lines are already the page: nothing to switch to */
    expect(rail.queryByRole("button", { name: "Line items" })).toBeNull();
  });

  it("lays out nothing of the column until it knows whether Tiff is on", () => {
    (global as unknown as { fetch: unknown }).fetch = jest.fn(() => new Promise(() => undefined));
    face();
    expect(screen.queryByRole("button", { name: "Line items" })).toBeNull();
    expect(screen.queryByRole("region", { name: "Add a line" })).toBeNull();
  });
});

/* the Design step (Isaac, 28 October 2026: "Brief, Scope, Design
   (skippable), Priced, with the Studio opening from the Design step") */
describe("the Design step", () => {
  const answering = (extra: Record<string, unknown>) => {
    (global as unknown as { fetch: unknown }).fetch = jest.fn(async (_url: string, init?: { body?: string }) => {
      const body = init?.body ? (JSON.parse(init.body) as Record<string, unknown>) : null;
      if (body) posted.push(body);
      const skipped = body?.op === "design" ? { noDesign: body.skip ? { at: "2026-10-28T00:00:00Z", by: "u-isaac" } : null } : {};
      return { json: async () => ({ ...view([indoor, core]), ...extra, ...skipped }) };
    });
  };
  const stages = () => screen.getByRole("list", { name: "Where the quote is" });

  it("opens the Studio on the job, or passes the step by and says No design", async () => {
    answering({ designs: [], noDesign: null });
    render(<QuoteLinesFace job="job-3406" price={price} onPriced={jest.fn()} />);
    const group = await screen.findByRole("region", { name: "Design" });
    expect(within(stages()).getByText("Design")).toBeInTheDocument();
    expect(within(group).getByRole("link", { name: "Design it" })).toHaveAttribute("href", "/dashboard/studio?job=job-3406");
    fireEvent.click(within(group).getByRole("button", { name: "Price without a design" }));
    await waitFor(() => expect(posted).toContainEqual(expect.objectContaining({ op: "design", skip: true })));
    expect(await within(stages()).findByText("No design")).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Design" })).getByText("Priced without a design")).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Design" })).getByRole("link", { name: "Design it" })).toBeInTheDocument();
  });

  it("lists the job's designs, each opening in the Studio", async () => {
    answering({ designs: [{ id: "dsn_1", name: "6 Bishops Avenue", updatedAt: "2026-10-27T03:00:00Z" }], noDesign: null });
    render(<QuoteLinesFace job="job-3406" price={price} onPriced={jest.fn()} />);
    const group = await screen.findByRole("region", { name: "Design" });
    expect(within(group).getByText("6 Bishops Avenue")).toBeInTheDocument();
    expect(within(group).getByRole("link", { name: "Open design" })).toHaveAttribute("href", "/dashboard/studio?design=dsn_1");
    expect(within(group).queryByRole("button", { name: "Price without a design" })).toBeNull();
  });

  it("isn't on the quote for someone without the Studio", async () => {
    answering({ designs: null });
    render(<QuoteLinesFace job="job-3406" price={price} onPriced={jest.fn()} />);
    await screen.findByRole("list", { name: "Where the quote is" });
    expect(screen.queryByRole("region", { name: "Design" })).toBeNull();
    expect(within(stages()).queryByText("Design")).toBeNull();
  });
});
