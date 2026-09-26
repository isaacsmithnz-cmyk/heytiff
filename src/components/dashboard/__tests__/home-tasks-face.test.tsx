import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HomeTasksFace } from "../home-tasks-face";
import { DeskJobHost } from "../home-job-sheet";
import { FLASH_MS } from "../home-list";
import { TiffContext, type TiffApi, type TiffLanded } from "@/components/tiff/modal/tiff-context";
import { typedAbout, type RecordTask, type TaskAbout, type TaskRecord } from "@/lib/dashboard/task-record";

/* THE NEW HOME'S TASKS FACE (H20). Every word a row says is lib/dashboard/
   task-record's and has its own suite; what is pinned here is what the
   face does with them: the two groups, the one row open at a time and what
   opens under it, each action offered only where it would be allowed and
   drawn at once while it is out, a refusal put back with its words, the
   two-step delete, the doors in and out, and the box in the room "tasks".

   The actions are server functions ("use server" cannot load in jsdom),
   the job card is the board's, and the Tiff button reaches the note flow:
   stubbed. The modal is a fake context, so what the box asks of it is
   seen. */
const mockRouter = { refresh: jest.fn(), push: jest.fn() };
jest.mock("next/navigation", () => ({ useRouter: () => mockRouter }));
jest.mock("@/components/workboard/board/job-sheet", () => ({
  JobSheet: (p: { row: { number: string | null }; onClose: () => void }) => (
    <div role="dialog" aria-label={`Job ${p.row.number ?? ""}`}>
      <button onClick={p.onClose}>Close the card</button>
    </div>
  ),
}));
const mockOpenMirrorJob = jest.fn();
jest.mock("@/app/actions/workboard", () => ({ openMirrorJob: (id: string) => mockOpenMirrorJob(id) }));
jest.mock("@/app/actions/dashboard", () => ({
  addTask: jest.fn(),
  completeTask: jest.fn(),
  reopenTask: jest.fn(),
  setTaskDue: jest.fn(),
  giveTask: jest.fn(),
  deleteTask: jest.fn(),
  resolveIssue: jest.fn(),
  reopenIssue: jest.fn(),
}));
jest.mock("@/app/actions/workboard-maintenance", () => ({ placeVisit: jest.fn(), clearVisitPlacement: jest.fn() }));
jest.mock("@/components/notes/tiff-button", () => ({
  TiffButton: ({ where, room }: { where?: string; room?: string }) => (
    <button type="button" aria-label="Talk to Tiff" data-where={where} data-room={room} />
  ),
}));

import { addTask, completeTask, deleteTask, giveTask, reopenTask, setTaskDue } from "@/app/actions/dashboard";

const m = <T,>(fn: T) => fn as unknown as jest.Mock;

const TODAY = "2026-09-24"; // a Thursday
const ME = "s-isaac";
const LUKE = "s-luke";
const LEO = "s-leo";

const task = (over: Partial<RecordTask> = {}): RecordTask => ({
  id: "t1",
  title: "Order the grilles",
  detail: null,
  assigneeId: ME,
  assigneeName: "Isaac Smith",
  dueDate: null,
  status: "open",
  createdBy: ME,
  createdAt: "2026-09-18T03:42:00Z",
  doneAt: null,
  doneByName: null,
  remindAt: null,
  remindKind: "at",
  createdByName: "Isaac Smith",
  doneById: null,
  acknowledgedAt: null,
  ...over,
});

const record = (over: Partial<TaskRecord> = {}): TaskRecord => ({
  open: [],
  done: [],
  doneCapped: false,
  about: {},
  people: { [ME]: "Isaac Smith", [LUKE]: "Luke Ingold", [LEO]: "Leo Park" },
  ...over,
});

const diary = (over: Partial<TaskAbout> = {}): TaskAbout => ({
  ...typedAbout(),
  source: "diary",
  noteId: "n1",
  authorId: ME,
  spoken: true,
  said: { day: "2026-08-22", time: "11:42 pm" },
  words: "Luke to order the grilles by Friday",
  ...over,
});

