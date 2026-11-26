import { fireEvent, render, screen, within } from "@testing-library/react";
import { priceBuildUp } from "@/lib/quotes/buildup";
import type { QuoteLine } from "@/lib/quotes/lines";
import { buildLineOf } from "@/lib/quotes/lines-price";
import { proposalOf } from "@/lib/quotes/lines-proposal";
import type { QuotePrice } from "@/lib/quotes/quote-price-server";
import { NO_BRAND } from "@/lib/org/brand";
import { fmtAud } from "@/lib/workboard/project-money";
import { LinesProposalPaper } from "../lines-proposal-paper";

/* The proposal for a quote built on its lines (slice 7.1, mock-up screen 7):
   option by option, price last, every figure the lines', each block of words
   edited where it sits. */

jest.mock("@/components/studio/summary/use-org-brand", () => ({ useOrgBrand: () => NO_BRAND }));

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
  name: "Ducted indoor 12.5 kW",
  code: "PEA-M125HAA",
  supplierKey: "mitsubishi",
  kind: "unit",
  qty: 1,
  unit: "",
  costCents: 100000,
  sellCents: null,
  source: "said",
  why: "",
  duct: false,
  ...o,
});
const one = line({});
const two = line({ id: "l2", optionIndex: 1, name: "Ducted indoor 14 kW", code: "PEA-M140HAA", costCents: 120000 });
const option = (name: string, l: QuoteLine) => {
  const build = priceBuildUp([buildLineOf(l)], [], settings);
  return { name, build, unpriced: [], rows: 1, labourFrom: "none" as const, profit: { costCents: 0, profitCents: 0, pct: 0, targetPct: 20, hourCostCents: 0, short: null } };
};
const price: QuotePrice = { ok: true, options: [option("Option 1", one), option("Option 2", two)], chargeOutCents: 14000 };

const paper = (over: Partial<Parameters<typeof LinesProposalPaper>[0]> = {}) => {
  const onSave = jest.fn();
  render(
    <LinesProposalPaper
      proposal={proposalOf({ intro: "Thanks for having us out.", options: [{ summary: "The smaller unit.", areas: [{ name: "Roof", items: ["Duct to each room"] }], included: ["Commissioning"] }] })}
      lines={[one, two]}
      price={price}
      optionNames={["Good", ""]}
      noteLibrary={[
        { key: "access", heading: "Access", lines: ["Clear the roof space."], always: false },
        { key: "warranty", heading: "Warranty", lines: ["Five years on the units."], always: true },
      ]}
      paymentTerms={null}
      title="Air conditioning for 12 Smith St"
      client="Jo Bloggs"
      site="12 Smith St"
      preparedBy="Isaac"
      jobNumber="3377"
      busy={false}
      onSave={onSave}
      {...over}
    />,
  );
  return onSave;
};

it("lays out each option with its words, equipment and price, the price last", () => {
  paper();
  const first = screen.getByRole("region", { name: "Option 1" });
  expect(within(first).getByRole("heading", { name: "Good" })).toBeInTheDocument();
  expect(within(first).getByText("The smaller unit.")).toBeInTheDocument();
  expect(within(first).getByText("Duct to each room")).toBeInTheDocument();
  expect(within(first).getByText("Commissioning")).toBeInTheDocument();
  expect(within(first).getByText("12.5 kW")).toBeInTheDocument();
  expect(first.lastElementChild).toHaveClass("lp-price");

  const second = screen.getByRole("region", { name: "Option 2" });
  expect(within(second).getByRole("heading", { name: "Option 2" })).toBeInTheDocument();
  /* a unit option 1 hasn't got is marked */
  expect(within(second).getByText("Added")).toBeInTheDocument();
  /* nothing written yet: an empty box that says so */
  const empty = within(second).getByRole("textbox", { name: "Option 2's summary" });
  expect(empty).toHaveTextContent("");
  expect(empty).toHaveAttribute("data-empty", "No summary written yet.");
});

/* typed where it sits, as on a page in Word (the Price overhaul, 18 November 2026) */
const typeIn = (box: HTMLElement, words: string) => {
  fireEvent.focus(box);
  box.textContent = words;
  fireEvent.input(box);
  fireEvent.blur(box, { relatedTarget: null });
};

it("shows the notes always on, and each option's share of each payment stage", () => {
  paper();
  expect(screen.getByText("Warranty")).toBeInTheDocument();
  expect(screen.queryByText("Access")).not.toBeInTheDocument();
  const pay = screen.getByRole("region", { name: "Payment" });
  const deposit = within(pay).getByRole("row", { name: /Deposit/ });
  const inc = price.ok ? price.options.map((o) => o.build.incGstCents) : [];
  for (const c of inc) expect(deposit).toHaveTextContent(fmtAud(Math.round(c / 10)));
});

