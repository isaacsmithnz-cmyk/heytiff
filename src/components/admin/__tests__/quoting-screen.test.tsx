import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const refresh = jest.fn();
jest.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
jest.mock("@/app/actions/quote-settings", () => ({ saveQuoteSettings: jest.fn() }));

import { ToastProvider } from "@/components/parts/toast";
import { QuotingScreen } from "../quoting-screen";
import { DEFAULT_QUOTE_SETTINGS, type QuoteSettings } from "@/lib/quotes/settings";
import { saveQuoteSettings } from "@/app/actions/quote-settings";

const saveQuoteSettingsMock = saveQuoteSettings as jest.Mock;

beforeEach(() => {
  saveQuoteSettingsMock.mockReset();
  refresh.mockReset();
});

/* Settings › Quoting (v2, 25 October 2026): the section's groups under thin
   lines, Rate and markup with its Save rates, Allowances with Save
   allowances, then what the mock didn't draw in the same kinds of group:
   task hours, what every job starts with, the usual ductwork and what the
   customer sees. What prices each part is the Price book's now. */

const screenWith = (calc: Parameters<typeof QuotingScreen>[0]["calc"], initial: QuoteSettings = DEFAULT_QUOTE_SETTINGS) =>
  render(
    <ToastProvider>
      <QuotingScreen initial={initial} calc={calc} />
    </ToastProvider>
  );

const facts = () => screen.getByText(/A day on site/);

it("draws the section as the mock does, its two groups first and the rest after", () => {
  screenWith(null);
  expect(screen.getByRole("heading", { level: 1, name: "Quoting" })).toBeInTheDocument();
  expect(screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual([
    "Rate and markup",
    "Allowances, at cost",
    "Task hours",
    "Every job starts with",
    "Ductwork, when the brief doesn't say",
    "What the customer sees",
  ]);
  /* what prices each part moved to the Price book */
  expect(screen.queryByRole("table", { name: "Preferred items" })).toBeNull();
  /* the one main button is the rates' */
  expect(screen.getByRole("button", { name: "Save rates" })).toHaveClass("pt-btn--main");
  expect(screen.getByRole("button", { name: "Save allowances" })).toHaveClass("pt-btn--second");
  /* Work out the rate goes to the Rate Calculator, beside the charge-out rate */
  expect(screen.getByRole("link", { name: "Work out the rate" })).toHaveAttribute("href", "/dashboard/admin/rate-calculator");
});

/* Isaac, 2026-10-04: "Day rate only the charge out rate by set work hours…
   make sure that you can set the rate without completing the rate calc". */
it("blank here: shows the Rate Calculator's figures in the fields, and says where they came from", () => {
  screenWith({ chargedCents: 14000, recommendedCents: null, workingHours: 8 });
  expect(screen.getByLabelText("Charge-out rate")).toHaveValue("");
  expect(screen.getByLabelText("Charge-out rate")).toHaveAttribute("placeholder", "140.00");
  expect(screen.getByLabelText("Working day")).toHaveAttribute("placeholder", "8");
  expect(facts()).toHaveTextContent("From your Rate Calculator: $140.00 an hour and 8 hours a day. A day on site is $1,120.00 a person.");
});

it("with no Rate Calculator, a rate and a day typed here make the day", () => {
  screenWith(null);
  expect(screen.getByLabelText("Charge-out rate")).toHaveAttribute("placeholder", "Not set");
  expect(facts()).toHaveTextContent("A day on site needs a charge-out rate and a working day.");
  fireEvent.change(screen.getByLabelText("Charge-out rate"), { target: { value: "150" } });
  fireEvent.change(screen.getByLabelText("Working day"), { target: { value: "7.5" } });
  expect(facts()).toHaveTextContent("A day on site is $1,125.00 a person.");
  expect(facts()).not.toHaveTextContent("Rate Calculator");
  expect(screen.getByRole("button", { name: "Save rates" })).toBeEnabled();
});

it("says the profit share under a markup, because 20% markup is 16.7% of the price", () => {
  screenWith(null);
  fireEvent.change(screen.getByLabelText("Units"), { target: { value: "20" } });
  expect(screen.getByText("16.7% of the price is profit")).toBeInTheDocument();
});

it("takes the business's own duct contingency, a share and hours, and saves them with the rates", async () => {
  saveQuoteSettingsMock.mockResolvedValueOnce({ ok: true, settings: { ...DEFAULT_QUOTE_SETTINGS, contingencyPct: 15, contingencyHours: 2 } });
  screenWith(null);
  fireEvent.change(screen.getByLabelText("Duct contingency"), { target: { value: "15" } });
  fireEvent.change(screen.getByLabelText("Contingency hours"), { target: { value: "2" } });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Save rates" }));
  });
  expect(saveQuoteSettingsMock).toHaveBeenCalledWith(expect.objectContaining({ contingencyPct: 15, contingencyHours: 2 }));
  expect(screen.getByText("Rates saved")).toBeInTheDocument();
  expect(refresh).toHaveBeenCalled();
});

