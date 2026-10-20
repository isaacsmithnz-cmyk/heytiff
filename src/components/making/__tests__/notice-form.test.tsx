import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { NoticeForm } from "../notice-form";
import { WindowsContext } from "@/components/records/records-context";
import { deleteNotice, editNotice, postNotice } from "@/app/actions/dashboard";
import { deleteDocument } from "@/app/actions/documents";
import { uploadFile } from "@/lib/documents/upload-client";
import { pickDate } from "@/components/ui/__tests__/fixtures/pick-date";
import type { BoardNotice } from "@/lib/dashboard/board";

/* WRITE A NOTICE (rules 51 and 52): a notice, a poll or an event, with its
   files, the day it comes off the board and its pin, posted by today's
   postNotice; an edit by today's editNotice. Saving keeps you on the
   board with a toast: a post's Undo takes the notice down, an edit's puts
   back what it said and takes out the files it added. */

const refresh = jest.fn();
jest.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
jest.mock("@/app/actions/dashboard", () => ({
  postNotice: jest.fn(async () => ({ ok: true, id: "n9" })),
  editNotice: jest.fn(async () => ({ ok: true })),
  deleteNotice: jest.fn(async () => ({ ok: true })),
}));
jest.mock("@/app/actions/documents", () => ({ deleteDocument: jest.fn(async () => ({ ok: true })) }));
jest.mock("@/lib/documents/upload-client", () => ({
  uploadFile: jest.fn(async (file: File) => ({
    ok: true,
    file: { documentId: `doc-${file.name}`, fileName: file.name, mimeType: "application/pdf", sizeBytes: 348160, previewUrl: null },
  })),
}));

const TODAY = "2026-10-18";
const toast = jest.fn();
const draw = (notice: BoardNotice | null = null) => {
  const onClose = jest.fn();
  render(
    <WindowsContext.Provider value={{ toast } as never}>
      <NoticeForm today={TODAY} notice={notice} onClose={onClose} />
    </WindowsContext.Provider>,
  );
  return onClose;
};
const dialog = () => screen.getByRole("dialog", { name: /notice|poll|event/i });
const type = (label: string, value: string) => fireEvent.change(within(dialog()).getByLabelText(label), { target: { value } });
const press = async (name: string) => {
  await act(async () => fireEvent.click(within(dialog()).getByRole("button", { name })));
};
const attach = async (...names: string[]) => {
  const input = dialog().querySelector<HTMLInputElement>('input[type="file"]')!;
  await act(async () => fireEvent.change(input, { target: { files: names.map((n) => new File(["x"], n, { type: "application/pdf" })) } }));
};

afterEach(() => {
  cleanup();
  jest.clearAllMocks();
});

describe("a notice", () => {
  it("posts as today's composer did, and Undo takes it down again", async () => {
    const onClose = draw();
    expect(within(dialog()).getByRole("heading", { name: "Write a notice" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Notice" })).toHaveAttribute("aria-checked", "true");
    expect(within(dialog()).getByRole("button", { name: "Post notice" })).toBeDisabled();
    type("Title", "Depot closed Friday");
    type("Message", "Park on Mills St.");
    fireEvent.click(screen.getByRole("checkbox", { name: "Pin to the top" }));
    await press("Post notice");
    expect(postNotice).toHaveBeenCalledWith({
      title: "Depot closed Friday",
      body: "Park on Mills St.",
      pinned: true,
      expiresAt: null,
      kind: "notice",
      documentIds: [],
    });
    expect(onClose).toHaveBeenCalled();
    expect(refresh).toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith("Notice posted", expect.any(Function));
    await toast.mock.calls[0][1]();
    expect(deleteNotice).toHaveBeenCalledWith("n9");
  });

  it("says why the action refused, and stays open", async () => {
    const onClose = draw();
    type("Title", "Depot closed Friday");
    (postNotice as jest.Mock).mockResolvedValueOnce({ ok: false, error: "You can't post notices." });
    await press("Post notice");
    expect(within(dialog()).getByRole("alert")).toHaveTextContent("You can't post notices.");
    expect(onClose).not.toHaveBeenCalled();
    expect(toast).not.toHaveBeenCalled();
  });

  it("uploads files as they're picked, lists them, and takes one out of the bucket when it's removed", async () => {
    draw();
    await attach("Venue menu.pdf");
    const list = within(dialog()).getByRole("list", { name: "Photos and files" });
    expect(list).toHaveTextContent("Venue menu.pdf");
    expect(list).toHaveTextContent("PDF, 340 KB");
    expect(uploadFile).toHaveBeenCalledWith(expect.any(File), "notice_attachment");
    fireEvent.click(within(dialog()).getByRole("button", { name: "Remove Venue menu.pdf" }));
    expect(deleteDocument).toHaveBeenCalledWith("doc-Venue menu.pdf");
    expect(within(dialog()).queryByRole("list", { name: "Photos and files" })).toBeNull();
  });

  it("holds the files to the board's six", async () => {
    draw();
    await attach("1.pdf", "2.pdf", "3.pdf", "4.pdf", "5.pdf", "6.pdf", "7.pdf");
    expect(uploadFile).toHaveBeenCalledTimes(6);
    expect(within(dialog()).getByRole("alert")).toHaveTextContent("You can attach up to 6 files.");
    expect(within(dialog()).queryByRole("button", { name: "Attach a file" })).toBeNull();
  });
});

describe("a poll", () => {
  it("asks a question with two answers to start, adds and removes answers, and posts them with multi-choice", async () => {
    draw();
    fireEvent.click(screen.getByRole("radio", { name: "Poll" }));
    expect(within(dialog()).getByLabelText("Question")).toBeInTheDocument();
    expect(within(dialog()).getByLabelText("Any detail")).toBeInTheDocument();
    expect(within(dialog()).getAllByRole("textbox", { name: /^Answer / })).toHaveLength(2);
    // two is the least a poll has: neither can go
    expect(within(dialog()).queryByRole("button", { name: /^Remove answer/ })).toBeNull();
    fireEvent.click(within(dialog()).getByRole("button", { name: "Add an answer" }));
    expect(within(dialog()).getAllByRole("textbox", { name: /^Answer / })).toHaveLength(3);
    fireEvent.click(within(dialog()).getByRole("button", { name: "Remove answer 3" }));
    type("Question", "Christmas party: which Friday?");
    type("Answer 1", "Friday 12 December");
    expect(within(dialog()).getByText("Give the poll at least 2 answers.")).toBeInTheDocument();
    expect(within(dialog()).getByRole("button", { name: "Post poll" })).toBeDisabled();
    type("Answer 2", "Friday 19 December");
    fireEvent.click(screen.getByRole("checkbox", { name: "Allow more than one answer" }));
    await press("Post poll");
    expect(postNotice).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "poll",
        title: "Christmas party: which Friday?",
        options: ["Friday 12 December", "Friday 19 December"],
        multi: true,
      }),
    );
    expect(toast).toHaveBeenCalledWith("Poll posted", expect.any(Function));
  });
});