const sm8 = (over: Partial<TaskAbout> = {}): TaskAbout => ({
  ...typedAbout(),
  source: "sm8",
  sm8NoteUuid: "note-1",
  askerName: "Luke Ingold",
  said: { day: "2026-09-21", time: "1:42 pm" },
  words: "can you order the grilles",
  job: { label: "2041 Wollstonecraft", uuid: "job-1" },
  ...over,
});

const tiffOpen = jest.fn((_o: unknown) => true);

type FaceProps = Partial<Parameters<typeof HomeTasksFace>[0]> & { rec: TaskRecord; landed?: TiffLanded | null };

function Face({ rec, landed = null, ...over }: FaceProps) {
  const tiff: TiffApi = { enabled: true, open: tiffOpen, openedBy: null, isOpen: false, landed, report: () => {} };
  return (
    <TiffContext.Provider value={tiff}>
      <DeskJobHost manage={false} moneyVisible={false}>
        <HomeTasksFace
          today={TODAY}
          record={rec}
          viewerStaffId={ME}
          canManage={false}
          assignable={[]}
          tz="Australia/Sydney"
          {...over}
        />
      </DeskJobHost>
    </TiffContext.Provider>
  );
}

type Res = { ok: true } | { ok: false; error: string };
/** An answer the test gives when it says. */
function held<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

/* AN ACTION LEFT OUT IS NEVER LEFT OUT FOR GOOD. React holds every async
   transition on the page in one scope, and an optimistic change is taken
   back only when the whole scope has settled — so one answer a test never
   gave would keep every later test's optimistic changes on screen. Each
   answer a test holds back is given at its end. */
let unanswered: ((r: Res) => void)[] = [];
/** An action that is out until the test ends. */
function out(): Promise<Res> {
  const h = held<Res>();
  unanswered.push(h.resolve);
  return h.promise;
}

const group = (name: string) => screen.getByRole("region", { name });
const title = (name: string) => screen.getByRole("button", { name });
const box = (name: string) => screen.getByRole("checkbox", { name });
/** The part of a row that is open under it. */
const opened = (name: string) => document.getElementById(title(name).getAttribute("aria-controls")!)!;

beforeEach(() => {
  jest.clearAllMocks();
  tiffOpen.mockImplementation(() => true);
});
afterEach(async () => {
  const answers = unanswered;
  unanswered = [];
  await act(async () => {
    for (const answer of answers) answer({ ok: true });
  });
  cleanup();
});

describe("the groups", () => {
  it("holds Open, then Done, each with its count", () => {
    render(
      <Face
        rec={record({
          open: [task(), task({ id: "t2", title: "Ring the Hilux dealer" })],
          done: [task({ id: "t3", title: "Book the trailer in", status: "done", doneAt: "2026-09-22T01:00:00Z", doneById: ME })],
        })}
      />,
    );
    expect(screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual(["Open 2", "Done 1"]);
    expect(within(group("Done 1")).getByRole("button", { name: "Book the trailer in" })).toBeInTheDocument();
  });

  it("says Nothing open. over what is done, and No tasks yet. when there is nothing at all", () => {
    const { unmount } = render(
      <Face rec={record({ done: [task({ status: "done", doneAt: "2026-09-22T01:00:00Z", doneById: ME })] })} />,
    );
    expect(screen.getByText("Nothing open.")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: /^Open/ })).toBeNull();
    unmount();
    render(<Face rec={record()} />);
    expect(screen.getByText("No tasks yet.")).toBeInTheDocument();
    expect(screen.queryAllByRole("heading", { level: 2 })).toEqual([]);
  });

  it("says where Done stopped when it stopped at its limit", () => {
    const done = Array.from({ length: 3 }, (_, i) =>
      task({ id: `d${i}`, title: `Done ${i}`, status: "done", doneAt: "2026-09-22T01:00:00Z", doneById: ME }),
    );
    render(<Face rec={record({ done, doneCapped: true })} />);
    expect(screen.getByText("Showing the latest 3.")).toBeInTheDocument();
  });
});

