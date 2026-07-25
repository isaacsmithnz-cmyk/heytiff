import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TimePaySettings } from "../settings";
import { DEFAULT_SETTINGS, type Settings } from "../logic";
import type { PayPeriod } from "../timepay";

/* The Breaks section of the pay-settings gear.

   It sits among the pay sections, which is the whole of its gating: everything
   inside `canPay` is `financials`, so an admin without it sees the public
   holiday manager and nothing that changes how pay is computed. A break is
   part of how pay is computed — it decides what a shift is worth. */

const PERIOD: PayPeriod = {
  start: "2026-06-29",
  range: "29 Jun – 5 Jul",
  year: "2026",
  live: true,
  note: "",
};

function open(over: { settings?: Settings; canPay?: boolean } = {}) {
  const onSave = jest.fn();
  const view = render(
    <TimePaySettings
      settings={over.settings ?? DEFAULT_SETTINGS}
      firstRun={false}
      period={PERIOD}
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
  it("offers paid/unpaid and a minutes stepper, defaulting to none", () => {
    open();
    const ms = section("Breaks");
    expect(within(ms).getByText("Paid")).toBeInTheDocument();
    expect(within(ms).getByText("Unpaid")).toBeInTheDocument();
    expect(within(ms).getByText("No standard break")).toBeInTheDocument();
    expect(
      within(ms).getByText(/Deducted from worked hours when unpaid/),
    ).toBeInTheDocument();
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
    await user.click(within(ms).getByText("Unpaid"));
    await user.click(within(ms).getByLabelText("Longer break"));
    await user.click(within(ms).getByLabelText("Longer break"));
    expect(within(ms).getByText("30 min")).toBeInTheDocument();

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
        period={PERIOD}
        canPay
        onClose={jest.fn()}
        onSave={jest.fn()}
      />,
    );
    expect(screen.getByText("Setup · step 1 of 7")).toBeInTheDocument();
  });
});
