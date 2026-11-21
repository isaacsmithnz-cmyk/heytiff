import { act, fireEvent, render, screen } from "@testing-library/react";
import { useState, type ReactNode } from "react";

let pathname = "/dashboard/studio";
let search = "";
jest.mock("next/navigation", () => ({
  usePathname: () => pathname,
  useSearchParams: () => new URLSearchParams(search),
}));

import { noteKeptDesign, noteKeptJobAnswered, resetStudioKeeper, StudioHost, StudioKeep } from "../studio-keeper";

/* Design's studio is kept alive behind other tabs (Isaac, 26 October 2026:
   switching to a job's tab and back "seems to have to reload the page"). A
   stand-in studio with state of its own shows whether the same one came
   back or a new one started. */
function FakeStudio({ label }: { label: string }) {
  const [clicks, setClicks] = useState(0);
  return (
    <button type="button" onClick={() => setClicks((n) => n + 1)}>
      {`${label} ${clicks}`}
    </button>
  );
}

/* The page reads `?design=` on the server for the studio it draws; the
   keeper reads the address for where that studio is asked to be. */
function App({ job, label, page, studio }: { job?: string; label: string; page: "studio" | "jobs"; studio?: ReactNode }) {
  return (
    <>
      <main className="outlet">{page === "studio" ? <StudioKeep job={job}>{studio ?? <FakeStudio label={label} />}</StudioKeep> : <p>Jobs</p>}</main>
      <StudioHost />
    </>
  );
}

const go = (path: string, query = "") => {
  pathname = path;
  search = query;
};

beforeEach(() => {
  act(() => resetStudioKeeper());
  go("/dashboard/studio");
  document.documentElement.removeAttribute("data-studio-kept");
});

it("draws the studio its page hands over, and the page's outlet steps aside", () => {
  render(<App label="studio" page="studio" />);
  expect(screen.getByRole("button", { name: "studio 0" })).toBeVisible();
  expect(document.documentElement).toHaveAttribute("data-studio-kept");
});

it("comes back exactly as it was left after another tab", () => {
  const view = render(<App label="studio" page="studio" />);
  fireEvent.click(screen.getByRole("button", { name: "studio 0" }));
  fireEvent.click(screen.getByRole("button", { name: "studio 1" }));

  go("/dashboard/jobs");
  view.rerender(<App label="studio" page="jobs" />);
  expect(screen.getByText("Jobs")).toBeInTheDocument();
  // still there, hidden: Activity keeps it mounted
  expect(screen.getByRole("button", { name: "studio 2", hidden: true })).not.toBeVisible();
  expect(document.documentElement).not.toHaveAttribute("data-studio-kept");

  go("/dashboard/studio");
  view.rerender(<App label="a new page render" page="studio" />);
  expect(screen.getByRole("button", { name: "studio 2" })).toBeVisible();
});

it("follows the design the studio opens, so coming back to it shows the same studio", () => {
  const view = render(<App label="studio" page="studio" />);
  fireEvent.click(screen.getByRole("button", { name: "studio 0" }));
  /* the studio opens a design and writes the address with replaceState:
     the page itself isn't drawn again, so only the host hears of it (a page
     drawn again later reads the same address, design and all) */
  act(() => noteKeptDesign("d1"));
  go("/dashboard/studio", "design=d1");
  view.rerender(<App label="studio" page="studio" />);
  expect(screen.getByRole("button", { name: "studio 1" })).toBeVisible();

  go("/dashboard/jobs");
  view.rerender(<App label="studio" page="jobs" />);
  go("/dashboard/studio", "design=d1");
  view.rerender(<App label="fresh" page="studio" />);
  expect(screen.getByRole("button", { name: "studio 1" })).toBeVisible();
});

it("starts a new studio when the address asks for somewhere else", () => {
  const view = render(<App label="studio" page="studio" />);
  act(() => noteKeptDesign("d1"));
  go("/dashboard/studio", "design=d1");
  view.rerender(<App label="studio" page="studio" />);

  // the Design place in the sidebar: the list of designs, not the open one
  go("/dashboard/studio");
  view.rerender(<App label="fresh" page="studio" />);
  expect(screen.getByRole("button", { name: "fresh 0" })).toBeVisible();
});

/* Isaac, 22 November 2026: opened from the list, a design, then Design in
   the sidebar, and the page sat on "Opening the Design Studio" until a
   reload. The studio wrote `?design=` with replaceState, so the page was
   never drawn again; the sidebar asked for the page already drawn, and the
   router handed back the same page, the same studio element and all. */
it("starts the list again when Design asks for the page already drawn, the same element and all", () => {
  const same = <FakeStudio label="list" />;
  const view = render(<App label="list" page="studio" studio={same} />);
  fireEvent.click(screen.getByRole("button", { name: "list 0" }));
  // the studio opens a design from the list and writes the address
  act(() => noteKeptDesign("d1"));
  go("/dashboard/studio", "design=d1");
  view.rerender(<App label="list" page="studio" studio={same} />);
  expect(screen.getByRole("button", { name: "list 1" })).toBeVisible();

  // Design in the sidebar: the address drops the design, the page is the same
  go("/dashboard/studio");
  view.rerender(<App label="list" page="studio" studio={same} />);
  expect(screen.getByRole("button", { name: "list 0" })).toBeVisible();
  expect(document.documentElement).toHaveAttribute("data-studio-kept");
});

/* the quote's Design step (Isaac, 28 October 2026): Design it opens the
   studio on a job (?job=), to start its first design there */
describe("a studio opened on a job", () => {
  it("starts a new studio there, even over a kept list of designs", () => {
    const view = render(<App label="studio" page="studio" />);
    fireEvent.click(screen.getByRole("button", { name: "studio 0" }));
    go("/dashboard/studio", "job=j1");
    view.rerender(<App job="j1" label="on the job" page="studio" />);
    expect(screen.getByRole("button", { name: "on the job 0" })).toBeVisible();
  });
  it("keeps it while it asks, and once answered, Design it on the job again asks again", () => {
    go("/dashboard/studio", "job=j1");
    const view = render(<App job="j1" label="on the job" page="studio" />);
    fireEvent.click(screen.getByRole("button", { name: "on the job 0" }));
    view.rerender(<App job="j1" label="drawn again" page="studio" />);
    expect(screen.getByRole("button", { name: "on the job 1" })).toBeVisible();

    act(() => noteKeptJobAnswered());
    go("/dashboard/jobs");
    view.rerender(<App label="studio" page="jobs" />);
    go("/dashboard/studio", "job=j1");
    view.rerender(<App job="j1" label="asked again" page="studio" />);
    expect(screen.getByRole("button", { name: "asked again 0" })).toBeVisible();
  });
});
