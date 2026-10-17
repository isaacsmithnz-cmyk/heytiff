import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { TaskForm } from "../task-form";
import { WindowsContext } from "@/components/records/records-context";
import { addTask, deleteTask, setTaskDue } from "@/app/actions/dashboard";

/* New › Task (rules 44 and 51): what needs doing and when; saving keeps
   you where you were, with a toast and Undo. */

jest.mock("@/app/actions/dashboard", () => ({
  addTask: jest.fn(async () => ({ ok: true, taskId: "t1" })),
  setTaskDue: jest.fn(async () => ({ ok: true })),
  deleteTask: jest.fn(async () => ({ ok: true })),
}));

const toast = jest.fn();
const host = { toast } as never;

const draw = (onClose = jest.fn()) => {
  render(
    <WindowsContext.Provider value={host}>
      <TaskForm onClose={onClose} />
    </WindowsContext.Provider>,
  );
  return onClose;
};

afterEach(() => {
  cleanup();
  jest.clearAllMocks();
});

describe("New › Task", () => {
  it("opens empty: nothing is filled in", () => {
    draw();
    expect(screen.getByRole("dialog", { name: "New task" })).toBeInTheDocument();
    expect(screen.getByLabelText("What needs doing")).toHaveValue("");
  });

  it("says why it won't save without words, on the field", async () => {
    const onClose = draw();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Add task" })));
    expect(screen.getByText("Say what needs doing.")).toBeInTheDocument();
    expect(screen.getByLabelText("What needs doing")).toHaveAttribute("aria-invalid", "true");
    expect(addTask).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("adds the task, closes, and offers Undo in a toast", async () => {
    const onClose = draw();
    fireEvent.change(screen.getByLabelText("What needs doing"), { target: { value: "Order the return air box" } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Add task" })));
    expect(addTask).toHaveBeenCalledWith("Order the return air box");
    expect(setTaskDue).not.toHaveBeenCalled();
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(toast).toHaveBeenCalledWith("Task added", expect.any(Function));
    await toast.mock.calls[0][1]();
    expect(deleteTask).toHaveBeenCalledWith("t1");
  });

  it("says what went wrong and stays open when the save fails", async () => {
    (addTask as jest.Mock).mockResolvedValueOnce({ ok: false, error: "Couldn't save that task." });
    const onClose = draw();
    fireEvent.change(screen.getByLabelText("What needs doing"), { target: { value: "x" } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Add task" })));
    expect(screen.getByText("Couldn't save that task.")).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });
});
