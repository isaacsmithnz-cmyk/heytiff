import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { FeedItem } from "@/lib/dashboard/your-feed";

/* Your feed, Home's third column (Isaac, 20 October 2026: built as the
   board drew it). The filter, a reply where the mention is, Got it. */

const refresh = jest.fn();
jest.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: jest.fn() }), usePathname: () => "/dashboard" }));
const replyToJobNote = jest.fn();
jest.mock("@/app/actions/job-note-sm8", () => ({ replyToJobNote: (...a: unknown[]) => replyToJobNote(...a) }));
const acknowledgeTask = jest.fn(async () => ({ ok: true }));
jest.mock("@/app/actions/assignments", () => ({ acknowledgeTask: (...a: unknown[]) => acknowledgeTask(...(a as [])) }));
/* the column's head is To do's, whose module brings To do's own actions */
const resolveIssue = jest.fn(async () => ({ ok: true }));
jest.mock("@/app/actions/dashboard", () => ({ completeTask: jest.fn(), reopenTask: jest.fn(), resolveIssue: (...a: unknown[]) => resolveIssue(...(a as [])) }));
/* the task's own form, as a stand-in that says what it was opened on */
jest.mock("@/components/making/task-form", () => ({
  TaskForm: (p: { taskId?: string | null; startWith?: string; onClose: () => void; onChanged?: () => void }) => (
    <div role="dialog" aria-label="Task">
      {p.taskId ? `task ${p.taskId}` : `new: ${p.startWith}`}
      <button onClick={() => (p.onChanged?.(), p.onClose())}>Save</button>
    </div>
  ),
}));
jest.mock("@/app/actions/reminders", () => ({ snoozeReminder: jest.fn() }));
jest.mock("@/app/actions/booking-sm8", () => ({ readBookInContext: jest.fn(), bookJobIn: jest.fn(), takeBackBooking: jest.fn() }));

import { HomeFeed } from "../home-feed";

const item = (over: Partial<FeedItem> & Pick<FeedItem, "key" | "filter">): FeedItem => ({
  who: { name: "Someone", sm8: false },
  what: "",
  said: null,
  yours: null,
  when: "",
  at: "2026-10-20 12:00:00",
  unread: false,
  act: null,
  reply: null,
  open: null,
  ...over,
});

const LUKE = item({
  key: "talk:1",
  filter: "you",
  who: { name: "Luke Parker", sm8: false },
  what: "mentioned you on 2674 Clovelly",
  said: "can you order two grille filters?",
  when: "12:52 pm",
  unread: true,
  reply: { jobUuid: "job-1", sourceNoteUuid: "n1", closesTaskId: "t9" },
});
const LEAVE = item({ key: "alert:leave-queue:1", filter: "approvals", who: { name: "Leave to approve", sm8: false }, what: "Alex, 3 to 5 Nov", act: { kind: "link", label: "Review", href: "/dashboard/team?view=leave" } });
const NEWJOB = item({ key: "event:new:j1", filter: "jobs", who: { name: "New job", sm8: true }, what: "3444 Stanmore", act: { kind: "link", label: "Open", href: "/dashboard/jobs/j1" } });
const GIVEN = item({ key: "assignment:t1", filter: "you", who: { name: "Order the PEAD", sm8: false }, what: "Given to you by Dane", unread: true, act: { kind: "gotit", taskId: "t1" } });

const draw = (items: FeedItem[] = [LUKE, LEAVE, NEWJOB, GIVEN]) => render(<HomeFeed items={items} />);
const list = () => screen.getByRole("list", { name: "Your feed" });

afterEach(() => {
  cleanup();
  localStorage.clear();
  [refresh, replyToJobNote, acknowledgeTask, resolveIssue].forEach((m) => m.mockClear());
});

it("(F) is Your feed, with All, To you, Jobs and Approvals, and no count", () => {
  draw();
  expect(screen.getByRole("heading", { name: "Your feed" })).toBeInTheDocument();
  expect(screen.getByRole("radiogroup", { name: "Show" })).toHaveTextContent("AllTo youJobsApprovals");
  expect(screen.queryByText("4")).toBeNull();
});

it("(F) filters to what you choose, and remembers it here", async () => {
  draw();
  await userEvent.click(screen.getByRole("radio", { name: "Approvals" }));
  expect(within(list()).getByText("Leave to approve")).toBeInTheDocument();
  expect(within(list()).queryByText("Luke Parker")).toBeNull();
  expect(localStorage.getItem("heytiff.home.feed.v1")).toBe("approvals");
  cleanup();
  draw();
  expect(await screen.findByRole("radio", { name: "Approvals" })).toHaveAttribute("aria-checked", "true");
});

