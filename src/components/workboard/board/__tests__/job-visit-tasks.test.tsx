import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
const uploadFile = jest.fn();
const attachJobDocument = jest.fn();
jest.mock("@/lib/documents/upload-client", () => ({ uploadFile: (...a: unknown[]) => uploadFile(...a) }));
jest.mock("@/app/actions/job-documents", () => ({ attachJobDocument: (...a: unknown[]) => attachJobDocument(...a) }));

import { JobVisits, VisitDialog, type ComingVisit, type PastVisit } from "../job-visit-tasks";
import type { JobTask, TaskUpdate } from "@/lib/workboard/visit-tasks";

/* Isaac's mock of 25 October 2026, frames 1 to 4 (job 2043 JT Construct):
   "now I think we're ready to build" */

const task = (id: string, name: string, over: Partial<JobTask> = {}): JobTask => ({
  id,
  name,
  stage: "Commissioning",
  kind: "tick",
  unit: null,
  visit: 9,
  sort: 0,
  progress: 0,
  serial: null,
  modelRead: null,
  source: "quote",
  ...over,
});
const up = (taskId: string, day: string, from: number, to: number, by: string, at: string): TaskUpdate => ({ id: `${taskId}-${at}`, taskId, day, from, to, note: "", by, at });

const ID = (n: number) => `6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a${String(n).padStart(2, "0")}`;
const TASKS = [
  task(ID(1), "Wire the five wall controllers", { stage: "Fit-off", progress: 100, sort: 0 }),
  task(ID(2), "Pressure test and evacuate the PUMY system", { progress: 50, sort: 1 }),
  task(ID(3), "Charge and commission the PUMY-P200", { sort: 2 }),
  task(ID(4), "Show the builder the controllers", {
    stage: "Return",
    sort: 3,
    issue: { note: "Builder's not on site till Monday", by: "David Hann", at: "2026-11-05T02:20:00Z", photo: null },
  }),
  task(ID(5), "Fit the bulkhead grilles upstairs", { stage: "Fit-off", visit: null, hours: 3, sort: 4 }),
  task(ID(6), "Fit the return air grille", { stage: "Fit-off", visit: 12, hours: 1, sort: 5 }),
  task(ID(7), "Balance the zones", { visit: null, hours: 2, sort: 6 }),
];
/* Sydney is 11 hours ahead in November: 9:40am and 11:15am there */
const UPDATES = [
  up(ID(1), "2026-11-05", 0, 100, "Louis Jones", "2026-11-04T22:40:00Z"),
  up(ID(2), "2026-11-05", 0, 50, "Leonardo Martins", "2026-11-05T00:15:00Z"),
];

const COMING: ComingVisit[] = [
  {
    key: "thu",
    start: "2026-11-05 07:00:00",
    end: "2026-11-05 15:00:00",
    crew: [
      { name: "Louis Jones", title: "HVAC" },
      { name: "Leonardo Martins", title: "HVAC" },
      { name: "David Hann", title: "Skilled TA" },
    ],
  },
  {
    key: "mon",
    start: "2026-11-09 07:00:00",
    end: "2026-11-09 15:00:00",
    crew: [
      { name: "Louis Jones", title: "HVAC" },
      { name: "Leonardo Martins", title: "HVAC" },
    ],
  },
];
/* eight days on site, newest first */
const PAST: PastVisit[] = [
  { day: "2026-10-21", crew: ["Louis Jones"], minutes: 328 },
  { day: "2026-09-25", crew: ["Isaac Smith"], minutes: 0 },
  { day: "2026-09-24", crew: ["David Hann"], minutes: 425 },
  { day: "2026-09-15", crew: ["Louis Jones"], minutes: 0 },
  { day: "2026-09-09", crew: ["Isaac Smith"], minutes: 0 },
  { day: "2026-08-21", crew: ["Callum Vrieze", "Leonardo Martins", "Louis Jones"], minutes: 480 },
  { day: "2026-08-14", crew: ["Louis Jones"], minutes: 60 },
  { day: "2026-08-12", crew: ["Louis Jones"], minutes: 60 },
];

let fetchMock: jest.Mock;
const sent = (method: string) => (fetchMock.mock.calls as [string, { method?: string; body?: string }?][]).filter(([, i]) => i?.method === method).map(([, i]) => JSON.parse(i!.body!));
const answer = (over: Record<string, unknown> = {}) => ({ ok: true, tasks: TASKS, updates: UPDATES, photos: [], today: "2026-11-05", booked: [], quoted: null, canMake: false, manage: true, note: null, ...over });
const answering = (over: Record<string, unknown> = {}) => fetchMock.mockImplementation(async () => ({ json: async () => answer(over) }));

