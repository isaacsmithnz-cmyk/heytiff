import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ShowcasePhoto, StarPhotoResult } from "@/app/actions/job-photo-favourites";

/* THE GALLERY — the starred set, drawn with what the bank knows about each
   picture. It SPENDS NOTHING: reading happens when a job card is opened, not
   here. And it SEARCHES NOTHING any more — the bank search moved into the
   board's one universal field (pinned in overview-screen.test), so what is
   left here is the curation and the viewer it opens.

   Mocked at all for the usual reason: a `"use server"` module drags
   `next/cache` into jsdom, where `Request` is undefined and the suite dies at
   import time. */
const listShowcase = jest.fn(async (): Promise<ShowcasePhoto[]> => []);
const setJobPhotoFavourite = jest.fn(
  async (_j: string, _a: string, starred: boolean): Promise<StarPhotoResult> => ({
    ok: true,
    starred,
    note: null,
  })
);
jest.mock("@/app/actions/job-photo-favourites", () => ({
  listShowcase: (...a: unknown[]) => listShowcase(...(a as [])),
  setJobPhotoFavourite: (...a: unknown[]) =>
    setJobPhotoFavourite(...(a as [string, string, boolean])),
}));

import { ShowcaseView } from "../showcase-view";

const photo = (over: Partial<ShowcasePhoto> & { remoteId: string }): ShowcasePhoto => ({
  jobUuid: "job-1",
  jobNumber: "907",
  clientName: "Heuvel Construction",
  name: "Photo",
  takenAt: "2026-08-28 13:25:00",
  url: "https://signed/p.jpg",
  subject: null,
  tags: [],
  caption: "",
  ocrText: "",
  read: false,
  addedAt: "2026-08-29T01:29:06Z",
  ...over,
});

beforeEach(() => {
  listShowcase.mockReset();
  listShowcase.mockResolvedValue([]);
  setJobPhotoFavourite.mockClear();
  setJobPhotoFavourite.mockImplementation(async (_j, _a, starred) => ({
    ok: true,
    starred,
    note: null,
  }));
});

it("says what the gallery is for when nothing is starred", async () => {
  render(<ShowcaseView />);
  expect(await screen.findByText("Nothing starred yet")).toBeInTheDocument();
  /* No filter row on an empty gallery — a row of zero chips is furniture. */
  expect(screen.queryByRole("tablist")).toBeNull();
});

/* THE BOX IS GONE. It sat a hand's width under the board's universal search
   with the same face and different reach; the universal field owns the bank
   now. A second searchbox reappearing here is the regression this pins. */
it("carries no search box of its own", async () => {
  listShowcase.mockResolvedValue([photo({ remoteId: "p-1" })]);
  render(<ShowcaseView />);
  await screen.findByText("1 starred photo");
  expect(screen.queryByRole("searchbox")).toBeNull();
});

it("files the photos under what they are of, and filters to one", async () => {
  listShowcase.mockResolvedValue([
    photo({ remoteId: "p-1", subject: "dataplate", read: true, caption: "Rating plate on the outdoor unit" }),
    photo({ remoteId: "p-2", subject: "ductwork", read: true, caption: "Flexible duct into a ceiling plenum" }),
    photo({ remoteId: "p-3", subject: "ductwork", read: true, caption: "Rigid duct run above the bulkhead" }),
  ]);
  render(<ShowcaseView />);

  await screen.findByText("3 starred photos");
  const filters = screen.getByRole("tablist", { name: "What the photo is of" });
  /* The COUNT is on the chip: a filter that doesn't say how many it holds
     makes you click it to find out it was empty. */
  expect(within(filters).getByRole("tab", { name: "Everything · 3" })).toBeInTheDocument();
  expect(within(filters).getByRole("tab", { name: /Ductwork · 2/ })).toBeInTheDocument();
  expect(within(filters).getByRole("tab", { name: /Dataplate · 1/ })).toBeInTheDocument();

  await userEvent.click(within(filters).getByRole("tab", { name: /Ductwork · 2/ }));
  expect(screen.getByText("Flexible duct into a ceiling plenum")).toBeInTheDocument();
  expect(screen.queryByText("Rating plate on the outdoor unit")).toBeNull();
});

/* THE GALLERY SPENDS NOTHING. Reading moved to the job card — opening a job
   is what puts its photographs in the bank — so this screen has no button
   that costs anything and nothing to disable. The loop and its brake are
   pinned in job-sheet.test.tsx, where they now live. */
