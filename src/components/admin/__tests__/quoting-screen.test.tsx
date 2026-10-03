import { fireEvent, render, screen } from "@testing-library/react";

jest.mock("next/navigation", () => ({ useRouter: () => ({ refresh: jest.fn() }) }));
jest.mock("@/app/actions/quote-settings", () => ({ saveQuoteSettings: jest.fn() }));
jest.mock("../price-book-panel", () => ({ PriceBook: () => null }));
jest.mock("../links-panel", () => ({ LinksPanel: () => null }));
jest.mock("../same-items-panel", () => ({ SameItemsPanel: () => null }));

import { QuotingScreen } from "../quoting-screen";
import { DEFAULT_QUOTE_SETTINGS } from "@/lib/quotes/settings";

/* Isaac, 2026-10-04: "Day rate only the charge out rate by set work hours…
   make sure that you can set the rate without completing the rate calc". */

const screenWith = (calc: Parameters<typeof QuotingScreen>[0]["calc"]) =>
  render(<QuotingScreen initial={DEFAULT_QUOTE_SETTINGS} components={[]} suppliers={[]} calc={calc} />);

it("blank here: says the Rate Calculator's figures, and the day they make", () => {
  screenWith({ chargedCents: 14000, recommendedCents: null, workingHours: 8 });
  expect(screen.getByText("$140.00, what your Rate Calculator says you charge")).toBeInTheDocument();
  expect(screen.getByText("8 hours, your Rate Calculator's working hours")).toBeInTheDocument();
  expect(screen.getByText("A day on site is $1,120.00 a person: 8 hours at $140.00.")).toBeInTheDocument();
});

it("with no Rate Calculator, a rate and a day typed here make the day", () => {
  screenWith(null);
  expect(screen.getAllByText("Not set")).toHaveLength(2);
  expect(screen.getByText("A day on site needs a charge-out rate and a working day.")).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Charge-out rate, dollars an hour"), { target: { value: "150" } });
  fireEvent.change(screen.getByLabelText("Hours in a working day"), { target: { value: "7.5" } });
  expect(screen.getByText("A day on site is $1,125.00 a person: 7.5 hours at $150.00.")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
});
