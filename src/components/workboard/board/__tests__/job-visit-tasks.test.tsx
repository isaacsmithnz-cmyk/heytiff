import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
const uploadFile = jest.fn();
const attachJobDocument = jest.fn();
jest.mock("@/lib/documents/upload-client", () => ({ uploadFile: (...a: unknown[]) => uploadFile(...a) }));
jest.mock("@/app/actions/job-documents", () => ({ attachJobDocument: (...a: unknown[]) => attachJobDocument(...a) }));

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
  serial: null,
  modelRead: null,
  source: "quote",
  ...over,
});
const up = (taskId: string, day: string, from: number, to: number, note = "", by = "Callum Vrieze"): TaskUpdate => ({ id: `${taskId}-${day}`, taskId, day, from, to, note, by, at: `${day}T05:00:00Z` });
const day = (d: string, over: Partial<VisitDay> = {}): VisitDay => ({ day: d, crewNode: "Callum Vrieze, Alex Morozoff", minutes: 960, length: "Full day", onSite: false, ...over });

const TASKS = [
  task("pen", "Garage penetrations", { progress: 100, sort: 0 }),
  task("rough", "Rough-in pipe and cable", { kind: "progress", progress: 50, sort: 1 }),
  task("drains", "Drains for Level 3", { visit: 2, sort: 2 }),
  task("comm", "Commission the system", { stage: "Commissioning", visit: null, sort: 3 }),
];
const UPDATES = [up("pen", "2026-10-06", 0, 100), up("rough", "2026-10-06", 0, 50, "Roughed in to the third indoor unit.")];

let fetchMock: jest.Mock;
const sent = (method: string) => (fetchMock.mock.calls as [string, { method?: string; body?: string }?][]).filter(([, i]) => i?.method === method).map(([, i]) => JSON.parse(i!.body!));
const answer = (over: Record<string, unknown> = {}) => ({ ok: true, tasks: TASKS, updates: UPDATES, photos: [], today: "2026-10-07", booked: [], quoted: null, canMake: false, manage: true, note: null, ...over });

beforeEach(() => {
  fetchMock = jest.fn(async () => ({ json: async () => answer() }));
  (global as unknown as { fetch: unknown }).fetch = fetchMock;
});

const mount = (over: Partial<Parameters<typeof JobVisitTasks>[0]> = {}) =>
  render(
    <JobVisitTasks
      job="job-1"
      visible
      onSite={[day("2026-05-26", { crewNode: "Michael Diamond", length: "Pop-in", minutes: 120 }), day("2026-10-06"), day("2026-10-07", { onSite: true, minutes: 240 })]}
      ahead={[day("2026-10-12", { crewNode: null, length: null, minutes: 0 })]}
      workOrderDate="2026-09-29 00:00:00"
      onSiteMinutes={1320}
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
    <JobVisitTasks job="job-1" visible onSite={[]} ahead={[]} workOrderDate={null} onSiteMinutes={null} emptyWords="Nobody's been on site yet, and nothing is booked." />
  );
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
});

it("counts a booked day nobody checked in on as a visit, so the later visits keep their numbers", async () => {
  fetchMock.mockImplementation(async () => ({ json: async () => answer({ booked: [{ day: "2026-10-06", crew: ["Callum Vrieze"] }] }) }));
  mount({ onSite: [day("2026-10-07", { onSite: true })] });
  expect(await screen.findByText("From visit 1")).toBeInTheDocument();
  expect(within(card("Visit 1")).getByText("Callum Vrieze")).toBeInTheDocument();
  expect(within(card("Visit 2")).getByText("On site now")).toBeInTheDocument();
});

it("lets a tick made today on a day with no visit be taken back from the card it shows on", async () => {
  fetchMock.mockImplementation(async () => ({
    json: async () => answer({ today: "2026-10-09", tasks: [task("drains", "Drains for Level 3", { visit: 2, progress: 100 })], updates: [up("drains", "2026-10-09", 0, 100)] }),
  }));
  mount();
  const box = await screen.findByRole("checkbox", { name: "Drains for Level 3: done" });
  expect(box).toBeEnabled();
  await act(async () => {
    fireEvent.click(box);
  });
  expect(sent("PUT")).toEqual([{ job: "job-1", edit: { kind: "progress", id: "drains", to: 0, note: "" } }]);
});

