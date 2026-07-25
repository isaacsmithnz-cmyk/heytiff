import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ProfileScreen } from "../profile-screen";
import type { SaveResult } from "../types";
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

describe("a rejected save", () => {
  it("keeps what was typed, marks the field, and stays in edit mode", async () => {
    const user = userEvent.setup();
    const actions = rejects({
      ok: false,
      error: "Check the date format — use dd/mm/yyyy.",
      fields: ["birthday"],
    });
    setup(actions);

    await user.click(editButtons()[0]);
    const birthday = screen.getByDisplayValue("25/12/1990");
    await user.clear(birthday);
    // a real date the server happens to refuse — pre-validation passes it
    await user.type(birthday, "01/01/1990");
    await user.click(screen.getByRole("button", { name: /^Save$/ }));

    expect(await screen.findByText("Check the date format — use dd/mm/yyyy.")).toBeInTheDocument();
    // what was typed is still there…
    expect(screen.getByDisplayValue("01/01/1990")).toBeInTheDocument();
    // …the field is marked…
    expect(screen.getByDisplayValue("01/01/1990")).toHaveAttribute("aria-invalid", "true");
    // …and the card never went back to read mode
    expect(screen.getByRole("button", { name: /^Save$/ })).toBeInTheDocument();
  });

  it("survives a re-render mid-edit with the same props", async () => {
    const user = userEvent.setup();
    const actions = okActions();
    const { rerender, props } = setup(actions);

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
  it("unlocks only the card that was clicked", async () => {
    const user = userEvent.setup();
    const { container } = setup(okActions());
    const cards = () => [...container.querySelectorAll<HTMLElement>(".card2")];

    await user.click(screen.getByRole("button", { name: /Compliance/ }));
    // Compliance holds a live card (add/remove, never locked) and the
    // qualifications card, which has the usual edit cycle
    expect(cards()).toHaveLength(2);
    expect(editButtons()).toHaveLength(1);

    // before: the edit-cycle card is locked, the live card never is
    const live = cards().find((c) => c.hasAttribute("data-live"))!;
    expect(live).not.toHaveClass("readonly");
    expect(cards().filter((c) => c.classList.contains("readonly"))).toHaveLength(1);

    await user.click(editButtons()[0]);

    // after: nothing is locked, because the only locked card was this one
    expect(cards().filter((c) => c.classList.contains("readonly"))).toHaveLength(0);
    expect(screen.getAllByRole("button", { name: /^Save$/ })).toHaveLength(1);
  });

  it("gives a static card no edit affordance at all", async () => {
    const user = userEvent.setup();
    setup(okActions());

    await user.click(screen.getByRole("button", { name: /Training/ }));
    expect(screen.queryByRole("button", { name: /^Edit$/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Save$/ })).not.toBeInTheDocument();
  });

  it("Cancel restores the values from props and drops the error", async () => {
    const user = userEvent.setup();
    const actions = rejects({ ok: false, error: "Nope.", fields: ["phone"] });
    setup(actions);

    await user.click(editButtons()[0]);
    const phone = screen.getByDisplayValue("0400 000 000");
    await user.clear(phone);
    await user.type(phone, "0000");
    await user.click(screen.getByRole("button", { name: /^Save$/ }));
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

    await user.click(screen.getByRole("button", { name: /Emergency contact/ }));
    await user.click(editButtons()[0]);
    await user.click(screen.getByRole("button", { name: /^Save$/ }));

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

describe("pre-validation", () => {
  it("never calls the action for a date it can already tell is wrong", async () => {
    const user = userEvent.setup();
    const actions = okActions();
    setup(actions);

    await user.click(editButtons()[0]);
    const birthday = screen.getByDisplayValue("25/12/1990");
    await user.clear(birthday);
    await user.type(birthday, "31/02/1990"); // no such day
    await user.click(screen.getByRole("button", { name: /^Save$/ }));

    expect(await screen.findByText("Check the date format — use dd/mm/yyyy.")).toBeInTheDocument();
    expect(actions.onSave).not.toHaveBeenCalled();
    expect(screen.getByDisplayValue("31/02/1990")).toHaveAttribute("aria-invalid", "true");
  });

  it("clears the mark once the date is fixed and the save goes through", async () => {
    const user = userEvent.setup();
    const actions = okActions();
    setup(actions);

    await user.click(editButtons()[0]);
    const birthday = screen.getByDisplayValue("25/12/1990");
    await user.clear(birthday);
    await user.type(birthday, "31/02/1990");
    await user.click(screen.getByRole("button", { name: /^Save$/ }));
    await screen.findByText("Check the date format — use dd/mm/yyyy.");

    // same input node — it is controlled, not remounted
    await user.clear(birthday);
    await user.type(birthday, "28/02/1990");
    await user.click(screen.getByRole("button", { name: /^Save$/ }));

    expect(actions.onSave).toHaveBeenCalledWith(
      "personal",
      expect.objectContaining({ birthday: "28/02/1990" })
    );
  });
});