describe("a row", () => {
  it("says where it came from, whose it is, and when it is due, late in its state", () => {
    render(
      <Face
        rec={record({
          open: [
            task({ dueDate: "2026-08-25" }),
            task({ id: "t2", title: "Head to Waverley", dueDate: TODAY, assigneeId: LUKE, assigneeName: "Luke Ingold" }),
          ],
          about: { t1: diary() },
        })}
      />,
    );
    const late = title("Order the grilles").closest(".hd-ls-row")!;
    expect(late).toHaveTextContent("Your diary, Sat 22 Aug.");
    expect(within(late as HTMLElement).getByText("30 days late")).toHaveAttribute("data-state", "bad");
    expect(late.querySelector(".hd-ls-tag")).toBeNull();
    const luke = title("Head to Waverley").closest(".hd-ls-row")!;
    expect(within(luke as HTMLElement).getByText("Luke")).toHaveClass("hd-ls-tag");
    expect(within(luke as HTMLElement).getByText("Today")).toHaveAttribute("data-state", "today");
  });

  it("strikes a done row through and says who ticked it and the day", () => {
    render(
      <Face
        rec={record({
          done: [task({ status: "done", doneAt: "2026-09-21T03:42:00Z", doneById: LUKE, assigneeId: LUKE, assigneeName: "Luke Ingold" })],
        })}
        canManage
      />,
    );
    const row = title("Order the grilles").closest(".hd-ls-row")!;
    expect(row).toHaveClass("done");
    expect(row).toHaveTextContent("Luke ticked it off.");
    expect(row).toHaveTextContent("Mon 21 Sept");
    expect(box("Order the grilles")).toHaveAttribute("aria-checked", "true");
  });
});

