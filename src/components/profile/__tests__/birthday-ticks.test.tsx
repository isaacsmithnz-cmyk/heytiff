import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { PersonalCard } from "../personal-card";
import { BirthdayTicks } from "../birthday-ticks";
import { TODAY, jordan } from "./fixtures/staff";

/* YOUR BIRTHDAY TICKS on the web card (Isaac, 6 November 2026: "Staff have to
   opt in, tick to share bday, tick to share age"), as the phone's card has
   them: Share my birthday and Share my age, both off until ticked, each
   saving itself; the age only while the birthday is shared. */

const OFF = { shareBirthday: false, shareAge: false };

function card({ withAction = true, birthday = jordan.birthday }: { withAction?: boolean; birthday?: string | null } = {}) {
  const onShareBirthday = jest.fn(async (change: { shareBirthday?: boolean; shareAge?: boolean }) => ({
    ok: true as const,
    sharing: { shareBirthday: change.shareBirthday ?? false, shareAge: false },
  }));
  render(
    <PersonalCard
      profile={{ ...jordan, birthday }}
      mode="self"
      email="jordan@heytiff.co"
      today={TODAY}
      birthdaySharing={withAction ? OFF : null}
      onShareBirthday={withAction ? onShareBirthday : undefined}
      onSave={jest.fn().mockResolvedValue({ ok: true })}
    />,
  );
  return { onShareBirthday };
}

const tick = (name: string) => screen.getByRole("checkbox", { name });

it("(F) sits under the date of birth on your own card, both ticks off", () => {
  card();
  const row = screen.getByText("Your birthday").closest(".pdrow") as HTMLElement;
  expect(row.previousElementSibling).toHaveTextContent("Date of birth");
  expect(tick("Share my birthday")).not.toBeChecked();
  expect(tick("Share my age")).not.toBeChecked();
  expect(tick("Share my age")).toBeDisabled();
});

it("draws no ticks where the page wired no action, as on a colleague's card", () => {
  card({ withAction: false });
  expect(screen.queryByText("Your birthday")).toBeNull();
  expect(screen.queryByRole("checkbox", { name: "Share my birthday" })).toBeNull();
});

it("draws no ticks with no birthday on the card, as the phone has it", () => {
  card({ birthday: null });
  expect(screen.queryByText("Your birthday")).toBeNull();
});

it("(F) saves each tick the moment it is pressed, with no Edit", async () => {
  const user = userEvent.setup();
  const { onShareBirthday } = card();
  await user.click(tick("Share my birthday"));
  expect(onShareBirthday).toHaveBeenCalledWith({ shareBirthday: true });
  expect(tick("Share my birthday")).toBeChecked();
  expect(tick("Share my age")).toBeEnabled();
});

it("(F) unticking the birthday unticks the age with it", async () => {
  const user = userEvent.setup();
  const onShare = jest.fn(async (change: { shareBirthday?: boolean; shareAge?: boolean }) => ({
    ok: true as const,
    sharing: change.shareBirthday === false ? OFF : { shareBirthday: true, shareAge: true },
  }));
  render(<BirthdayTicks initial={{ shareBirthday: true, shareAge: true }} onShare={onShare} />);
  expect(tick("Share my age")).toBeChecked();
  await user.click(tick("Share my birthday"));
  expect(onShare).toHaveBeenCalledWith({ shareBirthday: false });
  expect(tick("Share my birthday")).not.toBeChecked();
  expect(tick("Share my age")).not.toBeChecked();
  expect(tick("Share my age")).toBeDisabled();
});

it("(F) puts the tick back and says why when the save fails", async () => {
  const user = userEvent.setup();
  const onShare = jest.fn(async () => ({ ok: false as const, error: "Couldn't save that." }));
  render(<BirthdayTicks initial={OFF} onShare={onShare} />);
  await user.click(tick("Share my birthday"));
  expect(tick("Share my birthday")).not.toBeChecked();
  expect(screen.getByText("Couldn't save that.").closest(".pt-state")).toHaveClass("pt-state--wrong");
});
