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
const price: QuotePrice = { ok: true, options: [{ name: "Option 1", build, unpriced: [{ name: "Core hole 200 mm", qty: "1", why: "Not known yet" }], rows: 2, labourFrom: "none", profit: { costCents: 106750, profitCents: 26688, pct: 20, targetPct: 20, hourCostCents: 11200, short: null } }] };

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

const face = (onPriced = jest.fn()) => render(<QuoteLinesFace job="job-3377" price={price} actionsEl={null} onPriced={onPriced} />);

it("shows the total in its card, each system with its total, and every line's qty, cost and sell", async () => {
  face();
  expect(await screen.findByText("Ducted indoor, under the floor")).toBeInTheDocument();
  /* the head: one ledger, the total in its tinted cell, the profit's state in words */
  expect(document.querySelector(".ql-lc.tot b")).toHaveTextContent("$1,334.38");
  expect(screen.getByText("$266.88")).toBeInTheDocument();
  expect(screen.getByText("20%, 1 to confirm")).toHaveClass("warn");
  expect(screen.getByRole("heading", { name: "Downstairs" })).toBeInTheDocument();
  expect(screen.getByLabelText("Quantity of Ducted indoor, under the floor")).toHaveValue("1");
  expect(screen.getByLabelText("What one Ducted indoor, under the floor costs you")).toHaveValue("1067.50");
  expect(screen.getByLabelText("What one Ducted indoor, under the floor sells for")).toHaveValue("1334.38");
  /* a line nobody knows the price of shows a dash, never $0 */
  expect(screen.getByRole("heading", { name: "Core holes" })).toBeInTheDocument();
  expect(screen.getAllByText("—")).toHaveLength(1);
  /* the progress line from the lines: the core hole, and labour nobody's set */
  expect(screen.getByText("1 to confirm")).toBeInTheDocument();
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
  /* Tiff's own changes say they're hers */
  expect(screen.getByText("Tiff")).toBeInTheDocument();
  await act(async () => {
    fireEvent.click(screen.getAllByRole("button", { name: "Undo" })[0]!);
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
  await screen.findByText("Ducted indoor, under the floor");
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Copy option 1 to a new option" }));
  });
  expect(posted).toContainEqual({ job: "job-3377", op: "copy", from: 0, to: 2 });
  fireEvent.click(screen.getByRole("tab", { name: /Option 2/ }));
  expect(screen.getByText("Added")).toBeInTheDocument();
  expect(screen.getByText("Not in this option: Ducted indoor, under the floor")).toBeInTheDocument();
});

/* Select preferred item, slice 2.4 */
it("swaps a line for another item of its kind from the book, and makes it preferred from the next quote", async () => {
  face();
  await screen.findByText("Ducted indoor, under the floor");
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

/* provisional sums, slice 12.1 */
it("adds a provisional sum, and its price is its cost: nothing on top", async () => {
  const ps = line({ id: "p1", system: "", group: "Provisional sums", name: "Core hole 200 mm", code: null, supplierKey: null, kind: "material", costCents: 0, sellCents: null, source: "unknown", why: "" });
  (global as unknown as { fetch: jest.Mock }).fetch = jest.fn(async (_url: string, init?: { body?: string }) => {
    if (init?.body) posted.push(JSON.parse(init.body));
    return { json: async () => view([indoor, ps]) };
  });
  face();
  await screen.findByText("Core hole 200 mm");
  fireEvent.change(screen.getByLabelText("Search your book for a line to add"), { target: { value: "Ergovent round grille" } });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Add a provisional sum" }));
  });
  expect(posted).toContainEqual(expect.objectContaining({ op: "add", line: expect.objectContaining({ group: "Provisional sums", name: "Ergovent round grille", sellCents: null }) }));
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
  expect(await screen.findByText("20 A is under the PUZ-ZM125VKA2-A's 28 A")).toBeInTheDocument();
});