beforeEach(() => {
  fetchMock = jest.fn(async () => ({ json: async () => answer() }));
  (global as unknown as { fetch: unknown }).fetch = fetchMock;
});

const onOpen = jest.fn();
const onBook = jest.fn();
const mount = (over: Partial<Parameters<typeof JobVisits>[0]> = {}) =>
  render(
    <JobVisits
      job="job-1"
      visible
      client="JT Construct"
      zone="Australia/Sydney"
      coming={COMING}
      previous={PAST}
      workOrderDate="2026-08-01 00:00:00"
      onBook={onBook}
      onOpen={onOpen}
      {...over}
    />
  );

const visitCard = (day: RegExp) => screen.getAllByRole("button").find((b) => b.classList.contains("jv-card") && day.test(b.textContent ?? ""))!;
const onTheDay = () => within(screen.getByRole("list", { name: "Tasks, Thu 5 Nov" }));
const plan = () => within(screen.getByRole("region", { name: "Tasks to plan" }));
const settle = () => act(async () => {});

describe("coming up", () => {
  it("draws each visit as the Schedule does: its date in a block, its time, its people as initials only, and what its tasks come to", async () => {
    mount();
    expect(await screen.findByText("1 of 4 done")).toBeInTheDocument();
    const thu = visitCard(/^Thu5Nov/);
    expect(thu).toHaveClass("today");
    expect(within(thu).getByText("7am to 3pm")).toBeInTheDocument();
    expect(within(thu).getByText("Today")).toBeInTheDocument();
    /* initials in discs, the name the disc's label, never written beside it */
    expect(within(thu).getByRole("img", { name: "David Hann" })).toHaveTextContent("DH");
    expect(within(thu).queryByText("David Hann")).toBeNull();
    const mon = visitCard(/^Mon9Nov/);
    expect(mon).not.toHaveClass("today");
    expect(within(mon).queryByText(/task/)).toBeNull();
    /* the one blue button */
    fireEvent.click(screen.getByRole("button", { name: "Book a visit" }));
    expect(onBook).toHaveBeenCalled();
  });

  it("opens a visit pressed", async () => {
    mount();
    await screen.findByText("1 of 4 done");
    fireEvent.click(visitCard(/^Mon9Nov/));
    expect(onOpen).toHaveBeenCalledWith("mon");
  });

  it("says a day's tasks once, on the next visit when none is today", async () => {
    answering({ today: "2026-10-25" });
    mount();
    expect(await screen.findByRole("list", { name: "Tasks, Thu 5 Nov" })).toBeInTheDocument();
    expect(visitCard(/^Thu5Nov/)).not.toHaveClass("today");
    expect(screen.queryByText("Today")).toBeNull();
  });

  it("says nothing is booked, with nothing else on the left", async () => {
    mount({ coming: [], previous: [] });
    expect(await screen.findByText("Nothing booked yet.")).toBeInTheDocument();
    expect(screen.queryByText("Previous")).toBeNull();
    for (const gone of ["Next on site", "Check in", "By visit", "All tasks", "Not on a visit yet", "Measured in %"]) expect(screen.queryByText(gone)).toBeNull();
  });
});

