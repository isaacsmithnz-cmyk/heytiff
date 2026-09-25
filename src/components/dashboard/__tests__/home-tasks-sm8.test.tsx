import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HomeTasks } from "../home-tasks";
import { DashboardHome } from "../home";
import type { DashTask } from "@/lib/dashboard/tasks";
import type { DashboardData, HomeRail } from "@/lib/dashboard/page-data";
import type { TaskDoneLine } from "@/lib/dashboard/task-done-query";
import type { NoteState } from "@/lib/integrations/sm8-note-plan";
import { fillWords, NOTE_WORDS } from "@/lib/integrations/sm8-note-words";
import { retryTaskDone } from "@/app/actions/task-sm8";
import { confirmMySm8Link } from "@/app/actions/job-note-sm8";
import { completeTask, reopenTask } from "@/app/actions/dashboard";

/* A task's Done, on the task (two-way phase 2, PR C): the Done's words and
   where it stands, each line with its own doors, acting on its own row. And
   the bell's door onto it: /dashboard?task=<id> opens Home on that task.

   The actions are stubs (jest.setup mocks task-sm8 and job-note-sm8); what
   is pinned is what the face draws and what each door asks the server. */

jest.mock("@/components/notes/note-token", () => ({ NoteToken: () => <div /> }));
const refresh = jest.fn();
jest.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: jest.fn() }) }));
jest.mock("@/app/actions/dashboard", () => ({
  completeTask: jest.fn(async () => ({ ok: true })),
  createTask: jest.fn(),
  reopenTask: jest.fn(async () => ({ ok: true })),
  deleteTask: jest.fn(),
  setTaskDue: jest.fn(),
  resolveIssue: jest.fn(),
}));
jest.mock("@/components/workboard/board/job-sheet", () => ({ JobSheet: () => null }));

const retry = retryTaskDone as jest.MockedFunction<typeof retryTaskDone>;
const confirm = confirmMySm8Link as jest.MockedFunction<typeof confirmMySm8Link>;

const T = "3a3a3a3a-0000-4000-8000-00000000000a";
const OLD = "00000000-0000-4000-8000-0000000000d1";
const NEW = "00000000-0000-4000-8000-0000000000d2";
const ISAAC_SM8 = "5a1b2c3d-0000-4000-8000-00000000aaaa";

const task = (over: Partial<DashTask> = {}): DashTask => ({
  id: T,
  title: "Order the grilles",
  detail: null,
  assigneeId: "s1",
  assigneeName: "Isaac Smith",
  dueDate: null,
  status: "done",
  createdBy: "s2",
  createdAt: "2026-09-20T00:00:00Z",
  doneAt: "2026-09-25T01:00:00Z",
  doneByName: "Isaac Smith",
  remindAt: null,
  remindKind: "at" as const,
  ...over,
});

const state = (over: Partial<NoteState>): NoteState => ({ key: null, text: null, tone: null, acts: [], ...over });
const line = (noteId: string, s: Partial<NoteState>): TaskDoneLine => ({ noteId, words: "@lukeingold Done.", state: state(s) });

const sent = line(NEW, { key: "line.sent", text: NOTE_WORDS.line.sent, tone: "ok", acts: ["undo"] });
const stillIn = line(OLD, {
  key: "line.stillIn",
  text: fillWords(NOTE_WORDS.line.stillIn, { reason: NOTE_WORDS.row.noteRefused }),
  tone: "bad",
  acts: ["take_out_again"],
});
const refusedLine = line(NEW, {
  key: "line.notSent",
  text: fillWords(NOTE_WORDS.line.notSent, { reason: NOTE_WORDS.press.unlinked }),
  tone: "bad",
  acts: ["send_again", "undo"],
});
const asking = line(NEW, {
  key: "line.notSent",
  text: fillWords(NOTE_WORDS.line.notSent, { reason: fillWords(NOTE_WORDS.press.confirm, { sm8Name: "Isaac Smith" }) }),
  tone: "bad",
  acts: ["confirm", "undo"],
});

function renderTasks(over: Partial<Parameters<typeof HomeTasks>[0]> = {}) {
  return render(
    <HomeTasks
      today="2026-09-25"
      mine={[]}
      team={null}
      done={[task()]}
      reported={[]}
      viewerStaffId="s1"
      canManage={false}
      assignable={[]}
      {...over}
    />
  );
}