/* Isaac, 2026-10-07: "profit will be part of quoting setting" */
it("takes a profit target, and costs an hour at the rate less it until one's typed", () => {
  screenWith({ chargedCents: 14000, recommendedCents: null, workingHours: 8 });
  expect(facts()).not.toHaveTextContent("An hour costs you");
  fireEvent.change(screen.getByLabelText("Profit target"), { target: { value: "20" } });
  expect(facts()).toHaveTextContent("An hour costs you $112.00.");
  expect(screen.getByLabelText("Labour cost")).toHaveAttribute("placeholder", "112.00");
  fireEvent.change(screen.getByLabelText("Labour cost"), { target: { value: "95" } });
  expect(facts()).toHaveTextContent("An hour costs you $95.00.");
  expect(screen.getByRole("button", { name: "Save rates" })).toBeEnabled();
  /* a target past its bounds is said, on the field and under the group */
  fireEvent.change(screen.getByLabelText("Profit target"), { target: { value: "120" } });
  expect(screen.getByRole("button", { name: "Save rates" })).toBeDisabled();
  expect(screen.getByLabelText("Profit target")).toHaveAttribute("aria-invalid", "true");
  expect(screen.getByRole("alert")).toHaveTextContent("A profit target is 0 to 90% of the price.");
});

it("says a refused save under its own group, and keeps what was typed", async () => {
  saveQuoteSettingsMock.mockResolvedValueOnce({ ok: false, reason: "The settings couldn't be saved. Try again." });
  screenWith(null);
  fireEvent.change(screen.getByLabelText("Charge-out rate"), { target: { value: "150" } });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Save rates" }));
  });
  const rates = screen.getByRole("region", { name: "Rate and markup" });
  expect(within(rates).getByRole("alert")).toHaveTextContent("The settings couldn't be saved. Try again.");
  expect(screen.getByLabelText("Charge-out rate")).toHaveValue("150");
});

it("puts the rates back with the toast's Undo", async () => {
  const saved = { ...DEFAULT_QUOTE_SETTINGS, chargeOutCents: 15000 };
  saveQuoteSettingsMock.mockResolvedValueOnce({ ok: true, settings: saved }).mockResolvedValueOnce({ ok: true, settings: DEFAULT_QUOTE_SETTINGS });
  screenWith(null);
  fireEvent.change(screen.getByLabelText("Charge-out rate"), { target: { value: "150" } });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Save rates" }));
  });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
  });
  expect(saveQuoteSettingsMock).toHaveBeenLastCalledWith(DEFAULT_QUOTE_SETTINGS);
  expect(screen.getByLabelText("Charge-out rate")).toHaveValue("");
});

it("keeps the business's own allowances, at cost, and none until it sets them", async () => {
  saveQuoteSettingsMock.mockResolvedValue({ ok: false, reason: "x" });
  screenWith(null);
  const save = screen.getByRole("button", { name: "Save allowances" });
  expect(save).toBeDisabled();
  expect(screen.getByLabelText("Consumables")).toHaveAttribute("placeholder", "Not set");
  expect(within(screen.getByRole("region", { name: "Allowances, at cost" })).getByText("dollars a head")).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Consumables"), { target: { value: "31.82" } });
  fireEvent.change(screen.getByLabelText("New circuit"), { target: { value: "500" } });
  await act(async () => {
    fireEvent.click(save);
  });
  expect(saveQuoteSettingsMock.mock.calls[0][0].allowances).toEqual({ consumables: 3182, newCircuit: 50000, flush: null, recovery: null });
});

