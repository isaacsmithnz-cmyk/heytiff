import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MyTimeScreen } from "../my-time-screen";

/* The two faces of your own time, switched on the CLIENT.

   These replaced the `(my-time)` layout + BoardTabs pair: the frame held, but
   every tab click was still a route navigation — an RSC round trip and a
   skeleton, which on prod read as the page reloading beside Team's instant
   switcher. The shell loads both faces and switches state; the URL follows by
   replaceState so both real routes stay live. These pin all of that. */

jest.mock("../my-timesheet", () => ({
  MyTimesheet: () => <div data-testid="face-timesheet" />,
}));
jest.mock("../my-leave", () => ({
  MyLeave: () => <div data-testid="face-leave" />,
}));

const timesheet = { me: "stub" } as never;
const leave = { today: "2026-08-22" } as never;

afterEach(cleanup);

it("switches faces without a navigation — tabs are buttons, never links", async () => {
  const user = userEvent.setup();
  render(<MyTimeScreen initialTab="timesheet" timesheet={timesheet} leave={leave} />);

  expect(screen.getByTestId("face-timesheet")).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "My timesheet" })).toBeInTheDocument();
  /* The reload-shaped bug can only come back as an <a>: a link here means a
     tab click is a route navigation again. */
  expect(screen.queryByRole("link")).not.toBeInTheDocument();

  await user.click(screen.getByRole("tab", { name: "Leave" }));
  expect(screen.getByTestId("face-leave")).toBeInTheDocument();
  expect(screen.queryByTestId("face-timesheet")).not.toBeInTheDocument();
  // the heading swaps with the face — two nav destinations sharing a card
  expect(screen.getByRole("heading", { name: "My leave" })).toBeInTheDocument();
});

/* THE URL MUST NOT MOVE. The first cut replaceState'd the sibling path on
   every switch, and the dashboard shell — which keys its outlet on the
   pathname — remounted the whole page and reset the tab: click Leave, get
   Timesheet back with a full re-entrance. Any pathname change here means
   that bug has returned. */
it("never touches the URL when switching faces", async () => {
  const user = userEvent.setup();
  window.history.replaceState(null, "", "/dashboard/my-timesheet");
  render(<MyTimeScreen initialTab="timesheet" timesheet={timesheet} leave={leave} />);

  await user.click(screen.getByRole("tab", { name: "Leave" }));
  expect(screen.getByTestId("face-leave")).toBeInTheDocument();
  expect(window.location.pathname).toBe("/dashboard/my-timesheet");

  await user.click(screen.getByRole("tab", { name: "Timesheet" }));
  expect(window.location.pathname).toBe("/dashboard/my-timesheet");
});

/* THE PANEL SWAPS IN PLACE — no remount, no entrance animation.

   It briefly wore the Organisation card's recipe: `key={tab}` plus `.psec2`
   (`animation:fgUp .4s`). The key rebuilt the whole face on every click and
   fgUp then faded it back in from opacity 0 — the content below the tabs
   visibly flashed, where Team's just changes (Isaac, 2026-08-22). A stable
   node is the proof: with a key, React hands back a different element. */
it("swaps the face in place — same panel node, no fade class", async () => {
  const user = userEvent.setup();
  const { container } = render(
    <MyTimeScreen initialTab="timesheet" timesheet={timesheet} leave={leave} />,
  );
  const panel = () => container.querySelector('[role="tabpanel"]');

  const before = panel();
  expect(before).not.toHaveClass("psec2");

  await user.click(screen.getByRole("tab", { name: "Leave" }));
  expect(screen.getByTestId("face-leave")).toBeInTheDocument();
  expect(panel()).toBe(before);
  expect(panel()).not.toHaveClass("psec2");
});

it("keeps Leave reachable from every timesheet empty state", async () => {
  const user = userEvent.setup();
  render(
    <MyTimeScreen
      initialTab="timesheet"
      timesheet={{ subcontractor: true } as never}
      leave={leave}
    />,
  );

  // the subcontractor branch says so plainly, with the tabs still above it
  expect(screen.getByText(/Subcontractors don’t keep a timesheet here/)).toBeInTheDocument();
  await user.click(screen.getByRole("tab", { name: "Leave" }));
  expect(screen.getByTestId("face-leave")).toBeInTheDocument();
});
