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
const price: QuotePrice = { ok: true, options: [option("Option 1", one), option("Option 2", two)] };

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
  expect(within(second).getAllByText("No summary written yet.")).toHaveLength(1);
});

it("shows the notes always on, and each option's share of each payment stage", () => {
  paper();
  expect(screen.getByText("Warranty")).toBeInTheDocument();
  expect(screen.queryByText("Access")).not.toBeInTheDocument();
  const pay = screen.getByRole("region", { name: "Payment" });
  const deposit = within(pay).getByRole("row", { name: /Deposit/ });
  const inc = price.ok ? price.options.map((o) => o.build.incGstCents) : [];
  for (const c of inc) expect(deposit).toHaveTextContent(fmtAud(Math.round(c / 10)));
});

it("edits a block where it sits, and saves only that block's words", () => {
  const onSave = paper();
  fireEvent.click(screen.getByRole("button", { name: "Edit option 2's summary" }));
  fireEvent.change(screen.getByLabelText("Option 2's summary"), { target: { value: "The bigger unit, for the open plan." } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(onSave).toHaveBeenCalledWith({
    options: [
      { summary: "The smaller unit.", areas: [{ name: "Roof", items: ["Duct to each room"] }], included: ["Commissioning"] },
      { summary: "The bigger unit, for the open plan.", areas: [], included: [] },
    ],
  });
  expect(screen.queryByLabelText("Option 2's summary")).not.toBeInTheDocument();
});

it("takes the work by area as typed", () => {
  const onSave = paper();
  fireEvent.click(screen.getByRole("button", { name: "Edit option 1's work" }));
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "Roof:\n- Duct to each room\nGarage:\n- Outdoor on brackets" } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  expect(onSave.mock.calls[0]![0].options[0].areas).toEqual([
    { name: "Roof", items: ["Duct to each room"] },
    { name: "Garage", items: ["Outdoor on brackets"] },
  ]);
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

it("Cancel leaves the words as they were", () => {
  const onSave = paper();
  fireEvent.click(screen.getByRole("button", { name: "Edit the introduction" }));
  fireEvent.change(screen.getByLabelText("The introduction"), { target: { value: "Changed" } });
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(onSave).not.toHaveBeenCalled();
  expect(screen.getByText("Thanks for having us out.")).toBeInTheDocument();
});
