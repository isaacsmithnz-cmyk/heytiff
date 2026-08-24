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
  boot_scale: "AU/UK",
};

const startEdit = (user: ReturnType<typeof userEvent.setup>) =>
  user.click(screen.getByRole("button", { name: /^Edit$/ }));

const save = (user: ReturnType<typeof userEvent.setup>) =>
  user.click(screen.getByRole("button", { name: /^Save changes$/ }));

/** what a field's datalist is offering right now */
const options = (name: string) =>
  [...document.querySelectorAll(`#${name}-suggestions option`)].map((o) => o.getAttribute("value"));

const scalePicker = () => screen.getByLabelText("Boots — size scale") as HTMLSelectElement;

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
    // boots read with their scale attached — "10.5" alone is a different boot
    // in EU and in US
    expect(values).toEqual([
      "ShirtL",
      "Jacket / jumperXL",
      "Trousers92",
      "Boots10.5 AU/UK",
    ]);
  });

  it("offers the ladders as suggestions, and still takes anything typed", async () => {
    const user = userEvent.setup();
    const { onSave } = card();
    await startEdit(user);

    const shirt = screen.getByLabelText("Shirt") as HTMLInputElement;
    // a datalist, not a <select> — the common answer is one keystroke and the
    // uncommon one is still possible
    expect(shirt.getAttribute("list")).toBe("shirt_size-suggestions");
    expect(options("shirt_size")).toEqual(expect.arrayContaining(["2XL", "102"]));

    await user.clear(shirt);
    await user.type(shirt, "Ladies 14");
    await save(user);

    expect(onSave).toHaveBeenCalledWith(
      "personal",
      expect.objectContaining({ shirt_size: "Ladies 14" })
    );
  });

  /* Both racks. The bloke who says "large" and the one who reads 102 off the
     tag are describing the same shirt, and a field that suggests only one of
     them makes half the crew type around it. */
  it("suggests chest measurements beside the alpha sizes, on both top-half rows", async () => {
    const user = userEvent.setup();
    card();
    await startEdit(user);

    for (const key of ["shirt_size", "jacket_size"]) {
      expect(options(key)).toEqual(expect.arrayContaining(["S", "L", "5XL", "87", "102", "132"]));
    }
    // trousers stay the waist ladder — a different measurement, not this one
    expect(options("trousers_size")).not.toContain("L");
    expect(options("trousers_size")).toContain("92");
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
      boot_scale: "AU/UK",
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

/* A boot size is a number in a SYSTEM. "10" is a different boot in AU/UK, EU
   and US, so the scale is picked beside the number, saved with it, and shown
   wherever it is shown. */
describe("the boot scale", () => {
  it("starts on AU/UK — what is printed inside a boot bought here", async () => {
    const user = userEvent.setup();
    card({ ...jordan, boot_size: null, boot_scale: null });
    await startEdit(user);
    expect(scalePicker().value).toBe("AU/UK");
    expect([...scalePicker().options].map((o) => o.value)).toEqual(["AU/UK", "EU", "US"]);
  });

  it("swaps the ladder with the scale, rather than offering AU rungs in EU", async () => {
    const user = userEvent.setup();
    card();
    await startEdit(user);
    expect(options("boot_size")).toEqual(expect.arrayContaining(["10.5", "14"]));

    await user.selectOptions(scalePicker(), "EU");

    expect(options("boot_size")).toEqual(expect.arrayContaining(["44", "49"]));
    expect(options("boot_size")).not.toContain("10.5");
  });

  it("saves the scale beside the size", async () => {
    const user = userEvent.setup();
    const { onSave } = card();
    await startEdit(user);

    const boots = screen.getByLabelText("Boots") as HTMLInputElement;
    await user.clear(boots);
    await user.type(boots, "44");
    await user.selectOptions(scalePicker(), "EU");
    await save(user);

    expect(onSave).toHaveBeenCalledWith(
      "personal",
      expect.objectContaining({ boot_size: "44", boot_scale: "EU" })
    );
  });

  it("reads the number and its scale as one value", () => {
    card({ ...sized, boot_size: "11", boot_scale: "US" });
    expect(screen.getByText("11 US")).toBeInTheDocument();
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
    expect(row.textContent).toBe("UniformShirt L · Jacket XL · Trousers 92 · Boots 10.5 AU/UK");
  });

  it("shows the dash when we hold no sizes — nothing to order from", () => {
    summary(jordan);
    const row = screen.getByText("Uniform").closest(".pdrow") as HTMLElement;
    expect(within(row).getByLabelText("not recorded")).toBeInTheDocument();
  });
});
