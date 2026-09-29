import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { StaffProfile } from "@/lib/staff/profile";
import { ProfileScreen } from "../profile-screen";
import { TODAY, blankProfile, header, jordan, okActions } from "./fixtures/staff";

/* "What's still missing" — the record line in the Overview's head, and Still
   to add below it.

   Both read lib/staff/completeness, so the point of these is the WIRING: that
   the count on screen matches the list beside it, and that an Add lands you
   in the right form, on the right field.

   WHAT WENT (2026-09-29). The Adds beside each blank on Summary and the count
   badges on the tabs: there are no tabs, and a blank is said once, on the
   list, not in a cell as well. */

function setup(profile: StaffProfile | null = jordan, photoUrl?: string, sec?: string) {
  const actions = okActions();
  const view = render(
    <ProfileScreen
      mode="self"
      header={photoUrl ? { ...header, photoUrl } : header}
      profile={profile}
      licences={[]}
      vehicle={null}
      today={TODAY}
      warnDays={30}
      org="Smith Air"
      initialSec={sec}
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

/* A section is in edit mode when its Save is on screen. */
const isEditing = () => screen.queryByRole("button", { name: /^Save\b/ }) !== null;
const openSection = () => document.querySelector(".psec2")?.getAttribute("data-sec");

const line = () => document.querySelector(".pov-rec") as HTMLElement | null;
const action = () => line()?.querySelector("button") ?? null;
const listed = (group: "Required" | "Optional") =>
  [...(screen.queryByRole("group", { name: group })?.querySelectorAll(".pov-ti b") ?? [])].map(
    (b) => b.textContent,
  );

/* THE RECORD LINE — how much of the card is on file, and the one action onto
   the first required gap, in its own form, with the cursor in the field. */
describe("the record line", () => {
  it("counts what is on file, and offers the required gaps as one action", () => {
    setup(blankProfile);
    expect(line()).toHaveTextContent("0 of 11 on file");
    expect(action()).toHaveTextContent("Add the 7 required details");
    expect(line()!.querySelector(".pprog i")).toHaveClass("warn");
  });

  it("draws the bar to the same proportion it counts", () => {
    setup(jordan);
    // nine of the eleven — work rights and the photo are the two short
    expect(line()).toHaveTextContent("9 of 11 on file");
    expect(line()!.querySelector(".pprog i")).toHaveStyle({ width: "82%" });
  });

  /* One required gap names itself rather than counting to one. */
  it("names the gap when there is only one", () => {
    setup(jordan);
    expect(action()).toHaveTextContent("Add work rights");
  });

  /* Short of only WANTED details the card is cleared: the bar goes OK and the
     action goes, because nothing the business must hold is missing. The gap
     that is left is named on Still to add. */
  it("clears — the OK bar, no action — and leaves the gap to the list", () => {
    setup({ ...jordan, work_rights_status: "Australian citizen" });
    expect(line()).toHaveTextContent("10 of 11 on file");
    expect(action()).toBeNull();
    expect(line()!.querySelector(".pprog i")).toHaveClass("ok");
    expect(listed("Optional")).toContain("Photo");
  });

  /* Isaac: "if 11 out of 11 is on file then that can disappear". */
  it("goes when the card is finished", () => {
    setup(done, "https://storage.example/signed/doc-1.jpg");
    expect(line()).toBeNull();
  });

  /* The line belongs to the Overview; a section is a form, and says only
     what it holds. */
  it("lives on the Overview, not in a section", () => {
    setup(jordan, undefined, "emergency");
    expect(line()).toBeNull();
  });
});

describe("Still to add agrees with the count", () => {
  /* The list names every gap the count counts: the seven required details
     fold into two rows (Personal's six and Work rights), and the wanted four
     into their own. */
  it("lists what a blank card is short of, in the model's groups", () => {
    setup(blankProfile);
    expect(listed("Required")).toEqual(["Personal details", "Work rights"]);
    expect(listed("Optional")).toEqual([
      "Mobile number",
      "Emergency contact",
      "Licences and tickets",
      "Uniform sizes",
      "Photo",
    ]);
  });

  it("lists nothing required once the record line has cleared", () => {
    setup({ ...jordan, work_rights_status: "Australian citizen" });
    expect(screen.queryByRole("group", { name: "Required" })).toBeNull();
  });

  it("names a missing photo and opens the photo picker", () => {
    setup({ ...done, photo_url: null });
    const input = document.getElementById("pphoto-file") as HTMLInputElement;
    const picked = jest.spyOn(input, "click").mockImplementation(() => {});
    fireEvent.click(screen.getByRole("button", { name: "Add photo" }));
    expect(picked).toHaveBeenCalled();
  });
});

describe("answering a blank", () => {
  it("goes to the field's section and opens its form, on the field", async () => {
    const user = userEvent.setup();
    setup(blankProfile);

    await user.click(screen.getByRole("button", { name: "Add personal details" }));
    expect(openSection()).toBe("personal");
    expect(isEditing()).toBe(true);
    // the first of the gaps it named — the model's order
    expect(document.getElementById("first_name")).toHaveFocus();
  });

  it("opens the emergency form on the field that is missing", async () => {
    const user = userEvent.setup();
    setup({ ...jordan, emergency_phone: null });
    await user.click(screen.getByRole("button", { name: "Add emergency contact" }));
    expect(document.getElementById("emergency_phone")).toHaveFocus();
  });

  /* The record line's action opens the FIRST required gap in the model's
     order — on a card short of only the right to work it lands in the
     work-rights form, on the status. */
  it("opens the work-rights form on the status, from the record line", async () => {
    const user = userEvent.setup();
    setup(jordan);
    await user.click(action()!);
    expect(openSection()).toBe("workrights");
    expect(document.getElementById("work_rights_status")).toHaveFocus();
  });

  /* A card's Edit is the way in with nothing pointed at: the form opens and
     the cursor stays where the reader is. */
  it("leaves the cursor alone when the whole section was asked for", async () => {
    const user = userEvent.setup();
    setup(jordan);
    await user.click(screen.getByRole("button", { name: "Edit Personal" }));
    expect(isEditing()).toBe(true);
    expect(document.activeElement).toBe(document.body);
  });

  it("opens the form again when the same blank is asked for twice", async () => {
    const user = userEvent.setup();
    setup(blankProfile);
    const ask = () => screen.getByRole("button", { name: "Add personal details" });

    await user.click(ask());
    await user.click(screen.getByRole("button", { name: /^Cancel$/ }));
    // Cancel comes back to the Overview, and the very same request lands again
    expect(openSection()).toBe("summary");
    await user.click(ask());
    expect(isEditing()).toBe(true);
  });

  /* The photo's Add is the camera badge too, on screen — not waiting for a
     hover — while there is no photo. */
  it("keeps the camera badge up while the photo is the blank", () => {
    const { container } = setup({ ...jordan, work_rights_status: "Australian citizen" });
    expect(container.querySelector(".pphoto")).toHaveClass("nophoto");
    expect(screen.getByRole("button", { name: /Add a photo/ })).toBeInTheDocument();
  });

  it("lets the badge go back behind the hover once there is a photo", () => {
    // the badge reads the header's signed URL, not the profile's storage ref
    const { container } = setup(done, "https://storage.example/signed/doc-1.jpg");
    expect(container.querySelector(".pphoto")).not.toHaveClass("nophoto");
  });
});

/* ONE VERB FOR A BLANK, inside the sections.

   The overrides were "Set" on a date or a figure and "Select" on a dropdown —
   the verb naming the CONTROL rather than the act. A section opened by link
   still reads, and its blanks still offer the same word. */
describe("a blank's verb", () => {
  const verbs = () =>
    [...document.querySelectorAll(".pdrow .padd")].map((b) =>
      (b.textContent ?? "").replace(/\s+/g, " ").trim().split(" ")[0],
    );

  it("is Add, in every section and in every row", () => {
    const seen: string[] = [];
    for (const sec of ["personal", "emergency", "workrights"]) {
      const { unmount } = setup(blankProfile, undefined, sec);
      const here = verbs();
      // each of those sections has blanks to offer, or this guard proves nothing
      expect(here.length).toBeGreaterThan(0);
      seen.push(...here);
      unmount();
    }
    expect([...new Set(seen)]).toEqual(["Add"]);
  });

  /* A button with no label column beside it has to carry its own noun. */
  it("carries its own noun where no label sits beside it", () => {
    setup(blankProfile, undefined, "licences");
    expect(screen.getByRole("button", { name: "List qualifications" })).toBeInTheDocument();
  });
});

/* ONE LIST. The star on a form's label and the record line's count say the
   same thing — the business is obliged to hold this — and both read
   lib/staff/completeness. */
describe("the forms' stars", () => {
  const starred = () =>
    [...document.querySelectorAll(".psec2 .pdrow dt")]
      .filter((dt) => dt.querySelector(".req"))
      .map((dt) => (dt.textContent ?? "").replace("*", "").trim());

  it("agree with the model", async () => {
    const user = userEvent.setup();
    setup(jordan);
    await user.click(screen.getByRole("button", { name: "Edit Personal" }));
    expect(starred()).toEqual(["First name", "Last name", "Date of birth", "Address", "Start date", "Type"]);

    await user.click(screen.getByRole("button", { name: /^Cancel$/ }));
    await user.click(screen.getByRole("button", { name: "Edit emergency contact" }));
    // wanted, not required — nothing stops payroll running without them
    expect(starred()).toEqual([]);
  });
});

describe("a blank value inside a section", () => {
  it("is a button that opens the form, not a dash", async () => {
    const user = userEvent.setup();
    setup({ ...jordan, phone: null }, undefined, "personal");
    await user.click(screen.getByRole("button", { name: /Add Mobile/ }));

    expect(isEditing()).toBe(true);
    // one row, one name: the form and the row say the same word
    expect(screen.getByLabelText(/Mobile/)).toHaveValue("");
  });

  it("is the same form the Overview's Add opens", async () => {
    const user = userEvent.setup();
    setup({ ...jordan, phone: null });
    await user.click(screen.getByRole("button", { name: "Add mobile number" }));
    expect(openSection()).toBe("personal");
    expect(screen.getByLabelText(/Mobile/)).toHaveValue("");
    expect(document.getElementById("phone")).toHaveFocus();
  });

  it("does not offer to edit what this card cannot write", () => {
    setup(jordan, undefined, "personal");
    // the sign-in address is the Auth0 identity, not a column on this card
    expect(screen.queryByRole("button", { name: /Add Email/ })).not.toBeInTheDocument();
    expect(screen.getByText(header.email)).toBeInTheDocument();
  });
});