const page = () => screen.getByRole("article", { name: "The task" });

beforeEach(() => {
  retry.mockReset().mockResolvedValue({ ok: true, state: null });
  confirm.mockReset().mockResolvedValue({ ok: true, sender: { state: "ready", staffUuid: ISAAC_SM8, remoteId: ISAAC_SM8, sm8Name: "Isaac Smith", handle: "isaacsmith" } });
  refresh.mockReset();
  (completeTask as jest.Mock).mockClear();
  (reopenTask as jest.Mock).mockClear();
});
afterEach(cleanup);

describe("the task's line", () => {
  it("draws nothing where there is no line — the face as it was", () => {
    renderTasks();
    expect(within(page()).queryByText(/ServiceM8/)).toBeNull();
    expect(page().querySelectorAll("[data-note-id]")).toHaveLength(0);
  });

  it("(F) 29. shows each line: the words in quotes, then the state in its colour, and no Undo (Reopen is the task's Undo)", () => {
    renderTasks({ sm8Lines: { [T]: [sent, stillIn] } });
    const drawn = [...page().querySelectorAll("[data-note-id]")];
    expect(drawn.map((p) => p.getAttribute("data-note-id"))).toEqual([NEW, OLD]);
    expect(drawn[0]).toHaveTextContent(`“@lukeingold Done.” ${NOTE_WORDS.line.sent}`);
    expect(within(drawn[0] as HTMLElement).getByText(NOTE_WORDS.line.sent)).toHaveClass("ok");
    expect(within(drawn[1] as HTMLElement).getByText(stillIn.state.text!)).toHaveClass("bad");
    expect(within(page()).queryByRole("button", { name: NOTE_WORDS.door.undo })).toBeNull();
    // law 21: no middot, and no arrow
    expect(page().textContent).not.toMatch(/·|→/);
  });

  it("(F) 29. Try again on a Done still in ServiceM8 re-presses THAT row's take-back", async () => {
    const user = userEvent.setup();
    renderTasks({ sm8Lines: { [T]: [sent, stillIn] } });
    const old = page().querySelector(`[data-note-id="${OLD}"]`) as HTMLElement;
    await user.click(within(old).getByRole("button", { name: NOTE_WORDS.door.tryAgain }));
    await waitFor(() => expect(retry).toHaveBeenCalledWith({ taskId: T, noteId: OLD, act: "take_out_again" }));
    expect(refresh).toHaveBeenCalled();
  });

  it("(F) 29. Try again on a refused Done sends that row again, and a refusal is said", async () => {
    const user = userEvent.setup();
    retry.mockResolvedValueOnce({ ok: false, error: NOTE_WORDS.press.unlinked });
    renderTasks({ sm8Lines: { [T]: [refusedLine] } });
    await user.click(within(page()).getByRole("button", { name: NOTE_WORDS.door.tryAgain }));
    await waitFor(() => expect(retry).toHaveBeenCalledWith({ taskId: T, noteId: NEW, act: "send_again" }));
    expect(await screen.findByText(NOTE_WORDS.press.unlinked, { selector: ".tp-err" })).toBeInTheDocument();
  });

  it("(F) 29. Yes answers the question for the viewer's own link, then sends that row", async () => {
    const user = userEvent.setup();
    renderTasks({
      sm8Lines: { [T]: [asking] },
      sm8Sender: { state: "confirm", remoteId: ISAAC_SM8, sm8Name: "Isaac Smith", handle: "isaacsmith" },
    });
    await user.click(within(page()).getByRole("button", { name: NOTE_WORDS.door.yes }));
    await waitFor(() => expect(retry).toHaveBeenCalledWith({ taskId: T, noteId: NEW, act: "send_again" }));
    expect(confirm).toHaveBeenCalledWith({ remoteId: ISAAC_SM8, answer: "yes" });
    expect(confirm.mock.invocationCallOrder[0]).toBeLessThan(retry.mock.invocationCallOrder[0]);
  });

  it("Not me is kept, and the row is pressed again only to say why it can't go; a failed answer sends nothing", async () => {
    const user = userEvent.setup();
    const sender = { state: "confirm" as const, remoteId: ISAAC_SM8, sm8Name: "Isaac Smith", handle: "isaacsmith" };
    renderTasks({ sm8Lines: { [T]: [asking] }, sm8Sender: sender });
    await user.click(within(page()).getByRole("button", { name: NOTE_WORDS.door.notMe }));
    await waitFor(() => expect(confirm).toHaveBeenCalledWith({ remoteId: ISAAC_SM8, answer: "no" }));
    await waitFor(() => expect(retry).toHaveBeenCalledTimes(1));

    cleanup();
    retry.mockClear();
    confirm.mockResolvedValueOnce({ ok: false, error: NOTE_WORDS.press.linkChanged });
    renderTasks({ sm8Lines: { [T]: [asking] }, sm8Sender: sender });
    await user.click(within(page()).getByRole("button", { name: NOTE_WORDS.door.yes }));
    expect(await screen.findByText(NOTE_WORDS.press.linkChanged)).toBeInTheDocument();
    expect(retry).not.toHaveBeenCalled();
  });

  it("the question answered since (the viewer is ready now): the line offers Send again instead", () => {
    renderTasks({
      sm8Lines: { [T]: [asking] },
      sm8Sender: { state: "ready", staffUuid: ISAAC_SM8, remoteId: ISAAC_SM8, sm8Name: "Isaac Smith", handle: "isaacsmith" },
    });
    expect(within(page()).queryByRole("button", { name: NOTE_WORDS.door.yes })).toBeNull();
    expect(within(page()).getByRole("button", { name: NOTE_WORDS.door.tryAgain })).toBeInTheDocument();
  });

  it("(F) the checkbox and Mark done post the Done, and Reopen takes it back; a Reopen's note is said", async () => {
    const user = userEvent.setup();
    (reopenTask as jest.Mock).mockResolvedValueOnce({ ok: true, note: fillWords(NOTE_WORDS.press.notYours, { name: "Isaac Smith" }) });
    renderTasks({ mine: [task({ id: "t-open", status: "open", doneAt: null, title: "Book the lift" })] });
    await user.click(screen.getByRole("button", { name: 'Mark "Book the lift" done' }));
    await waitFor(() => expect(completeTask).toHaveBeenCalledWith("t-open", { postDone: true }));
    await user.click(screen.getByRole("button", { name: 'Reopen "Order the grilles"' }));
    await waitFor(() => expect(reopenTask).toHaveBeenCalledWith(T, { takeBackDone: true }));
    expect(await screen.findByText(fillWords(NOTE_WORDS.press.notYours, { name: "Isaac Smith" }))).toBeInTheDocument();
  });
});

