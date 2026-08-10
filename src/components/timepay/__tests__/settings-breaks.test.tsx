import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TimePaySettings } from "../settings";
import { DEFAULT_SETTINGS, type Settings } from "../logic";

/* The Breaks section of the pay-settings gear.

   It sits among the pay sections, which is the whole of its gating: everything
   inside `canPay` is `financials`, so an admin without it sees the public
   holiday manager and nothing that changes how pay is computed. A break is
   part of how pay is computed — it decides what a shift is worth. */


function open(over: { settings?: Settings; canPay?: boolean } = {}) {
  const onSave = jest.fn();
  const view = render(
    <TimePaySettings
      settings={over.settings ?? DEFAULT_SETTINGS}
      firstRun={false}
      canPay={over.canPay ?? true}
      onClose={jest.fn()}
      onSave={onSave}
    />,
  );
  return { ...view, onSave };
}

/** The `.ms` block whose label is `label`. */
function section(label: string): HTMLElement {
  const l = screen.getByText(label);
  return l.closest(".ms") as HTMLElement;
}

describe("Breaks", () => {
  it("asks how long before it asks anything else, and defaults to none", () => {
    open();
    const ms = section("Breaks");
    expect(within(ms).getByText("No standard break")).toBeInTheDocument();
    /* HOW LONG FIRST. With no break configured there is nothing for paid vs
       unpaid to be about, so the question isn't asked — it used to sit ABOVE
       the stepper, under a note explaining what happens "when unpaid", for a
       break of zero minutes. */
    expect(within(ms).queryByText("Paid")).toBeNull();
    expect(within(ms).queryByText("Unpaid")).toBeNull();
    expect(within(ms).getByText(/Nothing comes off anyone/)).toBeInTheDocument();
  });

  it("asks paid-or-unpaid as soon as there is a break to ask about", async () => {
    const user = userEvent.setup();
    open();
    const ms = section("Breaks");
    await user.click(within(ms).getByLabelText("Longer break"));
    expect(within(ms).getByText("15 min")).toBeInTheDocument();
    expect(within(ms).getByText("Paid")).toBeInTheDocument();
    // and the note describes the choice that is actually selected
    expect(within(ms).getByText(/nothing comes off the day/)).toBeInTheDocument();
    await user.click(within(ms).getByText("Unpaid"));
    expect(within(ms).getByText(/Comes off worked hours/)).toBeInTheDocument();
  });

  it("shows what the workspace already chose", () => {
    open({ settings: { ...DEFAULT_SETTINGS, breakMinutes: 30, breakPaid: false } });
    const ms = section("Breaks");
    expect(within(ms).getByText("30 min")).toBeInTheDocument();
    expect(within(ms).getByText("Unpaid").className).toContain("on");
    expect(within(ms).getByText("Paid").className).not.toContain("on");
  });

  it("saves the pair on the settings object the action persists", async () => {
    const user = userEvent.setup();
    const { onSave } = open();
    const ms = section("Breaks");
    await user.click(within(ms).getByLabelText("Longer break"));
    await user.click(within(ms).getByLabelText("Longer break"));
    expect(within(ms).getByText("30 min")).toBeInTheDocument();
    await user.click(within(ms).getByText("Unpaid"));

    await user.click(screen.getByText("Save"));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ breakMinutes: 30, breakPaid: false }),
    );
  });

  it("clamps to 0–120", async () => {
    const user = userEvent.setup();
    open({ settings: { ...DEFAULT_SETTINGS, breakMinutes: 120, breakPaid: false } });
    const ms = section("Breaks");
    await user.click(within(ms).getByLabelText("Longer break"));
    expect(within(ms).getByText("120 min")).toBeInTheDocument();

    for (let i = 0; i < 9; i++) await user.click(within(ms).getByLabelText("Shorter break"));
    expect(within(ms).getByText("No standard break")).toBeInTheDocument();
  });

  it("is invisible without `financials` — it decides what a shift is worth", () => {
    open({ canPay: false });
    expect(screen.queryByText("Breaks")).toBeNull();
    expect(screen.queryByText("Standard working day")).toBeNull();
  });

  it("stays out of the first-run wizard, which is still seven steps", () => {
    render(
      <TimePaySettings
        settings={DEFAULT_SETTINGS}
        firstRun
        canPay
        onClose={jest.fn()}
        onSave={jest.fn()}
      />,
    );
    expect(screen.getByText("Setup · step 1 of 7")).toBeInTheDocument();
  });
});