describe("on the day", () => {
  it("says who did each and when, greys what's done, and puts one control on the right of the rest", async () => {
    mount();
    await screen.findByText("1 of 4 done");
    const day = onTheDay();
    expect(day.getByText("Done, Louis Jones, 9:40am")).toBeInTheDocument();
    expect(day.getByRole("checkbox", { name: "Wire the five wall controllers" })).toBeChecked();
    expect(day.getByText("Started, Leonardo Martins, 11:15am")).toBeInTheDocument();
    expect(day.getByRole("button", { name: "50%" })).toBeInTheDocument();
    expect(day.getByRole("button", { name: "Started" })).toBeInTheDocument();
    expect(day.getByRole("button", { name: "Issue" })).toHaveClass("jv-issue");
    expect(day.getByText("David Hann, 1:20pm: “Builder's not on site till Monday”")).toBeInTheDocument();
    /* a done task has no control */
    expect(day.getAllByRole("button")).toHaveLength(3);
  });

  it("ticks a task done, and unticks it back to where it was", async () => {
    mount();
    await screen.findByText("1 of 4 done");
    await act(async () => {
      fireEvent.click(onTheDay().getByRole("checkbox", { name: "Charge and commission the PUMY-P200" }));
    });
    await act(async () => {
      fireEvent.click(onTheDay().getByRole("checkbox", { name: "Wire the five wall controllers" }));
    });
    expect(sent("PUT")).toEqual([
      { job: "job-1", edit: { kind: "progress", id: ID(3), to: 100, note: "" } },
      { job: "job-1", edit: { kind: "progress", id: ID(1), to: 0, note: "" } },
    ]);
  });

  it("says how far a task got from Started's menu", async () => {
    mount();
    await screen.findByText("1 of 4 done");
    fireEvent.click(onTheDay().getByRole("button", { name: "Started" }));
    const menu = within(screen.getByRole("menu"));
    expect(menu.getAllByRole("menuitem").map((m) => m.textContent)).toEqual(["Started, 25%", "Started, 50%", "Started, 75%", "Issue"]);
    await act(async () => {
      fireEvent.click(menu.getByRole("menuitem", { name: "Started, 75%" }));
    });
    expect(sent("PUT")).toEqual([{ job: "job-1", edit: { kind: "progress", id: ID(3), to: 75, note: "" } }]);
  });

  it("asks what's wrong for an Issue, with a photo put on the job, and saves it on the task", async () => {
    uploadFile.mockResolvedValue({ ok: true, file: { documentId: "7a1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4c", fileName: "b.jpg", mimeType: "image/jpeg", sizeBytes: 1, previewUrl: null } });
    attachJobDocument.mockResolvedValue({ ok: true });
    mount();
    await screen.findByText("1 of 4 done");
    fireEvent.click(onTheDay().getByRole("button", { name: "Started" }));
    fireEvent.click(within(screen.getByRole("menu")).getByRole("menuitem", { name: "Issue" }));
    const dialog = within(screen.getByRole("dialog", { name: "An issue with this task" }));
    expect(dialog.getByText("Charge and commission the PUMY-P200. Thu 5 Nov, JT Construct.")).toBeInTheDocument();
    expect(dialog.getByRole("button", { name: "Save issue" })).toBeDisabled();
    fireEvent.change(dialog.getByLabelText("What's wrong"), { target: { value: "No gas on site" } });
    const file = new File(["x"], "b.jpg", { type: "image/jpeg" });
    await act(async () => {
      fireEvent.change(dialog.getByText("Add a photo").closest("label")!.querySelector("input")!, { target: { files: [file] } });
    });
    expect(uploadFile).toHaveBeenCalledWith(file, "job_document");
    expect(attachJobDocument).toHaveBeenCalledWith("7a1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4c", "job-1");
    expect(dialog.getByText("b.jpg")).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(dialog.getByRole("button", { name: "Save issue" }));
    });
    expect(sent("PUT")).toEqual([{ job: "job-1", edit: { kind: "issue", id: ID(3), note: "No gas on site", documentId: "7a1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4c" } }]);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("clears an issue a task has", async () => {
    mount();
    await screen.findByText("1 of 4 done");
    fireEvent.click(onTheDay().getByRole("button", { name: "Issue" }));
    fireEvent.click(within(screen.getByRole("menu")).getByRole("menuitem", { name: "Issue" }));
    const dialog = within(screen.getByRole("dialog", { name: "An issue with this task" }));
    expect(dialog.getByLabelText("What's wrong")).toHaveValue("Builder's not on site till Monday");
    await act(async () => {
      fireEvent.click(dialog.getByRole("button", { name: "Clear the issue" }));
    });
    expect(sent("PUT")).toEqual([{ job: "job-1", edit: { kind: "issue", id: ID(4), note: "", documentId: null } }]);
  });
});