/* the review's own half, slice 11.1 */
it("lists what to confirm: what isn't known yet; the profit is the head's to say", async () => {
  face();
  expect(await screen.findByText("Core hole 200 mm: not known yet")).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "To confirm" })).toBeInTheDocument();
  expect(screen.queryByText("Profit 20%, target 20%")).toBeNull();
});

it("marks the option accepted from the corner, says its parts went on the job, and shows what goes to ServiceM8", async () => {
  const corner = document.createElement("div");
  document.body.appendChild(corner);
  const onToast = jest.fn();
  let accepted: number[] = [];
  (global as unknown as { fetch: unknown }).fetch = jest.fn(async (_url: string, init?: { body?: string }) => {
    if (init?.body) {
      posted.push(JSON.parse(init.body));
      accepted = [0];
    }
    return { json: async () => ({ ...view([indoor]), accepted, onJob: init?.body ? { added: 1, removed: 0 } : null }) };
  });
  render(
    <QuoteLinesFace job="job-3377" price={price} actionsEl={corner} onPriced={jest.fn()} onToast={onToast} send={<p>To ServiceM8</p>} />
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
  corner.remove();
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
  await screen.findByText("Ducted indoor, under the floor");
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
  unmount();

  loading = { 0: { pct: 12, reason: "Parapet access" } };
  face();
  expect(await screen.findByText("Hidden from the customer")).toBeInTheDocument();
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
  await screen.findByText("Ducted indoor, under the floor");
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
  expect(await screen.findByText("Not at AAD: Rexel")).toBeInTheDocument();
  const pick = screen.getByLabelText("Buy from, for this job");
  expect(pick).toHaveValue("aad");
  await act(async () => {
    fireEvent.change(pick, { target: { value: "rexel" } });
  });
  expect(posted).toContainEqual({ job: "job-3377", op: "supplier", key: "rexel" });
});

describe("the proposal (7.1)", () => {
  const corner = () => {
    const el = document.createElement("div");
    document.body.appendChild(el);
    render(<QuoteLinesFace job="job-3377" price={price} actionsEl={el} onPriced={jest.fn()} meta={{ title: "Air conditioning for 12 Smith St", client: "Jo Bloggs", site: "12 Smith St", jobNumber: "3377" }} />);
    return el;
  };

  it("Preview proposal shows the paper, Approve says this version is right", async () => {
    const el = corner();
    fireEvent.click(await within(el).findByRole("button", { name: "Preview proposal" }));
    expect(screen.getByRole("article", { name: "The proposal" })).toHaveTextContent("Jo Bloggs");
    expect(screen.getByRole("heading", { name: "Air conditioning for 12 Smith St" })).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(within(el).getByRole("button", { name: "Approve" }));
    });
    expect(posted.at(-1)).toMatchObject({ op: "approve" });
    fireEvent.click(within(el).getByRole("button", { name: "Back to the lines" }));
    expect(screen.queryByRole("article", { name: "The proposal" })).not.toBeInTheDocument();
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
  const el = document.createElement("div");
  document.body.appendChild(el);
  const second = { ...core, id: "l3", optionIndex: 1, name: "Core hole 100 mm" };
  (global as unknown as { fetch: unknown }).fetch = jest.fn(async () => ({ json: async () => view([indoor, core, second]) }));
  render(<QuoteLinesFace job="job-3377" price={price} actionsEl={el} onPriced={jest.fn()} />);
  fireEvent.click(await within(el).findByRole("button", { name: "Preview proposal" }));
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
    const list = await screen.findByRole("list", { name: "The tasks in Rough-in: 2 people, 1 day" });
    expect(within(list).getByLabelText("Hours for Travel and setup")).toHaveValue("5 h");
    expect(within(list).getByText("Changed, was 4 h")).toBeInTheDocument();
    expect(screen.getByText("11 h, 2 people for half a day")).toBeInTheDocument();
    /* read, not typed: a change is to a task */
    expect(screen.queryByLabelText("Quantity of Rough-in: 2 people, 1 day")).toBeNull();
  });

  it("an hour typed changes the line's tasks, keeping what Tiff had", async () => {
    labourOnly();
    face();
    const hours = await screen.findByLabelText("Hours for Travel and setup");
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
    fireEvent.click(await screen.findByRole("button", { name: "Add a task" }));
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

describe("the head (Isaac, 10 Oct: one ledger, as Analytics draws its top line)", () => {
  const only = (lines: QuoteLine[], extra: Record<string, unknown> = {}) => {
    (global as unknown as { fetch: unknown }).fetch = jest.fn(async () => ({ json: async () => ({ ...view(lines), ...extra }) }));
  };

  it("says the profit stands once nothing is left to confirm", async () => {
    only([indoor]);
    face();
    expect(await screen.findByText("20%, at your 20%")).toHaveClass("ok");
    expect(screen.getByText("Units").closest(".ql-lc")).toHaveTextContent("$1,334.38");
  });

  it("names each option on its button", async () => {
    only([indoor, { ...indoor, id: "l3", optionIndex: 1 }], { optionNames: ["Mitsubishi Electric ducted", ""] });
    face();
    expect(await screen.findByRole("tab", { name: /1\. Mitsubishi Electric ducted/ })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Option 2/ })).toBeInTheDocument();
  });
});

it("shows an estimate on its line and in To confirm, and confirms it from there", async () => {
  const cons = line({ id: "l7", system: "Downstairs", group: "Allowances", name: "Consumables", code: null, supplierKey: null, kind: "material", costCents: 1542, source: "assumed", why: "An estimate from your book: duct tape, cable ties, silicone", estimate: true });
  (global as unknown as { fetch: unknown }).fetch = jest.fn(async (_url: string, init?: { body?: string }) => {
    if (init?.body) posted.push(JSON.parse(init.body));
    return { json: async () => view([indoor, cons]) };
  });
  face();
  expect(await screen.findByText("Estimate")).toBeInTheDocument();
  expect(screen.getByText("Consumables: An estimate from your book: duct tape, cable ties, silicone")).toBeInTheDocument();
  /* the head counts it to confirm */
  expect(screen.getByText(/1 to confirm/, { selector: "em" })).toBeInTheDocument();
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
    options: [0, 1]
      .filter((i) => ls.some((l) => l.optionIndex === i))
      .map((i) => ({ name: `Option ${i + 1}`, build: priceBuildUp(ls.filter((l) => l.optionIndex === i).map(buildLineOf), [], settings2), unpriced: [], rows: 1, labourFrom: "none" as const, profit: null })),
  });
  const variation = { n: 1, option: 1, of: 0, what: "Client wants the upstairs hallway done too.", startedAt: "2026-10-15T00:00:00Z", startedBy: "u-isaac", approvedAt: null, acceptedAt: null };

  it("starts from Update quote on an accepted quote, asking what's changing", async () => {
    const corner = document.createElement("div");
    document.body.appendChild(corner);
    (global as unknown as { fetch: unknown }).fetch = jest.fn(async (_url: string, init?: { body?: string }) => {
      if (init?.body) posted.push(JSON.parse(init.body));
      return { json: async () => (init?.body ? { ...view([indoor, diffuser, ...varied]), accepted: [0], variations: [variation], opened: 1 } : { ...view([indoor, diffuser]), accepted: [0] }) };
    });
    render(<QuoteLinesFace job="job-3377" price={priceFor([indoor, diffuser])} actionsEl={corner} onPriced={jest.fn()} />);
    fireEvent.click(await within(corner).findByRole("button", { name: "Update quote" }));
    const dialog = screen.getByRole("dialog", { name: "Update quote" });
    expect(within(dialog).getByText(/is accepted, so this is a variation/)).toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText("What's changing"), { target: { value: "Client wants the upstairs hallway done too." } });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Start variation 1" }));
    });
    expect(posted).toContainEqual({ job: "job-3377", op: "variation", what: "Client wants the upstairs hallway done too." });
    corner.remove();
  });

  it("says its own price as the difference, what it adds or changes, and goes to the client on its own paper", async () => {
    const corner = document.createElement("div");
    document.body.appendChild(corner);
    (global as unknown as { fetch: unknown }).fetch = jest.fn(async (_url: string, init?: { body?: string }) => {
      if (init?.body) posted.push(JSON.parse(init.body));
      return { json: async () => ({ ...view([indoor, diffuser, ...varied]), accepted: [0], variations: [variation], ...(init?.body ? { onJob: { added: 1, removed: 0 } } : {}) }) };
    });
    const onToast = jest.fn();
    render(<QuoteLinesFace job="job-3377" price={priceFor([indoor, diffuser, ...varied])} actionsEl={corner} onPriced={jest.fn()} onToast={onToast} meta={{ title: "Ducted", client: "Andrew", site: null, jobNumber: "3377" }} />);
    fireEvent.click(await screen.findByRole("tab", { name: /Variation 1/ }));
    /* one more diffuser at $12.89 + 40%, the line rounded to the cent */
    expect(screen.getByRole("tab", { name: /Variation 1/ })).toHaveTextContent("+$18.04");
    expect(screen.getByText("Variation 1, ex GST")).toBeInTheDocument();
    expect(screen.getByText(/^New total /)).toBeInTheDocument();
    expect(document.querySelectorAll(".ql-vs")).toHaveLength(1);
    expect(document.querySelector(".ql-vs")).toHaveTextContent("Changed");
    expect(within(corner).queryByRole("button", { name: "Update quote" })).toBeNull();
    fireEvent.click(within(corner).getByRole("button", { name: "Preview variation" }));
    const paper = within(screen.getByRole("article", { name: "Variation 1" }));
    expect(paper.getByText("Client wants the upstairs hallway done too.")).toBeInTheDocument();
    expect(paper.getByText("CONE DIFFUSER PLASTIC 200")).toBeInTheDocument();
    expect(paper.getByText("+$18.04")).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(within(corner).getByRole("button", { name: "Approve" }));
    });
    expect(posted).toContainEqual({ job: "job-3377", op: "variation-approve", option: 1 });
    await act(async () => {
      fireEvent.click(within(corner).getByRole("button", { name: "Mark variation 1 accepted" }));
    });
    expect(posted).toContainEqual({ job: "job-3377", op: "variation-accept", option: 1 });
    expect(onToast).toHaveBeenCalledWith("The variation's new work is on the job's task list, and its new parts on the materials list");
    corner.remove();
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
    const corner = document.createElement("div");
    document.body.appendChild(corner);
    (global as unknown as { fetch: unknown }).fetch = jest.fn(async (_url: string, init?: { body?: string }) => {
      if (init?.body) posted.push(JSON.parse(init.body));
      return { json: async () => ({ ...view([indoor, core]), ...answer }) };
    });
    render(<QuoteLinesFace job="job-3377" price={price} actionsEl={corner} onPriced={jest.fn()} meta={{ title: "Ducted", client: "Andrew", site: null, jobNumber: "3377" }} />);
    return corner;
  };

  it("starts from Update quote on an approved quote nobody has accepted", async () => {
    const corner = mount({ approved: true });
    fireEvent.click(await within(corner).findByRole("button", { name: "Update quote" }));
    const dialog = screen.getByRole("dialog", { name: "Update quote" });
    expect(within(dialog).getByText(/is approved, so this is version 2\. Version 1 is kept as it stands, the approval comes off/)).toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText("What's changing"), { target: { value: "Client wants a bigger unit in the lounge." } });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Start version 2" }));
    });
    expect(posted).toContainEqual({ job: "job-3377", op: "version", what: "Client wants a bigger unit in the lounge." });
    corner.remove();
  });

  it("isn't offered on a quote not yet approved", async () => {
    const corner = mount({});
    await within(corner).findByRole("button", { name: "Preview proposal" });
    expect(within(corner).queryByRole("button", { name: "Update quote" })).toBeNull();
    corner.remove();
  });

  it("says the version it's at, and opens a past one as it stood, read only", async () => {
    const corner = mount({ versions: [kept] });
    expect(await screen.findByText("Version 2")).toBeInTheDocument();
    const rail = within(screen.getByRole("list", { name: "Versions" }));
    expect(rail.getByText("Option 1: $1,467.82 inc GST")).toBeInTheDocument();
    fireEvent.click(rail.getByRole("button", { name: "Open" }));
    const paper = within(screen.getByRole("article", { name: "Version 1" }));
    expect(paper.getByText("Client wants a bigger unit in the lounge.")).toBeInTheDocument();
    expect(paper.getByText("What changed for version 2")).toBeInTheDocument();
    expect(paper.getByText("Ducted indoor, under the floor")).toBeInTheDocument();
    expect(paper.getByText("$1,467.82")).toBeInTheDocument();
    /* nothing to approve or accept on a kept version */
    expect(within(corner).queryByRole("button", { name: "Approve" })).toBeNull();
    expect(within(corner).queryByRole("button", { name: "Mark accepted" })).toBeNull();
    fireEvent.click(within(corner).getByRole("button", { name: "Back to the lines" }));
    expect(screen.queryByRole("article", { name: "Version 1" })).not.toBeInTheDocument();
    corner.remove();
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
  const corner = document.createElement("div");
  document.body.appendChild(corner);
  render(<QuoteLinesFace job="job-3377" price={null} actionsEl={corner} onPriced={jest.fn()} />);
  expect(await screen.findByLabelText("Quantity of Ducted indoor, under the floor")).toHaveValue("1");
  expect(screen.queryByLabelText("What one Ducted indoor, under the floor costs you")).toBeNull();
  expect(screen.queryByLabelText("What one Ducted indoor, under the floor sells for")).toBeNull();
  expect(screen.queryByRole("columnheader", { name: "Sell each" })).toBeNull();
  expect(document.querySelector(".ql-led")).toBeNull();
  expect(screen.queryByLabelText("Search your book for a line to add")).toBeNull();
  expect(within(corner).queryByRole("button", { name: "Preview proposal" })).toBeNull();
  expect(within(corner).queryByRole("button", { name: /Mark accepted/ })).toBeNull();
  /* the work is still theirs */
  expect(screen.getByRole("button", { name: "Add a line by hand" })).toBeInTheDocument();
  corner.remove();
});

