import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { StaffProfile } from "@/lib/staff/profile";
import { ProfileScreen } from "../profile-screen";
import { TODAY, blankProfile, header, jordan, okActions } from "./fixtures/staff";

/* "What's still missing" — the completion line in Summary's identity row, the
   Adds beside its blanks, and the tabs' count badges.

   All three read lib/staff/completeness, so the point of these is the WIRING:
   that the count on screen matches the badges beside it, and that an Add lands
   you in the right form.

   WHAT WENT. The strip in the breadcrumb row — a ring, "82% complete", a line
   and one button that opened the first missing field's form. Each blank on
   Summary is that button now, for its own field, and the line moved into the
   identity row where the person is. It renders on Summary only: the tabs'
   counts carry the gaps to the other tabs. */

function setup(profile: StaffProfile | null = jordan, photoUrl?: string) {
  const actions = okActions();
  const view = render(
    <ProfileScreen
      mode="self"
      header={photoUrl ? { ...header, photoUrl } : header}
      profile={profile}
      licences={[]}
      vehicle={null}
      today={TODAY} warnDays={30}
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
   mode. */
const isEditing = () => screen.queryByRole("button", { name: /^Save\b/ }) !== null;

const countOn = (name: RegExp) =>
  screen.getByRole("tab", { name }).querySelector(".wb2-vtn")?.textContent ?? null;

const line = () => document.querySelector(".pcompl") as HTMLElement;

describe("the completion line", () => {
  it("counts what is on file and names the required gaps, in the warn colour", () => {
    setup(blankProfile);
    expect(line()).toHaveTextContent("7 required details missing");
    expect(line()).toHaveTextContent("0 of 11 on file");
    expect(line().querySelector("b")).toHaveClass("warn");
    expect(line().querySelector(".pprog i")).toHaveClass("warn");
  });

  it("draws the bar to the same proportion it counts", () => {
    setup(jordan);
    // nine of the eleven — work rights and the photo are the two short
    expect(line()).toHaveTextContent("9 of 11 on file");
    expect(line().querySelector(".pprog i")).toHaveStyle({ width: "82%" });
  });

  /* Work rights is the one required detail jordan lacks; the photo is wanted.
     One required gap is a warn state; a card short of only wanted details is
     cleared, and the bar goes to the OK colour with no word beside it. */
  it("clears — the OK bar, no word — once every required detail is in", () => {
    setup({ ...jordan, work_rights_status: "Australian citizen" });
    expect(line()).toHaveTextContent("10 of 11 on file");
    expect(line().querySelector("b")).toBeNull();
    expect(line().querySelector(".pprog i")).toHaveClass("ok");
  });

  it("says the card is complete, in the OK colour, when nothing is left to ask for", () => {
    setup(done);
    expect(line()).toHaveTextContent("Profile complete");
    expect(line().querySelector("b")).toHaveClass("ok");
    expect(line()).toHaveTextContent("11 of 11 on file");
  });

  it("singular when one is missing", () => {
    setup(jordan);
    expect(line()).toHaveTextContent("1 required detail missing");
  });

  /* Summary's row, not the breadcrumb's: on the other tabs the count badge is
     what says the card is short. */
  it("lives on Summary, and the tabs' counts carry the gaps elsewhere", async () => {
    const user = userEvent.setup();
    setup(jordan);
    await user.click(screen.getByRole("tab", { name: /Emergency/ }));
    expect(document.querySelector(".pcompl")).toBeNull();
    expect(countOn(/Work rights/)).toBe("1");
  });
});

describe("the tabs' counts", () => {
  it("marks only the sections actually holding a missing field", () => {
    setup(jordan); // work rights is the only gap with a form behind it
    expect(countOn(/Work rights/)).toBe("1");
    expect(countOn(/Personal/)).toBeNull();
  });

  /* The badge is a COUNT, and it is what says which section is short from any
     tab — a flag would under-report a blank Personal by six. */
  it("says how many, not just that some are missing", () => {
    setup(blankProfile);
    expect(countOn(/Personal/)).toBe("7");
    expect(countOn(/Emergency/)).toBe("2");
    expect(countOn(/Work rights/)).toBe("1");
    // Summary counts too: the photo is a field, and the camera badge on the
    // identity row is where you answer it
    expect(countOn(/Summary/)).toBe("1");
  });

  it("agrees with the line — the badges sum to what the line counts", () => {
    const { container } = setup(blankProfile);
    const badges = [...container.querySelectorAll(".wb2-vtn")].map((b) => Number(b.textContent));
    expect(badges.reduce((a, b) => a + b, 0)).toBe(11);
    expect(line()).toHaveTextContent("0 of 11 on file");
  });

  it("drops every badge when the card is finished", () => {
    const { container } = setup(done);
    expect(container.querySelector(".wb2-vtn")).toBeNull();
  });
});

describe("answering a blank", () => {
  it("goes to the field's section and opens its form", async () => {
    const user = userEvent.setup();
    setup(blankProfile);

    await user.click(screen.getByRole("button", { name: "Add Date of birth" }));

    expect(screen.getByRole("tab", { name: /Personal/ })).toHaveClass("on");
    expect(isEditing()).toBe(true);
    expect(screen.getByLabelText(/Date of birth/)).toBeInTheDocument();
  });

  it("opens the form again when the same section is asked for twice", async () => {
    const user = userEvent.setup();
    setup(blankProfile);
    const ask = () => screen.getByRole("button", { name: "Add Date of birth" });

    await user.click(ask());
    await user.click(screen.getByRole("button", { name: /^Cancel$/ }));
    expect(isEditing()).toBe(false);

    // back to Summary, and the very same request lands a second time
    await user.click(screen.getByRole("tab", { name: /Summary/ }));
    await user.click(ask());
    expect(isEditing()).toBe(true);
  });

  it("leaves the next section you open in read mode", async () => {
    const user = userEvent.setup();
    setup(blankProfile);

    await user.click(screen.getByRole("button", { name: "Add Date of birth" }));
    await user.click(screen.getByRole("tab", { name: /Emergency/ }));

    expect(isEditing()).toBe(false);
  });

  /* The photo is the one blank on Summary with no Add beside it: the camera
     badge is its Add, and it is on screen — not waiting for a hover — while
     there is no photo. */
  it("keeps the camera badge up while the photo is the blank", () => {
    const { container } = setup({ ...jordan, work_rights_status: "Australian citizen" });
    expect(container.querySelector(".pphoto")).toHaveClass("nophoto");
    expect(screen.getByRole("button", { name: /Add a photo/ })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Summary/ }).querySelector(".wb2-vtn")).toHaveTextContent("1");
  });

  it("lets the badge go back behind the hover once there is a photo", () => {
    // the badge reads the header's signed URL, not the profile's storage ref
    const { container } = setup(done, "https://storage.example/signed/doc-1.jpg");
    expect(container.querySelector(".pphoto")).not.toHaveClass("nophoto");
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

  /* And on Summary the same blank is the same Add — into the same form. */
  it("is the same Add on Summary, landing in the same form", async () => {
    const user = userEvent.setup();
    setup({ ...jordan, phone: null });
    await user.click(screen.getByRole("button", { name: /Add Mobile/ }));
    expect(screen.getByRole("tab", { name: /Personal/ })).toHaveClass("on");
    expect(screen.getByLabelText(/Mobile/)).toHaveValue("");
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
