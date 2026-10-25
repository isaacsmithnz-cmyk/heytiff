import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DEFAULT_SETTINGS, type Settings } from "@/components/timepay/logic";
import type { XeroPayrollProps } from "@/components/timepay/xero-payroll";

jest.mock("next/navigation", () => ({ useRouter: () => ({ push: jest.fn(), refresh: jest.fn() }) }));
/* "use server" modules: the real ones pull Auth0 into jsdom and the suite
   fails to LOAD. The holidays group has its own suite; here it only has to
   be there or not. */
jest.mock("@/app/actions/holidays", () => ({
  addHoliday: jest.fn(),
  removeHoliday: jest.fn(),
  restoreHoliday: jest.fn(),
  getHolidayManagerData: jest.fn(async () => null),
}));
jest.mock("@/components/timepay/xero-payroll", () => ({
  XeroPayroll: () => "the payroll roster",
}));

import { ToastProvider } from "@/components/parts/toast";
import { PayScreen } from "../pay-screen";

/* Settings › Pay and holidays (v2, 25 October 2026): what was Time & Pay's
   settings gear, as groups on one page.

   What this file pins:

     THE GEAR'S GATES. The pay rules come with `financials`, the holidays with
     admin, payroll matching with `financials` and Xero; the page decides
     which it hands over, and the screen draws exactly those.

     ONE ROW, SAVED WHOLE. Every save is the whole settings object, the
     saved one with the group's change laid over it, through the same action
     the modal called.

     A TYPED FIGURE APPLIES ON SAVE CHANGES, and a figure out of bounds never
     leaves the browser. A rule you only pick saves itself, says so in a
     toast, and its Undo writes the old value back over whatever has saved
     since.

     THE FIRST RUN is the page: until a rule is saved the title says they
     aren't confirmed, and its button saves them as they stand. */

const XERO: XeroPayrollProps = {
  load: jest.fn(),
  onLink: jest.fn(),
  onUnlink: jest.fn(),
  onAdoptEmployment: jest.fn(),
  onAdoptBasis: jest.fn(),
  onCheckPay: jest.fn(),
  onAdoptWage: jest.fn(),
};

type Answer = { ok: true } | { ok: false; error: string };
type SaveMock = jest.Mock<Promise<Answer>, [Settings]>;

/** savePaySettings, answering every save the same way */
const answering = (answer: Answer): SaveMock => jest.fn(async (_s: Settings) => answer);

function setup(
  over: { settings?: Partial<Settings>; configured?: boolean; pay?: boolean; holidays?: boolean; xero?: boolean; onSave?: SaveMock } = {},
) {
  const onSave = over.onSave ?? answering({ ok: true });
  const settings: Settings = { ...DEFAULT_SETTINGS, ...over.settings };
  render(
    <ToastProvider>
      <PayScreen
        pay={over.pay === false ? null : { settings, configured: over.configured ?? true, onSave }}
        holidays={over.holidays ? { initial: { holidays: [], orgState: "NSW", today: "2026-07-25" } } : null}
        xero={over.xero ? XERO : null}
      />
    </ToastProvider>,
  );
  return { onSave, settings };
}

const group = (heading: string) =>
  screen.getByRole("heading", { level: 2, name: heading }).closest(".st2-group") as HTMLElement;

/** The value beside a label in a group's read face. */
const fact = (g: HTMLElement, label: string) => within(g).getByText(label, { selector: "dt" }).nextElementSibling;

const edit = async (user: ReturnType<typeof userEvent.setup>, heading: string) => {
  await user.click(within(group(heading)).getByRole("button", { name: `Edit ${heading.toLowerCase()}` }));
  return group(heading);
};

const saved = (onSave: SaveMock) => onSave.mock.calls.at(-1)![0];

const retype = async (user: ReturnType<typeof userEvent.setup>, field: HTMLElement, text: string) => {
  await user.clear(field);
  await user.type(field, text);
};