it("(F) replies where the mention is: the reply goes to ServiceM8 through the job's reply, closing the ask's task", async () => {
  replyToJobNote.mockResolvedValue({ ok: true, note: {} });
  draw();
  const luke = within(list()).getByText("Luke Parker").closest("li")!;
  expect(within(luke).getByText('"can you order two grille filters?"')).toBeInTheDocument();
  await userEvent.click(within(luke).getByRole("button", { name: "Reply" }));
  await userEvent.type(within(luke).getByRole("textbox", { name: "Reply to Luke Parker" }), "Ordering them now");
  await userEvent.click(within(luke).getByRole("button", { name: "Send" }));
  expect(replyToJobNote).toHaveBeenCalledWith(expect.objectContaining({ jobUuid: "job-1", sourceNoteUuid: "n1", words: "Ordering them now", closesTaskId: "t9" }));
  expect(await within(luke).findByText("You: Ordering them now")).toBeInTheDocument();
  expect(within(luke).queryByRole("button", { name: "Reply" })).toBeNull();
  expect(refresh).toHaveBeenCalled();
});

it("(F) keeps your words and says why when the reply didn't go", async () => {
  replyToJobNote.mockResolvedValue({ ok: false, error: "That job isn't in ServiceM8's copy any more." });
  draw();
  const luke = within(list()).getByText("Luke Parker").closest("li")!;
  await userEvent.click(within(luke).getByRole("button", { name: "Reply" }));
  await userEvent.type(within(luke).getByRole("textbox", { name: "Reply to Luke Parker" }), "On it{Enter}");
  expect(await within(luke).findByRole("alert")).toHaveTextContent("That job isn't in ServiceM8's copy any more.");
  expect(within(luke).getByRole("textbox", { name: "Reply to Luke Parker" })).toHaveValue("On it");
});

it("(F) Got it takes work given to you out of the feed", async () => {
  draw();
  await userEvent.click(within(list()).getByRole("button", { name: "Got it" }));
  expect(acknowledgeTask).toHaveBeenCalledWith("t1");
  expect(within(list()).queryByText("Order the PEAD")).toBeNull();
});

it("(F) says nothing is here when a filter holds nothing", async () => {
  draw([LUKE]);
  await userEvent.click(screen.getByRole("radio", { name: "Jobs" }));
  expect(screen.getByText("Nothing here")).toBeInTheDocument();
});

/* To do's Reply on a mention lands on Home with its note named (20 October 2026) */
it("(F) opens the reply box on the mention To do's Reply named, whatever the filter", () => {
  localStorage.setItem("heytiff.home.feed.v1", "approvals");
  render(<HomeFeed items={[{ ...LUKE, notes: ["n0", "n1"] }, LEAVE]} replyTo="n0" />);
  const luke = within(list()).getByText("Luke Parker").closest("li")!;
  expect(within(luke).getByRole("textbox", { name: "Reply to Luke Parker" })).toBeInTheDocument();
});

it("(F) draws an approval with an icon, not initials as if it were a person", () => {
  render(<HomeFeed items={[{ ...LEAVE, who: { ...LEAVE.who, thing: true } }]} />);
  const row = within(list()).getByText("Leave to approve").closest("li")!;
  expect(row.querySelector(".hm-feed-av--thing")).not.toBeNull();
  expect(row.querySelector(".pt-initials")).toBeNull();
});

/* Isaac, 24 October 2026: "Everything on that feed and notes should be interactive" */
it("(F) opens what an item is about from its words: a page, or the task it is over Home", async () => {
  render(
    <HomeFeed
      items={[
        { ...LEAVE, open: { href: "/dashboard/team?view=leave" } },
        { ...GIVEN, open: { taskId: "t1" } },
      ]}
    />,
  );
  expect(within(list()).getByRole("link", { name: /Leave to approve/ })).toHaveAttribute("href", "/dashboard/team?view=leave");
  await userEvent.click(within(list()).getByRole("button", { name: /Order the PEAD/ }));
  expect(screen.getByRole("dialog", { name: "Task" })).toHaveTextContent("task t1");
});

const ISSUE = item({
  key: "issue:i1",
  filter: "you",
  who: { name: "Ute 2's reverse camera is out again", sm8: false, thing: true },
  what: "New today",
  act: { kind: "issue", issueId: "i1", title: "Ute 2's reverse camera is out again" },
});

it("(F) makes a field issue with nothing to open a task, closing the issue once the task is saved", async () => {
  render(<HomeFeed items={[ISSUE]} />);
  await userEvent.click(within(list()).getByRole("button", { name: "Make it a task" }));
  const form = screen.getByRole("dialog", { name: "Task" });
  expect(form).toHaveTextContent("new: Ute 2's reverse camera is out again");
  expect(resolveIssue).not.toHaveBeenCalled();
  await userEvent.click(within(form).getByRole("button", { name: "Save" }));
  expect(resolveIssue).toHaveBeenCalledWith("i1");
  expect(screen.queryByText("Ute 2's reverse camera is out again")).toBeNull();
});

it("(F) Done closes a field issue where it sits", async () => {
  render(<HomeFeed items={[ISSUE]} />);
  await userEvent.click(within(list()).getByRole("button", { name: "Done" }));
  expect(resolveIssue).toHaveBeenCalledWith("i1");
  expect(screen.queryByText("Ute 2's reverse camera is out again")).toBeNull();
});
