import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CAPABILITIES, resolve } from "@/lib/permissions";
import { ProfileScreen } from "../profile-screen";
import type { PermissionsCtx, ProfileMode } from "../types";
import { TODAY, header, jordan, okActions } from "./fixtures/staff";

/* EDITING HAPPENS WHERE THE VALUE LIVES.

   A section used to declare its read view and its edit view separately, and
   separate is how they drifted into different screens: grouped panels of tight
   label/value rows one side, a flat two-column form of 46px boxes the other.
   Clicking Edit threw the layout away and moved every label. Live, that read
   as "the font is much bigger than where it comes from" and "why do I click
   Add to go into it" — one cause, two complaints.

   These pin the thing that fixes it: ONE row list, and the mode only changes
   what sits inside a `dd`. If a future card grows a separate `edit` render
   again, the structural assertions below are what should fail. */

const ctx: PermissionsCtx = {
  role: "staff",
  caps: resolve("staff"),
  settable: new Set(CAPABILITIES),
  canChangeRole: true,
  editable: true,
};

function setup(sec: string, mode: ProfileMode = "admin") {
  const actions = okActions();
  const view = render(
    <ProfileScreen
      mode={mode}
      header={header}
      profile={jordan}
      licences={[]}
      vehicle={null}
      today={TODAY}
      org="Smith Air"
      orgState="NSW"
      initialSec={sec}
      adminExtras={{
        payroll: {
          hourly_wage: 45,
          contracted_hours: 38,
          utilisation: 85,
          cost_split: { install: 55, service: 35, admin: 10 },
        },
        permissions: ctx,
        notes: {},
      }}
      actions={actions}
    />
  );
  return { ...view, actions };
}

const labels = (c: HTMLElement) =>
  [...c.querySelectorAll(".pdrow dt")].map((d) => (d.textContent ?? "").replace("*", "").trim());
const panels = (c: HTMLElement) =>
  [...c.querySelectorAll(".pdlh > span")].map((h) => h.textContent);
const startEdit = (user: ReturnType<typeof userEvent.setup>) =>
  user.click(screen.getAllByRole("button", { name: /^Edit$/ })[0]);

describe("nothing moves when the mode changes", () => {
  it("keeps the same panels, in the same order", async () => {
    const user = userEvent.setup();
    const { container } = setup("personal");
    const before = panels(container);

    await startEdit(user);

    expect(panels(container)).toEqual(before);
    expect(before).toEqual(["Identity", "Contact", "Employment"]);
  });

  it("keeps the same rows, with the same labels, in the same order", async () => {
    const user = userEvent.setup();
    const { container } = setup("personal");
    const before = labels(container);

    await startEdit(user);

    expect(labels(container)).toEqual(before);
  });

  /* The form used to call the same field something else — "Phone" where the
     row above it said "Mobile", "Birthday" for "Date of birth". One list can
     only have one name, which is the point. */
  it("calls each field one thing", async () => {
    const user = userEvent.setup();
    const { container } = setup("personal");
    await startEdit(user);

    expect(labels(container)).toContain("Mobile");
    expect(labels(container)).not.toContain("Phone");
    expect(labels(container)).toContain("Date of birth");
    expect(labels(container)).not.toContain("Birthday");
  });

  /* The control has to be the same SIZE as the value it replaces, or the row
     jumps even when it doesn't move. jsdom computes no stylesheet, so this
     asserts the hook the stylesheet keys off instead. */
  it("marks the rows that became controls, and only those", async () => {
    const user = userEvent.setup();
    const { container } = setup("personal");
    expect(container.querySelectorAll(".pdrow.live")).toHaveLength(0);

    await startEdit(user);

    const live = container.querySelectorAll(".pdrow.live").length;
    expect(live).toBeGreaterThan(0);
    // Email has no control — it is the Auth0 identity, not a column this card
    // can write — so its row stays a value in both modes
    expect(live).toBe(container.querySelectorAll(".pdrow").length - 1);
  });
});

