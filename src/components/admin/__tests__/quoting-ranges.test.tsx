/* The ranges that come in sizes, on Price book › What prices each part
   (Isaac, 2026-10-04: "you pick one item, say your Y 14-10-10, and Tiff
   finds the same range's other sizes in your price book for you to confirm
   once"). A part's row in its group of the common install items opens its
   range in a dialog (28 October 2026). */
import { act, fireEvent, render as draw, screen, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { ToastProvider } from "@/components/parts/toast";
import { CommonItems } from "../common-items";
import { RANGE_KEYS, type CandidateLine, type RangeView } from "@/lib/quotes/ranges";

const render = (ui: ReactElement) => draw(<ToastProvider>{ui}</ToastProvider>);

const empty: RangeView[] = RANGE_KEYS.map((kind) => ({ kind, items: [] }));

const Items = ({ ranges }: { ranges: RangeView[] }) => (
  <CommonItems components={[]} ranges={ranges} suppliers={[]} groupSuppliers={{}} busy={false} wrong={null} onChoose={jest.fn()} onBuyFrom={jest.fn()} />
);

/** A group opened, a part's row in it, and its button that opens the range. */
const inGroup = (group: string) => {
  if (!screen.queryByRole("dialog", { name: group })) fireEvent.click(screen.getByRole("button", { name: `Open ${group}` }));
  return within(screen.getByRole("dialog", { name: group }));
};
const rowOf = (group: string, label: string) => inGroup(group).getByText(label).closest('[role="row"]') as HTMLElement;
const openRange = (group: string, label: string) => within(rowOf(group, label)).getByRole("button", { name: /the range of/ });

const ys: CandidateLine[] = [
  {
    key: "aad|AIRLOC SMARTFIT Y INS",
    label: "Airloc smartfit Y ins",
    supplierKey: "aad",
    supplierName: "AAD",
    quotes: 12,
    items: [
      { code: "AY141010", name: "AIRLOC SMARTFIT Y 14-10-10 INS", size: { ins: [350], outs: [250, 250] }, words: "Ø350 → Ø250 / Ø250", buyCents: 3031 },
      { code: "AY121010", name: "AIRLOC SMARTFIT Y 12-10-10 INS", size: { ins: [300], outs: [250, 250] }, words: "Ø300 → Ø250 / Ø250", buyCents: 2283 },
    ],
  },
  {
    key: "aad|BTO INSULATED",
    label: "BTO insulated",
    supplierKey: "aad",
    supplierName: "AAD",
    quotes: 3,
    items: [
      { code: "B1086I", name: "BTO 250.200.150 INSULATED", size: { ins: [250], outs: [200, 150] }, words: "Ø250 → Ø200 / Ø150", buyCents: 1710 },
      { code: "B161414I", name: "BTO 400.400/350.350 INSULATED", size: null, words: "", buyCents: 4325 },
    ],
  },
  {
    key: "aad|AIRLOC SMARTFIT Y INS KEY",
    label: "Airloc smartfit Y ins key",
    supplierKey: "aad",
    supplierName: "AAD",
    quotes: 0,
    items: [{ code: "AY141212", name: "AIRLOC SMARTFIT Y 14-12-12 INS KEY", size: { ins: [350], outs: [300, 300] }, words: "Ø350 → Ø300 / Ø300", buyCents: 3031 }],
  },
];

it("lists every part that comes in sizes in its group, none chosen for a new business", () => {
  render(<Items ranges={empty} />);
  const ductwork = inGroup("Ductwork");
  for (const name of ["Flexible duct", "Ys and BTOs", "Reducers", "Supply plenum", "Return plenum", "Zone damper"]) {
    const row = ductwork.getByText(name).closest('[role="row"]') as HTMLElement;
    expect(within(row).getByText("Every size in your book")).toBeInTheDocument();
    expect(within(row).getByText("Lowest price")).toBeInTheDocument();
    expect(within(row).getByRole("button", { name: /^Choose the range of/ })).toHaveTextContent("Choose range");
  }
  expect(ductwork.getAllByText("All sizes, by Ø")).toHaveLength(2);
});

it("makes a range from one product line: its sizes laid out ticked, the line's key sizes with them, and added on one press", async () => {
  const posted: unknown[] = [];
  global.fetch = jest.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === "POST") {
      posted.push(JSON.parse(String(init.body)));
      return {
        json: async () => ({
          ok: true,
          range: {
            kind: "fitting",
            items: [
              { supplierKey: "aad", supplierName: "AAD", code: "AY141010", name: "AIRLOC SMARTFIT Y 14-10-10 INS", size: { ins: [350], outs: [250, 250] }, words: "Ø350 → Ø250 / Ø250", buyCents: 3031 },
              { supplierKey: "aad", supplierName: "AAD", code: "AY141212", name: "AIRLOC SMARTFIT Y 14-12-12 INS KEY", size: { ins: [350], outs: [300, 300] }, words: "Ø350 → Ø300 / Ø300", buyCents: 3031 },
            ],
          },
        }),
      } as Response;
    }
    expect(url).toBe("/api/quoting/ranges?kind=fitting");
    return { json: async () => ({ ok: true, lines: ys }) } as Response;
  }) as unknown as typeof fetch;

  render(<Items ranges={empty} />);
  const fittings = openRange("Ductwork", "Ys and BTOs");
  await act(async () => {
    fireEvent.click(fittings);
  });
  expect(screen.getByRole("dialog", { name: "Ys and BTOs" })).toBeInTheDocument();
  /* the lines the business's quotes use most come first, as the server sorts them */
  const offered = screen.getByRole("list", { name: "Ys and BTOs in your price book" });
  expect(within(offered).getAllByRole("listitem").map((li) => li.textContent)).toEqual([
    "Airloc smartfit Y ins, AAD2 sizes, on 12 quotesUse this line",
    "BTO insulated, AAD1 size, on 3 quotesUse this line",
    "Airloc smartfit Y ins key, AAD1 sizeUse this line",
  ]);
  fireEvent.click(within(offered).getAllByRole("button", { name: "Use this line" })[0]!);

  expect(screen.getByRole("heading", { name: "Airloc smartfit Y ins, AAD" })).toBeInTheDocument();
  const names = ["Ø350 → Ø250 / Ø250, AY141010", "Ø300 → Ø250 / Ø250, AY121010", "Ø350 → Ø300 / Ø300, AY141212"];
  expect(screen.getAllByRole("checkbox")).toHaveLength(3);
  for (const name of names) expect(screen.getByRole("checkbox", { name })).toBeChecked();
  /* a person takes one out before adding */
  fireEvent.click(screen.getByRole("checkbox", { name: names[1] }));
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Add 2 sizes" }));
  });
  expect(posted).toEqual([
    {
      kind: "fitting",
      add: [
        { supplierKey: "aad", code: "AY141010", size: { ins: [350], outs: [250, 250] } },
        { supplierKey: "aad", code: "AY141212", size: { ins: [350], outs: [300, 300] } },
      ],
      remove: [],
    },
  ]);
  expect(screen.getByText("Ys and BTOs: 2 sizes added")).toBeInTheDocument();
  /* the fittings a size a row, as the trade says them, each its item, code, supplier and price */
  fireEvent.click(within(screen.getByRole("dialog", { name: "Ys and BTOs" })).getByRole("button", { name: "Done" }));
  const y = rowOf("Ductwork", "Y 14-10-10");
  expect(within(y).getByText("Ø350 → Ø250 / Ø250")).toBeInTheDocument();
  expect(within(y).getByText("AIRLOC SMARTFIT Y 14-10-10 INS")).toBeInTheDocument();
  expect(within(y).getByText("AY141010")).toBeInTheDocument();
  expect(within(y).getByText("AAD")).toBeInTheDocument();
  expect(within(y).getByText("$30.31")).toBeInTheDocument();
  expect(rowOf("Ductwork", "Y 14-12-12")).toBeInTheDocument();
});

