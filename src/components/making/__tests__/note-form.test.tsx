import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NoteForm } from "../note-form";
import { WindowsContext } from "@/components/records/records-context";
import { addMyNote } from "@/app/actions/my-notes";

/* New › Note (Isaac, 24 October 2026): "notes should just be personal
   notes … you're the only one that's going to be looking at it". The words
   and Save, kept in My notes; nobody to send it to, and no job. */

jest.mock("@/app/actions/my-notes", () => ({ addMyNote: jest.fn(async () => ({ ok: true, id: "n1" })) }));

const toast = jest.fn();
const draw = (onClose = jest.fn()) => {
  render(
    <WindowsContext.Provider value={{ toast } as never}>
      <NoteForm onClose={onClose} />
    </WindowsContext.Provider>,
  );
  return onClose;
};
const say = (words: string) => fireEvent.change(screen.getByLabelText("Note"), { target: { value: words } });

afterEach(() => {
  cleanup();
  jest.clearAllMocks();
});

it("(F) keeps the note in My notes, and asks nobody else", async () => {
  const onClose = draw();
  expect(screen.queryByText("To")).toBeNull();
  expect(screen.queryByText("For job")).toBeNull();
  say("Ute 2's reverse camera is out again");
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Save to My notes" })));
  expect(addMyNote).toHaveBeenCalledWith({ body: "Ute 2's reverse camera is out again", source: "text" });
  await waitFor(() => expect(onClose).toHaveBeenCalled());
  expect(toast).toHaveBeenCalledWith("Saved to My notes");
});

it("asks for the words first, and keeps the form when it didn't save", async () => {
  const onClose = draw();
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Save to My notes" })));
  expect(addMyNote).not.toHaveBeenCalled();
  expect(screen.getByText("Write something first.")).toBeInTheDocument();
  (addMyNote as jest.Mock).mockResolvedValueOnce({ ok: false, error: "Couldn't keep that note." });
  say("Hello");
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Save to My notes" })));
  expect(screen.getByText("Couldn't keep that note.")).toBeInTheDocument();
  expect(onClose).not.toHaveBeenCalled();
});