describe("an event", () => {
  it("takes a day, a start on the wheel and a place, and comes off the board on its day unless told otherwise", async () => {
    draw();
    fireEvent.click(screen.getByRole("radio", { name: "Event" }));
    expect(within(dialog()).getByLabelText("What's on")).toBeInTheDocument();
    type("What's on", "Daikin VRV training");
    expect(within(dialog()).getByRole("button", { name: "Post event" })).toBeDisabled();
    await pickDate("Day", "2026-11-13", within(dialog()));
    expect(within(dialog()).getByLabelText("Comes off the board")).toHaveTextContent("13/11/2026");
    fireEvent.click(screen.getByRole("combobox", { name: "Start" }));
    const wheel = screen.getByRole("dialog", { name: "Start" });
    fireEvent.click(within(within(wheel).getByRole("listbox", { name: "Hour" })).getByRole("option", { name: "9" }));
    fireEvent.keyDown(wheel, { key: "Escape" });
    type("Where", "Daikin training centre, Mascot");
    expect(dialog().querySelector('input[type="time"]')).toBeNull();
    await press("Post event");
    expect(postNotice).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "event",
        eventDate: "2026-11-13",
        eventTime: "09:00",
        eventLocation: "Daikin training centre, Mascot",
        expiresAt: "2026-11-13",
      }),
    );
    expect(toast).toHaveBeenCalledWith("Event posted", expect.any(Function));
  });
});

const posted = (over: Partial<BoardNotice> = {}): BoardNotice =>
  ({
    id: "n1",
    title: "Toolbox talk",
    body: "At the depot.",
    pinned: false,
    kind: "event",
    expiresAt: "2026-11-13",
    event: { date: "2026-11-13", time: "07:00", location: "The depot", rsvp: { options: [], voters: 0, myOptionIds: [], multi: false } },
    poll: null,
    ...over,
  }) as BoardNotice;

describe("an edit", () => {
  it("fills in the notice, never offers a poll's answers or another kind, and saves through editNotice", async () => {
    draw(posted());
    expect(within(dialog()).getByRole("heading", { name: "Edit event" })).toBeInTheDocument();
    expect(screen.queryByRole("radiogroup", { name: "Kind" })).toBeNull();
    expect(within(dialog()).getByLabelText("What's on")).toHaveValue("Toolbox talk");
    expect(screen.getByRole("combobox", { name: "Start" })).toHaveTextContent("7:00 AM");
    type("Where", "The yard");
    await attach("Map.pdf");
    await press("Save changes");
    expect(editNotice).toHaveBeenCalledWith({
      noticeId: "n1",
      title: "Toolbox talk",
      body: "At the depot.",
      pinned: false,
      expiresAt: "2026-11-13",
      documentIds: ["doc-Map.pdf"],
      eventDate: "2026-11-13",
      eventTime: "07:00",
      eventLocation: "The yard",
    });
    expect(toast).toHaveBeenCalledWith("Event saved", expect.any(Function));
    // Undo: what it said, and the file it added comes out again
    await toast.mock.calls[0][1]();
    expect(editNotice).toHaveBeenLastCalledWith({
      noticeId: "n1",
      title: "Toolbox talk",
      body: "At the depot.",
      pinned: false,
      expiresAt: "2026-11-13",
      documentIds: [],
      eventDate: "2026-11-13",
      eventTime: "07:00",
      eventLocation: "The depot",
    });
    expect(deleteDocument).toHaveBeenCalledWith("doc-Map.pdf");
  });

  it("keeps a poll's answers out of an edit", () => {
    draw(posted({ kind: "poll", event: null, title: "Which Friday?" }));
    expect(within(dialog()).getByRole("heading", { name: "Edit poll" })).toBeInTheDocument();
    expect(within(dialog()).queryByRole("textbox", { name: /^Answer / })).toBeNull();
    expect(within(dialog()).getByLabelText("Title")).toHaveValue("Which Friday?");
  });
});