it("says which items have no size in their name, and never offers them", async () => {
  global.fetch = jest.fn(async () => ({ json: async () => ({ ok: true, lines: ys }) })) as unknown as typeof fetch;
  render(<Items ranges={empty} />);
  const fittings = openRange("Ductwork", "Ys and BTOs");
  await act(async () => {
    fireEvent.click(fittings);
  });
  fireEvent.click(within(screen.getByRole("list", { name: "Ys and BTOs in your price book" })).getAllByRole("button", { name: "Use this line" })[1]!);
  expect(screen.getAllByRole("checkbox")).toHaveLength(1);
  expect(screen.getByText("No size in the name, so not offered: BTO 400.400/350.350 INSULATED.")).toBeInTheDocument();
});

it("lets a bracket say the widest outdoor it takes", async () => {
  const posted: { add: { size: unknown }[] }[] = [];
  global.fetch = jest.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === "POST") {
      posted.push(JSON.parse(String(init.body)));
      return { json: async () => ({ ok: true, range: { kind: "wall_bracket", items: [] } }) } as Response;
    }
    return {
      json: async () => ({
        ok: true,
        lines: [
          {
            key: "aad|CON WALL BRACKET",
            label: "Con wall bracket",
            supplierKey: "aad",
            supplierName: "AAD",
            quotes: 4,
            items: [
              { code: "CWB180", name: "CON WALL BRACKET 180KG W:450 H:350 L:700", size: { kg: 180 }, words: "180 kg", buyCents: 3079 },
              { code: "CWBX", name: "CON WALL BRACKET 250KG W:550 H:450 L:850", size: { kg: 250 }, words: "250 kg", buyCents: 4865 },
            ],
          },
        ],
      }),
    } as Response;
  }) as unknown as typeof fetch;
  render(<Items ranges={empty} />);
  const brackets = openRange("Mounting", "Outdoor unit wall bracket");
  await act(async () => {
    fireEvent.click(brackets);
  });
  fireEvent.click(screen.getByRole("button", { name: "Use this line" }));
  fireEvent.change(screen.getByLabelText("Widest outdoor CWB180 takes, mm"), { target: { value: "900" } });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Add 2 sizes" }));
  });
  expect(posted[0]!.add.map((a) => a.size)).toEqual([
    { kg: 180, maxWidthMm: 900 },
    { kg: 250, maxWidthMm: null },
  ]);
});

