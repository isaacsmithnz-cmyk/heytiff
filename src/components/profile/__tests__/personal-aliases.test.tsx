import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PersonalCard } from "../personal-card";
import { TODAY, jordan } from "./fixtures/staff";

/* "Also called" — the names a person goes by (Isaac, 2026-09-29). Tiff
   learns them when somebody tells her who a nickname is; the card lists
   them and takes them by hand. The row rides the card's own Edit and Save,
   but it is not a column: it goes to its own action, and never reaches the
   section save. */

function card(aliases: string[] = ["Bobo", "Leo"], withAction = true) {
  const onSave = jest.fn().mockResolvedValue({ ok: true });
  const onSaveAliases = jest.fn().mockResolvedValue({ ok: true });
  render(
    <PersonalCard
      profile={jordan}
      mode="admin"
      email="jordan@heytiff.co"
      today={TODAY}
      aliases={aliases}
      onSaveAliases={withAction ? onSaveAliases : undefined}
      onSave={onSave}
    />
  );
  return { onSave, onSaveAliases };
}

const row = () => screen.getByText("Also called").closest(".pdrow") as HTMLElement;

it("(F) lists the names the person goes by", () => {
  card();
  expect(row()).toHaveTextContent("Also calledBobo, Leo");
});

it("draws no row where the page wired no action", () => {
  card(["Bobo"], false);
  expect(screen.queryByText("Also called")).toBeNull();
});

it("(F) saves the list to its own action, and keeps it out of the section save", async () => {
  const user = userEvent.setup();
  const { onSave, onSaveAliases } = card();
  await user.click(screen.getByRole("button", { name: /^Edit$/ }));
  const box = screen.getByPlaceholderText("e.g. Bobo, Leo");
  await user.clear(box);
  await user.type(box, "Bobo, Big Leo");
  await user.click(screen.getByRole("button", { name: /^Save changes$/ }));
  expect(onSaveAliases).toHaveBeenCalledWith(["Bobo", "Big Leo"]);
  expect(onSave).toHaveBeenCalledTimes(1);
  expect(onSave.mock.calls[0][1]).not.toHaveProperty("aliases");
});

it("(F) leaves the names alone when they weren't touched", async () => {
  const user = userEvent.setup();
  const { onSave, onSaveAliases } = card();
  await user.click(screen.getByRole("button", { name: /^Edit$/ }));
  await user.click(screen.getByRole("button", { name: /^Save changes$/ }));
  expect(onSaveAliases).not.toHaveBeenCalled();
  expect(onSave).toHaveBeenCalledTimes(1);
});

it("(F) refuses what isn't a name before saving anything, and says which", async () => {
  const user = userEvent.setup();
  const { onSave, onSaveAliases } = card();
  await user.click(screen.getByRole("button", { name: /^Edit$/ }));
  const box = screen.getByPlaceholderText("e.g. Bobo, Leo");
  await user.type(box, ", R2D2");
  await user.click(screen.getByRole("button", { name: /^Save changes$/ }));
  expect(await screen.findByText("“R2D2” isn't a name. Use letters, and commas between names.")).toBeInTheDocument();
  expect(onSaveAliases).not.toHaveBeenCalled();
  expect(onSave).not.toHaveBeenCalled();
});

it("stops on the action's refusal, and says it", async () => {
  const user = userEvent.setup();
  const { onSave, onSaveAliases } = card([]);
  onSaveAliases.mockResolvedValue({ ok: false, error: "Bobo is already what Leonardo Martins is called.", fields: ["aliases"] });
  await user.click(screen.getByRole("button", { name: /^Edit$/ }));
  await user.type(screen.getByPlaceholderText("e.g. Bobo, Leo"), "Bobo");
  await user.click(screen.getByRole("button", { name: /^Save changes$/ }));
  expect(await screen.findByText("Bobo is already what Leonardo Martins is called.")).toBeInTheDocument();
  expect(onSave).not.toHaveBeenCalled();
});
