import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { JobVisitTasks, type VisitDay } from "../job-visit-tasks";
import type { JobTask, TaskUpdate } from "@/lib/workboard/visit-tasks";

/* Isaac, 2026-10-06, on the mock-up of 2905: "yes thats right, build it" */

const task = (id: string, name: string, over: Partial<JobTask> = {}): JobTask => ({
  id,
  name,
  stage: "Rough-in",
  kind: "tick",
  unit: null,
  visit: 1,
  sort: 0,
  progress: 0,
  doneAt: null,
  doneBy: null,
  serial: null,
  modelRead: null,
  source: "quote",
  ...over,
});
const up = (taskId: string, day: string, from: number, to: number, note = "", by = "Callum Vrieze"): TaskUpdate => ({ id: `${taskId}-${day}`, taskId, day, from, to, note, by, at: `${day}T05:00:00Z` });
const day = (d: string, over: Partial<VisitDay> = {}): VisitDay => ({ day: d, crew: ["Callum Vrieze", "Alex Morozoff"], crewNode: "Callum Vrieze, Alex Morozoff", length: "Full day", hours: "16h", onSite: false, ...over });

const TASKS = [
  task("pen", "Garage penetrations", { progress: 100, sort: 0 }),
  task("rough", "Rough-in pipe and cable", { kind: "progress", progress: 50, sort: 1 }),
  task("drains", "Drains for Level 3", { visit: 2, sort: 2 }),
  task("comm", "Commission the system", { stage: "Commissioning", visit: null, sort: 3 }),
];
const UPDATES = [up("pen", "2026-10-06", 0, 100), up("rough", "2026-10-06", 0, 50, "Roughed in to the third indoor unit.")];

let fetchMock: jest.Mock;
const sent = (method: string) => (fetchMock.mock.calls as [string, { method?: string; body?: string }?][]).filter(([, i]) => i?.method === method).map(([, i]) => JSON.parse(i!.body!));
const answer = (over: Record<string, unknown> = {}) => ({ ok: true, tasks: TASKS, updates: UPDATES, today: "2026-10-07", canMake: false, manage: true, ...over });

beforeEach(() => {
  fetchMock = jest.fn(async (_url: string, init?: { method?: string }) => ({ json: async () => (init?.method ? answer() : answer()) }));
  (global as unknown as { fetch: unknown }).fetch = fetchMock;
});

const mount = (over: Partial<Parameters<typeof JobVisitTasks>[0]> = {}) =>
  render(
    <JobVisitTasks
      job="job-1"
      visible
      onSite={[day("2026-05-26", { crew: ["Michael Diamond"], crewNode: "Michael Diamond", length: "Pop-in", hours: "2h" }), day("2026-10-06"), day("2026-10-07", { onSite: true, hours: "4h" })]}
      ahead={[day("2026-10-12", { crewNode: null, length: null, hours: null })]}
      workOrderDate="2026-09-29 00:00:00"
      onSiteWords="22h on site"
      emptyWords="Nobody's been on site yet, and nothing is booked."
      {...over}
    />
  );

const card = (name: string) => screen.getAllByRole("listitem").find((li) => within(li).queryByText(name, { selector: "b" }))!;

it("lays the visits out from the work order, each with what was done on it and what's still to do", async () => {
  mount();
  expect(await screen.findByText("Carried to visit 2")).toBeInTheDocument();
  /* the site measure before the work order is a site visit, not counted */
  expect(within(card("Site visit")).getByText("Pop-in")).toBeInTheDocument();
  const v1 = within(card("Visit 1"));
  expect(v1.getByText("Done")).toBeInTheDocument();
  expect(v1.getByRole("checkbox", { name: "Garage penetrations: done" })).toBeDisabled();
  expect(v1.getByRole("checkbox", { name: "Rough-in pipe and cable: 50%" })).toBeInTheDocument();
  expect(v1.getByText("Carried to visit 2")).toBeInTheDocument();
  expect(v1.getByText("Roughed in to the third indoor unit.")).toBeInTheDocument();
  const v2 = within(card("Visit 2"));
  expect(v2.getByText("On site now")).toBeInTheDocument();
  expect(v2.getByText("From visit 1")).toBeInTheDocument();
  expect(v2.getByRole("checkbox", { name: "Drains for Level 3: not done" })).toBeEnabled();
  expect(within(card("Visit 3")).getByText("Booked")).toBeInTheDocument();
  /* a task on no visit waits underneath */
  expect(screen.getByText("Not on a visit yet")).toBeInTheDocument();
  expect(screen.getByText("3 visits, 22h on site, 1 of 4 tasks done")).toBeInTheDocument();
});

it("ticks a task done on today's visit", async () => {
  mount();
  const box = await screen.findByRole("checkbox", { name: "Drains for Level 3: not done" });
  await act(async () => {
    fireEvent.click(box);
  });
  expect(sent("PUT")).toEqual([{ job: "job-1", edit: { kind: "progress", id: "drains", to: 100, note: "" } }]);
});

it("opens a task measured in % to say how far it got today, with a note, and what each visit did", async () => {
  mount();
  fireEvent.click(await within(card("Visit 2")).findByRole("checkbox", { name: "Rough-in pipe and cable: 50%" }));
  expect(screen.getByText("Today, visit 2")).toBeInTheDocument();
  expect(screen.getByText("0% to 50%")).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("How far, percent"), { target: { value: "70" } });
  fireEvent.change(screen.getByLabelText("Note"), { target: { value: "Level 3 risers in." } });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Save 70%" }));
  });
  expect(sent("PUT")).toEqual([{ job: "job-1", edit: { kind: "progress", id: "rough", to: 70, note: "Level 3 risers in." } }]);
  fireEvent.click(screen.getByRole("button", { name: "Visits" }));
  expect(await screen.findByText("Visit 1")).toBeInTheDocument();
});

it("shows the same tasks as one list by the quote's stages, and puts a loose one on a visit", async () => {
  mount();
  fireEvent.click(await screen.findByRole("radio", { name: "All tasks" }));
  expect(screen.getByText("Commissioning", { selector: "b" })).toBeInTheDocument();
  expect(screen.getByText("Visits 1 and 2")).toBeInTheDocument();
  await act(async () => {
    fireEvent.change(screen.getByLabelText("Add Commission the system to a visit"), { target: { value: "3" } });
  });
  expect(sent("PUT")).toEqual([{ job: "job-1", edit: { kind: "visit", id: "comm", visit: 3 } }]);
});

it("offers a manager the tasks from the accepted quote when there are none, and draws them once Tiff has written them", async () => {
  fetchMock.mockImplementation(async (_url: string, init?: { method?: string }) => ({
    json: async () => (init?.method === "POST" ? answer() : answer({ tasks: [], updates: [], canMake: true })),
  }));
  mount();
  const make = await screen.findByRole("button", { name: "Make the tasks from the quote" });
  await act(async () => {
    fireEvent.click(make);
  });
  expect(sent("POST")).toEqual([{ job: "job-1", make: true }]);
  expect(await screen.findByText("Garage penetrations")).toBeInTheDocument();
});

it("reads nothing until the face is open, and says so when there's nothing at all", async () => {
  const { rerender } = mount({ visible: false, onSite: [], ahead: [] });
  expect(fetchMock).not.toHaveBeenCalled();
  expect(screen.getByText("Nobody's been on site yet, and nothing is booked.")).toBeInTheDocument();
  rerender(
    <JobVisitTasks job="job-1" visible onSite={[]} ahead={[]} workOrderDate={null} onSiteWords={null} emptyWords="Nobody's been on site yet, and nothing is booked." />
  );
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
});
