import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PersonalCard } from "../personal-card";
import { SummaryTab } from "../summary-tab";
import type { StaffProfile } from "@/lib/staff/profile";
import { TODAY, header, jordan, okActions } from "./fixtures/staff";

/* Uniform sizes, on the card and on Summary.

   The sizes are a PANEL on Personal, not a tab of their own: four optional
   fields do not earn a tenth tab, and they ride the personal save that is
   already there. What that buys is pinned here — one Edit, one Save, four
   more keys in the same submission — along with the two things that would
   otherwise drift: the boxes stay free text over a suggested ladder, and
   Summary answers with ONE labelled line rather than four rows of sizes. */

const sized: StaffProfile = {
  ...jordan,
  shirt_size: "L",
  jacket_size: "XL",
  trousers_size: "92",
  boot_size: "10.5",
};

const startEdit = (user: ReturnType<typeof userEvent.setup>) =>
  user.click(screen.getByRole("button", { name: /^Edit$/ }));

const save = (user: ReturnType<typeof userEvent.setup>) =>
  user.click(screen.getByRole("button", { name: /^Save changes$/ }));

function card(profile: StaffProfile = sized, mode: "self" | "admin" = "self") {
  const onSave = jest.fn().mockResolvedValue({ ok: true });
  const view = render(
    <PersonalCard
      profile={profile}
      mode={mode}
      email="jordan@heytiff.co"
      today={TODAY}
      onSave={onSave}
    />
  );
  return { ...view, onSave };
}

describe("the Uniform panel", () => {
  it("reads the four sizes back without opening the form", () => {
    const { container } = card();
    const panel = [...container.querySelectorAll(".pdlcard")].find((p) =>
      p.querySelector(".pdlh")?.textContent?.includes("Uniform")
    ) as HTMLElement;

    expect(panel).toBeTruthy();
    const values = [...panel.querySelectorAll(".pdrow")].map((r) => r.textContent);
    expect(values).toEqual([
      "ShirtL",
      "Jacket / jumperXL",
      "Trousers92",
      "Boots10.5",
    ]);
  });

  it("offers the AU ladders as suggestions, and still takes anything typed", async () => {
    const user = userEvent.setup();
    const { onSave } = card();
    await startEdit(user);

    const shirt = screen.getByLabelText("Shirt") as HTMLInputElement;
    // a datalist, not a <select> — the common answer is one keystroke and the
    // uncommon one is still possible
    expect(shirt.getAttribute("list")).toBe("shirt_size-suggestions");
    expect(
      [...document.querySelectorAll("#shirt_size-suggestions option")].map((o) =>
        o.getAttribute("value")
      )
    ).toContain("2XL");

    await user.clear(shirt);
    await user.type(shirt, "Ladies 14");
    await save(user);

    expect(onSave).toHaveBeenCalledWith(
      "personal",
      expect.objectContaining({ shirt_size: "Ladies 14" })
    );
  });

  /* One save, not a second one to remember: the sizes go up with the name and
     the phone number, through the section the person already had rights to. */
  it("saves with the rest of the personal card, in one submission", async () => {
    const user = userEvent.setup();
    const { onSave } = card();
    await startEdit(user);
    await save(user);

    expect(onSave).toHaveBeenCalledTimes(1);
    const [section, fields] = onSave.mock.calls[0];
    expect(section).toBe("personal");
    expect(fields).toMatchObject({
      first_name: "Jordan",
      shirt_size: "L",
      jacket_size: "XL",
      trousers_size: "92",
      boot_size: "10.5",
    });
  });

  it("is there on your own card, not just an admin's — you know your own size", async () => {
    const user = userEvent.setup();
    card(sized, "self");
    await startEdit(user);
    for (const label of ["Shirt", "Jacket / jumper", "Trousers", "Boots"]) {
      expect(screen.getByLabelText(label)).toBeInTheDocument();
    }
  });

  it("offers '+ Add' where a size is missing, like every other blank row", () => {
    const { container } = card({ ...jordan, shirt_size: null });
    const panel = [...container.querySelectorAll(".pdlcard")].find((p) =>
      p.querySelector(".pdlh")?.textContent?.includes("Uniform")
    ) as HTMLElement;
    expect(within(panel).getAllByRole("button", { name: /Add/ })).toHaveLength(4);
  });
});

describe("on Summary", () => {
  const summary = (profile: StaffProfile = sized) =>
    render(
      <SummaryTab
        header={header}
        profile={profile}
        licences={[]}
        vehicle={null}
        today={TODAY}
        orgState="NSW"
        mode="admin"
        actions={okActions()}
        onGo={jest.fn()}
      />
    );

  it("answers in one labelled line, under Personal", () => {
    summary();
    const row = screen.getByText("Uniform").closest(".pdrow") as HTMLElement;
    expect(row.textContent).toBe("UniformShirt L · Jacket XL · Trousers 92 · Boots 10.5");
  });

  it("shows the dash when we hold no sizes — nothing to order from", () => {
    summary(jordan);
    const row = screen.getByText("Uniform").closest(".pdrow") as HTMLElement;
    expect(within(row).getByLabelText("not recorded")).toBeInTheDocument();
  });
});
