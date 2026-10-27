import { act, fireEvent, render, screen, within } from "@testing-library/react";

const refresh = jest.fn();
jest.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
jest.mock("@/app/actions/quote-settings", () => ({ saveQuoteSettings: jest.fn() }));

import { ToastProvider } from "@/components/parts/toast";
import { PricedParts, type PricedPartsData } from "../priced-parts";
import { DEFAULT_QUOTE_SETTINGS } from "@/lib/quotes/settings";
import { saveQuoteSettings } from "@/app/actions/quote-settings";
import type { ComponentShortlist } from "@/lib/quotes/settings-query";

const saveQuoteSettingsMock = saveQuoteSettings as jest.Mock;

/* Price book › What prices each part (it was on Quoting until 25 October
   2026): the common install items in their groups (28 October 2026), each
   part's item opened from its group, the swaps made often enough to ask
   about, and the kits. */

const coil: ComponentShortlist = {
  key: "pair_coil_14_12",
  label: "Pair coil 1/4 + 1/2",
  unit: "m",
  chosen: {
    group: { code: "PC1412", name: "PAIRED COIL 1/4+1/2X20M", rollM: 20, uses: 12, offers: [] },
    offer: { supplierKey: "aad", supplierName: "AAD", code: "PC1412", pack: "20 m coil", buyCents: 19100, perUnitCents: 955 },
    overridden: false,
  },
  groups: [
    {
      code: "PC1412",
      name: "PAIRED COIL 1/4+1/2X20M",
      rollM: 20,
      uses: 12,
      offers: [
        { supplierKey: "aad", supplierName: "AAD", code: "PC1412", pack: "20 m coil", buyCents: 19100, perUnitCents: 955 },
        { supplierKey: "reece", supplierName: "Reece", code: "9800006-1", pack: "20 m coil", buyCents: 19438, perUnitCents: 972 },
      ],
    },
  ],
};

const data = (over: Partial<PricedPartsData> = {}): PricedPartsData => ({
  settings: { ...DEFAULT_QUOTE_SETTINGS, materialMarkupPct: 40 },
  components: [coil],
  ranges: [],
  habits: [],
  suppliers: [
    { key: "aad", name: "AAD" },
    { key: "reece", name: "Reece" },
  ],
  ...over,
});

const draw = (d: PricedPartsData) =>
  render(
    <ToastProvider>
      <PricedParts {...d} />
    </ToastProvider>
  );

beforeEach(() => {
  saveQuoteSettingsMock.mockReset();
  refresh.mockReset();
  /* the kits ask for their preview; nothing priced */
  (global as unknown as { fetch: unknown }).fetch = jest.fn(async () => ({ ok: true, json: async () => ({ ok: false }) }));
});

/** A group of the common install items, opened. */
const openGroup = (label: string) => {
  fireEvent.click(screen.getByRole("button", { name: `Open ${label}` }));
  return within(screen.getByRole("dialog", { name: label }));
};

it("lists the common install items in eight groups, each with where its parts come from", () => {
  draw(data());
  const table = screen.getByRole("table", { name: "Common install items" });
  const rows = within(table).getAllByRole("row").slice(1);
  expect(rows.map((r) => r.querySelector("b")?.textContent)).toEqual(["Pipe", "Cable and power", "Drain", "Mounting", "Covering", "Ductwork", "Grilles and outlets", "Controls"]);
  expect(within(rows[0]!).getByText("AAD")).toBeInTheDocument();
  expect(within(rows[5]!).getByText("Lowest price")).toBeInTheDocument();
});

it("opens a group: each part by its name and what it is, then the item, its code, where it's from and what it costs", () => {
  draw(data());
  const pipe = openGroup("Pipe");
  const row = pipe.getByText("Pair coil 1/4 + 1/2").closest('[role="row"]') as HTMLElement;
  expect(within(row).getByText("Insulated, by the coil")).toBeInTheDocument();
  expect(within(row).getByText("PAIRED COIL 1/4+1/2X20M")).toBeInTheDocument();
  expect(within(row).getByText("PC1412, 20 m coil")).toBeInTheDocument();
  expect(within(row).getByText("AAD")).toBeInTheDocument();
  expect(within(row).getByText("$9.55 a metre")).toBeInTheDocument();
  /* a part nothing has priced yet says so */
  const other = pipe.getByText("Pair coil 3/8 + 3/4").closest('[role="row"]') as HTMLElement;
  expect(within(other).getByText("Nothing chosen yet")).toBeInTheDocument();
});

