import { act, fireEvent, render, screen } from "@testing-library/react";

jest.mock("next/navigation", () => ({ useRouter: () => ({ refresh: jest.fn() }) }));
jest.mock("@/app/actions/quote-settings", () => ({ saveQuoteSettings: jest.fn() }));

import { QuotingScreen } from "../quoting-screen";
import { DEFAULT_QUOTE_SETTINGS } from "@/lib/quotes/settings";
import { saveQuoteSettings } from "@/app/actions/quote-settings";

const saveQuoteSettingsMock = saveQuoteSettings as jest.Mock;

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
  /* the rate and the day, an hour's cost, the four allowances and the four task hours */
  expect(screen.getAllByText("Not set")).toHaveLength(11);
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

/* the engine rebuild, slice 14.1: the kits as the business's own book prices them */
it("lists each kit's parts as the book prices them, and what the book hasn't got", () => {
  render(
    <QuotingScreen
      initial={DEFAULT_QUOTE_SETTINGS}
      components={[]}
      ranges={[]}
      calc={null}
      kits={[
        { kit: "split", part: "Pair coil", size: "1/4 + 1/2", pick: { name: "PAIRED COIL 1/4+1/2X20M", code: "PC1412", why: "On your quotes", cents: 955, perMetre: true } },
        { kit: "split", part: "RCBO", size: "16 A", pick: null },
      ]}
    />
  );
  expect(screen.getByRole("heading", { name: "Kit: Split install" })).toBeInTheDocument();
  expect(screen.getByText("PAIRED COIL 1/4+1/2X20M")).toBeInTheDocument();
  expect(screen.getByText("PC1412, on your quotes")).toBeInTheDocument();
  expect(screen.getByText("$9.55 a metre")).toBeInTheDocument();
  expect(screen.getByText("Not in your book")).toBeInTheDocument();
});

/* habits, slice 13.2: a swap made again and again, asked about, one press to say yes */
it("asks about a swap made on three quotes, and makes it preferred with one press", async () => {
  const fetchMock = jest.fn(async () => ({ ok: true, json: async () => ({ ok: true }) }));
  (global as unknown as { fetch: unknown }).fetch = fetchMock;
  render(
    <QuotingScreen
      initial={DEFAULT_QUOTE_SETTINGS}
      components={[]}
      ranges={[]}
      calc={null}
      habits={[{ from: { code: "VB250", name: "Vortex flexible 250" }, to: { code: "VH250", name: "Vortex acoustic 250", supplierKey: "aad" }, quotes: 3 }]}
    />
  );
  expect(screen.getByText("You've swapped VB250 for VH250 on 3 quotes.")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Make VH250 your preferred" }));
  expect(await screen.findByText("Preferred")).toBeInTheDocument();
  expect(fetchMock).toHaveBeenCalledWith("/api/quoting/preferred", expect.objectContaining({ body: JSON.stringify({ ref: "aad|VH250", on: true }) }));
});

/* the business's own task hours (slice 8.1) */
it("saves the business's task hours, each a check beside a quote's labour", async () => {
  saveQuoteSettingsMock.mockResolvedValueOnce({ ok: true, settings: { ...DEFAULT_QUOTE_SETTINGS, taskHours: { zone: null, grille: 1.5, metre: null, visit: null } } });
  render(<QuotingScreen initial={DEFAULT_QUOTE_SETTINGS} components={[]} ranges={[]} calc={null} />);
  fireEvent.change(screen.getByLabelText("Hours for an outlet"), { target: { value: "1.5" } });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Save task hours" }));
  });
  expect(saveQuoteSettingsMock).toHaveBeenCalledWith(expect.objectContaining({ taskHours: { zone: null, grille: 1.5, metre: null, visit: null } }));
});