/* Isaac, 2026-10-03: "if a quote has been generated in sm8 it should show on
   our quote page"; retiring the old builder, it heads the list on the right
   of the lines too */
it("shows ServiceM8's quote at the top of the list on the right, its PDF opening there", async () => {
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
  render(
    <QuoteLinesFace
      job="job-3377"
      price={price}
      actionsEl={null}
      onPriced={jest.fn()}
     
      sm8={{ papers: [paper], sentOn: "2026-10-01", value: "$45,430 inc GST" }}
      onOpenPaper={onOpenPaper}
    />
  );
  const group = await screen.findByRole("region", { name: "Quote from ServiceM8" });
  expect(within(group).getByText("Sent Thu 1 Oct, $45,430 inc GST")).toBeInTheDocument();
  fireEvent.click(within(group).getByRole("button", { name: /Quote #3377/ }));
  expect(onOpenPaper).toHaveBeenCalledWith(paper);
});

it("shows no ServiceM8 quote on a job ServiceM8 never quoted", async () => {
  render(<QuoteLinesFace job="job-3377" price={price} actionsEl={null} onPriced={jest.fn()} sm8={{ papers: [], sentOn: null, value: null }} />);
  expect(await screen.findByText("Ducted indoor, under the floor")).toBeInTheDocument();
  expect(screen.queryByText("Quote from ServiceM8")).toBeNull();
});
