/* A GROUPED NOTE STAYS GROUPED, in the list and in the drawer.

   `keepNoteForMe` writes the kept rows as one body, one line each — that is
   what makes the cascade's floor a note rather than a paragraph. Rendering it
   with the CSS default collapses every newline into a space and un-groups
   exactly what was grouped, and putting a note away must not do that to it:
   the archive is a quieter view of the same note, not a lossier one. */

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MyNotesBoard } from "../my-notes-board";
import type { MyNote } from "@/lib/notes/my-notes-query";

/* Server functions: importing the real module drags "use server" into jsdom,
   and nothing here presses a button that writes. */
jest.mock("@/app/actions/my-notes", () => ({
  addMyNote: jest.fn(),
  archiveMyNote: jest.fn(),
  deleteMyNote: jest.fn(),
  editMyNote: jest.fn(),
}));
/* The token has its own suite; here it is furniture at the top of the page. */
jest.mock("../note-token", () => ({ NoteToken: () => null }));

const BODY = "• Unit still will not regulate.\n• Fuel regulation fault\n• Checked the regulator";

const note = (id: string, archivedAt: string | null = null): MyNote => ({
  id,
  body: BODY,
  source: "routed",
  sourceNoteId: "n-1",
  createdAt: "2026-08-29T04:00:00.000Z",
  updatedAt: "2026-08-29T04:00:00.000Z",
  archivedAt,
});

it("keeps the lines of a grouped note wherever it is shown", async () => {
  const { container } = render(
    <MyNotesBoard notes={[note("active")]} archived={[note("archived", "2026-08-30T04:00:00.000Z")]} />
  );

  await userEvent.click(screen.getByRole("button", { name: /Put away \(1\)/ }));

  const shown = Array.from(container.querySelectorAll("span")).filter(
    (el) => el.children.length === 0 && el.textContent === BODY
  );

  /* Both branches, or the assertion proves nothing about the one that regressed. */
  expect(shown).toHaveLength(2);
  for (const el of shown) {
    expect(getComputedStyle(el).whiteSpace).toBe("pre-line");
  }
});