it("still reads the tasks when the face was left before the first read landed", async () => {
  let land: (v: unknown) => void = () => undefined;
  fetchMock.mockImplementation(() => new Promise((r) => (land = r)));
  const { rerender } = mount();
  rerender(<JobVisitTasks job="job-1" visible={false} onSite={[day("2026-10-06")]} ahead={[]} workOrderDate={null} onSiteMinutes={null} emptyWords="" />);
  await act(async () => {
    land({ json: async () => answer() });
  });
  rerender(<JobVisitTasks job="job-1" visible onSite={[day("2026-10-06")]} ahead={[]} workOrderDate={null} onSiteMinutes={null} emptyWords="" />);
  expect(await screen.findByText("Garage penetrations")).toBeInTheDocument();
});

/* Isaac, 2026-10-06: "snap the photo of that particular unit, and serial
   numbers etc. can be read from there using photos" */
it("takes a unit's plate photo onto the job and shows what was read off it against the quote", async () => {
  const hang = task("hang", "Hang the Level 2 Bedroom 3 unit", {
    stage: "Install",
    kind: "unit",
    visit: 2,
    unit: { role: "indoor", room: "Level 2 Bedroom 3", model: "PEFY-P25VMX-A", capacity: "2.8 kW", type: "Ducted" },
  });
  const read = { ...hang, modelRead: "PEFY-P25VMX-A", serial: "52X04417" };
  fetchMock.mockImplementation(async (_url: string, init?: { method?: string }) => ({
    json: async () =>
      init?.method === "PUT"
        ? answer({ tasks: [read], updates: [], photos: [{ id: "p1", taskId: "hang", role: "plate", url: "https://files.example/p.jpg", at: "2026-10-07T01:00:00Z" }] })
        : answer({ tasks: [hang], updates: [] }),
  }));
  uploadFile.mockResolvedValue({ ok: true, file: { documentId: "7a1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4c", fileName: "p.jpg", mimeType: "image/jpeg", sizeBytes: 1, previewUrl: null } });
  attachJobDocument.mockResolvedValue({ ok: true });
  mount();
  expect(await screen.findByText("Unit and plate photos")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Hang the Level 2 Bedroom 3 unit" }));
  const file = new File(["x"], "plate.jpg", { type: "image/jpeg" });
  await act(async () => {
    fireEvent.change(screen.getByLabelText("Photo of the plate"), { target: { files: [file] } });
  });
  expect(uploadFile).toHaveBeenCalledWith(file, "job_document");
  expect(attachJobDocument).toHaveBeenCalledWith("7a1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4c", "job-1");
  expect(sent("PUT")).toEqual([{ job: "job-1", edit: { kind: "photo", id: "hang", documentId: "7a1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4c", role: "plate" } }]);
  expect(await screen.findByText("Matches the quote")).toBeInTheDocument();
  expect(screen.getByText("52X04417")).toBeInTheDocument();
  expect(screen.getByRole("img", { name: "The rating plate" })).toHaveAttribute("src", "https://files.example/p.jpg");
  fireEvent.click(screen.getByRole("button", { name: "Change what was read" }));
  fireEvent.change(screen.getByLabelText("Serial"), { target: { value: "52X04418" } });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
  });
  expect(sent("PUT")[1]).toEqual({ job: "job-1", edit: { kind: "plate", id: "hang", model: "PEFY-P25VMX-A", serial: "52X04418" } });
});

