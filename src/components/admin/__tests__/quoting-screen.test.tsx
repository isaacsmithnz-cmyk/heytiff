import { fireEvent, render, screen } from "@testing-library/react";

jest.mock("next/navigation", () => ({ useRouter: () => ({ refresh: jest.fn() }) }));
jest.mock("@/app/actions/quote-settings", () => ({ saveQuoteSettings: jest.fn() }));

import { QuotingScreen } from "../quoting-screen";
import { DEFAULT_QUOTE_SETTINGS } from "@/lib/quotes/settings";

/* Isaac, 2026-10-04: "Day rate only the charge out rate by set work hours…
   make sure that you can set the rate without completing the rate calc". */

const screenWith = (calc: Parameters<typeof QuotingScreen>[0]["calc"]) =>
  render(<QuotingScreen initial={DEFAULT_QUOTE_SETTINGS} components={[]} ranges={[]} calc={calc} />);

it("blank here: says the Rate Calculator's figures, and the day they make", () => {
  screenWith({ chargedCents: 14000, recommendedCents: null, workingHours: 8 });
  expect(screen.getByText("$140.00, what your Rate Calculator says you charge")).toBeInTheDocument();
  expect(screen.getByText("8 hours, your Rate Calculator's working hours")).toBeInTheDocument();
  expect(screen.getByText("A day on site is $1,120.00 a person: 8 hours at $140.00.")).toBeInTheDocument();
});

it("with no Rate Calculator, a rate and a day typed here make the day", () => {
  screenWith(null);
  /* the rate and the day, an hour's cost, and the four allowances */
  expect(screen.getAllByText("Not set")).toHaveLength(7);
  expect(screen.getByText("A day on site needs a charge-out rate and a working day.")).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Charge-out rate, dollars an hour"), { target: { value: "150" } });
  fireEvent.change(screen.getByLabelText("Hours in a working day"), { target: { value: "7.5" } });
  expect(screen.getByText("A day on site is $1,125.00 a person: 7.5 hours at $150.00.")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
});

it("takes the business's own duct contingency, and has none until it's set", () => {
  screenWith(null);
  expect(screen.getByText("None")).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Duct contingency, percent of ductwork and grilles"), { target: { value: "15" } });
  fireEvent.change(screen.getByLabelText("Duct contingency, hours"), { target: { value: "2" } });
  expect(screen.getByText("On a quote with ductwork")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
});

/* Isaac, 2026-10-07: "profit will be part of quoting setting" */
it("takes a profit target, and costs an hour at the rate less it until one's typed", () => {
  screenWith({ chargedCents: 14000, recommendedCents: null, workingHours: 8 });
  expect(screen.getByText("Not set: quotes aren't checked")).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Profit target, percent of the price"), { target: { value: "20" } });
  expect(screen.getByText("A quote under it says so")).toBeInTheDocument();
  expect(screen.getByText("$112.00: the rate less the target")).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("What an hour of labour costs, dollars"), { target: { value: "95" } });
  expect(screen.getByText("Your figure")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
  fireEvent.change(screen.getByLabelText("Profit target, percent of the price"), { target: { value: "120" } });
  expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
});

it("keeps the business's own allowances, at cost, and none until it sets them", async () => {
  const { saveQuoteSettings } = jest.requireMock("@/app/actions/quote-settings") as { saveQuoteSettings: jest.Mock };
  saveQuoteSettings.mockResolvedValue({ ok: false, reason: "x" });
  screenWith(null);
  const save = screen.getByRole("button", { name: "Save allowances" });
  expect(save).toBeDisabled();
  fireEvent.change(screen.getByLabelText("Consumables allowance, dollars a head"), { target: { value: "31.82" } });
  fireEvent.change(screen.getByLabelText("New circuit allowance, dollars a circuit"), { target: { value: "500" } });
  fireEvent.click(save);
  expect(saveQuoteSettings.mock.calls[0][0].allowances).toEqual({ consumables: 3182, newCircuit: 50000, flush: null, recovery: null });
});
