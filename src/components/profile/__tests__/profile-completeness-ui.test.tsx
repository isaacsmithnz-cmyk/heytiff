import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { StaffProfile } from "@/lib/staff/profile";
import { ProfileScreen } from "../profile-screen";
import { TODAY, blankProfile, header, jordan, okActions } from "./fixtures/staff";

/* "What's still missing" — the ring, the checklist and the tabs' amber dots.

   All three read lib/staff/completeness, so the point of these is the WIRING:
   that the count on screen matches the dots beside it, and that every item is
   something you can act on from where you are reading it. */

function setup(profile: StaffProfile | null = jordan) {
  const actions = okActions();
  const view = render(
    <ProfileScreen
      mode="self"
      header={header}
      profile={profile}
      licences={[]}
      vehicle={null}
      today={TODAY}
      org="Smith Air"
      actions={actions}
    />
  );
  return { ...view, actions };
}

/* jordan is filled in but for the one field nobody remembers */
const done: StaffProfile = { ...jordan, work_rights_status: "Australian citizen" };

const banner = () => screen.getByText(/% complete/).closest(".ptodo") as HTMLElement;

/* A card's mode is its `readonly` class, not the presence of a Save button:
   SectionCard renders the whole button set every time and the CSS shows the
   pair the mode calls for, so in jsdom Save is always in the document. */
const isEditing = (container: HTMLElement) =>
  container.querySelector(".card2:not(.readonly):not([data-static]):not([data-live])") !== null;

describe("the banner", () => {
  it("counts what is missing and names the required ones", () => {
    setup(blankProfile);
    expect(screen.getByText("0% complete")).toBeInTheDocument();
    expect(screen.getByText("10 of 10 fields missing · 7 required")).toBeInTheDocument();
  });

  it("draws the ring to the same percentage it prints", () => {
    const { container } = setup(jordan);
    // one field short of the ten
    expect(screen.getByText("90% complete")).toBeInTheDocument();
    expect(container.querySelector(".pring .v")).toHaveAttribute("stroke-dasharray", "90 100");
  });

  it("gives the screen back once there is nothing left to ask for", () => {
    setup(done);
    expect(screen.queryByText(/% complete/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Fill in missing details/ })).not.toBeInTheDocument();
  });

  it("lists every missing field as something you can click", () => {
    setup(blankProfile);
    const items = within(banner()).getAllByRole("button");
    // the checklist, plus the one CTA above it
    expect(items).toHaveLength(11);
    expect(within(banner()).getByRole("button", { name: /Date of birth/ })).toBeInTheDocument();
  });
});

describe("the tabs' amber dots", () => {
  it("marks only the sections actually holding a missing field", () => {
    setup(jordan); // work rights is the only gap
    expect(screen.getByRole("tab", { name: /Work rights/ })).toHaveTextContent("details missing");
    expect(screen.getByRole("tab", { name: /Personal details/ })).not.toHaveTextContent(
      "details missing"
    );
  });

  it("agrees with the checklist — a blank card marks all three owning sections", () => {
    const { container } = setup(blankProfile);
    const flagged = [...container.querySelectorAll(".pftab")]
      .filter((t) => t.querySelector(".attn"))
      .map((t) => t.getAttribute("data-psec"));
    expect(flagged.sort()).toEqual(["emergency", "personal", "workrights"]);
  });

  it("drops every dot when the card is finished", () => {
    const { container } = setup(done);
    expect(container.querySelector(".pftab .attn")).toBeNull();
  });
});

describe("answering the checklist", () => {
  it("moves to the owning section AND opens that card's form", async () => {
    const user = userEvent.setup();
    const { container } = setup(jordan);

    await user.click(within(banner()).getByRole("button", { name: /Work rights/ }));

    expect(screen.getByRole("tab", { name: /Work rights/ })).toHaveClass("on");
    // already in edit mode — nobody clicked Edit
    expect(isEditing(container)).toBe(true);
    expect(screen.getByLabelText(/Work rights status/)).toBeInTheDocument();
  });

  it("opens the form again when the same section is asked for twice", async () => {
    const user = userEvent.setup();
    const { container } = setup(jordan);
    const ask = () => within(banner()).getByRole("button", { name: /Work rights/ });

    await user.click(ask());
    await user.click(screen.getByRole("button", { name: /^Cancel$/ }));
    expect(isEditing(container)).toBe(false);

    // the nonce moved, so the very same request lands a second time
    await user.click(ask());
    expect(isEditing(container)).toBe(true);
  });

  it("leaves the next section you open in read mode", async () => {
    const user = userEvent.setup();
    const { container } = setup(jordan);

    await user.click(within(banner()).getByRole("button", { name: /Work rights/ }));
    await user.click(screen.getByRole("tab", { name: /Emergency contact/ }));

    expect(isEditing(container)).toBe(false);
  });

  it("the headline CTA goes to the first thing on the list", async () => {
    const user = userEvent.setup();
    const { container } = setup(blankProfile);

    await user.click(screen.getByRole("button", { name: /Fill in missing details/ }));

    // First name is the first missing field, and it lives in Personal
    expect(screen.getByRole("tab", { name: /Personal details/ })).toHaveClass("on");
    expect(isEditing(container)).toBe(true);
    expect(screen.getByLabelText(/First name/)).toBeInTheDocument();
  });
});

describe("a blank value in the read view", () => {
  it("is a button that opens the form, not a dash", async () => {
    const user = userEvent.setup();
    const { container } = setup({ ...jordan, phone: null });

    // the value's own slot offers the fix
    await user.click(screen.getByRole("button", { name: /Add Mobile/ }));

    expect(isEditing(container)).toBe(true);
    expect(screen.getByLabelText(/Phone/)).toHaveValue("");
  });

  it("does not offer to edit what this card cannot write", () => {
    setup(jordan);
    // the sign-in address is the Auth0 identity, not a column on this card
    expect(screen.queryByRole("button", { name: /Add Email/ })).not.toBeInTheDocument();
    expect(screen.getByText(header.email)).toBeInTheDocument();
  });
});
