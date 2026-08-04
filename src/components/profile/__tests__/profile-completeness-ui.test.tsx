import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { StaffProfile } from "@/lib/staff/profile";
import { ProfileScreen } from "../profile-screen";
import { TODAY, blankProfile, header, jordan, okActions } from "./fixtures/staff";

/* "What's still missing" — the strip in the breadcrumb row and the tabs' count
   badges.

   Both read lib/staff/completeness, so the point of these is the WIRING: that
   the count on screen matches the badges beside it, and that the one button
   left still lands you in the right form.

   WHAT WENT. The strip used to be a banner inside the card with a seven-item
   checklist under it, and each item was a button into its section. Every one
   of those items named a field the Summary panels already show as a dash, and
   the tab badges already say which section owns it — so the list is gone and
   the two things that replaced it are what these tests hold. */

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

/* jordan is filled in but for work rights — and, now that the photo counts,
   a photo. `done` closes both. */
const done: StaffProfile = {
  ...jordan,
  work_rights_status: "Australian citizen",
  photo_url: "org/o1/staff_photo/doc-1.jpg",
};

/* A section is in edit mode when its Save is on screen: the section head
   renders Edit OR the Cancel/Save pair, never both, so the button set is the
   mode. (It used to be the `readonly` class on a `.card2` frame — the frame
   went when the tab became the section's title.) */
const isEditing = () => screen.queryByRole("button", { name: /^Save\b/ }) !== null;

const countOn = (name: RegExp) =>
  screen.getByRole("tab", { name }).querySelector(".wb2-vtn")?.textContent ?? null;

describe("the completion strip", () => {
  it("counts what is missing and names the required ones", () => {
    setup(blankProfile);
    expect(screen.getByText("0% complete")).toBeInTheDocument();
    expect(screen.getByText("11 of 11 fields missing · 7 required")).toBeInTheDocument();
  });

  it("draws the ring to the same percentage it prints", () => {
    const { container } = setup(jordan);
    // two short of the eleven — work rights and the photo
    expect(screen.getByText("82% complete")).toBeInTheDocument();
    expect(container.querySelector(".pring .v")).toHaveAttribute("stroke-dasharray", "82 100");
  });

  it("gives the row back once there is nothing left to ask for", () => {
    setup(done);
    expect(screen.queryByText(/% complete/)).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Fill in missing details/ })
    ).not.toBeInTheDocument();
  });

  /* It sits in the breadcrumb row, not in the card, so it is on screen from
     every tab — you can be standing in a section and still see the total. */
  it("stays on screen when you leave Summary", async () => {
    const user = userEvent.setup();
    setup(jordan);
    await user.click(screen.getByRole("tab", { name: /Emergency/ }));
    expect(screen.getByText("82% complete")).toBeInTheDocument();
  });
});

describe("the tabs' counts", () => {
  it("marks only the sections actually holding a missing field", () => {
    setup(jordan); // work rights is the only gap with a form behind it
    expect(countOn(/Work rights/)).toBe("1");
    expect(countOn(/Personal/)).toBeNull();
  });

  /* The badge is a COUNT, and it is the only thing left saying which section
     is short — a flag would under-report a blank Personal by six. */
  it("says how many, not just that some are missing", () => {
    setup(blankProfile);
    expect(countOn(/Personal/)).toBe("7");
    expect(countOn(/Emergency/)).toBe("2");
    expect(countOn(/Work rights/)).toBe("1");
    // Summary counts too: the photo is a field, and the camera badge on the
    // identity block is where you answer it
    expect(countOn(/Summary/)).toBe("1");
  });

  it("agrees with the strip — the badges sum to what the strip counts", () => {
    const { container } = setup(blankProfile);
    const badges = [...container.querySelectorAll(".wb2-vtn")].map((b) => Number(b.textContent));
    expect(badges.reduce((a, b) => a + b, 0)).toBe(11);
    expect(screen.getByText("11 of 11 fields missing · 7 required")).toBeInTheDocument();
  });

  it("drops every badge when the card is finished", () => {
    const { container } = setup(done);
    expect(container.querySelector(".wb2-vtn")).toBeNull();
  });
});

describe("answering the strip", () => {
  it("goes to the first missing field's section and opens its form", async () => {
    const user = userEvent.setup();
    setup(blankProfile);

    await user.click(screen.getByRole("button", { name: /Fill in missing details/ }));

    // First name is the first missing field, and it lives in Personal
    expect(screen.getByRole("tab", { name: /Personal/ })).toHaveClass("on");
    expect(isEditing()).toBe(true);
    expect(screen.getByLabelText(/First name/)).toBeInTheDocument();
  });

  it("opens the form again when the same section is asked for twice", async () => {
    const user = userEvent.setup();
    setup(blankProfile);
    const ask = () => screen.getByRole("button", { name: /Fill in missing details/ });

    await user.click(ask());
    await user.click(screen.getByRole("button", { name: /^Cancel$/ }));
    expect(isEditing()).toBe(false);

    // the nonce moved, so the very same request lands a second time
    await user.click(ask());
    expect(isEditing()).toBe(true);
  });

  it("leaves the next section you open in read mode", async () => {
    const user = userEvent.setup();
    setup(blankProfile);

    await user.click(screen.getByRole("button", { name: /Fill in missing details/ }));
    await user.click(screen.getByRole("tab", { name: /Emergency/ }));

    expect(isEditing()).toBe(false);
  });

  /* Summary is the one section the strip can name that has no form to open —
     the photo's control is the camera badge, already on screen. Asking for it
     must land you there WITHOUT trying to open an edit cycle that isn't there. */
  it("lands on Summary without an edit cycle when the photo is what's missing", async () => {
    const user = userEvent.setup();
    // everything but the photo
    setup({ ...jordan, work_rights_status: "Australian citizen" });

    await user.click(screen.getByRole("button", { name: /Fill in missing details/ }));

    expect(screen.getByRole("tab", { name: /Summary/ })).toHaveClass("on");
    expect(isEditing()).toBe(false);
    expect(screen.getByRole("button", { name: /Add a photo/ })).toBeInTheDocument();
  });
});

describe("a blank value", () => {
  it("is a button that opens the form inside a section, not a dash", async () => {
    const user = userEvent.setup();
    setup({ ...jordan, phone: null });

    await user.click(screen.getByRole("tab", { name: /Personal/ }));
    // the value's own slot offers the fix
    await user.click(screen.getByRole("button", { name: /Add Mobile/ }));

    expect(isEditing()).toBe(true);
    // one row, one name: the form said "Phone" while the row above it said
    // "Mobile" — now they are the same field and the same word
    expect(screen.getByLabelText(/Mobile/)).toHaveValue("");
  });

  /* Summary is read-only, so the same blank reads as a dash there. A button in
     a panel nobody can edit from would be an affordance that lies. */
  it("is a dash on Summary, where there is nothing to click", () => {
    setup({ ...jordan, phone: null });
    expect(screen.queryByRole("button", { name: /Add Mobile/ })).not.toBeInTheDocument();
    expect(screen.getAllByLabelText("not recorded").length).toBeGreaterThan(0);
  });

  it("does not offer to edit what this card cannot write", async () => {
    const user = userEvent.setup();
    setup(jordan);
    await user.click(screen.getByRole("tab", { name: /Personal/ }));
    // the sign-in address is the Auth0 identity, not a column on this card
    expect(screen.queryByRole("button", { name: /Add Email/ })).not.toBeInTheDocument();
    expect(screen.getByText(header.email)).toBeInTheDocument();
  });
});
