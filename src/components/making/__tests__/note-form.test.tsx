import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { NoteForm } from "../note-form";
import { WindowsContext } from "@/components/records/records-context";
import { sendNote } from "@/app/actions/shared-notes";

/* New › Note (Isaac, 24 October 2026; the board
   https://claude.ai/artifact/NiPWtzHBwnetSyyiBag3Yp): what, the job, and who
   it is to. With no job it starts on The office. */

jest.mock("@/app/actions/shared-notes", () => ({
  notePeople: jest.fn(async () => ({ me: "s-me", people: [{ id: "s-isaac", name: "Isaac Smith" }] })),
  sendNote: jest.fn(async () => ({ ok: true })),
}));
jest.mock("@/app/actions/palette", () => ({
  searchPalette: jest.fn(async () => ({ staff: [], clients: [], projects: [], photos: [], jobs: [] })),
}));

const toast = jest.fn();
const draw = (job: { uuid: string; label: string } | null = null, onClose = jest.fn()) => {
  render(
    <WindowsContext.Provider value={{ toast } as never}>
      <NoteForm job={job} onClose={onClose} />
    </WindowsContext.Provider>,
  );
  return onClose;
};
const say = (words: string) => fireEvent.change(screen.getByLabelText("What"), { target: { value: words } });
const toList = () => screen.queryByRole("list");

afterEach(() => {
  cleanup();
  jest.clearAllMocks();
});

it("(F) with no job, goes to the office", async () => {
  const onClose = draw();
  await act(async () => {});
  expect(screen.getByRole("dialog", { name: "New note" })).toBeInTheDocument();
  expect(within(toList()!).getByText("The office")).toBeInTheDocument();
  say("Ute 2's reverse camera is out again");
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Send" })));
  expect(sendNote).toHaveBeenCalledWith({ text: "Ute 2's reverse camera is out again", jobUuid: null, to: [], toOffice: true });
  await waitFor(() => expect(onClose).toHaveBeenCalled());
  expect(toast).toHaveBeenCalledWith("Sent to The office");
});

it("(F) goes to the people you name instead, once the office is taken off", async () => {
  draw();
  await act(async () => {});
  fireEvent.click(screen.getByRole("button", { name: "Take The office off" }));
  expect(toList()).toBeNull();
  fireEvent.click(screen.getByRole("combobox", { name: "Add someone" }));
  fireEvent.click(await screen.findByRole("option", { name: "Isaac Smith" }));
  expect(within(toList()!).getByText("Isaac Smith")).toBeInTheDocument();
  say("Can you grab the ladder");
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Send" })));
  expect(sendNote).toHaveBeenCalledWith({ text: "Can you grab the ladder", jobUuid: null, to: ["s-isaac"], toOffice: false });
});

it("(F) on a job's page, the job is filled in and nobody is named until you choose", async () => {
  draw({ uuid: "j-3450", label: "3450 Kingsford" });
  await act(async () => {});
  expect(toList()).toBeNull();
  say("Return air is 600 x 400");
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Send" })));
  expect(sendNote).toHaveBeenCalledWith({ text: "Return air is 600 x 400", jobUuid: "j-3450", to: [], toOffice: false });
  expect(toast).toHaveBeenCalledWith("Kept on 3450 Kingsford");
});

it("asks for the words first, and keeps the form when it didn't send", async () => {
  const onClose = draw();
  await act(async () => {});
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Send" })));
  expect(sendNote).not.toHaveBeenCalled();
  expect(screen.getByText("Write the note first.")).toBeInTheDocument();
  (sendNote as jest.Mock).mockResolvedValueOnce({ ok: false, error: "There's nobody in the office to send it to. Name someone." });
  say("Hello");
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "Send" })));
  expect(screen.getByText("There's nobody in the office to send it to. Name someone.")).toBeInTheDocument();
  expect(onClose).not.toHaveBeenCalled();
});
