import { act, fireEvent, render, screen } from "@testing-library/react";
import { CompareCard } from "../compare-card";

/* Compare on a unit line (slice 10.2): the unit on the quote beside the
   book's, what each sells for and is, Use on option N, and the box that
   takes what to compare it with in the person's words. */

const col = (o: Record<string, unknown>) => ({
  current: false,
  indoor: { name: "Daikin Cora 7.1", code: "FTXV71WVMA", supplierKey: "aad", costCents: 45604, brand: "Daikin" },
  outdoor: { name: "Outdoor", code: "RXV71WVMA", supplierKey: "aad", costCents: 106410, brand: "Daikin" },
  sellCents: 190018,
  diffCents: null,
  cooling: "7.1 kW, from its name",
  indoorSpec: null,
  outdoorSpec: null,
  pipe: null,
  pairedBy: "On the quote",
  ...o,
});
const view = {
  ok: true,
  line: { id: "l1", name: "Daikin Cora 7.1", system: "Downstairs", option: 0 },
  columns: [
    col({ current: true }),
    col({
      indoor: { name: "MSZ-AP80", code: "MSZ-AP80VGKD2", supplierKey: "aad", costCents: 60000, brand: "Mitsubishi Electric" },
      outdoor: { name: "MUZ-AP80", code: "MUZ-AP80VGD2", supplierKey: "aad", costCents: 130000, brand: "Mitsubishi Electric" },
      sellCents: 256729,
      diffCents: 66711,
      cooling: "7.8 kW, 9.0 kW heating",
      indoorSpec: "1,100 × 325 × 257 mm, 17 kg, 30 to 53 dB(A)",
      outdoorSpec: "880 mm tall, 53 kg, 16 A",
      pipe: "1/4 + 1/2",
      pairedBy: "Your book: same brand, type and size",
    }),
  ],
};

let posted: Record<string, unknown>[] = [];
const respondWith = (answer: Record<string, unknown>) =>
  jest.fn(async (_u: string, init?: { body?: string }) => {
    if (init?.body) {
      posted.push(JSON.parse(init.body));
      return { json: async () => answer };
    }
    return { json: async () => view };
  });

beforeEach(() => {
  posted = [];
});

it("sets the unit on the quote beside the book's, each priced, with its specs or no data pack", async () => {
  (global as unknown as { fetch: unknown }).fetch = respondWith({ ok: true });
  render(<CompareCard job="j" lineId="l1" onClose={jest.fn()} onChanged={jest.fn()} />);
  expect(await screen.findByText("Downstairs on option 1, side by side")).toBeInTheDocument();
  expect(screen.getByText("+$667.11")).toBeInTheDocument();
  expect(screen.getByText("On option 1")).toBeInTheDocument();
  expect(screen.getAllByText("No data pack").length).toBeGreaterThan(0);
  expect(screen.getByText("880 mm tall, 53 kg, 16 A")).toBeInTheDocument();
});

it("puts a compared unit on the quote", async () => {
  const onChanged = jest.fn();
  (global as unknown as { fetch: unknown }).fetch = respondWith({ ok: true });
  render(<CompareCard job="j" lineId="l1" onClose={jest.fn()} onChanged={onChanged} />);
  const use = await screen.findByRole("button", { name: "Use on option 1" });
  await act(async () => {
    fireEvent.click(use);
  });
  expect(posted).toContainEqual({ job: "j", line: "l1", use: "MSZ-AP80VGKD2" });
  expect(onChanged).toHaveBeenCalled();
});

it("takes what to compare it with in the person's words, and says when Tiff is picking", async () => {
  (global as unknown as { fetch: unknown }).fetch = respondWith({ ok: true, toTiff: true });
  render(<CompareCard job="j" lineId="l1" onClose={jest.fn()} onChanged={jest.fn()} />);
  fireEvent.change(await screen.findByLabelText("What to compare it with"), { target: { value: "Something quieter that still covers the open plan" } });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Compare" }));
  });
  expect(posted).toContainEqual({ job: "j", line: "l1", ask: "Something quieter that still covers the open plan" });
  expect(screen.getByText("Tiff is picking from your book: it shows here when she's added it.")).toBeInTheDocument();
});

it("says why when nothing matched and Tiff is off", async () => {
  (global as unknown as { fetch: unknown }).fetch = respondWith({ ok: false, reason: "Nothing in your book matched that. Ask by a model, or a brand and a size." });
  render(<CompareCard job="j" lineId="l1" onClose={jest.fn()} onChanged={jest.fn()} />);
  fireEvent.change(await screen.findByLabelText("What to compare it with"), { target: { value: "a Fujitsu around 9 kW" } });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Compare" }));
  });
  expect(screen.getByText("Nothing in your book matched that. Ask by a model, or a brand and a size.")).toBeInTheDocument();
});
