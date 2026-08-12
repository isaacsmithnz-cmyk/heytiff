import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

/* Driving a DateField from a test.

   Every date in the app is PICKED, never typed — see date-field.tsx — so a
   test can't `type()` into one. It has to do what a person does: open the
   field, page to the month, press the day.

   This lives in `fixtures/` (jest ignores that folder as a suite) because
   eleven call sites moved onto the picker at once and every one of their tests
   needed the same steps. A shared helper is also what stops the next screen's
   test reaching for `fireEvent.change` on a button and concluding the field is
   broken.

   IT PAGES TO THE MONTH, and that is not optional. The picker opens on the
   field's value, else its `today` — which on a board sheet is a fixture date
   that may be months from the one under test. Clicking "5" in whatever grid
   happens to be showing silently books the fifth of the WRONG month, and the
   assertion that follows fails somewhere unrelated. */

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export async function pickDate(
  label: string | RegExp,
  iso: string,
  scope: { getByLabelText: typeof screen.getByLabelText } = screen,
): Promise<void> {
  const user = userEvent.setup();
  await user.click(scope.getByLabelText(label));

  /* By its own name, not just role=dialog: the sheets these fields live in ARE
     dialogs, so a bare role lookup finds two. */
  const dialog = await screen.findByRole("dialog", { name: "Choose a date" });
  /* Months as one comparable number, so "December 2026 → January 2027" steps
     the right way. Comparing years alone sent it backwards inside a year. */
  const ordinal = (label: string): number => {
    const [name, year] = label.split(" ");
    return Number(year) * 12 + MONTHS.indexOf(name);
  };
  const want = `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;
  const target = ordinal(want);
  const shown = () => dialog.querySelector(".cal-mo")?.textContent?.trim() ?? "";

  for (let i = 0; shown() !== want; i++) {
    if (i > 36) throw new Error(`pickDate: could not reach ${want} — stuck on ${shown()}`);
    const back = ordinal(shown()) > target;
    await user.click(
      within(dialog).getByRole("button", { name: back ? "Previous month" : "Next month" }),
    );
  }

  /* The grid pads with the neighbouring months' days and marks them `.out` —
     and the pad comes FIRST, so a 30th in July's leading pad is the 30th of
     JUNE. Skipping `.out` is what stops this booking the right number in the
     wrong month, which is a failure that surfaces three assertions later. */
  const day = String(Number(iso.slice(8, 10)));
  const cell = within(dialog)
    .getAllByRole("button")
    .find(
      (b) =>
        b.className.includes("cal-d") && !b.className.includes("out") && b.textContent === day,
    );
  if (!cell) throw new Error(`pickDate: no ${day} in ${want}`);
  await user.click(cell);
}

/** What a DateField is currently showing, as the dd/mm/yyyy a person reads. */
export function shownDate(label: string | RegExp): string {
  return screen.getByLabelText(label).textContent ?? "";
}