it("has no reader of its own to press", async () => {
  listShowcase.mockResolvedValue([photo({ remoteId: "p-1" })]);
  render(<ShowcaseView />);
  await screen.findByText("1 starred photo");
  expect(screen.queryByRole("button", { name: /Read/ })).toBeNull();
});

/* An unread photo has no subject, and must not be filed under one. It gets
   its own way in instead, so the queue is visible rather than invisible. */
it("keeps the unread ones reachable without inventing a subject for them", async () => {
  listShowcase.mockResolvedValue([
    photo({ remoteId: "p-1", subject: "fault", read: true, caption: "Split in the insulation" }),
    photo({ remoteId: "p-2", caption: "" }),
  ]);
  render(<ShowcaseView />);

  const filters = await screen.findByRole("tablist", { name: "What the photo is of" });
  expect(within(filters).getByRole("tab", { name: /Damage or fault · 1/ })).toBeInTheDocument();
  await userEvent.click(within(filters).getByRole("tab", { name: "Not read yet · 1" }));
  expect(screen.queryByText("Split in the insulation")).toBeNull();
});

/* ── the viewer ───────────────────────────────────────────────────────────
   The cards drew as inert figures for one release — the only screen in the
   app where a photograph did not open. */

const three = () => [
  photo({ remoteId: "p-1", read: true, subject: "ductwork", caption: "First duct" }),
  photo({ remoteId: "p-2", read: true, subject: "ductwork", caption: "Second duct" }),
  photo({ remoteId: "p-3", read: true, subject: "dataplate", caption: "The plate" }),
];

it("opens the viewer on the photo you clicked, with the roll behind it", async () => {
  listShowcase.mockResolvedValue(three());
  render(<ShowcaseView />);
  await screen.findByText("3 starred photos");

  await userEvent.click(screen.getByRole("button", { name: "Open Second duct" }));

  const viewer = screen.getByRole("dialog");
  expect(within(viewer).getByText("Second duct")).toBeInTheDocument();
  expect(within(viewer).getByText("2 / 3")).toBeInTheDocument();
  /* The origin line carries the job and the client — the photo is about the
     work, and the viewer must say whose. */
  expect(within(viewer).getByText(/#907 · Heuvel Construction/)).toBeInTheDocument();
});

it("closes on Escape — this tab has no sheet to do it for it", async () => {
  listShowcase.mockResolvedValue(three());
  render(<ShowcaseView />);
  await screen.findByText("3 starred photos");

  await userEvent.click(screen.getByRole("button", { name: "Open First duct" }));
  expect(screen.getByRole("dialog")).toBeInTheDocument();
  await userEvent.keyboard("{Escape}");
  expect(screen.queryByRole("dialog")).toBeNull();
});

/* Unstarring the photo on the stage removes it from the gallery — but the
   roll under the reader's feet is a snapshot, so the viewer keeps showing it
   until they close. The grid has settled by the time they are back. */
it("unstars from the viewer without pulling the roll out from under you", async () => {
  listShowcase.mockResolvedValue(three());
  render(<ShowcaseView />);
  await screen.findByText("3 starred photos");

  await userEvent.click(screen.getByRole("button", { name: "Open Second duct" }));
  await userEvent.click(screen.getByRole("button", { name: "Unstar Second duct" }));

  expect(setJobPhotoFavourite).toHaveBeenCalledWith("job-1", "p-2", false);
  /* Still on the stage — the snapshot holds. */
  const viewer = screen.getByRole("dialog");
  expect(within(viewer).getByText("Second duct")).toBeInTheDocument();
  /* The gallery behind has already let it go. */
  expect(screen.getByText("2 starred photos")).toBeInTheDocument();

  await userEvent.keyboard("{Escape}");
  expect(screen.queryByText("Second duct")).toBeNull();
});

/* The action answers with the TRUTH, not ok/not-ok — a refused write settles
   the star back to what the server holds instead of leaving a lie lit. */
it("puts the star back when the server refuses the unstar", async () => {
  listShowcase.mockResolvedValue(three());
  setJobPhotoFavourite.mockResolvedValue({ ok: false, starred: true, note: null });
  render(<ShowcaseView />);
  await screen.findByText("3 starred photos");

  await userEvent.click(screen.getByRole("button", { name: "Open Second duct" }));
  await userEvent.click(screen.getByRole("button", { name: "Unstar Second duct" }));

  await waitFor(() => expect(screen.getByText("3 starred photos")).toBeInTheDocument());
  expect(
    screen.getByRole("button", { name: "Unstar Second duct" })
  ).toHaveAttribute("aria-pressed", "true");
});