/* ── the bell's door ── */

const rail = (): HomeRail => ({
  dayISO: "2026-09-25",
  tz: null,
  blocks: [],
  linked: false,
  linkHref: null,
  tasks: [],
  nowMin: null,
  enabled: false,
  jobs: [],
  tracksTime: false,
  manage: false,
  moneyVisible: false,
  connected: false,
  where: {},
  crew: {},
});

const data = (): DashboardData => ({
  chips: { self: [], team: [] },
  calendar: { spanStart: "2026-09-21", spanEnd: "2026-10-19", days: [] },
  tasks: {
    mine: [task({ id: "t-open", status: "open", doneAt: null, title: "Book the lift" })],
    team: null,
    done: [task()],
    reported: [],
    sm8: { lines: { [T]: [stillIn] }, sender: null },
  },
  notices: [],
  journal: [],
  assignable: [],
  jobs: [],
  issues: [],
  canManage: false,
  viewerStaffId: "s1",
  today: "2026-09-25",
  rail: rail(),
  desk: null,
});

describe("/dashboard?task=<id>", () => {
  it("(F) 30. opens Home on the Tasks face with that task chosen, and its line on the page", () => {
    render(<DashboardHome data={data()} taskId={T} />);
    expect(screen.getByRole("tab", { name: /^Tasks/ })).toHaveAttribute("aria-selected", "true");
    expect(document.getElementById("hmsec-tasks")).not.toHaveAttribute("hidden");
    expect(within(page()).getByText("Order the grilles")).toHaveClass("hm-said");
    expect(page().querySelector(`[data-note-id="${OLD}"]`)).toHaveTextContent(stillIn.state.text!);
  });

  it("without one, Home opens on the Diary as ever", () => {
    render(<DashboardHome data={data()} />);
    expect(screen.getByRole("tab", { name: /^Diary/ })).toHaveAttribute("aria-selected", "true");
  });
});