it("types a block where it sits, and saves only that block's words as you leave it", () => {
  const onSave = paper();
  expect(screen.queryByRole("button", { name: /^Edit option/ })).toBeNull();
  typeIn(screen.getByRole("textbox", { name: "Option 2's summary" }), "The bigger unit, for the open plan.");
  expect(onSave).toHaveBeenCalledWith({
    options: [
      { summary: "The smaller unit.", areas: [{ name: "Roof", items: ["Duct to each room"] }], included: ["Commissioning"] },
      { summary: "The bigger unit, for the open plan.", areas: [], included: [] },
    ],
  });
});

it("saves nothing when a block is left as it was", () => {
  const onSave = paper();
  typeIn(screen.getByRole("textbox", { name: "The introduction" }), "Thanks for having us out.");
  expect(onSave).not.toHaveBeenCalled();
});

it("types a list one item a line: Enter starts the next, and the list saves as you leave it", () => {
  const onSave = paper();
  const first = screen.getByRole("textbox", { name: "Roof, item 1" });
  fireEvent.focus(first);
  fireEvent.keyDown(first, { key: "Enter" });
  const next = screen.getByRole("textbox", { name: "Roof, item 2" });
  next.textContent = "Outdoor on brackets";
  fireEvent.input(next);
  fireEvent.blur(next, { relatedTarget: null });
  expect(onSave.mock.calls[0]![0].options[0].areas).toEqual([{ name: "Roof", items: ["Duct to each room", "Outdoor on brackets"] }]);
});

it("what isn't included is typed as a list too, and a blank item is left off", () => {
  const onSave = paper();
  const box = screen.getByRole("textbox", { name: "What isn't included, item 1" });
  fireEvent.keyDown(box, { key: "Enter" });
  typeIn(screen.getByRole("textbox", { name: "What isn't included, item 1" }), "Switchboard upgrades");
  expect(onSave).toHaveBeenCalledWith({ notIncluded: ["Switchboard upgrades"] });
});

it("picks the notes, the always-on ones fixed", () => {
  const onSave = paper();
  fireEvent.click(screen.getByRole("button", { name: "Edit the notes" }));
  expect(screen.getByRole("checkbox", { name: "Warranty" })).toBeDisabled();
  fireEvent.click(screen.getByRole("checkbox", { name: "Access" }));
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(onSave).toHaveBeenCalledWith({ notes: ["access"] });
});

it("a payment preset brings its stages", () => {
  const onSave = paper();
  fireEvent.click(screen.getByRole("button", { name: "Edit the payment stages" }));
  fireEvent.change(screen.getByLabelText("The payment stages"), { target: { value: "domestic_construction" } });
  expect(onSave.mock.calls[0]![0].payment.stages).toHaveLength(4);
});

it("Escape puts the words back as they were", () => {
  const onSave = paper();
  const box = screen.getByRole("textbox", { name: "The introduction" });
  fireEvent.focus(box);
  box.textContent = "Changed";
  fireEvent.keyDown(box, { key: "Escape" });
  expect(box).toHaveTextContent("Thanks for having us out.");
  fireEvent.blur(box, { relatedTarget: null });
  expect(onSave).not.toHaveBeenCalled();
});

it("drawn to read (the Price tab's preview, the PDF), has no box to type in and nothing to edit", () => {
  paper({ readOnly: true });
  expect(screen.queryAllByRole("textbox")).toHaveLength(0);
  expect(screen.queryByRole("button", { name: /^Edit/ })).toBeNull();
  expect(screen.getByText("Thanks for having us out.")).toBeInTheDocument();
  expect(screen.getByText("Duct to each room")).toBeInTheDocument();
});

/* TIFF'S CHECK (review.ts, 26 November 2026): what's kept with a reason is
   said under Qualifications, and the block a finding is on is outlined */
it("says what Tiff's check kept, and outlines the block a finding is on", () => {
  paper({ qualifications: ["Copper tees for CMY joints: Budget estimate; CMY joints on the firm price."], spot: "units-0" });
  const q = screen.getByRole("region", { name: "Qualifications" });
  expect(q.textContent).toMatch(/Copper tees for CMY joints: Budget estimate/);
  expect(document.querySelector('[data-block="units-0"]')?.className).toMatch(/lp-spot/);
  expect(document.querySelector('[data-block="payment"]')?.className).not.toMatch(/lp-spot/);
});

it("has no Qualifications when nothing was kept", () => {
  paper({ qualifications: [] });
  expect(screen.queryByRole("region", { name: "Qualifications" })).toBeNull();
});