describe("opening a row", () => {
  it("opens under its title, one row at a time", async () => {
    const user = userEvent.setup();
    render(<Face rec={record({ open: [task(), task({ id: "t2", title: "Ring the Hilux dealer" })] })} />);
    await user.click(title("Order the grilles"));
    expect(title("Order the grilles")).toHaveAttribute("aria-expanded", "true");
    expect(opened("Order the grilles")).toBeInTheDocument();
    await user.click(title("Ring the Hilux dealer"));
    expect(title("Ring the Hilux dealer")).toHaveAttribute("aria-expanded", "true");
    expect(title("Order the grilles")).toHaveAttribute("aria-expanded", "false");
    await user.click(title("Ring the Hilux dealer"));
    expect(title("Ring the Hilux dealer")).toHaveAttribute("aria-expanded", "false");
  });

  /* Law 8: what a pointer opens grows open, what the keyboard opens is
     simply there — and a row that moves groups under it (ticked from
     inside) lands open, without growing a second time. */
  describe("with motion", () => {
    const realAnimate = Element.prototype.animate;
    beforeEach(() => {
      Element.prototype.animate = jest.fn() as unknown as typeof Element.prototype.animate;
    });
    afterEach(() => {
      Element.prototype.animate = realAnimate;
    });

    it("grows open from a pointer, and is simply there from the keyboard", async () => {
      const user = userEvent.setup();
      render(<Face rec={record({ open: [task(), task({ id: "t2", title: "Ring the Hilux dealer" })] })} />);
      await user.click(title("Order the grilles"));
      expect(opened("Order the grilles")).toHaveAttribute("data-grow");
      title("Ring the Hilux dealer").focus();
      await user.keyboard("{Enter}");
      expect(opened("Ring the Hilux dealer")).not.toHaveAttribute("data-grow");
    });

    it("does not grow open again when the row lands in Done", async () => {
      const user = userEvent.setup();
      m(completeTask).mockImplementation(out);
      render(<Face rec={record({ open: [task()] })} />);
      await user.click(title("Order the grilles"));
      await user.click(screen.getByRole("button", { name: "Mark done" }));
      expect(group("Done 1")).toContainElement(title("Order the grilles"));
      expect(opened("Order the grilles")).not.toHaveAttribute("data-grow");
    });
  });

  it("opens for a press anywhere on the row that is not a control", async () => {
    const user = userEvent.setup();
    render(<Face rec={record({ open: [task({ dueDate: "2026-10-02" })] })} />);
    await user.click(screen.getByText("Fri 2 Oct"));
    expect(title("Order the grilles")).toHaveAttribute("aria-expanded", "true");
  });

  it("says For, Due, Time and Job, and the Job opens the desk's one card", async () => {
    const user = userEvent.setup();
    mockOpenMirrorJob.mockResolvedValue({ id: "job-1", number: "2041", clientName: "Harbour St" });
    render(
      <Face
        rec={record({
          open: [task({ dueDate: "2026-08-25", remindAt: "2026-08-25T06:00:00Z", remindKind: "by", detail: "Two of them, 600 by 600." })],
          about: { t1: sm8() },
        })}
      />,
    );
    await user.click(title("Order the grilles"));
    const open = opened("Order the grilles");
    expect(open).toHaveTextContent("Two of them, 600 by 600.");
    const facts = [...open.querySelectorAll("dt")].map((dt) => [dt.textContent, dt.nextElementSibling!.textContent]);
    expect(facts).toEqual([
      ["For", "You"],
      ["Due", "Tue 25 Aug, 30 days late"],
      ["Time", "by 4:00 pm"],
      ["Job", "2041 Wollstonecraft"],
    ]);
    expect(within(open).getByText("Tue 25 Aug, 30 days late")).toHaveAttribute("data-late");
    await user.click(within(open).getByRole("button", { name: "2041 Wollstonecraft" }));
    expect(mockOpenMirrorJob).toHaveBeenCalledWith("job-1");
    expect(await screen.findByRole("dialog", { name: "Job 2041" })).toBeInTheDocument();
  });

  it("quotes their own words under what says whose they are", async () => {
    const user = userEvent.setup();
    render(
      <Face
        rec={record({
          open: [
            task(),
            task({ id: "t2", title: "Typed one" }),
            task({ id: "t3", title: "From Luke" }),
            task({ id: "t4", title: "Luke's diary" }),
          ],
          about: {
            t1: diary(),
            t2: diary({ spoken: false, words: "Order grilles" }),
            t3: sm8(),
            t4: diary({ authorId: LUKE, words: null }),
          },
        })}
      />,
    );
    const quote = async (name: string) => {
      await user.click(title(name));
      return opened(name).querySelector("figure");
    };
    expect((await quote("Order the grilles"))!.textContent).toBe(
      "You said, Sat 22 Aug, 11:42 pmLuke to order the grilles by Friday",
    );
    expect((await quote("Typed one"))!.querySelector("figcaption")!.textContent).toBe("You typed, Sat 22 Aug, 11:42 pm");
    expect((await quote("From Luke"))!.querySelector("figcaption")!.textContent).toBe(
      "Luke Ingold wrote, in a job note on 2041 Wollstonecraft",
    );
    // nobody reads someone else's diary: no words, no figure
    expect(await quote("Luke's diary")).toBeNull();
  });

  it("tells what happened to it, oldest first", async () => {
    const user = userEvent.setup();
    render(
      <Face
        rec={record({
          open: [task({ createdBy: LUKE, createdByName: "Luke Ingold", createdAt: "2026-09-21T03:42:00Z", acknowledgedAt: "2026-09-22T00:00:00Z" })],
        })}
      />,
    );
    await user.click(title("Order the grilles"));
    const lines = [...opened("Order the grilles").querySelectorAll("ol li")].map((li) => [
      li.querySelector("span")!.textContent,
      li.textContent!.slice(li.querySelector("span")!.textContent!.length),
    ]);
    expect(lines).toEqual([
      ["Mon 21 Sept, 1:42 pm", "Luke typed it."],
      ["Mon 21 Sept, 1:42 pm", "Luke gave it to you."],
      ["Tue 22 Sept, 10:00 am", "You said Got it."],
    ]);
  });
});

