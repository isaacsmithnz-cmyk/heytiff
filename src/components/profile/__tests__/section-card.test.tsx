import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CAPABILITIES, resolve } from "@/lib/permissions";
import { ProfileScreen } from "../profile-screen";
import type { PermissionsCtx, SaveResult } from "../types";
import { TODAY, header, jordan, okActions } from "./fixtures/staff";

/* The per-card edit cycle — and the second production bug this rewrite kills.

   The old handler captured the card's DOM node, awaited the action, then wrote
   the error onto that node. A rejected save still revalidated nothing, but ANY
   re-render swapped the subtree out from under it: the error landed on a
   detached node and everything typed went with it. The draft lives in React
   state now, so a failure touches only the message. */

const rejects = (res: SaveResult) => ({
  ...okActions(),
  onSave: jest.fn().mockResolvedValue(res),
});

function setup(actions: ReturnType<typeof okActions>) {
  const props = {
    mode: "self" as const,
    header,
    profile: jordan,
    licences: [],
    vehicle: null,
    today: TODAY,
    org: "Smith Air",
    actions,
  };
  const view = render(<ProfileScreen {...props} />);
  return { ...view, props };
}

const editButtons = () => screen.getAllByRole("button", { name: /^Edit$/ });

/* Summary is the landing tab now, and it has nothing to edit — so a test about
   the edit cycle has to open a section first. Personal is the one every one of
   these used to land on. */
const openPersonal = (user: ReturnType<typeof userEvent.setup>) =>
  user.click(screen.getByRole("tab", { name: /Personal/ }));

/* Dates are picked, not typed — and since #142 the picker is OURS: a button
   that opens a calendar, with no input of any kind in it. So a test can't set
   a date; it has to open the thing and click a day, by the name a screen
   reader would read out. The day is chosen from the month the field opens on
   (its own value's), because paging a decade at a time is not what a person
   does either. */
const pick = async (user: ReturnType<typeof userEvent.setup>, label: string, day: string) => {
  await user.click(screen.getByLabelText(label));
  await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: day }));
};

describe("a rejected save", () => {
  it("keeps what was typed, marks the field, and stays in edit mode", async () => {
    const user = userEvent.setup();
    const actions = rejects({
      ok: false,
      error: "Check the date format — use dd/mm/yyyy.",
      fields: ["birthday"],
    });
    setup(actions);

    await openPersonal(user);
    await user.click(editButtons()[0]);
    // a real date the server happens to refuse — pre-validation passes it
    await pick(user, "Date of birth", "Monday 3 December 1990");
    await user.click(screen.getByRole("button", { name: /^Save\b/ }));

    expect(await screen.findByText("Check the date format — use dd/mm/yyyy.")).toBeInTheDocument();
    // what was entered is still there…
    expect(screen.getByLabelText("Date of birth")).toHaveTextContent("03/12/1990");
    // …the field is marked…
    expect(screen.getByLabelText("Date of birth")).toHaveAttribute("aria-invalid", "true");
    // …and the card never went back to read mode
    expect(screen.getByRole("button", { name: /^Save\b/ })).toBeInTheDocument();
  });

  it("survives a re-render mid-edit with the same props", async () => {
    const user = userEvent.setup();
    const actions = okActions();
    const { rerender, props } = setup(actions);

    await openPersonal(user);
    await user.click(editButtons()[0]);
    const phone = screen.getByDisplayValue("0400 000 000");
    await user.clear(phone);
    await user.type(phone, "0499 999 999");

    // any parent re-render — a revalidate landing from a sibling card, a
    // router refresh, anything. Nothing syncs props into the draft.
    rerender(<ProfileScreen {...props} />);

    expect(screen.getByDisplayValue("0499 999 999")).toBeInTheDocument();
  });
});