describe("the label still belongs to the control", () => {
  /* `Field` used to tie a real <label> to each control by reading its name.
     Rows do that job now, and losing it would be an invisible regression —
     the screen would look right and announce nothing. */
  it("focuses the control when its row label is clicked", async () => {
    const user = userEvent.setup();
    setup("personal");
    await startEdit(user);

    await user.click(screen.getByText("First name"));
    expect(screen.getByDisplayValue("Jordan")).toHaveFocus();
  });

  it("marks a required row on its label rather than in a legend", async () => {
    const user = userEvent.setup();
    const { container } = setup("personal");
    await startEdit(user);
    expect(container.querySelectorAll(".pdrow dt .req").length).toBeGreaterThan(0);
  });
});

describe("a percentage you can see", () => {
  it("draws utilisation as a filled track without entering edit mode", () => {
    const { container } = setup("payroll");
    const slider = container.querySelector(".pslider");
    expect(slider).toHaveClass("readonly");
    expect(slider?.querySelector(".fill")).toHaveStyle({ width: "85%" });
    // nothing draggable until you ask
    expect(container.querySelectorAll('.pslider input[type="range"]')).toHaveLength(0);
  });

  it("puts the thumb on the same track when you do", async () => {
    const user = userEvent.setup();
    const { container } = setup("payroll");
    await startEdit(user);

    const slider = container.querySelector(".pslider");
    expect(slider).not.toHaveClass("readonly");
    expect(screen.getByRole("slider", { name: "Utilisation" })).toHaveValue("85");
  });

  it("drags to a new value and submits it", async () => {
    const user = userEvent.setup();
    const { actions } = setup("payroll");
    await startEdit(user);

    // fireEvent, not user-event: a range's value moves by drag or arrow key,
    // and jsdom implements neither — what matters here is that the control is
    // wired to the draft, which a change event proves.
    fireEvent.change(screen.getByRole("slider", { name: "Utilisation" }), {
      target: { value: "70" },
    });
    await user.click(screen.getByRole("button", { name: /^Save\b/ }));

    const [section, fields] = actions.onSave.mock.calls[0];
    expect(section).toBe("payroll");
    expect(fields.utilisation).toBe("70");
  });

  /* An unset percentage is a dash, not a confident 0% — the two mean different
     things to a rate calculation. */
  it("reads an unset one as a dash", () => {
    const actions = okActions();
    const { container } = render(
      <ProfileScreen
        mode="admin"
        header={header}
        profile={jordan}
        licences={[]}
        vehicle={null}
        today={TODAY}
        org="Smith Air"
        initialSec="payroll"
        adminExtras={{ payroll: { hourly_wage: 45 }, permissions: ctx, notes: {} }}
        actions={actions}
      />
    );
    expect(container.querySelector(".pslider .num")).toHaveTextContent("—");
  });
});

describe("work rights follows the draft, not the saved row", () => {
  /* The visa panel is unmounted for a citizen, not dimmed — and that has to
     hold off ONE condition now, because the same rows serve both modes. A
     divergence here would show a panel the save is about to empty. */
  it("folds the visa panel away as you choose a no-visa status", async () => {
    const user = userEvent.setup();
    const { container } = setup("workrights");
    await startEdit(user);

    expect(panels(container)).toContain("Visa");

    await user.selectOptions(screen.getByRole("combobox", { name: /^Status/ }), "Australian citizen");

    expect(panels(container)).not.toContain("Visa");
    expect(screen.getByText("No — full working rights")).toBeInTheDocument();
  });
});

describe("the emergency card is the one exception, and says why", () => {
  /* A plastic ICE card is the read view because it is the thing someone reads
     off a phone at speed on a site — and a card is not something you type
     into. Showing it beside the rows would be the doubling we took off
     Summary; showing it WHILE editing would be worse, because it renders the
     saved values and would sit there contradicting what you were typing. */
  it("swaps the card for the rows rather than showing both", async () => {
    const user = userEvent.setup();
    const { container } = setup("emergency");

    expect(container.querySelector(".idc")).toBeInTheDocument();
    expect(container.querySelectorAll(".pdrow")).toHaveLength(0);

    await startEdit(user);

    expect(container.querySelector(".idc")).not.toBeInTheDocument();
    expect(within(container).getByDisplayValue("Sarah Mills")).toBeInTheDocument();
  });
});
