import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { TaskForm } from "../task-form";
import { WindowsContext } from "@/components/records/records-context";
import { completeTask, deleteTask, makeTasks, readTaskForEdit, taskPeople, updateTask, type TaskForEdit } from "@/app/actions/dashboard";

/* New › Task and a job's Add › Task (rules 44 and 51): what needs doing,
   the job (filled in on a job's page, clearable), when, and who; saving
   keeps you where you were, with a toast and Undo. */

jest.mock("@/app/actions/dashboard", () => ({
  makeTasks: jest.fn(async () => ({ ok: true, taskIds: ["t1"] })),
  deleteTask: jest.fn(async () => ({ ok: true })),
  taskPeople: jest.fn(async () => ({ me: "s-me", people: [] })),
  readTaskForEdit: jest.fn(),
  updateTask: jest.fn(async () => ({ ok: true })),
  completeTask: jest.fn(async () => ({ ok: true })),
  reopenTask: jest.fn(async () => ({ ok: true })),
}));
jest.mock("@/app/actions/palette", () => ({
  searchPalette: jest.fn(async () => ({
    staff: [],
    clients: [],
    projects: [],
    photos: [],
    jobs: [{ remoteId: "j-3342", jobNumber: "3342", clientName: "Rifkin", suburb: "Bellevue Hill" }],
  })),
}));

const toast = jest.fn();
const draw = (job: { uuid: string; label: string } | null = null, onClose = jest.fn()) => {
  render(
    <WindowsContext.Provider value={{ toast } as never}>
      <TaskForm job={job} onClose={onClose} />
    </WindowsContext.Provider>,
  );
  return onClose;
};
const say = (words: string) => fireEvent.change(screen.getByLabelText("What needs doing"), { target: { value: words } });

afterEach(() => {
  cleanup();
  jest.clearAllMocks();
});