/* the business's own task hours (slice 8.1) */
it("saves the business's task hours, each a check beside a quote's labour", async () => {
  saveQuoteSettingsMock.mockResolvedValueOnce({ ok: true, settings: { ...DEFAULT_QUOTE_SETTINGS, taskHours: { zone: null, grille: 1.5, metre: null, visit: null } } });
  screenWith(null);
  fireEvent.change(screen.getByLabelText("An outlet or grille"), { target: { value: "1.5" } });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Save task hours" }));
  });
  expect(saveQuoteSettingsMock).toHaveBeenCalledWith(expect.objectContaining({ taskHours: { zone: null, grille: 1.5, metre: null, visit: null } }));
  expect(screen.getByText("Task hours saved")).toBeInTheDocument();
});

/* Isaac, 2026-10-10: "the tasks can be auto-populated for basic things, so
   protection, check site for damages that we could be blamed for" */
it("shows the starter tasks every job starts with, and saves the business's own", async () => {
  const user = userEvent.setup();
  saveQuoteSettingsMock.mockResolvedValueOnce({ ok: true, settings: DEFAULT_QUOTE_SETTINGS });
  screenWith(null);
  expect(screen.getByRole("heading", { name: "Every job starts with" })).toBeInTheDocument();
  expect(screen.getByLabelText("Starter task 1")).toHaveValue("Photos of any existing damage before we start");
  await user.click(screen.getByRole("button", { name: "Take Protect floors and walls off" }));
  await user.click(screen.getByRole("button", { name: "Add a task" }));
  fireEvent.change(screen.getByLabelText("Starter task 3"), { target: { value: "Check the switchboard" } });
  await user.click(screen.getByRole("combobox", { name: "When Check the switchboard is done" }));
  await user.click(within(screen.getByRole("listbox")).getByRole("option", { name: "The first visit" }));
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Save starter tasks" }));
  });
  expect(saveQuoteSettingsMock).toHaveBeenLastCalledWith(
    expect.objectContaining({
      starterTasks: [
        { name: "Photos of any existing damage before we start", when: "first", photos: true },
        { name: "Photos of the finished work", when: "last", photos: true },
        { name: "Check the switchboard", when: "first", photos: false },
      ],
    })
  );
});

/* a choice saves itself the moment it's picked (rule 32), and says so */
it("saves the usual layout and what the customer sees on pick", async () => {
  const user = userEvent.setup();
  saveQuoteSettingsMock.mockImplementation(async (s: QuoteSettings) => ({ ok: true, settings: s }));
  screenWith(null);
  await user.click(screen.getByRole("combobox", { name: "Usual layout" }));
  await user.click(within(screen.getByRole("listbox")).getByRole("option", { name: "A plenum on the unit with a spigot for each outlet" }));
  expect(saveQuoteSettingsMock).toHaveBeenLastCalledWith(expect.objectContaining({ usualLayout: "plenum" }));
  expect(await screen.findByText("Usual layout set to a plenum")).toBeInTheDocument();

  await user.click(screen.getByRole("combobox", { name: "On a quote, unless it says otherwise" }));
  await user.click(within(screen.getByRole("listbox")).getByRole("option", { name: "Each option's line items and its total" }));
  expect(saveQuoteSettingsMock).toHaveBeenLastCalledWith(expect.objectContaining({ showLines: true, usualLayout: "plenum" }));

  /* Isaac, 2026-10-21: a rough price from Tiff, on site */
  await user.click(screen.getByRole("combobox", { name: "A rough price from Tiff, on site" }));
  await user.click(within(screen.getByRole("listbox")).getByRole("option", { name: "For anyone on a job, as a rounded price" }));
  expect(saveQuoteSettingsMock).toHaveBeenLastCalledWith(expect.objectContaining({ staffRoughPrice: true, showLines: true }));
});
