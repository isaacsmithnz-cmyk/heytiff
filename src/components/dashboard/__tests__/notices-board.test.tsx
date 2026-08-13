import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NoticesBoard } from "../notices-board";
import type { BoardNotice } from "@/lib/dashboard/board";

/* The noticeboard's destructive edge, and its body field.

   The 2026-08-12 audit found this component untested — 1,200 lines carrying
   polls, RSVPs, comments, attachments, archiving and a hard delete. This
   covers the two things that changed and the rule behind each; the rest of the
   surface is still uncovered and worth a suite of its own. */

const refresh = jest.fn();
jest.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

const deleteNotice = jest.fn(async () => ({ ok: true }));
const setNoticeArchived = jest.fn(async () => ({ ok: true }));
const markNoticesRead = jest.fn(async () => ({ ok: true }));
jest.mock("@/app/actions/dashboard", () => ({
  castPollVote: jest.fn(async () => ({ ok: true })),
  commentOnNotice: jest.fn(async () => ({ ok: true })),
  deleteComment: jest.fn(async () => ({ ok: true })),
  deleteNotice: (...a: unknown[]) => deleteNotice(...(a as [])),
  editNotice: jest.fn(async () => ({ ok: true })),
  markNoticesRead: (...a: unknown[]) => markNoticesRead(...(a as [])),
  postNotice: jest.fn(async () => ({ ok: true })),
  reactToNotice: jest.fn(async () => ({ ok: true })),
  setNoticeArchived: (...a: unknown[]) => setNoticeArchived(...(a as [])),
  setRsvp: jest.fn(async () => ({ ok: true })),
}));
jest.mock("@/app/actions/documents", () => ({
  deleteDocument: jest.fn(async () => ({ ok: true })),
  uploadFile: jest.fn(async () => ({ ok: false, error: "no" })),
}));

const TODAY = "2026-08-12";

const notice = (over: Partial<BoardNotice> = {}): BoardNotice =>
  ({
    id: "n1",
    title: "Depot closed Friday",
    body: null,
    pinned: false,
    postedById: "s1",
    postedByName: "Dane Whitely",
    createdAt: "2026-08-10T00:00:00Z",
    revision: 1,
    editedAt: null,
    kind: "notice",
    expiresAt: null,
    archivedAt: null,
    ackedRevision: null,
    state: "read",
    mine: true,
    readBy: 2,
    audience: 3,
    poll: null,
    event: null,
    reactions: { tallies: [], total: 0, mine: null },
    comments: [],
    mentionsMe: 0,
    attachments: [],
    ...over,
  }) as BoardNotice;

const draw = (notices: BoardNotice[]) =>
  render(
    <NoticesBoard
      notices={notices}
      canManage
      canRead
      today={TODAY}
      staff={[]}
      viewerStaffId="s1"
    />,
  );

beforeEach(() => {
  deleteNotice.mockClear();
  setNoticeArchived.mockClear();
  refresh.mockClear();
});

/* DELETE IS OFFERED FROM THE ARCHIVE ONLY.

   It used to be a ghost button on every live notice, one click from
   destroying the post, its comments, its poll votes, its RSVPs and its files —
   with no confirm and no undo, a millimetre from Archive, which looks
   identical and is completely recoverable. My Notes already wrote the rule
   down: nothing is destroyed in one click from the list you read every day. */
describe("deleting a notice", () => {
  it("is not offered at all on a notice that is still on the board", () => {
    draw([notice()]);
    expect(screen.queryByRole("button", { name: /Delete for good/ })).not.toBeInTheDocument();
    // the recoverable one is still right there
    expect(screen.getByRole("button", { name: "Archive" })).toBeInTheDocument();
  });

  it("appears once the notice is archived, and asks twice", async () => {
    const user = userEvent.setup();
    draw([notice({ archivedAt: "2026-08-11T00:00:00Z" })]);
    // the archive section is collapsed by default
    await user.click(screen.getByRole("button", { name: /Archived/ }));

    const del = screen.getByRole("button", { name: /Delete for good/ });
    await user.click(del);
    expect(deleteNotice).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: /Confirm delete/ }));
    expect(deleteNotice).toHaveBeenCalledWith("n1");
  });

  it("disarms when the button loses focus, so it can't be left cocked", async () => {
    const user = userEvent.setup();
    draw([notice({ archivedAt: "2026-08-11T00:00:00Z" })]);
    await user.click(screen.getByRole("button", { name: /Archived/ }));

    await user.click(screen.getByRole("button", { name: /Delete for good/ }));
    expect(screen.getByRole("button", { name: /Confirm delete/ })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Put back" }));
    expect(deleteNotice).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /Confirm delete/ })).not.toBeInTheDocument();
  });
});

/* ONE WORD PER STATE. The button said Archive, the chip said "Filed away" and
   the section said Archived — three words for one state on one screen. */
describe("the archived state", () => {
  it("is called the same thing on the chip as on the button and the section", async () => {
    const user = userEvent.setup();
    draw([notice({ archivedAt: "2026-08-11T00:00:00Z" })]);
    await user.click(screen.getByRole("button", { name: /Archived/ }));

    const card = document.querySelector(".nb-item") as HTMLElement;
    expect(within(card).getByText("Archived")).toBeInTheDocument();
    expect(within(card).queryByText(/Filed away/)).not.toBeInTheDocument();
  });
});

/* THE BODY IS THE ANNOUNCEMENT. It was a one-line `<input>`, so a notice could
   never hold a paragraph break — and `.nb-body` has rendered stored text with
   `white-space: pre-wrap` the whole time. */
describe("the composer", () => {
  it("takes the message in a textarea, and keeps the newlines", async () => {
    const user = userEvent.setup();
    draw([]);
    await user.click(screen.getByRole("button", { name: /Post a notice/ }));

    const body = screen.getByPlaceholderText(/as many lines as it takes/);
    expect(body.tagName).toBe("TEXTAREA");

    await user.type(body, "Yard resurfaced.{enter}{enter}Park on Mills St.");
    expect((body as HTMLTextAreaElement).value).toBe(
      "Yard resurfaced.\n\nPark on Mills St.",
    );
  });
});