it("chooses another item to price a component, from its shortlist", async () => {
  saveQuoteSettingsMock.mockImplementation(async (s) => ({ ok: true, settings: s }));
  draw(data());
  fireEvent.click(openGroup("Pipe").getByRole("button", { name: "Choose what prices Pair coil 1/4 + 1/2" }));
  const dialog = within(screen.getByRole("dialog", { name: "What prices pair coil 1/4 + 1/2" }));
  /* the item in use says so; the lowest of several is in the state's green */
  expect(dialog.getByText("In use")).toBeInTheDocument();
  expect(dialog.getByText("$9.55")).toHaveClass("st2-pb-low");
  await act(async () => {
    fireEvent.click(dialog.getByRole("button", { name: "Use 9800006-1 from Reece" }));
  });
  expect(saveQuoteSettingsMock).toHaveBeenCalledWith(
    expect.objectContaining({ preferred: { pair_coil_14_12: { supplierKey: "reece", code: "9800006-1", rollM: null } } })
  );
  expect(screen.queryByRole("dialog", { name: "What prices pair coil 1/4 + 1/2" })).toBeNull();
  expect(screen.getByRole("dialog", { name: "Pipe" })).toBeInTheDocument();
  expect(refresh).toHaveBeenCalled();
});

it("saves a roll length a name doesn't say, and goes back to the lowest", async () => {
  saveQuoteSettingsMock.mockImplementation(async (s) => ({ ok: true, settings: s }));
  const overridden: ComponentShortlist = { ...coil, chosen: { ...coil.chosen!, overridden: true } };
  draw(data({ components: [overridden], settings: { ...DEFAULT_QUOTE_SETTINGS, preferred: { pair_coil_14_12: { supplierKey: "aad", code: "PC1412", rollM: null } } } }));
  const pipe = openGroup("Pipe");
  expect(pipe.getByText("Your pick")).toBeInTheDocument();
  fireEvent.click(pipe.getByRole("button", { name: "Choose what prices Pair coil 1/4 + 1/2" }));
  fireEvent.change(screen.getByLabelText("Roll length of PC1412, metres"), { target: { value: "15" } });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Save the length" }));
  });
  expect(saveQuoteSettingsMock).toHaveBeenLastCalledWith(expect.objectContaining({ preferred: { pair_coil_14_12: { supplierKey: "aad", code: "PC1412", rollM: 15 } } }));
  fireEvent.click(screen.getByRole("button", { name: "Choose what prices Pair coil 1/4 + 1/2" }));
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Go back to the lowest" }));
  });
  expect(saveQuoteSettingsMock).toHaveBeenLastCalledWith(expect.objectContaining({ preferred: {} }));
  expect(screen.queryByRole("dialog", { name: "What prices pair coil 1/4 + 1/2" })).toBeNull();
});

it("says a refused choice in the dialog, and keeps it open", async () => {
  saveQuoteSettingsMock.mockResolvedValue({ ok: false, reason: "The settings couldn't be saved. Try again." });
  draw(data());
  fireEvent.click(openGroup("Pipe").getByRole("button", { name: "Choose what prices Pair coil 1/4 + 1/2" }));
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Use 9800006-1 from Reece" }));
  });
  expect(within(screen.getByRole("dialog", { name: "What prices pair coil 1/4 + 1/2" })).getByRole("alert")).toHaveTextContent("The settings couldn't be saved. Try again.");
});

/* habits, slice 13.2: a swap made again and again, asked about, one press to say yes */
it("asks about a swap made on three quotes, and makes it preferred with one press", async () => {
  const fetchMock = jest.fn(async () => ({ ok: true, json: async () => ({ ok: true }) }));
  (global as unknown as { fetch: unknown }).fetch = fetchMock;
  draw(data({ habits: [{ from: { code: "VB250", name: "Vortex flexible 250" }, to: { code: "VH250", name: "Vortex acoustic 250", supplierKey: "aad" }, quotes: 3 }] }));
  expect(screen.getByText("You've swapped VB250 for VH250 on 3 quotes.")).toBeInTheDocument();
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Make VH250 your preferred" }));
  });
  expect(within(screen.getByRole("list", { name: "Habits" })).getByText("Preferred")).toBeInTheDocument();
  expect(fetchMock).toHaveBeenCalledWith("/api/quoting/preferred", expect.objectContaining({ body: JSON.stringify({ ref: "aad|VH250", on: true }) }));
});

/* Isaac's kits, round 2 (2026-10-11): a kit priced at the business's own
   example, part by part, each sized part's range under it to tick */