describe("the edit cycle", () => {
  /* Compliance is the one tab holding TWO sections: the licence wall, which is
     live (add/remove, never a read mode) and so takes the section head, and
     Qualifications, which keeps a card's frame because the tab's title is
     already spoken for. Opening one must not unlock the other. */
  it("unlocks only the section that was clicked", async () => {
    const user = userEvent.setup();
    const { container } = setup(okActions());

    await user.click(screen.getByRole("tab", { name: /Compliance/ }));
    expect(container.querySelectorAll(".card2")).toHaveLength(1);
    expect(container.querySelectorAll("[data-live]")).toHaveLength(1);
    // only the framed one has an edit cycle. Its mode is the `readonly` class,
    // not the presence of Save: the card variant renders the whole button set
    // every time and the CSS shows the pair the mode calls for.
    expect(editButtons()).toHaveLength(1);
    const framed = () => container.querySelector<HTMLElement>(".card2")!;
    expect(framed()).toHaveClass("readonly");

    await user.click(editButtons()[0]);

    expect(framed()).not.toHaveClass("readonly");
    expect(screen.getAllByRole("button", { name: /^Save\b/ })).toHaveLength(1);
    // the live wall is untouched — it never had a mode to change
    expect(container.querySelectorAll("[data-live]")).toHaveLength(1);
  });

  it("gives a static card no edit affordance at all", async () => {
    const user = userEvent.setup();
    setup(okActions());

    await user.click(screen.getByRole("tab", { name: /Training/ }));
    expect(screen.queryByRole("button", { name: /^Edit$/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Save\b/ })).not.toBeInTheDocument();
  });

  it("Cancel restores the values from props and drops the error", async () => {
    const user = userEvent.setup();
    const actions = rejects({ ok: false, error: "Nope.", fields: ["phone"] });
    setup(actions);

    await openPersonal(user);
    await user.click(editButtons()[0]);
    const phone = screen.getByDisplayValue("0400 000 000");
    await user.clear(phone);
    await user.type(phone, "0000");
    await user.click(screen.getByRole("button", { name: /^Save\b/ }));
    expect(await screen.findByText("Nope.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /^Cancel$/ }));

    expect(screen.queryByText("Nope.")).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue("0000")).not.toBeInTheDocument();
    // back to read mode, showing the stored value
    expect(screen.getByText("0400 000 000")).toBeInTheDocument();

    // and re-opening starts from props again, not from the abandoned draft
    await user.click(editButtons()[0]);
    expect(screen.getByDisplayValue("0400 000 000")).toBeInTheDocument();
  });

  it("submits only its own card's fields", async () => {
    const user = userEvent.setup();
    const actions = okActions();
    setup(actions);

    await user.click(screen.getByRole("tab", { name: /Emergency/ }));
    await user.click(editButtons()[0]);
    await user.click(screen.getByRole("button", { name: /^Save\b/ }));

    const [section, fields] = actions.onSave.mock.calls[0];
    expect(section).toBe("emergency");
    expect(Object.keys(fields).sort()).toEqual([
      "emergency_alt_phone",
      "emergency_name",
      "emergency_phone",
      "emergency_relationship",
    ]);
    // nothing from the Personal card rides along
    expect(fields).not.toHaveProperty("first_name");
  });
});

/* Pre-validation runs the same builder the action runs, and only calls the
   action if it comes back clean.

   Note what is NOT tested here any more: a malformed date. Every date on this
   card is a calendar picker, so "31/02/1990" is no longer something a person
   can enter — the format class of error is designed out rather than caught.
   What remains reachable is the free-text numbers on the Payroll card, which
   is what this exercises. The date rules themselves are still pinned, in
   lib/staff/__tests__/pre-validate.test.ts. */
describe("pre-validation", () => {
  const adminCtx: PermissionsCtx = {
    role: "staff",
    caps: resolve("staff"),
    settable: new Set(CAPABILITIES),
    canChangeRole: true,
    editable: true,
  };

  function adminSetup(actions: ReturnType<typeof okActions>) {
    render(
      <ProfileScreen
        mode="admin"
        header={header}
        profile={jordan}
        licences={[]}
        vehicle={null}
        today={TODAY}
        org="Smith Air"
        adminExtras={{ payroll: { hourly_wage: 45 }, permissions: adminCtx }}
        actions={actions}
      />
    );
  }

  it("never calls the action for a number it can already tell is wrong", async () => {
    const user = userEvent.setup();
    const actions = okActions();
    adminSetup(actions);

    await user.click(screen.getByRole("tab", { name: /Payroll/ }));
    await user.click(screen.getByRole("button", { name: /^Edit$/ }));
    const wage = screen.getByLabelText(/Hourly wage/);
    await user.clear(wage);
    await user.type(wage, "45o"); // a typo'd letter, not a number

    await user.click(screen.getByRole("button", { name: /^Save\b/ }));

    expect(
      await screen.findByText("Check the numbers — they should be plain figures.")
    ).toBeInTheDocument();
    expect(actions.onSave).not.toHaveBeenCalled();
    expect(wage).toHaveAttribute("aria-invalid", "true");
    // and it kept what was typed, so the fix is one character
    expect(wage).toHaveValue("45o");
  });

  it("clears the mark once it's fixed and the save goes through", async () => {
    const user = userEvent.setup();
    const actions = okActions();
    adminSetup(actions);

    await user.click(screen.getByRole("tab", { name: /Payroll/ }));
    await user.click(screen.getByRole("button", { name: /^Edit$/ }));
    const wage = screen.getByLabelText(/Hourly wage/);
    await user.clear(wage);
    await user.type(wage, "45o");
    await user.click(screen.getByRole("button", { name: /^Save\b/ }));
    await screen.findByText("Check the numbers — they should be plain figures.");

    await user.clear(wage);
    await user.type(wage, "45");
    await user.click(screen.getByRole("button", { name: /^Save\b/ }));

    expect(actions.onSave).toHaveBeenCalledWith(
      "payroll",
      expect.objectContaining({ hourly_wage: "45" })
    );
  });
});

describe("dates are picked, never typed", () => {
  it("offers a calendar for every date the card edits, and nothing to type into", async () => {
    const user = userEvent.setup();
    const { container } = setup(okActions());

    await openPersonal(user);
    await user.click(editButtons()[0]);
    for (const label of ["Date of birth", "Start date"]) {
      const field = screen.getByLabelText(label);
      expect(field.tagName).toBe("BUTTON");
      expect(field).toHaveAttribute("aria-haspopup", "dialog");
    }

    await user.click(screen.getByRole("tab", { name: /Work rights/ }));
    await user.click(editButtons()[0]);
    for (const label of ["Expiry", /VEVO checked/]) {
      expect(screen.getByLabelText(label)).toHaveAttribute("aria-haspopup", "dialog");
    }
    // the format argument is designed out: there is no date input left to lose it in
    expect(container.querySelector('input[type="date"]')).toBeNull();
  });

  it("submits the ISO the picker produced, and shows dd/mm/yyyy once saved", async () => {
    const user = userEvent.setup();
    const actions = okActions();
    const { rerender, props } = setup(actions);

    await openPersonal(user);
    await user.click(editButtons()[0]);
    // the field opens on the month it already holds — June 2020
    await pick(user, "Start date", "Tuesday 30 June 2020");
    await user.click(screen.getByRole("button", { name: /^Save\b/ }));

    expect(actions.onSave).toHaveBeenCalledWith(
      "personal",
      expect.objectContaining({ start_date: "2020-06-30" })
    );

    rerender(<ProfileScreen {...props} profile={{ ...jordan, start_date: "2020-06-30" }} />);
    // entry is ISO; reading a date back is still how an Australian writes one
    expect(screen.getByText("30/06/2020")).toBeInTheDocument();
  });

  it("seeds the picker from the stored date, not from the displayed one", async () => {
    const user = userEvent.setup();
    setup(okActions());
    await openPersonal(user);
    await user.click(editButtons()[0]);
    expect(screen.getByLabelText("Date of birth")).toHaveTextContent("25/12/1990");

    // and it opens ON that date's month rather than on today
    await user.click(screen.getByLabelText("Date of birth"));
    expect(within(screen.getByRole("dialog")).getByText("December 1990")).toBeInTheDocument();
  });
});
