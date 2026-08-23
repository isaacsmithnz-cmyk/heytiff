import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MeScreen } from "../me-screen";
import type { MeData } from "@/lib/me/page-data";

jest.mock("next/navigation", () => ({ useRouter: () => ({ push: jest.fn(), refresh: jest.fn() }) }));

/* THE SERVER ACTIONS ARE STUBBED, NOT THE FACES. A `"use server"` module
   pulled into jsdom takes `next/cache` and its `Request` global with it and
   the suite dies at import — so every action module these five faces reach is
   mocked, and the faces themselves render for real. That is the point: what
   this file guards is which face is on screen and which switch it carries, and
   a stubbed face would answer both questions by construction.

   The two timepay faces ARE stubbed. They are big screens with their own
   suites, and neither carries an in-panel switch. */
jest.mock("@/components/timepay/my-timesheet", () => ({
  MyTimesheet: () => <div data-testid="face-timesheet" />,
}));
jest.mock("@/components/timepay/my-leave", () => ({
  MyLeave: () => <div data-testid="face-leave" />,
}));
jest.mock("@/app/actions/my-notes", () => ({
  addMyNote: jest.fn(async () => ({ ok: true })),
  archiveMyNote: jest.fn(async () => ({ ok: true })),
  deleteMyNote: jest.fn(async () => ({ ok: true })),
  editMyNote: jest.fn(async () => ({ ok: true })),
}));
jest.mock("@/components/notes/note-token", () => ({
  NoteToken: ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
    <input aria-label="a note" value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}));
jest.mock("@/app/actions/expenses", () => ({
  submitClaim: jest.fn(async () => ({ ok: true })),
  cancelClaim: jest.fn(async () => ({ ok: true })),
}));
jest.mock("@/app/actions/expense-ai", () => ({ readExpenseReceipt: jest.fn() }));
jest.mock("@/app/actions/fleet-ai", () => ({ readFuelReceipt: jest.fn(), valueFleet: jest.fn() }));
jest.mock("@/lib/documents/upload-client", () => ({ uploadFile: jest.fn() }));
jest.mock("@/app/actions/fleet", () => ({
  addLog: jest.fn(async () => ({ ok: true })),
  assignVehicle: jest.fn(async () => ({ ok: true })),
  deleteLog: jest.fn(async () => ({ ok: true })),
  editLog: jest.fn(async () => ({ ok: true })),
  removeVehicle: jest.fn(async () => ({ ok: true })),
  resolveIssue: jest.fn(async () => ({ ok: true })),
  saveValuations: jest.fn(async () => ({ ok: true })),
  saveVehicle: jest.fn(async () => ({ ok: true })),
}));

/* THE FIVE PERSONAL SCREENS, ON ONE CARD.

   They were five rail rows and the rail could not afford them — thirteen rows
   needed 999px of nav inside a 733px window, so Operations and Admin sat below
   a fold that `.no-sb` gives no scrollbar to admit. What these guard is the
   half of that trade that could quietly rot: the rows went, and every one of
   the five has to still be a place you can get to and a thing that says which
   it is. */

const DATA = {
  timesheet: null,
  leave: null,
  fleet: { own: { vehicle: null, pickable: [], logs: [] }, today: "2026-08-23", viewerStaffId: null },
  claims: [],
  notes: [],
  archived: [],
  staffId: null,
  today: "2026-08-23",
} as unknown as MeData;

const strip = () => screen.getByRole("tablist", { name: "Yours" });

it("carries all five faces, and opens the one the route names", () => {
  render(<MeScreen initialTab="vehicle" data={DATA} />);
  const labels = within(strip())
    .getAllByRole("tab")
    .map((t) => t.textContent);
  expect(labels).toEqual(["Timesheet", "Leave", "Expenses", "Vehicle", "Notes"]);
  expect(within(strip()).getByRole("tab", { name: "Vehicle" })).toHaveAttribute(
    "aria-selected",
    "true"
  );
  expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("My vehicle");
});

it("names itself for each face — these are five destinations, not one screen", async () => {
  const user = userEvent.setup();
  render(<MeScreen initialTab="timesheet" data={DATA} />);
  for (const [tab, title] of [
    ["Leave", "My leave"],
    ["Expenses", "My expenses"],
    ["Vehicle", "My vehicle"],
    ["Notes", "Notes"],
    ["Timesheet", "My timesheet"],
  ] as const) {
    await user.click(within(strip()).getByRole("tab", { name: tab }));
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(title);
  }
});