it("shows each kit part with how many, what sizes it, and its range from the book, ticking one out", async () => {
  const preview = {
    ok: true,
    unit: { model: "PEA-M125HAA", role: "indoor", coolKw: 12.5 },
    brands: ["mitsubishi-electric"],
    totalCents: 2906,
    parts: [
      {
        key: "ys",
        name: "Y branches",
        rule: "Where the main duct splits to the outlets",
        sizedBy: "By the duct sizes in and out",
        lines: [{ name: "METAL Y 400.300.300 NSW", code: "MY161212", qty: 1, unit: "", eachCents: 2906, totalCents: 2906, known: true, why: "" }],
        range: {
          kind: "fitting",
          held: false,
          items: [
            { supplierKey: "aad", supplierName: "AAD", code: "MY161212", name: "METAL Y 400.300.300 NSW", words: "Ø400 → Ø300 / Ø300", size: { ins: [400], outs: [300, 300] }, cents: 2906, ticked: true, used: true },
            { supplierKey: "aad", supplierName: "AAD", code: "MY1288", name: "METAL Y 300.200.200 NSW", words: "Ø300 → Ø200 / Ø200", size: { ins: [300], outs: [200, 200] }, cents: 2275, ticked: true, used: false },
          ],
        },
      },
    ],
  };
  const posted: Record<string, unknown>[] = [];
  (global as unknown as { fetch: unknown }).fetch = jest.fn(async (url: string, init?: { body?: string }) => {
    if (init?.body) posted.push(JSON.parse(init.body));
    return { ok: true, json: async () => (String(url).startsWith("/api/quoting/kit") ? preview : { ok: true }) };
  });
  draw(data({ components: [] }));
  const ys = within(await screen.findByRole("region", { name: "Y branches" }));
  expect(ys.getByText("Where the main duct splits to the outlets")).toBeInTheDocument();
  expect(ys.getByText("Your range: 2 of 2 in your book, every size until you narrow it")).toBeInTheDocument();
  expect(ys.getByText("At this size")).toBeInTheDocument();
  /* the first untick keeps every other size */
  await act(async () => {
    fireEvent.click(ys.getAllByRole("checkbox")[1]!);
  });
  expect(posted).toContainEqual({ kind: "fitting", add: [{ supplierKey: "aad", code: "MY161212", size: { ins: [400], outs: [300, 300] } }], remove: [] });
});

it("prices a kit at the business's own example, given in its dialog", async () => {
  const asked: string[] = [];
  (global as unknown as { fetch: unknown }).fetch = jest.fn(async (url: string) => {
    asked.push(String(url));
    return { ok: true, json: async () => ({ ok: true, unit: null, brands: ["daikin"], parts: [], totalCents: 0 }) };
  });
  draw(data({ components: [] }));
  await screen.findByText("$0.00");
  fireEvent.click(screen.getByRole("button", { name: "Change the example" }));
  const dialog = within(screen.getByRole("dialog", { name: "Your example" }));
  fireEvent.change(dialog.getByLabelText("The indoor's model"), { target: { value: "FDYAN100" } });
  fireEvent.change(dialog.getByLabelText("Outlets"), { target: { value: "6" } });
  await act(async () => {
    fireEvent.click(dialog.getByRole("button", { name: "Price the kit" }));
  });
  expect(asked.at(-1)).toContain("model=FDYAN100");
  expect(asked.at(-1)).toContain("outlets=6");
  expect(screen.queryByRole("dialog")).toBeNull();
});

/* Buy all from (Isaac, 28 October 2026: "select Voltex and all ductwork will
   be quoted at Voltex"): a group bought from one supplier */
describe("a group bought from one supplier", () => {
  it("saves the supplier chosen for the group, and back to the lowest price", async () => {
    saveQuoteSettingsMock.mockImplementation(async (s) => ({ ok: true, settings: s }));
    draw(data());
    const pipe = openGroup("Pipe");
    fireEvent.click(pipe.getByRole("combobox", { name: "Buy all pipe from" }));
    await act(async () => {
      fireEvent.click(within(screen.getByRole("listbox")).getByRole("option", { name: "Reece" }));
    });
    expect(saveQuoteSettingsMock).toHaveBeenLastCalledWith(expect.objectContaining({ groupSuppliers: { pipe: "reece" } }));
    fireEvent.click(pipe.getByRole("combobox", { name: "Buy all pipe from" }));
    await act(async () => {
      fireEvent.click(within(screen.getByRole("listbox")).getByRole("option", { name: "Lowest price" }));
    });
    expect(saveQuoteSettingsMock).toHaveBeenLastCalledWith(expect.objectContaining({ groupSuppliers: {} }));
  });

  it("names the group's supplier on the page, and says which parts it hasn't got", () => {
    const notAtReece: ComponentShortlist = { ...coil, chosen: { ...coil.chosen!, notAt: "Reece" } };
    draw(data({ components: [notAtReece], settings: { ...DEFAULT_QUOTE_SETTINGS, groupSuppliers: { pipe: "reece" } } }));
    const pipeRow = within(screen.getByRole("table", { name: "Common install items" })).getByText("Pipe").closest('[role="row"]') as HTMLElement;
    expect(within(pipeRow).getByText("Reece")).toBeInTheDocument();
    const row = openGroup("Pipe").getByText("Pair coil 1/4 + 1/2").closest('[role="row"]') as HTMLElement;
    expect(within(row).getByText("Not at Reece")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Buy all pipe from" })).toHaveTextContent("Reece");
  });
});
