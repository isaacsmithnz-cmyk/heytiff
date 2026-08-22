import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MyNotesBoard } from "../my-notes-board";
import type { MyNote } from "@/lib/notes/my-notes-query";

/* THE BOARD'S TWO FACES. Archived used to be a second card behind a
   disclosure chevron — the only fold of its kind in the app — so nothing ever
   proved the put-away pile was reachable. It is a tab on the card now, and
   these pin the split: what's on each face, and that the count rides the tab. */

jest.mock("@/app/actions/my-notes", () => ({
  addMyNote: jest.fn(async () => ({ ok: true })),
  archiveMyNote: jest.fn(async () => ({ ok: true })),
  deleteMyNote: jest.fn(async () => ({ ok: true })),
  editMyNote: jest.fn(async () => ({ ok: true })),
}));

/* The token drags the whole dictation stack into jsdom for a test about
   tabs; a labelled input carries the two props the board actually wires. */
jest.mock("../note-token", () => ({
  NoteToken: ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
    <input aria-label="a note" value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}));

const note = (over: Partial<MyNote> = {}): MyNote => ({
  id: "n1",
  body: "Ring the wholesaler back",
  source: "text",
  sourceNoteId: null,
  createdAt: "2026-08-20T01:00:00.000Z",
  updatedAt: "2026-08-20T01:00:00.000Z",
  archivedAt: null,
  ...over,
});

it("keeps live notes on the Notes face and the put-away pile behind the Archived tab", async () => {
  const user = userEvent.setup();
  render(
    <MyNotesBoard
      notes={[note()]}
      archived={[note({ id: "n2", body: "Old coil pricing", archivedAt: "2026-08-21T01:00:00.000Z" })]}
    />,
  );

  expect(screen.getByText("Ring the wholesaler back")).toBeInTheDocument();
  expect(screen.queryByText("Old coil pricing")).not.toBeInTheDocument();

  // the count rides the tab — "1 put away" is its accessible suffix
  await user.click(screen.getByRole("tab", { name: /Archived — 1 put away/ }));
  expect(screen.getByText("Old coil pricing")).toBeInTheDocument();
  expect(screen.queryByText("Ring the wholesaler back")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: /Put back note: Old coil pricing/ })).toBeInTheDocument();
});

it("says so plainly when nothing has been archived", async () => {
  const user = userEvent.setup();
  render(<MyNotesBoard notes={[note()]} archived={[]} />);
  await user.click(screen.getByRole("tab", { name: "Archived" }));
  expect(screen.getByText("Nothing archived")).toBeInTheDocument();
});

/* THE PANEL SWAPS IN PLACE — no remount, no fade.

   This wore `key={tab}` + `.psec2` (`animation:fgUp .4s`) from the
   Organisation card's recipe: the key rebuilt the face on every click and
   fgUp faded it back in, so the list visibly flashed. Team's directory just
   changes its children, and that is the reference (Isaac, 2026-08-22). A
   stable node is the proof — with a key, React hands back a different one. */
it("swaps the face in place — same panel node, no fade class", async () => {
  const user = userEvent.setup();
  const { container } = render(<MyNotesBoard notes={[note()]} archived={[note({ id: "n2" })]} />);
  const panel = () => container.querySelector('[role="tabpanel"]');

  const before = panel();
  expect(before).not.toHaveClass("psec2");

  await user.click(screen.getByRole("tab", { name: /Archived/ }));
  expect(panel()).toBe(before);
  expect(panel()).not.toHaveClass("psec2");
});
