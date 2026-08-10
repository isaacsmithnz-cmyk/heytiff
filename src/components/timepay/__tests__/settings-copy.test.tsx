import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TimePaySettings } from "../settings";
import { DEFAULT_SETTINGS, type Settings } from "../logic";

/* What the gear ASKS, and whether the question makes sense where it is asked.

   From the 2026-08 daily-user walk. Four separate findings, one theme: a
   control was in the wrong section, or answered a question the screen hadn't
   asked yet, or looked like a field when it was a sentence. */

function open(settings: Settings = DEFAULT_SETTINGS) {
  const onSave = jest.fn();
  render(
    <TimePaySettings
      settings={settings}
      firstRun={false}
      canPay
      onClose={jest.fn()}
      onSave={onSave}
    />,
  );
  return { onSave };
}
const section = (label: string) => screen.getByText(label).closest(".ms") as HTMLElement;

describe("the overtime ladder", () => {
  /* `otAfter` had its own section; `dblAfter` — the rung directly above it —
     sat at the bottom of "Weekend & holiday rates", below night shift, behind
     a label in tracked caps reading "AND ON ANY DAY — 2× AFTER A LONG DAY OF".
     It is not a weekend rule: splitDay gives a Saturday or a public holiday its
     own rate for the WHOLE day and never reaches the ladder at all. */
  it("asks both rungs together, in the section about ordinary days", () => {
    open();
    const ot = section("Overtime");
    expect(within(ot).getByText("Time and a half after")).toBeInTheDocument();
    expect(within(ot).getByText("Then double time after")).toBeInTheDocument();
    expect(within(ot).getByText("8h")).toBeInTheDocument();
    expect(within(ot).getByText("12h")).toBeInTheDocument();
  });

  it("leaves the weekend section to weekends", () => {
    open();
    const weekend = section("Weekend & holiday rates");
    expect(within(weekend).queryByText("12h")).toBeNull();
    expect(screen.queryByText(/and on any day/i)).toBeNull();
  });

  it("still steps and saves the second rung from its new home", async () => {
    const user = userEvent.setup();
    const { onSave } = open();
    const ot = section("Overtime");
    // two steppers in this section now, so reach the second one by position
    const plus = within(ot).getAllByLabelText("Increase");
    await user.click(plus[1]);
    expect(within(ot).getByText("12.5h")).toBeInTheDocument();
    await user.click(screen.getByText("Save"));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ dblAfter: 12.5 }));
  });
});

describe("a rate rule with no second rung", () => {
  /* Picking 2× used to render the words "all day" in the CONTROL row, styled
     exactly like the "then 2× after" label that sits beside a stepper — so it
     read as a field someone had disabled, rather than as the absence of a
     follow-up question. The row's own summary already says "2× all day". */
  it("says so in its summary and puts nothing in the control row", async () => {
    const user = userEvent.setup();
    open();
    // Sundays default to 2× all day
    const sun = screen.getByText("Sundays").closest(".prule") as HTMLElement;
    expect(within(sun).getByText("2× all day")).toBeInTheDocument();
    expect(within(sun).queryByText("all day", { selector: ".rl-then" })).toBeNull();

    // and the 1.5× branch still asks its follow-up
    await user.click(within(sun).getByText("1.5×"));
    expect(within(sun).getByText("then 2× after")).toBeInTheDocument();
  });
});

describe("locking timesheets", () => {
  /* The most consequential switch in this modal was a bare toggle. With it on,
     the person who submitted a sheet cannot touch it again and the only way
     back is a manager sending it back — so whoever flips it is choosing to
     become the recovery path. */
  it("says what it does to the person who submits, either way", async () => {
    const user = userEvent.setup();
    open();
    const auto = section("Auto-submit");
    expect(within(auto).getByText(/only sending their sheet back reopens it/)).toBeInTheDocument();
    await user.click(within(auto).getByText("Lock timesheets once submitted"));
    expect(within(auto).getByText(/keep correcting a submitted sheet/)).toBeInTheDocument();
  });
});

describe("the pay-run export", () => {
  /* The walk's finding was that an export does not belong behind a gear
     labelled "Pay settings". Reading the handler changed the answer: it was a
     1.8-second spinner that produced no file, and there is no PDF anywhere in
     the codebase. Moving that somewhere MORE discoverable would have been the
     worse fix. */
  it("offers no button to press, and says why", () => {
    open();
    const ex = section("Pay run export");
    expect(within(ex).queryByText(/Export .*PDF/)).toBeNull();
    expect(within(ex).getByText(/Not built yet/)).toBeInTheDocument();
  });

  it("keeps the preference live, so the choice survives to the first real one", async () => {
    const user = userEvent.setup();
    const { onSave } = open();
    await user.click(within(section("Pay run export")).getByText("Include daily breakdown per person"));
    await user.click(screen.getByText("Save"));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ exportDetail: true }));
  });
});

describe("the working-days control", () => {
  it("keys the days with two letters, so the two Ts and two Ss are tellable apart", () => {
    open();
    const days = within(screen.getByRole("group", { name: "Normal working days" })).getAllByRole(
      "button",
    );
    expect(days.map((d) => d.textContent)).toEqual(["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"]);
    // the accessible name stays the full weekday
    expect(days[3]).toHaveAttribute("aria-label", "Thu");
  });
});

describe("re-running the wizard", () => {
  it("says it steps you through, and keeps what is already set", async () => {
    const user = userEvent.setup();
    open({ ...DEFAULT_SETTINGS, standard: 7.6 });
    await user.click(screen.getByText("Step through setup"));
    expect(screen.getByText(/step 1 of 7/)).toBeInTheDocument();
    // nothing was reset on the way in
    await user.click(screen.getByLabelText("Step 3"));
    expect(screen.getByText("7.6h")).toBeInTheDocument();
  });
});
