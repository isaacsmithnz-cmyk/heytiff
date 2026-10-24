import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NotesPage } from "../notes-page";
import type { MyNote } from "@/lib/notes/my-notes-query";

/* NOTES (v2): Your name › Notes. What these pin: the title and its one
   button; Notes and Archived as soft tabs, no number on either; a note as a
   row of its first line over the rest; Edit opening the note's own form;
   Archive with Undo; and Delete for good only from Archived, after asking.
   They were Conversations › Only me's, which went (Isaac, 24 October 2026). */

const api = {
  addMyNote: jest.fn(async (_input: { body: string; source?: string }) => ({ ok: true as const, id: "n-new" })),
  archiveMyNote: jest.fn(async (_id: string, _archived?: boolean) => ({ ok: true as const })),
  deleteMyNote: jest.fn(async (_id: string) => ({ ok: true as const })),
  editMyNote: jest.fn(async (_id: string, _body: string) => ({ ok: true as const })),
};
jest.mock("@/app/actions/my-notes", () => ({
  addMyNote: (input: { body: string; source?: string }) => api.addMyNote(input),
  archiveMyNote: (id: string, archived?: boolean) => api.archiveMyNote(id, archived),
  deleteMyNote: (id: string) => api.deleteMyNote(id),
  editMyNote: (id: string, body: string) => api.editMyNote(id, body),
}));

const note = (over: Partial<MyNote> = {}): MyNote => ({
  id: "n1",
  body: "Ring the wholesaler back\nabout the coil pricing",
  source: "text",
  sourceNoteId: null,
  createdAt: "2026-08-20T01:00:00.000Z",
  updatedAt: "2026-08-20T01:00:00.000Z",
  archivedAt: null,
  ...over,
});
const old = note({ id: "n0", body: "Old gate code", archivedAt: "2026-08-21T01:00:00.000Z" });

beforeEach(() => jest.clearAllMocks());

it("is titled Notes, with New note its one main button", () => {
  render(<NotesPage notes={[note()]} archived={[]} />);
  expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Notes");
  expect(screen.getByRole("button", { name: "New note" })).toHaveClass("pt-btn--main");
  expect(document.querySelectorAll(".pt-btn--main")).toHaveLength(1);
});

it("shows a note as its first line over the rest, and the archived ones behind Archived", async () => {
  const user = userEvent.setup();
  render(<NotesPage notes={[note()]} archived={[old]} />);
  const list = screen.getByRole("list", { name: "Your notes" });
  expect(within(list).getByText("Ring the wholesaler back")).toBeInTheDocument();
  expect(within(list).getByText("about the coil pricing")).toBeInTheDocument();
  expect(screen.queryByText("Old gate code")).not.toBeInTheDocument();

  // no number on the tab (Isaac, 20 October)
  await user.click(screen.getByRole("tab", { name: "Archived" }));
  expect(screen.getByText("Old gate code")).toBeInTheDocument();
  expect(screen.queryByText("Ring the wholesaler back")).not.toBeInTheDocument();
});

it("opens New note's form, and Edit opens the same form on the note", async () => {
  const user = userEvent.setup();
  render(<NotesPage notes={[note()]} archived={[]} />);
  await user.click(screen.getByRole("button", { name: "New note" }));
  expect(screen.getByRole("dialog", { name: "New note" })).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Cancel" }));

  await user.click(screen.getByRole("button", { name: "Edit note: Ring the wholesaler back" }));
  const dialog = screen.getByRole("dialog", { name: "Edit note" });
  const field = within(dialog).getByRole("textbox");
  expect(field).toHaveValue("Ring the wholesaler back\nabout the coil pricing");
  await user.clear(field);
  await user.type(field, "Ring them Monday");
  await user.click(within(dialog).getByRole("button", { name: "Save changes" }));
  expect(api.editMyNote).toHaveBeenCalledWith("n1", "Ring them Monday");
  expect(api.addMyNote).not.toHaveBeenCalled();
});

it("archives a note and says so with Undo", async () => {
  const user = userEvent.setup();
  render(<NotesPage notes={[note()]} archived={[]} />);
  await user.click(screen.getByRole("button", { name: "Archive note: Ring the wholesaler back" }));
  expect(api.archiveMyNote).toHaveBeenCalledWith("n1", undefined);
  expect(await screen.findByText("Note archived")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Undo" }));
  await waitFor(() => expect(api.archiveMyNote).toHaveBeenLastCalledWith("n1", false));
});

it("puts an archived note back, and deletes one for good only after asking", async () => {
  const user = userEvent.setup();
  render(<NotesPage notes={[]} archived={[old]} />);
  await user.click(screen.getByRole("tab", { name: "Archived" }));
  await user.click(screen.getByRole("button", { name: "Put back note: Old gate code" }));
  expect(api.archiveMyNote).toHaveBeenCalledWith("n0", false);

  await user.click(screen.getByRole("button", { name: "Delete note: Old gate code" }));
  expect(api.deleteMyNote).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Delete note" }));
  expect(api.deleteMyNote).toHaveBeenCalledWith("n0");
});

it("says what is missing, with no button of its own", async () => {
  const user = userEvent.setup();
  render(<NotesPage notes={[]} archived={[]} />);
  expect(screen.getByText("No notes yet")).toBeInTheDocument();
  await user.click(screen.getByRole("tab", { name: "Archived" }));
  expect(screen.getByText("Nothing archived")).toBeInTheDocument();
  expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual(["New note"]);
});

/* THE PANEL SWAPS IN PLACE — no remount, no fade (Isaac, 2026-08-22). A
   stable node is the proof: with a key, React hands back a different one. */
it("swaps the list in place", async () => {
  const user = userEvent.setup();
  const { container } = render(<NotesPage notes={[note()]} archived={[old]} />);
  const panel = () => container.querySelector('[role="tabpanel"]');
  const before = panel();
  await user.click(screen.getByRole("tab", { name: "Archived" }));
  expect(panel()).toBe(before);
});