it("keeps a plate photo that couldn't be read, says so, and offers to type it", async () => {
  const hang = task("hang", "Hang the Study unit", { stage: "Install", kind: "unit", visit: 2, unit: { role: "indoor", room: "Study", model: "MSZ-AP35VG", capacity: "3.5 kW", type: "High wall" } });
  fetchMock.mockImplementation(async (_url: string, init?: { method?: string }) => ({
    json: async () =>
      init?.method === "PUT"
        ? answer({ tasks: [hang], updates: [], photos: [{ id: "p1", taskId: "hang", role: "plate", url: "https://files.example/p.jpg", at: "x" }], note: "The plate couldn't be read from that photo. Type the model and serial instead." })
        : answer({ tasks: [hang], updates: [] }),
  }));
  uploadFile.mockResolvedValue({ ok: true, file: { documentId: "7a1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4c", fileName: "p.jpg", mimeType: "image/jpeg", sizeBytes: 1, previewUrl: null } });
  attachJobDocument.mockResolvedValue({ ok: true });
  mount();
  fireEvent.click(await screen.findByRole("button", { name: "Hang the Study unit" }));
  expect(screen.getByLabelText("Photo of the plate")).toHaveAttribute("accept", "image/jpeg,image/png,image/webp");
  await act(async () => {
    fireEvent.change(screen.getByLabelText("Photo of the plate"), { target: { files: [new File(["x"], "p.jpg", { type: "image/jpeg" })] } });
  });
  expect(await screen.findByText("The plate couldn't be read from that photo. Type the model and serial instead.")).toBeInTheDocument();
  expect(screen.getByRole("img", { name: "The rating plate" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Type the model and serial" }));
  expect(screen.getByLabelText("Serial")).toBeInTheDocument();
});

/* Isaac, 2026-10-03: "17.5 h on site of 32 h quoted", green under, amber up to 15% over, red past it */
it("sets the hours on site against the hours quoted, in the colour of how far over", async () => {
  fetchMock.mockImplementation(async () => ({ json: async () => answer({ quoted: { hours: 32, people: 2, visits: 2 } }) }));
  /* the work since the work order: the site measure before it isn't counted */
  const { container, rerender } = mount({ onSite: [day("2026-05-26", { minutes: 120 }), day("2026-10-06", { minutes: 600 }), day("2026-10-07", { minutes: 450 })] });
  expect(await screen.findByText("17h 30m")).toBeInTheDocument();
  expect(screen.getByText("on site of 32h quoted")).toBeInTheDocument();
  expect(screen.getByText("2 people, 2 visits")).toBeInTheDocument();
  expect(container.querySelector(".jcl-hbar .jcl-tbar i")).toHaveClass("ok");
  const at = (minutes: number) =>
    rerender(
      <JobVisitTasks job="job-1" visible onSite={[day("2026-10-06", { minutes })]} ahead={[]} workOrderDate={null} onSiteMinutes={minutes} emptyWords="" />
    );
  at(32 * 60 * 1.1);
  expect(container.querySelector(".jcl-hbar .jcl-tbar i")).toHaveClass("warn");
  at(32 * 60 * 1.3);
  expect(container.querySelector(".jcl-hbar .jcl-tbar i")).toHaveClass("bad");
  expect(container.querySelector(".jcl-hbar .jcl-tbar i")).toHaveStyle({ width: "100%" });
});

it("offers to book a visit the quote planned that isn't booked yet", async () => {
  const onBook = jest.fn();
  fetchMock.mockImplementation(async () => ({ json: async () => answer({ tasks: [task("comm", "Commission the system", { stage: "Commissioning", visit: 5 })], updates: [] }) }));
  mount({ onBook });
  fireEvent.click(await screen.findByRole("button", { name: "Book visit 5" }));
  expect(onBook).toHaveBeenCalled();
});

it("leaves what was said about one view behind when another is opened", async () => {
  fetchMock.mockImplementation(async (_url: string, init?: { method?: string }) => ({
    json: async () => (init?.method === "PUT" ? { ok: false, reason: "That couldn't be saved. Try again." } : answer()),
  }));
  mount();
  const box = await screen.findByRole("checkbox", { name: "Drains for Level 3: not done" });
  await act(async () => {
    fireEvent.click(box);
  });
  expect(screen.getByText("That couldn't be saved. Try again.")).toBeInTheDocument();
  fireEvent.click(screen.getAllByRole("button", { name: "Drains for Level 3" })[0]!);
  expect(screen.queryByText("That couldn't be saved. Try again.")).toBeNull();
});