describe("the page", () => {
  it("is the pay rules as groups, then the holidays and payroll matching", () => {
    setup({ holidays: true, xero: true });
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Pay and holidays");
    expect(screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual([
      "Pay cycle",
      "Ordinary hours",
      "Overtime",
      "Weekend and holiday rates",
      "Super",
      "Timesheets and leave",
      "Public holidays",
      "Xero payroll",
    ]);
    expect(within(group("Xero payroll")).getByText("the payroll roster")).toBeInTheDocument();
  });

  it("reads back what is saved, in words", () => {
    setup();
    const cycle = group("Pay cycle");
    expect(fact(cycle, "Pay cycle")).toHaveTextContent("Weekly");
    expect(fact(cycle, "Week starts on")).toHaveTextContent("Monday");
    expect(fact(cycle, "Auto-submit")).toHaveTextContent("Sunday at 3:00 PM");
    const hours = group("Ordinary hours");
    expect(fact(hours, "Standard day")).toHaveTextContent("8h");
    expect(fact(hours, "Normal hours")).toHaveTextContent("7:00 AM to 3:00 PM");
    expect(fact(hours, "Working days")).toHaveTextContent("Monday to Friday");
    expect(fact(hours, "Break")).toHaveTextContent("None");
    const ot = group("Overtime");
    expect(fact(ot, "Time and a half")).toHaveTextContent("After 8h a day");
    expect(fact(ot, "Double time")).toHaveTextContent("After 12h in a day");
    expect(fact(ot, "Salaried overtime")).toHaveTextContent("Pays at the rules");
    const rates = group("Weekend and holiday rates");
    expect(fact(rates, "Saturdays")).toHaveTextContent("1.5× first 2h, then 2×");
    expect(fact(rates, "Sundays")).toHaveTextContent("2× all day");
    expect(fact(rates, "Public holidays")).toHaveTextContent("2× all day");
    expect(fact(rates, "Night shift, 10 PM to 6 AM")).toHaveTextContent("Standard rates");
    expect(fact(group("Super"), "Super guarantee")).toHaveTextContent("12%, the default");
  });

  it("names a fortnight's first day and a month's start day only for those cycles", () => {
    setup({ settings: { cycle: "Monthly", monthStartDay: 15 } });
    expect(fact(group("Pay cycle"), "Pay month starts on")).toHaveTextContent("The 15th");
    expect(within(group("Pay cycle")).queryByText("First fortnight starts")).toBeNull();
  });

  it("lists a part-timer's days, and a paid break with its length", () => {
    setup({ settings: { workDays: [0, 1, 3], breakMinutes: 30, breakPaid: false } });
    expect(fact(group("Ordinary hours"), "Working days")).toHaveTextContent("Monday, Tuesday and Thursday");
    expect(fact(group("Ordinary hours"), "Break")).toHaveTextContent("30 min, unpaid");
  });
});

describe("the gear's gates", () => {
  it("an admin without `financials` gets the holidays and no pay rule", () => {
    setup({ pay: false, holidays: true });
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Pay and holidays");
    expect(screen.getByRole("heading", { level: 2, name: "Public holidays" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Pay cycle" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Overtime" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Confirm pay rules" })).toBeNull();
  });

  it("payroll matching is there only when the page hands it over", () => {
    setup({ holidays: true });
    expect(screen.queryByRole("heading", { name: "Xero payroll" })).toBeNull();
  });

  it("the holidays and payroll matching carry anchors a link can land on", () => {
    setup({ holidays: true, xero: true });
    expect(group("Public holidays")).toHaveAttribute("id", "holidays");
    expect(group("Xero payroll")).toHaveAttribute("id", "xero-payroll");
  });
});

describe("the first run", () => {
  it("says the rules aren't confirmed, and saves them as they stand", async () => {
    const user = userEvent.setup();
    const { onSave } = setup({ configured: false });
    expect(screen.getByText("Not confirmed")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Confirm pay rules" }));
    expect(onSave).toHaveBeenCalledWith(DEFAULT_SETTINGS);
    expect(await screen.findByText("Pay rules confirmed")).toBeInTheDocument();
  });

  it("says nothing once they are", () => {
    setup();
    expect(screen.queryByText("Not confirmed")).toBeNull();
    expect(screen.queryByRole("button", { name: "Confirm pay rules" })).toBeNull();
  });

  it("says why when confirming is refused", async () => {
    const user = userEvent.setup();
    const onSave = answering({ ok: false, error: "Couldn't save pay settings." });
    setup({ configured: false, onSave });
    await user.click(screen.getByRole("button", { name: "Confirm pay rules" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't save pay settings.");
  });
});

describe("typed figures apply on Save changes", () => {
  it("saves the standard day as the whole settings object", async () => {
    const user = userEvent.setup();
    const { onSave } = setup();
    const g = await edit(user, "Ordinary hours");
    await retype(user, within(g).getByLabelText("Standard day, in hours"), "7.6");
    expect(onSave).not.toHaveBeenCalled();
    await user.click(within(g).getByRole("button", { name: "Save changes" }));
    expect(onSave).toHaveBeenCalledWith({ ...DEFAULT_SETTINGS, standard: 7.6 });
  });

  it("a figure out of bounds never leaves the browser, and its field says why", async () => {
    const user = userEvent.setup();
    const { onSave } = setup();
    const g = await edit(user, "Ordinary hours");
    await retype(user, within(g).getByLabelText("Standard day, in hours"), "3");
    await user.click(within(g).getByRole("button", { name: "Save changes" }));
    expect(onSave).not.toHaveBeenCalled();
    expect(within(g).getByText("Between 4 and 12 hours")).toBeInTheDocument();
    expect(within(g).getByLabelText("Standard day, in hours")).toHaveAttribute("aria-invalid", "true");
    expect(within(g).getByRole("alert")).toHaveTextContent("Check the figures marked above.");
  });

  it("Cancel leaves the saved rule as it was", async () => {
    const user = userEvent.setup();
    const { onSave } = setup();
    const g = await edit(user, "Ordinary hours");
    await retype(user, within(g).getByLabelText("Standard day, in hours"), "9");
    await user.click(within(g).getByRole("button", { name: "Cancel" }));
    expect(onSave).not.toHaveBeenCalled();
    expect(fact(group("Ordinary hours"), "Standard day")).toHaveTextContent("8h");
  });

  it("a save the server refuses keeps the group open and says why", async () => {
    const user = userEvent.setup();
    const onSave = answering({ ok: false, error: "Only someone with financial access can change pay settings." });
    setup({ onSave });
    const g = await edit(user, "Super");
    await retype(user, within(g).getByLabelText("Super guarantee, %"), "12.5");
    await user.click(within(g).getByRole("button", { name: "Save changes" }));
    expect(await within(g).findByRole("alert")).toHaveTextContent("financial access");
    expect(within(g).getByLabelText("Super guarantee, %")).toHaveValue("12.5");
  });

  /* HOW LONG FIRST. With no break there is nothing for paid or unpaid to be
     about, so the question isn't asked until there is one. */
  it("asks whether a break is paid only once it has a length", async () => {
    const user = userEvent.setup();
    const { onSave } = setup();
    const g = await edit(user, "Ordinary hours");
    expect(within(g).queryByRole("radiogroup", { name: "The break is" })).toBeNull();
    await retype(user, within(g).getByLabelText("Break, in minutes"), "30");
    await user.click(within(g).getByRole("radio", { name: "Unpaid" }));
    await user.click(within(g).getByRole("button", { name: "Save changes" }));
    expect(saved(onSave)).toMatchObject({ breakMinutes: 30, breakPaid: false });
  });

  it("caps a break at two hours, in whole minutes", async () => {
    const user = userEvent.setup();
    const { onSave } = setup();
    const g = await edit(user, "Ordinary hours");
    await retype(user, within(g).getByLabelText("Break, in minutes"), "150");
    await user.click(within(g).getByRole("button", { name: "Save changes" }));
    expect(onSave).not.toHaveBeenCalled();
    expect(within(g).getByText("Between 0 and 120 minutes")).toBeInTheDocument();
  });

  it("ticks the working days, every day named in full", async () => {
    const user = userEvent.setup();
    const { onSave } = setup();
    const g = await edit(user, "Ordinary hours");
    const days = within(within(g).getByRole("group", { name: "Working days" })).getAllByRole("checkbox");
    expect(days).toHaveLength(7);
    await user.click(within(g).getByRole("checkbox", { name: "Friday" }));
    await user.click(within(g).getByRole("checkbox", { name: "Saturday" }));
    await user.click(within(g).getByRole("button", { name: "Save changes" }));
    expect(saved(onSave).workDays).toEqual([0, 1, 2, 3, 5]);
  });

  /* A time is a wheel, never typed (rule 34). */
  it("picks the normal hours and the auto-submit time off the wheel, never typed", async () => {
    const user = userEvent.setup();
    setup();
    const hours = await edit(user, "Ordinary hours");
    expect(within(hours).getByRole("combobox", { name: "Normal start" })).toHaveTextContent("7:00 AM");
    expect(within(hours).queryByRole("textbox", { name: /start|finish/i })).toBeNull();
    const cycle = await edit(user, "Pay cycle");
    expect(within(cycle).getByRole("combobox", { name: "Auto-submit time" })).toHaveTextContent("3:00 PM");
  });

  /* THE WHOLE LADDER, IN ONE PLACE: both rungs of an ordinary weekday. */
  it("asks both rungs of overtime together, and a week's threshold starts at 38", async () => {
    const user = userEvent.setup();
    const { onSave } = setup();
    const g = await edit(user, "Overtime");
    expect(within(g).getByLabelText("Time and a half after, in hours")).toHaveValue("8");
    expect(within(g).getByLabelText("Double time after, in hours")).toHaveValue("12");
    await user.click(within(g).getByRole("radio", { name: "A week" }));
    expect(within(g).getByLabelText("Time and a half after, in hours")).toHaveValue("38");
    await retype(user, within(g).getByLabelText("Double time after, in hours"), "12.5");
    await user.click(within(g).getByRole("radio", { name: "Absorbed in salary" }));
    await user.click(within(g).getByRole("button", { name: "Save changes" }));
    expect(saved(onSave)).toMatchObject({ otUnit: "week", otAfter: 38, dblAfter: 12.5, salariedOtPaid: false });
  });

  it("holds a week's threshold to a week's bounds", async () => {
    const user = userEvent.setup();
    const { onSave } = setup({ settings: { otUnit: "week", otAfter: 38 } });
    const g = await edit(user, "Overtime");
    await retype(user, within(g).getByLabelText("Time and a half after, in hours"), "20");
    await user.click(within(g).getByRole("button", { name: "Save changes" }));
    expect(onSave).not.toHaveBeenCalled();
    expect(within(g).getByText("Between 30 and 60 hours")).toBeInTheDocument();
  });

  /* Double all day has no second rung, so nothing more is asked; time and a
     half asks how many hours before it doubles. */
  it("asks after a day's second rung only when it has one", async () => {
    const user = userEvent.setup();
    const { onSave } = setup();
    const g = await edit(user, "Weekend and holiday rates");
    expect(within(g).getByLabelText("Saturdays, 2× after, in hours")).toHaveValue("2");
    expect(within(g).queryByLabelText("Sundays, 2× after, in hours")).toBeNull();
    await user.click(within(within(g).getByRole("radiogroup", { name: "Sundays" })).getByRole("radio", { name: "1.5×, then 2×" }));
    await retype(user, within(g).getByLabelText("Sundays, 2× after, in hours"), "3");
    await user.click(within(within(g).getByRole("radiogroup", { name: "Saturdays" })).getByRole("radio", { name: "Standard rates" }));
    await user.click(within(g).getByRole("button", { name: "Save changes" }));
    const { rules } = saved(onSave);
    expect(rules.sun).toEqual({ on: true, rate: 1.5, up: 3 });
    // standard rates keeps the day's rate and hours, so turning it back on lands where it was
    expect(rules.sat).toEqual({ on: false, rate: 1.5, up: 2 });
    expect(rules.ph).toEqual(DEFAULT_SETTINGS.rules.ph);
  });

  it("moves the pay cycle, and asks where a month starts only for a month", async () => {
    const user = userEvent.setup();
    const { onSave } = setup();
    const g = await edit(user, "Pay cycle");
    await user.click(within(g).getByRole("radio", { name: "Fortnightly" }));
    expect(within(g).getByLabelText("First fortnight starts")).toBeInTheDocument();
    await user.click(within(g).getByRole("radio", { name: "Monthly" }));
    expect(within(g).queryByLabelText("First fortnight starts")).toBeNull();
    await user.click(within(g).getByRole("combobox", { name: "Pay month starts on" }));
    await user.click(within(screen.getByRole("listbox")).getByRole("option", { name: "The 15th" }));
    await user.click(within(g).getByRole("combobox", { name: "Week starts on" }));
    await user.click(within(screen.getByRole("listbox")).getByRole("option", { name: "Wednesday" }));
    await user.click(within(g).getByRole("button", { name: "Save changes" }));
    expect(saved(onSave)).toMatchObject({ cycle: "Monthly", monthStartDay: 15, weekStart: "Wed" });
  });

  it("super left blank is the statutory figure, which the row keeps as nothing", async () => {
    const user = userEvent.setup();
    const { onSave } = setup({ settings: { superPct: 11.5 } });
    expect(fact(group("Super"), "Super guarantee")).toHaveTextContent("11.5%");
    const g = await edit(user, "Super");
    await user.clear(within(g).getByLabelText("Super guarantee, %"));
    await user.click(within(g).getByRole("button", { name: "Save changes" }));
    expect(saved(onSave).superPct).toBeNull();
  });
});

describe("the rules you only pick save themselves", () => {
  it("locks timesheets with its switch, says so, and Undo puts it back", async () => {
    const user = userEvent.setup();
    const { onSave } = setup();
    const lock = screen.getByRole("switch", { name: "Lock a timesheet once it's submitted" });
    expect(lock).toHaveAttribute("aria-checked", "true");
    await user.click(lock);
    expect(onSave).toHaveBeenCalledWith({ ...DEFAULT_SETTINGS, lock: false });
    expect(await screen.findByText("Submitted timesheets stay open")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(saved(onSave).lock).toBe(true));
  });

  /* An Undo lays its one field over what has saved since, not over the
     settings its toast was raised on. */
  it("an Undo keeps what saved after it", async () => {
    const user = userEvent.setup();
    const { onSave } = setup();
    await user.click(screen.getByRole("switch", { name: "Lock a timesheet once it's submitted" }));
    await user.click(screen.getByRole("switch", { name: "Daily breakdown in the pay-run export" }));
    await user.click((await screen.findAllByRole("button", { name: "Undo" }))[0]);
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(3));
    expect(saved(onSave)).toMatchObject({ lock: true, exportDetail: true });
  });

  it("asks for a medical certificate from the working day picked", async () => {
    const user = userEvent.setup();
    const { onSave } = setup();
    const cert = screen.getByRole("combobox", { name: "Medical certificate for personal leave" });
    expect(cert).toHaveTextContent("Never asked for");
    await user.click(cert);
    await user.click(within(screen.getByRole("listbox")).getByRole("option", { name: "From 2 working days" }));
    expect(saved(onSave).certAfterDays).toBe(2);
    expect(await screen.findByText("Certificate asked from 2 working days")).toBeInTheDocument();
  });

  it("turns the certificate off again", async () => {
    const user = userEvent.setup();
    const { onSave } = setup({ settings: { certAfterDays: 3 } });
    await user.click(screen.getByRole("combobox", { name: "Medical certificate for personal leave" }));
    await user.click(within(screen.getByRole("listbox")).getByRole("option", { name: "Never asked for" }));
    expect(saved(onSave).certAfterDays).toBeNull();
  });

  /* The export isn't built: the row says so, and the preference is kept for
     the first one. */
  it("keeps the export's breakdown as a preference, and says the export isn't built", async () => {
    const user = userEvent.setup();
    const { onSave } = setup();
    const g = group("Timesheets and leave");
    expect(within(g).getByText("Export not built yet")).toBeInTheDocument();
    expect(within(g).queryByRole("button", { name: /export .*pdf/i })).toBeNull();
    await user.click(within(g).getByRole("switch", { name: "Daily breakdown in the pay-run export" }));
    expect(saved(onSave).exportDetail).toBe(true);
  });

  it("says why under the group when a pick is refused", async () => {
    const user = userEvent.setup();
    const onSave = answering({ ok: false, error: "Couldn't save pay settings." });
    setup({ onSave });
    await user.click(screen.getByRole("switch", { name: "Lock a timesheet once it's submitted" }));
    expect(await within(group("Timesheets and leave")).findByRole("alert")).toHaveTextContent("Couldn't save pay settings.");
  });
});