it("takes a product line out of a range", async () => {
  const posted: unknown[] = [];
  global.fetch = jest.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === "POST") {
      posted.push(JSON.parse(String(init.body)));
      return { json: async () => ({ ok: true, range: { kind: "zone_damper", items: [] } }) } as Response;
    }
    return { json: async () => ({ ok: true, lines: [] }) } as Response;
  }) as unknown as typeof fetch;
  const dampers: RangeView = {
    kind: "zone_damper",
    items: [
      { supplierKey: "advantage_air", supplierName: "Advantage Air", code: "CEMOD20", name: "'Clip-in' motorised damper 200 dia", size: { mm: 200 }, words: "Ø200", buyCents: 3524 },
      { supplierKey: "advantage_air", supplierName: "Advantage Air", code: "CEMOD25", name: "'Clip-in' motorised damper 250 dia", size: { mm: 250 }, words: "Ø250", buyCents: 3674 },
    ],
  };
  render(<Items ranges={empty.map((r) => (r.kind === "zone_damper" ? dampers : r))} />);
  const row = rowOf("Ductwork", "Zone damper");
  expect(within(row).getByText("Clip-in motorised damper")).toBeInTheDocument();
  expect(within(row).getByText("Advantage Air")).toBeInTheDocument();
  expect(within(row).getByText("2 sizes")).toBeInTheDocument();
  expect(within(row).getByText("from $35.24")).toBeInTheDocument();
  await act(async () => {
    fireEvent.click(within(row).getByRole("button", { name: "Change the range of zone dampers" }));
  });
  expect(screen.getByText("Ø200, Ø250")).toBeInTheDocument();
  expect(screen.getByText("Nothing in your price book reads as zone dampers with a size in its name.")).toBeInTheDocument();
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Take it out" }));
  });
  expect(screen.getByText("Zone dampers: 2 sizes taken out")).toBeInTheDocument();
  expect(posted).toEqual([
    {
      kind: "zone_damper",
      add: [],
      remove: [
        { supplierKey: "advantage_air", code: "CEMOD20" },
        { supplierKey: "advantage_air", code: "CEMOD25" },
      ],
    },
  ]);
  expect(within(rowOf("Ductwork", "Zone damper")).getByText("Every size in your book")).toBeInTheDocument();
});