/* THE SWITCH INSIDE A FACE. Vehicle, Expenses and Notes each carried their own
   card-edge strip; a strip inside a strip is not a control this app has, so
   the inner pair moved onto `.seg`. What must stay true is that both faces are
   still reachable and still announce themselves — the whole point of the move
   was that nothing became unreachable. */
it("keeps each face's own pair on an in-panel switch, not a second card strip", async () => {
  const user = userEvent.setup();
  render(<MeScreen initialTab="notes" data={DATA} />);

  // exactly two tablists: the card's five, and this face's two
  const lists = screen.getAllByRole("tablist");
  expect(lists.map((l) => l.getAttribute("aria-label"))).toEqual(["Yours", "Your notes"]);
  expect(screen.getByRole("tablist", { name: "Your notes" })).toHaveClass("me-fsw");

  const inner = () => screen.getByRole("tablist", { name: "Your notes" });
  await user.click(within(inner()).getByRole("tab", { name: "Archived" }));
  expect(within(inner()).getByRole("tab", { name: "Archived" })).toHaveAttribute(
    "aria-selected",
    "true"
  );
  // …and switching the CARD's face does not leave the old switch behind
  await user.click(within(strip()).getByRole("tab", { name: "Expenses" }));
  expect(screen.queryByRole("tablist", { name: "Your notes" })).toBeNull();
  expect(screen.getByRole("tablist", { name: "Your expense claims" })).toBeTruthy();
});

/* THE PANEL SWAPS IN PLACE — no remount, no fade. `key={tab}` + `.psec2`
   rebuilt the face and faded it in on every switch, which on a timesheet grid
   reads as the content flashing (Isaac, 2026-08-22). */
it("keeps the same panel node, with no fade class", async () => {
  const user = userEvent.setup();
  const { container } = render(<MeScreen initialTab="timesheet" data={DATA} />);
  const panel = () => container.querySelector('.stg > [role="tabpanel"]');

  const before = panel();
  expect(before).not.toHaveClass("psec2");
  await user.click(within(strip()).getByRole("tab", { name: "Leave" }));
  expect(panel()).toBe(before);
  expect(panel()).not.toHaveClass("psec2");
});

/* THE URL MUST NOT MOVE. A cross-PATH replaceState remounts the whole page
   tree — the shell keys its outlet on the pathname — taking this component's
   state with it, so every tab click bounced back to the entry face (Isaac hit
   it on prod within minutes, 2026-08-22). */
it("never writes the path when you change face", async () => {
  const user = userEvent.setup();
  const spy = jest.spyOn(window.history, "replaceState");
  const push = jest.spyOn(window.history, "pushState");
  render(<MeScreen initialTab="timesheet" data={DATA} />);
  await user.click(within(strip()).getByRole("tab", { name: "Notes" }));
  expect(spy).not.toHaveBeenCalled();
  expect(push).not.toHaveBeenCalled();
  spy.mockRestore();
  push.mockRestore();
});

/* THE HEADER MUST NOT MOVE. Notes carried "Only you can see these" under the
   card's heading, so landing on Notes stepped the whole page down and leaving
   it stepped back up (Isaac, 2026-08-23). The sentence is not gone — it rides
   the switch row inside the panel — but the header now holds exactly one
   thing on every face, and any face that adds a second brings the shift back. */
it("keeps the header to a heading alone, on every face", async () => {
  const user = userEvent.setup();
  const { container } = render(<MeScreen initialTab="timesheet" data={DATA} />);
  const head = () => container.querySelector(".rhead") as HTMLElement;

  for (const tab of ["Leave", "Expenses", "Vehicle", "Notes", "Timesheet"] as const) {
    await user.click(within(strip()).getByRole("tab", { name: tab }));
    expect(head().querySelectorAll("h1")).toHaveLength(1);
    // nothing else in there — no lede, no chip, nothing a single face adds
    expect(head().textContent).toBe(head().querySelector("h1")!.textContent);
  }
  // …and the sentence still exists, on the surface it describes
  await user.click(within(strip()).getByRole("tab", { name: "Notes" }));
  expect(screen.getByText("Only you can see these.")).toBeTruthy();
});

/* A MISSING STAFF CARD USED TO REDIRECT. My expenses and My notes each bounced
   to /dashboard when the viewer had no staff row, which cannot survive the
   merge: one absent face would take the other four with it. */
it("shows an empty face rather than losing the card when there is no staff record", () => {
  render(<MeScreen initialTab="timesheet" data={DATA} />);
  expect(screen.getByText("No staff record yet")).toBeTruthy();
  expect(within(strip()).getAllByRole("tab")).toHaveLength(5);
});