describe("the task form", () => {
  it("from anywhere but a job: a general task for you", async () => {
    const onClose = draw();
    await act(async () => {});
    expect(screen.getByPlaceholderText("None, a general task")).toBeInTheDocument();
    say("Order the grilles");
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Add task" })));
    expect(makeTasks).toHaveBeenCalledWith({ text: "Order the grilles", jobUuid: null, dueDate: null, dueTime: null, forStaffId: "s-me", anyone: false });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(toast).toHaveBeenCalledWith("Task added", expect.any(Function));
    await toast.mock.calls[0][1]();
    expect(deleteTask).toHaveBeenCalledWith("t1");
  });

  it("on a job's page: the job is filled in, and saving puts the task on it", async () => {
    draw({ uuid: "j-3209", label: "3209 Richards" });
    await act(async () => {});
    expect(screen.getByText("3209 Richards")).toBeInTheDocument();
    say("Order the grilles");
    (makeTasks as jest.Mock).mockResolvedValueOnce({ ok: true, taskIds: ["t1"], jobKept: true });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Add task" })));
    /* a job's task is anyone's until someone is chosen (Isaac, 24 October 2026) */
    expect((makeTasks as jest.Mock).mock.calls[0][0]).toMatchObject({ jobUuid: "j-3209", anyone: true, forStaffId: null });
    expect(toast).toHaveBeenCalledWith("Task added to 3209 Richards", expect.any(Function));
  });

  it("clears the job to make it a general task, and can find another", async () => {
    draw({ uuid: "j-3209", label: "3209 Richards" });
    await act(async () => {});
    fireEvent.click(screen.getByRole("button", { name: "Clear the job" }));
    expect(screen.queryByText("3209 Richards")).toBeNull();
    jest.useFakeTimers();
    fireEvent.change(screen.getByPlaceholderText("None, a general task"), { target: { value: "Rifkin" } });
    await act(async () => {
      jest.advanceTimersByTime(300);
    });
    jest.useRealTimers();
    await act(async () => {});
    fireEvent.click(screen.getByRole("button", { name: "Job 3342, Rifkin, Bellevue Hill" }));
    expect(screen.getByText("Job 3342, Rifkin, Bellevue Hill")).toBeInTheDocument();
  });

  it("makes one task a line, says how many, and Undo takes them all back", async () => {
    draw({ uuid: "j-3209", label: "3209 Richards" });
    await act(async () => {});
    say("Order the grilles\nBook the crane\n\nCall Rifkin");
    expect(screen.getByRole("button", { name: "Add 3 tasks" })).toBeInTheDocument();
    (makeTasks as jest.Mock).mockResolvedValueOnce({ ok: true, taskIds: ["a", "b", "c"], jobKept: true });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Add 3 tasks" })));
    expect(toast).toHaveBeenCalledWith("3 tasks added to 3209 Richards", expect.any(Function));
    await toast.mock.calls[0][1]();
    expect((deleteTask as jest.Mock).mock.calls.map((c) => c[0])).toEqual(["a", "b", "c"]);
  });

  it("asks who only of someone who may give work", async () => {
    draw();
    await act(async () => {});
    expect(screen.queryByText("Who")).toBeNull();
    cleanup();
    (taskPeople as jest.Mock).mockResolvedValueOnce({ me: "s-me", people: [{ id: "s-me", name: "Isaac Smith" }, { id: "s-lyle", name: "Lyle Irving" }] });
    draw();
    await act(async () => {});
    expect(screen.getByText("Who")).toBeInTheDocument();
    expect(screen.getByText("Isaac Smith, you")).toBeInTheDocument();
  });

  it("says why it won't save without words, and stays open", async () => {
    const onClose = draw();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Add task" })));
    expect(screen.getByText("Say what needs doing.")).toBeInTheDocument();
    expect(makeTasks).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
});

/* Add date, then Add time (Isaac, 24 October 2026): a day alone is due any
   time that day; a time comes only when Add time is pressed */
describe("when a task is due", () => {
  it("adds a date first, and a time only once there is a date", async () => {
    draw();
    await act(async () => {});
    expect(screen.queryByRole("button", { name: "Add time" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Add date" }));
    expect(screen.queryByRole("button", { name: "Add date" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Add time" })).toBeNull();
  });
});

/* A TASK OPENS ITS OWN FORM (Isaac, 24 October 2026) */
describe("an existing task's form", () => {
  const task: TaskForEdit = {
    id: "t9",
    title: "Proceed with 3450 Kingsford as do and charge",
    job: null,
    suggestedJob: { uuid: "j-3450", label: "3450 Kingsford" },
    assigneeId: null,
    dueDate: "2026-10-30",
    dueTime: null,
    done: null,
    madeBy: "Luke Ingold",
    madeAt: "2026-10-23T20:01:11Z",
    mayGive: true,
  };
  const open = async (over: Partial<TaskForEdit> = {}) => {
    (readTaskForEdit as jest.Mock).mockResolvedValue({ ok: true, task: { ...task, ...over } });
    render(
      <WindowsContext.Provider value={{ toast } as never}>
        <TaskForm taskId="t9" onClose={jest.fn()} />
      </WindowsContext.Provider>,
    );
    await act(async () => {});
  };

  it("fills in the task, the job its words name, Anyone, its date, and Add time beside it", async () => {
    await open();
    expect(screen.getByRole("heading", { name: "Task" })).toBeInTheDocument();
    expect(screen.getByLabelText("What needs doing")).toHaveValue(task.title);
    expect(screen.getByText("3450 Kingsford")).toBeInTheDocument();
    expect(screen.getByText("Anyone")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add time" })).toBeInTheDocument();
    expect(screen.getByText(/Made by Luke Ingold/)).toBeInTheDocument();
  });

  it("saves the job and Anyone, and ticks it done", async () => {
    await open();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Save" })));
    expect(updateTask).toHaveBeenCalledWith("t9", expect.objectContaining({ jobUuid: "j-3450", anyone: true, dueDate: "2026-10-30", dueTime: null }));
    cleanup();
    await open();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Mark done" })));
    expect(completeTask).toHaveBeenCalledWith("t9", { postDone: true });
  });

  it("says who ticked a done task and when, and deletes on Delete", async () => {
    await open({ done: { by: "Luke Ingold", at: "2026-10-24T03:10:00Z" } });
    expect(screen.getByText(/Done by Luke Ingold/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Not done yet" })).toBeInTheDocument();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Delete" })));
    expect(deleteTask).toHaveBeenCalledWith("t9");
  });
});