describe("tasks to plan", () => {
  it("lists the tasks not on a day under their stage, each with its hours, and no date", async () => {
    mount();
    await screen.findByText("1 of 4 done");
    const p = plan();
    /* the quote's order of stages: Fit-off, then Commissioning */
    expect(p.getAllByRole("checkbox").map((c) => c.closest("label")!.textContent)).toEqual([
      "Fit-off",
      "Fit the bulkhead grilles upstairs",
      "Fit the return air grille",
      "Commissioning",
      "Balance the zones",
    ]);
    expect(p.getByText("3 h")).toBeInTheDocument();
    /* a task on a day is under that visit, not here */
    expect(p.queryByText("Charge and commission the PUMY-P200")).toBeNull();
    expect(p.queryByText(/Nov|Oct/)).toBeNull();
  });

  it("ticks a whole stage, and adds every ticked task to the day picked, at once", async () => {
    mount();
    await screen.findByText("1 of 4 done");
    expect(plan().queryByRole("button", { name: "Add to a day" })).toBeNull();
    fireEvent.click(plan().getByRole("checkbox", { name: "Fit-off" }));
    expect(plan().getByText("2 tasks")).toBeInTheDocument();
    fireEvent.click(plan().getByRole("button", { name: "Add to a day" }));
    const menu = within(screen.getByRole("menu", { name: "Add to a day" }));
    expect(menu.getAllByRole("menuitem").map((m) => m.textContent)).toEqual(["Thu 5 Nov", "Mon 9 Nov"]);
    await act(async () => {
      fireEvent.click(menu.getByRole("menuitem", { name: "Mon 9 Nov" }));
    });
    /* Mon 9 Nov is the tenth day on site since the work order */
    expect(sent("PUT")).toEqual([{ job: "job-1", edit: { kind: "place", ids: [ID(5), ID(6)], visit: 10 } }]);
    await waitFor(() => expect(plan().queryByText("2 tasks")).toBeNull());
  });

  it("drags a task onto a visit, and the ticked ones with it", async () => {
    mount();
    await screen.findByText("1 of 4 done");
    const data = new Map<string, string>();
    const dataTransfer = { setData: (k: string, v: string) => data.set(k, v), getData: (k: string) => data.get(k) ?? "", get types() { return [...data.keys()]; }, effectAllowed: "" };
    fireEvent.click(plan().getByRole("checkbox", { name: "Balance the zones" }));
    const row = plan().getByText("Fit the bulkhead grilles upstairs").closest("li")!;
    expect(row).toHaveAttribute("draggable", "true");
    fireEvent.dragStart(row, { dataTransfer });
    await act(async () => {
      fireEvent.drop(visitCard(/^Thu5Nov/), { dataTransfer });
    });
    fireEvent.click(plan().getByRole("checkbox", { name: "Balance the zones" }));
    fireEvent.dragStart(plan().getByText("Balance the zones").closest("li")!, { dataTransfer });
    await act(async () => {
      fireEvent.drop(visitCard(/^Mon9Nov/), { dataTransfer });
    });
    expect(sent("PUT")).toEqual([
      { job: "job-1", edit: { kind: "place", ids: [ID(5)], visit: 9 } },
      { job: "job-1", edit: { kind: "place", ids: [ID(7)], visit: 10 } },
    ]);
  });

  it("adds a task by Enter, to the work itself (Install) and on no day", async () => {
    mount();
    await screen.findByText("1 of 4 done");
    const box = plan().getByRole("textbox", { name: "Add a task" });
    fireEvent.change(box, { target: { value: "Core hole, rear living" } });
    await act(async () => {
      fireEvent.keyDown(box, { key: "Enter" });
    });
    expect(sent("PUT")).toEqual([{ job: "job-1", edit: { kind: "add", name: "Core hole, rear living", stage: "Install", taskKind: "tick", visit: null } }]);
    expect(box).toHaveValue("");
  });

  it("offers a manager the tasks from the quote when the job has none", async () => {
    fetchMock.mockImplementation(async (_url: string, init?: { method?: string }) => ({
      json: async () => (init?.method === "POST" ? answer() : answer({ tasks: [], updates: [], canMake: true })),
    }));
    mount();
    const make = await screen.findByRole("button", { name: "Make tasks from the quote" });
    expect(make).toHaveClass("pt-btn--second");
    await act(async () => {
      fireEvent.click(make);
    });
    expect(sent("POST")).toEqual([{ job: "job-1", make: true }]);
    expect(await screen.findByText("1 of 4 done")).toBeInTheDocument();
  });

  it("leaves someone who doesn't run the board the list to read, and nothing to plan with", async () => {
    answering({ manage: false });
    mount();
    await screen.findByText("1 of 4 done");
    expect(plan().queryByRole("checkbox")).toBeNull();
    expect(plan().queryByRole("textbox")).toBeNull();
    expect(plan().getByText("Fit the bulkhead grilles upstairs").closest("li")).toHaveAttribute("draggable", "false");
    /* the crew still ticks on the day */
    expect(onTheDay().getByRole("checkbox", { name: "Charge and commission the PUMY-P200" })).toBeEnabled();
  });
});

