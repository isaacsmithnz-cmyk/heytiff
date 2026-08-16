import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WorkRightsCard, workRightsPayload } from "../workrights-card";
import { blankProfile, TODAY, okActions } from "./fixtures/staff";

/* Work rights.

   The old card rendered the visa block for everyone and merely DIMMED it for a
   citizen, leaving disabled inputs on screen holding values that could no
   longer be true. Here the block is unmounted, and choosing a no-visa status
   blanks those columns on save — so the record says what the card says. */

const onVisa = {
  ...blankProfile,
  work_rights_status: "Full working rights (visa)",
  visa_type: "482 TSS",
  visa_expiry: "2026-08-07",
  hours_condition: "unlimited",
  vevo_checked_at: "2026-06-01",
};

function setup(profile = blankProfile) {
  const actions = okActions();
  render(
    <WorkRightsCard
      profile={profile}
      mode="self"
      today={TODAY}
      onSave={actions.onSave}
    />
  );
  return actions;
}

const edit = () => screen.getByRole("button", { name: /^Edit$/ });
const save = () => screen.getByRole("button", { name: /^Save\b/ });

describe("choosing a no-visa status", () => {
  it("takes the visa inputs out of the DOM, not merely out of focus", async () => {
    const user = userEvent.setup();
    setup(onVisa);

    await user.click(edit());
    expect(screen.getByDisplayValue("482 TSS")).toBeInTheDocument();

    await user.selectOptions(
      screen.getByRole("combobox", { name: /^Status/i }),
      "Australian citizen"
    );

    expect(screen.queryByDisplayValue("482 TSS")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Expiry")).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Right to work checked/)).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue("unlimited")).not.toBeInTheDocument();
    // the edit-only "No visa required" banner is gone: both modes now say it
    // as a row, so there is one presentation of the fact instead of two
    expect(screen.getByText("No — full working rights")).toBeInTheDocument();
  });

  it("nulls the visa columns on save rather than leaving stale ones", async () => {
    const user = userEvent.setup();
    const actions = setup(onVisa);

    await user.click(edit());
    await user.selectOptions(
      screen.getByRole("combobox", { name: /^Status/i }),
      "Permanent resident"
    );
    await user.click(save());

    expect(actions.onSave).toHaveBeenCalledWith("workrights", {
      work_rights_status: "Permanent resident",
      visa_type: "",
      visa_expiry: "",
      hours_condition: "",
      vevo_checked_at: "",
    });
  });

  it("brings the typed values back when the status goes back to a visa", async () => {
    const user = userEvent.setup();
    setup(onVisa);

    await user.click(edit());
    const combo = screen.getByRole("combobox", { name: /^Status/i });
    await user.selectOptions(combo, "Australian citizen");
    await user.selectOptions(combo, "Conditional working rights (visa)");

    // the draft kept them, so a misclick costs nothing
    expect(screen.getByDisplayValue("482 TSS")).toBeInTheDocument();
    expect(screen.getByLabelText("Expiry")).toHaveTextContent("07/08/2026");
  });

  it("asks for both of its dates with a calendar, never a text box", async () => {
    const user = userEvent.setup();
    setup(onVisa);
    await user.click(edit());
    for (const label of ["Expiry", /Right to work checked/]) {
      const field = screen.getByLabelText(label);
      expect(field.tagName).toBe("BUTTON");
      expect(field).toHaveAttribute("aria-haspopup", "dialog");
    }

    // a check you already did can't be in the future: it opens on the month it
    // holds (June 2026), and the days past TODAY aren't there to be clicked
    await user.click(screen.getByLabelText(/Right to work checked/));
    const pop = () => within(screen.getByRole("dialog"));
    await user.click(pop().getByRole("button", { name: "Next month" }));
    expect(pop().getByRole("button", { name: "Friday 24 July 2026" })).toBeEnabled(); // TODAY
    expect(pop().getByRole("button", { name: "Saturday 25 July 2026" })).toBeDisabled();
  });

  it("submits the ISO the picker produced", async () => {
    const user = userEvent.setup();
    const actions = setup(onVisa);
    await user.click(edit());
    // the expiry opens on its own month — August 2026
    await user.click(screen.getByLabelText("Expiry"));
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Monday 31 August 2026" })
    );
    await user.click(save());
    expect(actions.onSave).toHaveBeenCalledWith(
      "workrights",
      expect.objectContaining({ visa_expiry: "2026-08-31" })
    );
  });
});

describe("the read view", () => {
  it("states the answer for a citizen, with no visa panel at all", () => {
    setup({ ...blankProfile, work_rights_status: "Australian citizen" });
    expect(screen.getByText("Australian citizen")).toBeInTheDocument();
    expect(screen.getByText(/No — full working rights/)).toBeInTheDocument();
    // the whole panel is unmounted, not dimmed — same rule the edit form applies
    expect(screen.queryByText("Visa")).not.toBeInTheDocument();
    expect(screen.queryByText("Expiry")).not.toBeInTheDocument();
    expect(screen.queryByText("Right to work checked")).not.toBeInTheDocument();
  });

  it("shows the visa panel for a visa holder, and tints an expiry that is close", () => {
    const { container } = render(
      <WorkRightsCard profile={onVisa} mode="self" today={TODAY} onSave={jest.fn()} />
    );
    expect(screen.getByText("Visa")).toBeInTheDocument();
    expect(screen.getByText("482 TSS")).toBeInTheDocument();
    expect(screen.getByText(/07\/08\/2026/)).toBeInTheDocument();
    // 14 days out — the same 30-day window the dashboard chip uses
    expect(container.querySelector(".ro-state.warn")).not.toBeNull();
  });

  it("asks for the status rather than inventing one", async () => {
    const user = userEvent.setup();
    setup();
    // nothing recorded reads as an offer, not a dash: the button opens this
    // card's own form with the field it names
    expect(screen.queryByText("Australian citizen")).not.toBeInTheDocument();
    // and ONLY the status is asked for — the visa fields follow from it
    expect(screen.queryByRole("button", { name: /Add Type/ })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Select Status/ }));
    expect(screen.getByLabelText(/^Status/)).toBeInTheDocument();
  });
});

describe("workRightsPayload", () => {
  it("is a no-op for a visa status", () => {
    const draft = { work_rights_status: "Full working rights (visa)", visa_type: "482 TSS" };
    expect(workRightsPayload(draft)).toBe(draft);
  });

  it("blanks every visa column for a citizen or permanent resident", () => {
    for (const status of ["Australian citizen", "Permanent resident"]) {
      expect(workRightsPayload({ work_rights_status: status, visa_type: "482" })).toEqual({
        work_rights_status: status,
        visa_type: "",
        visa_expiry: "",
        hours_condition: "",
        vevo_checked_at: "",
      });
    }
  });
});