describe("ticking it off", () => {
  it("moves it to Done at once, ticked by you, and the box keeps your focus", async () => {
    const user = userEvent.setup();
    const answer = held<Res>();
    m(completeTask).mockReturnValue(answer.promise);
    const before = record({ open: [task(), task({ id: "t2", title: "Ring the Hilux dealer" })] });
    const { rerender } = render(<Face rec={before} />);
    await user.click(box("Order the grilles"));
    expect(completeTask).toHaveBeenCalledWith("t1");
    expect(within(group("Done 1")).getByRole("checkbox", { name: "Order the grilles" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(title("Order the grilles").closest(".hd-ls-row")).toHaveTextContent("You ticked it off.");
    expect(box("Order the grilles")).toHaveFocus();
    // the page comes back with it, and the action answers
    rerender(
      <Face
        rec={record({
          open: [task({ id: "t2", title: "Ring the Hilux dealer" })],
          done: [task({ status: "done", doneAt: "2026-09-24T03:00:00Z", doneById: ME })],
        })}
      />,
    );
    await act(async () => answer.resolve({ ok: true }));
    expect(within(group("Done 1")).getByRole("button", { name: "Order the grilles" })).toBeInTheDocument();
    expect(mockRouter.refresh).not.toHaveBeenCalled();
  });

  it("stays open in its new place from Mark done, with Not done yet under your hand", async () => {
    const user = userEvent.setup();
    m(completeTask).mockImplementation(out);
    render(<Face rec={record({ open: [task()] })} />);
    await user.click(title("Order the grilles"));
    await user.click(screen.getByRole("button", { name: "Mark done" }));
    expect(title("Order the grilles")).toHaveAttribute("aria-expanded", "true");
    expect(group("Done 1")).toContainElement(title("Order the grilles"));
    expect(screen.getByRole("button", { name: "Not done yet" })).toHaveFocus();
  });

  it("takes a done one back with Not done yet", async () => {
    const user = userEvent.setup();
    m(reopenTask).mockImplementation(out);
    render(<Face rec={record({ done: [task({ status: "done", doneAt: "2026-09-22T01:00:00Z", doneById: ME })] })} />);
    await user.click(title("Order the grilles"));
    // a done task is only taken back or deleted
    const acts = [...opened("Order the grilles").querySelectorAll(".hd-tk-a button")].map((b) => b.textContent);
    expect(acts).toEqual(["Not done yet", "Delete task"]);
    await user.click(screen.getByRole("button", { name: "Not done yet" }));
    expect(reopenTask).toHaveBeenCalledWith("t1");
    expect(group("Open 1")).toContainElement(title("Order the grilles"));
  });

  it("puts a tick the action refused back where it was, says why, and asks the page again", async () => {
    const user = userEvent.setup();
    m(completeTask).mockResolvedValue({ ok: false, error: "That task isn't yours to complete." });
    render(<Face rec={record({ open: [task()] })} />);
    await user.click(box("Order the grilles"));
    expect(await screen.findByText("That task isn't yours to complete.")).toBeInTheDocument();
    // the words land first; the tick is taken back as the action's scope settles
    await waitFor(() => expect(group("Open 1")).toContainElement(box("Order the grilles")));
    expect(box("Order the grilles")).toHaveAttribute("aria-checked", "false");
    expect(screen.queryByRole("region", { name: /^Done/ })).toBeNull();
    expect(mockRouter.refresh).toHaveBeenCalledTimes(1);
  });

  it("says its own words when the action throws", async () => {
    const user = userEvent.setup();
    m(completeTask).mockRejectedValue(new Error("network"));
    render(<Face rec={record({ open: [task()] })} />);
    await user.click(box("Order the grilles"));
    expect(await screen.findByText("Couldn't complete that task.")).toBeInTheDocument();
  });
});

describe("who may do what", () => {
  /* Work you gave Luke that he finished: yours to read, his to take back. */
  it("gives a creator who is neither the assignee nor a manager no box and no Mark done", async () => {
    const user = userEvent.setup();
    render(
      <Face
        rec={record({
          open: [task({ id: "t2", title: "Luke's open one", assigneeId: LUKE, assigneeName: "Luke Ingold" })],
          done: [task({ assigneeId: LUKE, assigneeName: "Luke Ingold", status: "done", doneAt: "2026-09-22T01:00:00Z", doneById: LUKE })],
        })}
      />,
    );
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.getByRole("img", { name: "Done" })).toHaveClass("hd-tk-tick");
    await user.click(title("Luke's open one"));
    expect(screen.queryByRole("button", { name: "Mark done" })).toBeNull();
    // still theirs to move and to delete: they made it
    expect(screen.getByRole("button", { name: "Set due date" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete task" })).toBeInTheDocument();
  });

  it("offers Delete task to the creator or a manager, and to nobody else", async () => {
    const user = userEvent.setup();
    const lukes = task({ createdBy: LUKE, createdByName: "Luke Ingold" });
    const { unmount } = render(<Face rec={record({ open: [lukes] })} />);
    await user.click(title("Order the grilles"));
    expect(screen.queryByRole("button", { name: "Delete task" })).toBeNull();
    unmount();
    render(<Face rec={record({ open: [lukes] })} canManage />);
    await user.click(title("Order the grilles"));
    expect(screen.getByRole("button", { name: "Delete task" })).toBeInTheDocument();
  });

  it("offers Give it to only to a manager: you, then everyone else, never who has it", async () => {
    const user = userEvent.setup();
    const people = [
      { id: ME, name: "Isaac Smith" },
      { id: LUKE, name: "Luke Ingold" },
      { id: LEO, name: "Leo Park" },
    ];
    const rec = record({ open: [task({ assigneeId: LUKE, assigneeName: "Luke Ingold", createdBy: ME })] });
    const { unmount } = render(<Face rec={rec} assignable={people} />);
    await user.click(title("Order the grilles"));
    expect(screen.queryByRole("combobox", { name: "Give it to" })).toBeNull();
    unmount();

    m(giveTask).mockImplementation(out);
    render(<Face rec={rec} assignable={people} canManage />);
    await user.click(title("Order the grilles"));
    const give = screen.getByRole("combobox", { name: "Give it to" });
    expect([...give.querySelectorAll("option")].map((o) => o.textContent)).toEqual(["Give it to", "You", "Leo Park"]);
    await user.selectOptions(give, "Leo Park");
    expect(giveTask).toHaveBeenCalledWith("t1", LEO);
    // drawn as given while it is out
    expect(title("Order the grilles").closest(".hd-ls-row")!.querySelector(".hd-ls-tag")).toHaveTextContent("Leo");
  });

  it("gives nothing away on a done task", async () => {
    const user = userEvent.setup();
    render(
      <Face
        rec={record({ done: [task({ status: "done", doneAt: "2026-09-22T01:00:00Z", doneById: ME })] })}
        assignable={[{ id: LEO, name: "Leo Park" }]}
        canManage
      />,
    );
    await user.click(title("Order the grilles"));
    expect(screen.queryByRole("combobox", { name: "Give it to" })).toBeNull();
    expect(screen.queryByRole("button", { name: /due date/ })).toBeNull();
  });
});

describe("the due date", () => {
  it("says Set due date on a task with none, and Move due date on one with a date, which it moves", async () => {
    const user = userEvent.setup();
    m(setTaskDue).mockImplementation(out);
    render(<Face rec={record({ open: [task(), task({ id: "t2", title: "Dated", dueDate: "2026-10-02" })] })} />);
    await user.click(title("Order the grilles"));
    expect(screen.getByRole("button", { name: "Set due date" })).toBeInTheDocument();
    await user.click(title("Dated"));
    await user.click(screen.getByRole("button", { name: "Move due date" }));
    await user.click(screen.getByRole("button", { name: "Monday 5 October 2026" }));
    expect(setTaskDue).toHaveBeenCalledWith("t2", "2026-10-05");
    expect(title("Dated").closest(".hd-ls-row")).toHaveTextContent("Mon 5 Oct");
  });

  it("takes the date off with Clear", async () => {
    const user = userEvent.setup();
    m(setTaskDue).mockImplementation(out);
    render(<Face rec={record({ open: [task({ dueDate: "2026-10-02" })] })} />);
    await user.click(title("Order the grilles"));
    await user.click(screen.getByRole("button", { name: "Move due date" }));
    await user.click(screen.getByRole("button", { name: "Clear" }));
    expect(setTaskDue).toHaveBeenCalledWith("t1", null);
  });
});

describe("where it came from", () => {
  it("opens your own diary entry, and never someone else's", async () => {
    const user = userEvent.setup();
    const onOpenEntry = jest.fn();
    render(
      <Face
        rec={record({
          open: [task(), task({ id: "t2", title: "From Luke's diary" })],
          about: { t1: diary(), t2: diary({ noteId: "n2", authorId: LUKE, words: null }) },
        })}
        onOpenEntry={onOpenEntry}
      />,
    );
    await user.click(title("From Luke's diary"));
    expect(screen.queryByRole("button", { name: "Open in diary" })).toBeNull();
    await user.click(title("Order the grilles"));
    await user.click(screen.getByRole("button", { name: "Open in diary" }));
    expect(onOpenEntry).toHaveBeenCalledWith("n1", true);
  });

  it("offers Open conversation for a ServiceM8 task only once the desk has conversations to open", async () => {
    const user = userEvent.setup();
    const onOpenConversation = jest.fn();
    const rec = record({ open: [task()], about: { t1: sm8() } });
    const { unmount } = render(<Face rec={rec} />);
    await user.click(title("Order the grilles"));
    expect(screen.queryByRole("button", { name: "Open conversation" })).toBeNull();
    unmount();
    render(<Face rec={rec} onOpenConversation={onOpenConversation} />);
    await user.click(title("Order the grilles"));
    await user.click(screen.getByRole("button", { name: "Open conversation" }));
    expect(onOpenConversation).toHaveBeenCalledWith("note-1", true);
  });
});

describe("deleting it", () => {
  it("asks twice, with focus on Keep, and Keep puts focus back on Delete task", async () => {
    const user = userEvent.setup();
    render(<Face rec={record({ open: [task()] })} />);
    await user.click(title("Order the grilles"));
    await user.click(screen.getByRole("button", { name: "Delete task" }));
    expect(deleteTask).not.toHaveBeenCalled();
    expect(screen.getByRole("group", { name: "Delete for good?" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Keep" })).toHaveFocus();
    await user.click(screen.getByRole("button", { name: "Keep" }));
    expect(screen.queryByRole("group", { name: "Delete for good?" })).toBeNull();
    expect(screen.getByRole("button", { name: "Delete task" })).toHaveFocus();
  });

  it("deletes on the second press, and the row goes at once", async () => {
    const user = userEvent.setup();
    m(deleteTask).mockImplementation(out);
    render(<Face rec={record({ open: [task(), task({ id: "t2", title: "Ring the Hilux dealer" })] })} />);
    await user.click(title("Order the grilles"));
    await user.click(screen.getByRole("button", { name: "Delete task" }));
    await user.click(screen.getByRole("button", { name: "Delete" }));
    expect(deleteTask).toHaveBeenCalledWith("t1");
    expect(screen.queryByRole("button", { name: "Order the grilles" })).toBeNull();
    expect(screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual(["Open 1"]);
  });

  it("brings the row back, saying why, when the delete is refused", async () => {
    const user = userEvent.setup();
    m(deleteTask).mockResolvedValue({ ok: false, error: "That task isn't yours to delete." });
    render(<Face rec={record({ open: [task()] })} />);
    await user.click(title("Order the grilles"));
    await user.click(screen.getByRole("button", { name: "Delete task" }));
    await user.click(screen.getByRole("button", { name: "Delete" }));
    expect(await screen.findByText("That task isn't yours to delete.")).toBeInTheDocument();
    expect(title("Order the grilles")).toBeInTheDocument();
  });
});

describe("a door from another face", () => {
  let scrolled: HTMLElement[];
  beforeEach(() => {
    scrolled = [];
    Element.prototype.scrollIntoView = jest.fn(function (this: HTMLElement) {
      scrolled.push(this);
    });
  });

  it("opens the row it names, brings it into view, lights it once, and hands the door back", async () => {
    jest.useFakeTimers();
    try {
      const onFocusHandled = jest.fn();
      const rec = record({ open: [task({ id: "t0", title: "Ring the Hilux dealer" }), task()] });
      const { rerender } = render(<Face rec={rec} focusTaskId="t1" onFocusHandled={onFocusHandled} />);
      expect(title("Order the grilles")).toHaveAttribute("aria-expanded", "true");
      expect(title("Ring the Hilux dealer")).toHaveAttribute("aria-expanded", "false");
      const row = title("Order the grilles").closest(".hd-ls-row")!;
      expect(row).toHaveAttribute("data-lit");
      expect(scrolled.map((el) => el.dataset.thing)).toEqual(["t1"]);
      act(() => jest.advanceTimersByTime(FLASH_MS));
      expect(onFocusHandled).toHaveBeenCalledTimes(1);
      // the desk takes the door back; the row stays open, no longer lit
      rerender(<Face rec={rec} focusTaskId={null} onFocusHandled={onFocusHandled} />);
      expect(row).not.toHaveAttribute("data-lit");
      expect(title("Order the grilles")).toHaveAttribute("aria-expanded", "true");
    } finally {
      jest.useRealTimers();
    }
  });

  /* The desk clears the door once it has been shown, so the same door
     pressed again arrives as null, then the task: a second press, which
     must open the row again even after it was closed by hand. */
  it("opens the row again when the same door is pressed again", async () => {
    const user = userEvent.setup();
    const rec = record({ open: [task()] });
    const { rerender } = render(<Face rec={rec} focusTaskId="t1" />);
    rerender(<Face rec={rec} focusTaskId={null} />);
    await user.click(title("Order the grilles"));
    expect(title("Order the grilles")).toHaveAttribute("aria-expanded", "false");
    rerender(<Face rec={rec} focusTaskId="t1" />);
    expect(title("Order the grilles")).toHaveAttribute("aria-expanded", "true");
  });
});

describe("the box", () => {
  it("is the one entry box, in the room Tasks", () => {
    render(<Face rec={record()} />);
    expect(screen.getByRole("textbox", { name: "Add a task" })).toHaveClass("tm-in");
    expect(screen.getByRole("button", { name: "Talk to Tiff" })).toHaveAttribute("data-room", "tasks");
  });

  it("saves the words as your task, and lights it as it arrives", async () => {
    const user = userEvent.setup();
    m(addTask).mockResolvedValue({ ok: true, taskId: "t9" });
    const { rerender } = render(<Face rec={record({ open: [task()] })} />);
    await user.type(screen.getByRole("textbox", { name: "Add a task" }), "Call the strata manager");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(addTask).toHaveBeenCalledWith("Call the strata manager");
    expect(screen.getByRole("textbox", { name: "Add a task" })).toHaveValue("");
    rerender(<Face rec={record({ open: [task(), task({ id: "t9", title: "Call the strata manager" })] })} />);
    expect(title("Call the strata manager").closest(".hd-ls-row")).toHaveAttribute("data-lit");
    expect(title("Order the grilles").closest(".hd-ls-row")).not.toHaveAttribute("data-lit");
  });

  it("keeps the words and says why when the save is refused", async () => {
    const user = userEvent.setup();
    m(addTask).mockResolvedValue({ ok: false, error: "Couldn't save that task." });
    render(<Face rec={record()} />);
    await user.type(screen.getByRole("textbox", { name: "Add a task" }), "Call the strata manager");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't save that task.");
    expect(screen.getByRole("textbox", { name: "Add a task" })).toHaveValue("Call the strata manager");
  });

  it("takes the words to Tiff, said on Tasks, with Sort it out and with Enter", async () => {
    const user = userEvent.setup();
    render(<Face rec={record()} />);
    const field = screen.getByRole("textbox", { name: "Add a task" });
    await user.type(field, "Luke to order grilles by Friday");
    await user.click(screen.getByRole("button", { name: "Sort it out" }));
    expect(tiffOpen).toHaveBeenLastCalledWith(
      expect.objectContaining({ words: "Luke to order grilles by Friday", room: "tasks" }),
    );
    await user.type(field, "Book 3323 Randwick{Enter}");
    expect(tiffOpen).toHaveBeenLastCalledWith(expect.objectContaining({ words: "Book 3323 Randwick", room: "tasks" }));
    expect(addTask).not.toHaveBeenCalled();
  });

  it("lights what Tiff has just filed", () => {
    render(
      <Face
        rec={record({ open: [task(), task({ id: "t2", title: "Ring the Hilux dealer" })] })}
        landed={{ noteIds: ["n1"], ids: ["t2"] }}
      />,
    );
    expect(title("Ring the Hilux dealer").closest(".hd-ls-row")).toHaveAttribute("data-lit");
    expect(title("Order the grilles").closest(".hd-ls-row")).not.toHaveAttribute("data-lit");
  });
});