describe("previous", () => {
  it("shows the last six days on site with who went and their time, and the rest in place", async () => {
    mount();
    await screen.findByText("1 of 4 done");
    const prev = within(screen.getByRole("region", { name: "Previous" }));
    expect(prev.getAllByRole("listitem")).toHaveLength(6);
    const first = prev.getAllByRole("listitem")[0]!;
    expect(first).toHaveTextContent("Wed 21 Oct");
    expect(first).toHaveTextContent("5h 28m");
    expect(within(first).getByRole("img", { name: "Louis Jones" })).toBeInTheDocument();
    fireEvent.click(prev.getByRole("button", { name: "Show all 8" }));
    expect(prev.getAllByRole("listitem")).toHaveLength(8);
    expect(prev.queryByRole("button", { name: /Show all/ })).toBeNull();
  });
});

it("reads nothing until the section is open, and still reads after it was left before the first read landed", async () => {
  let land: (v: unknown) => void = () => {};
  fetchMock.mockImplementation(() => new Promise((r) => (land = r)));
  const { rerender } = mount({ visible: false });
  await settle();
  expect(fetchMock).not.toHaveBeenCalled();
  rerender(<JobVisits job="job-1" visible client="JT Construct" zone="Australia/Sydney" coming={COMING} previous={PAST} workOrderDate="2026-08-01 00:00:00" onOpen={onOpen} />);
  rerender(<JobVisits job="job-1" visible={false} client="JT Construct" zone="Australia/Sydney" coming={COMING} previous={PAST} workOrderDate="2026-08-01 00:00:00" onOpen={onOpen} />);
  await act(async () => land({ json: async () => answer() }));
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(await screen.findByText("1 of 4 done")).toBeInTheDocument();
});

it("counts a booked day nobody checked in on, so the later visits keep their numbers", async () => {
  answering({ booked: [{ day: "2026-10-28", crew: ["Louis Jones"] }] });
  mount();
  await screen.findByRole("list", { name: "Tasks, Thu 5 Nov" });
  fireEvent.click(plan().getByRole("checkbox", { name: "Balance the zones" }));
  fireEvent.click(plan().getByRole("button", { name: "Add to a day" }));
  await act(async () => {
    fireEvent.click(within(screen.getByRole("menu")).getByRole("menuitem", { name: "Thu 5 Nov" }));
  });
  expect(sent("PUT")).toEqual([{ job: "job-1", edit: { kind: "place", ids: [ID(7)], visit: 10 } }]);
});

describe("a visit, pressed", () => {
  it("says when and for whom, who's going with what they are, where its booking stands, and its two doors", () => {
    const cancel = jest.fn();
    const change = jest.fn();
    render(<VisitDialog visit={COMING[0]!} jobLine="Job 2043, JT Construct" state={<span>Booked in ServiceM8</span>} onClose={() => {}} onCancel={cancel} onChange={change} />);
    const d = within(screen.getByRole("dialog", { name: "Thu 5 Nov, 7am to 3pm" }));
    expect(d.getByText("Job 2043, JT Construct")).toBeInTheDocument();
    const going = within(d.getByRole("list", { name: "Who's going" }));
    expect(going.getAllByRole("listitem").map((li) => li.textContent)).toEqual(["LJLouis JonesHVAC", "LMLeonardo MartinsHVAC", "DHDavid HannSkilled TA"]);
    expect(d.getByText("Booked in ServiceM8")).toBeInTheDocument();
    fireEvent.click(d.getByRole("button", { name: "Cancel visit" }));
    fireEvent.click(d.getByRole("button", { name: "Change visit" }));
    expect(cancel).toHaveBeenCalled();
    expect(change).toHaveBeenCalled();
    expect(d.getByRole("button", { name: "Cancel visit" })).toHaveClass("pt-btn--delete");
  });

  it("offers neither door where neither is this viewer's", () => {
    render(<VisitDialog visit={COMING[1]!} jobLine="Job 2043, JT Construct" state={null} onClose={() => {}} />);
    const d = within(screen.getByRole("dialog", { name: "Mon 9 Nov, 7am to 3pm" }));
    expect(d.queryByRole("button")).toBeNull();
  });
});
