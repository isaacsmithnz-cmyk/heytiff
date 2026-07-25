import { fireEvent, render, screen } from "@testing-library/react";
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
      org="Smith Air"
      today={TODAY}
      onSave={actions.onSave}
    />
  );
  return actions;
}

const edit = () => screen.getByRole("button", { name: /^Edit$/ });
const save = () => screen.getByRole("button", { name: /^Save$/ });

describe("choosing a no-visa status", () => {
  it("takes the visa inputs out of the DOM, not merely out of focus", async () => {
    const user = userEvent.setup();
    setup(onVisa);

    await user.click(edit());
    expect(screen.getByDisplayValue("482 TSS")).toBeInTheDocument();

    await user.selectOptions(
      screen.getByRole("combobox", { name: /Work rights status/i }),
      "Australian citizen"
    );

    expect(screen.queryByDisplayValue("482 TSS")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Visa expiry")).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/VEVO last checked/)).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue("unlimited")).not.toBeInTheDocument();
    expect(screen.getByText("No visa required")).toBeInTheDocument();
  });

  it("nulls the visa columns on save rather than leaving stale ones", async () => {
    const user = userEvent.setup();
    const actions = setup(onVisa);

    await user.click(edit());
    await user.selectOptions(
      screen.getByRole("combobox", { name: /Work rights status/i }),
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
    const combo = screen.getByRole("combobox", { name: /Work rights status/i });
    await user.selectOptions(combo, "Australian citizen");
    await user.selectOptions(combo, "Conditional working rights (visa)");

    // the draft kept them, so a misclick costs nothing
    expect(screen.getByDisplayValue("482 TSS")).toBeInTheDocument();
    expect(screen.getByLabelText("Visa expiry")).toHaveValue("2026-08-07");
  });

  it("asks for both of its dates with a calendar, never a text box", async () => {
    const user = userEvent.setup();
    setup(onVisa);
    await user.click(edit());
    expect(screen.getByLabelText("Visa expiry")).toHaveAttribute("type", "date");
    expect(screen.getByLabelText(/VEVO last checked/)).toHaveAttribute("type", "date");
    // a check you already did can't be in the future
    expect(screen.getByLabelText(/VEVO last checked/)).toHaveAttribute("max", TODAY);
  });

  it("submits the ISO the picker produced", async () => {
    const user = userEvent.setup();
    const actions = setup(onVisa);
    await user.click(edit());
    fireEvent.change(screen.getByLabelText("Visa expiry"), { target: { value: "2027-06-30" } });
    await user.click(save());
    expect(actions.onSave).toHaveBeenCalledWith(
      "workrights",
      expect.objectContaining({ visa_expiry: "2027-06-30" })
    );
  });
});

describe("the read view", () => {
  it("states the answer for a citizen, with no visa facts at all", () => {
    setup({ ...blankProfile, work_rights_status: "Australian citizen" });
    expect(screen.getByText("No visa required — full working rights")).toBeInTheDocument();
    expect(screen.queryByText("Expiry")).not.toBeInTheDocument();
    expect(screen.queryByText("VEVO checked")).not.toBeInTheDocument();
  });

  it("leads with the visa type, and tints an expiry that is close", () => {
    const { container } = render(
      <WorkRightsCard
        profile={onVisa}
        mode="self"
        org="Smith Air"
        today={TODAY}
        onSave={jest.fn()}
      />
    );
    expect(screen.getByText("482 TSS")).toBeInTheDocument();
    expect(screen.getByText("07/08/2026")).toBeInTheDocument();
    // 14 days out — the same 30-day window the dashboard chip uses
    expect(container.querySelector(".idc-facts .f.warn")).not.toBeNull();
  });

  it("says nothing is recorded rather than inventing a status", () => {
    setup();
    expect(screen.getByText("Work rights not recorded")).toBeInTheDocument();
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
