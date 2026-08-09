import { render, screen } from "@testing-library/react";
import { HomeTasks } from "../home-tasks";
import { todayInAu } from "@/lib/au-dates";
import type { DashTask } from "@/lib/dashboard/tasks";

jest.mock("next/navigation", () => ({ useRouter: () => ({ refresh: jest.fn() }) }));
jest.mock("@/app/actions/dashboard", () => ({
  completeTask: jest.fn(),
  createTask: jest.fn(),
  reopenTask: jest.fn(),
}));

/* "Recently done" compares a task's completion against `today`, which is an AU
   calendar date. done_at is a timestamp, so it has to be resolved to an AU day
   as well — reading it in UTC puts anything finished before ~10am AEST on the
   previous date, which is most of a working morning, every day. */

const doneTask = (doneAt: string): DashTask => ({
  id: "t1",
  title: "Renew the WHS induction",
  detail: null,
  assigneeId: "s1",
  assigneeName: "Isaac Smith",
  dueDate: null,
  status: "done",
  createdBy: "s1",
  createdAt: "2026-07-20T00:00:00Z",
  doneAt,
  doneByName: "Isaac Smith",
});

const renderDone = (doneAt: string, today: string) =>
  render(
    <HomeTasks
      today={today}
      mine={[]}
      team={null}
      done={[doneTask(doneAt)]}
      reported={[]}
      viewerStaffId="s1"
      canManage={false}
      assignable={[]}
    />,
  );

describe("doneLabel — AU calendar day", () => {
  it("reads 'Done today' for a task finished this morning in the yard", () => {
    // 8:00am Sat 25 Jul 2026 in Sydney (AEST, UTC+10) = 22:00 Fri 24 Jul UTC
    const doneAt = "2026-07-24T22:00:00Z";
    expect(todayInAu(new Date(doneAt))).toBe("2026-07-25");

    renderDone(doneAt, "2026-07-25");
    expect(screen.getByText("Done today")).toBeInTheDocument();
  });

  it("still reads 'Done today' later the same AU day", () => {
    const doneAt = "2026-07-25T10:00:00Z"; // 8pm Sydney
    renderDone(doneAt, "2026-07-25");
    expect(screen.getByText("Done today")).toBeInTheDocument();
  });

  it("names the AU day for something finished earlier in the week", () => {
    // 9:00am Wed 22 Jul in Sydney = 23:00 Tue 21 Jul UTC — the label must say
    // the 22nd (the day it happened here), not the 21st
    renderDone("2026-07-21T23:00:00Z", "2026-07-25");
    expect(screen.getByText("Done 22 July")).toBeInTheDocument();
  });
});
