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

/* ── the row above the pictures ───────────────────────────────────────────
   It drew one chip per subject and one more for the unread — eleven labels
   wrapping over three lines on a real gallery. Now it is five families, and
   the subjects live behind the filter button. */

it("puts FAMILIES on the tabs, not the ten subjects", async () => {
  listShowcase.mockResolvedValue([
    photo({ remoteId: "p-1", subject: "dataplate", read: true, caption: "Rating plate on the outdoor unit" }),
    photo({ remoteId: "p-2", subject: "ductwork", read: true, caption: "Flexible duct into a ceiling plenum" }),
    photo({ remoteId: "p-3", subject: "pipework", read: true, caption: "Lagging on the liquid line" }),
  ]);
  render(<ShowcaseView />);

  await screen.findByText("3 starred photos");
  const tabs = screen.getByRole("tablist", { name: "What the photo is of" });
  /* The COUNT is on the tab: a filter that doesn't say how many it holds
     makes you click it to find out it was empty. */
  expect(within(tabs).getByRole("tab", { name: "Everything · 3" })).toBeInTheDocument();
  expect(within(tabs).getByRole("tab", { name: /Equipment · 1/ })).toBeInTheDocument();
  expect(within(tabs).getByRole("tab", { name: /Installation · 2/ })).toBeInTheDocument();
  /* THE REGRESSION THIS PINS: a subject back on the row is the wall of
     labels coming back. Ductwork and pipework are one tab now. */
  expect(within(tabs).queryByRole("tab", { name: /Ductwork/ })).toBeNull();
  expect(within(tabs).queryByRole("tab", { name: /Dataplate/ })).toBeNull();
});

it("narrows to a family when its tab is picked", async () => {
  listShowcase.mockResolvedValue([
    photo({ remoteId: "p-1", subject: "dataplate", read: true, caption: "Rating plate on the outdoor unit" }),
    photo({ remoteId: "p-2", subject: "ductwork", read: true, caption: "Flexible duct into a ceiling plenum" }),
  ]);
  render(<ShowcaseView />);
  await screen.findByText("2 starred photos");

  await userEvent.click(screen.getByRole("tab", { name: /Installation · 1/ }));
  expect(screen.getByText("Flexible duct into a ceiling plenum")).toBeInTheDocument();
  expect(screen.queryByText("Rating plate on the outdoor unit")).toBeNull();
});

/* ── the filter button ─────────────────────────────────────────────────── */

it("keeps the ten subjects behind a filter button, shut until asked for", async () => {
  listShowcase.mockResolvedValue([
    photo({ remoteId: "p-1", subject: "dataplate", read: true, caption: "Rating plate" }),
    photo({ remoteId: "p-2", subject: "ductwork", read: true, caption: "Flexible duct" }),
  ]);
  render(<ShowcaseView />);
  await screen.findByText("2 starred photos");

  const button = screen.getByRole("button", { name: "Filter" });
  expect(button).toHaveAttribute("aria-expanded", "false");
  expect(screen.queryByRole("menu")).toBeNull();

  await userEvent.click(button);
  const menu = screen.getByRole("menu", { name: "Filter by subject" });
  /* Grouped under the family headings, so the menu teaches the tabs rather
     than presenting a second, flatter vocabulary. */
  expect(within(menu).getByText("Equipment")).toBeInTheDocument();
  expect(within(menu).getByRole("menuitemradio", { name: /Dataplate/ })).toBeInTheDocument();
  expect(within(menu).getByRole("menuitemradio", { name: /Ductwork/ })).toBeInTheDocument();
});

/* The two controls must never disagree on screen: a subject is inside a
   family, so choosing one lights the tab that contains it. */
it("lights a subject's family tab when the subject is picked", async () => {
  listShowcase.mockResolvedValue([
    photo({ remoteId: "p-1", subject: "dataplate", read: true, caption: "Rating plate" }),
    photo({ remoteId: "p-2", subject: "outdoor-unit", read: true, caption: "The condenser" }),
    photo({ remoteId: "p-3", subject: "ductwork", read: true, caption: "Flexible duct" }),
  ]);
  render(<ShowcaseView />);
  await screen.findByText("3 starred photos");

  await userEvent.click(screen.getByRole("button", { name: "Filter" }));
  await userEvent.click(screen.getByRole("menuitemradio", { name: /Dataplate/ }));

  // the menu shuts, the button says what the fine cut is
  expect(screen.queryByRole("menu")).toBeNull();
  expect(screen.getByRole("button", { name: "Dataplate" })).toBeInTheDocument();
  // its family's tab is the lit one, and only that photo shows
  expect(screen.getByRole("tab", { name: /Equipment · 2/ })).toHaveAttribute(
    "aria-selected",
    "true"
  );
  expect(screen.getByText("Rating plate")).toBeInTheDocument();
  expect(screen.queryByText("The condenser")).toBeNull();
});

it("gives a fine filter a way back out", async () => {
  listShowcase.mockResolvedValue([
    photo({ remoteId: "p-1", subject: "dataplate", read: true, caption: "Rating plate" }),
    photo({ remoteId: "p-2", subject: "ductwork", read: true, caption: "Flexible duct" }),
  ]);
  render(<ShowcaseView />);
  await screen.findByText("2 starred photos");

  await userEvent.click(screen.getByRole("button", { name: "Filter" }));
  await userEvent.click(screen.getByRole("menuitemradio", { name: /Dataplate/ }));
  expect(screen.queryByText("Flexible duct")).toBeNull();

  await userEvent.click(screen.getByRole("button", { name: "Clear the Dataplate filter" }));
  expect(screen.getByText("Flexible duct")).toBeInTheDocument();
  expect(screen.getByRole("tab", { name: "Everything · 2" })).toHaveAttribute(
    "aria-selected",
    "true"
  );
});

it("shuts the filter menu on Escape", async () => {
  listShowcase.mockResolvedValue([photo({ remoteId: "p-1", subject: "dataplate", read: true })]);
  render(<ShowcaseView />);
  await screen.findByText("1 starred photo");

  await userEvent.click(screen.getByRole("button", { name: "Filter" }));
  expect(screen.getByRole("menu")).toBeInTheDocument();
  await userEvent.keyboard("{Escape}");
  expect(screen.queryByRole("menu")).toBeNull();
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

/* An unread photo has no subject, and must not be filed under one — so it is
   not a tab either. It gets its own way in, inside the filter, so the queue
   is visible rather than invisible. */
it("keeps the unread ones reachable without inventing a family for them", async () => {
  listShowcase.mockResolvedValue([
    photo({ remoteId: "p-1", subject: "fault", read: true, caption: "Split in the insulation" }),
    photo({ remoteId: "p-2", caption: "" }),
  ]);
  render(<ShowcaseView />);
  await screen.findByText("2 starred photos");

  const tabs = screen.getByRole("tablist", { name: "What the photo is of" });
  expect(within(tabs).getByRole("tab", { name: /Faults · 1/ })).toBeInTheDocument();
  /* Not a family, so not a tab — an unread photo has no answer yet and
     filing it under one would be inventing it. */
  expect(within(tabs).queryByRole("tab", { name: /Not read yet/ })).toBeNull();

  await userEvent.click(screen.getByRole("button", { name: "Filter" }));
  await userEvent.click(screen.getByRole("menuitemradio", { name: /Not read yet/ }));
  expect(screen.queryByText("Split in the insulation")).toBeNull();
  expect(screen.getByRole("button", { name: "Not read yet" })).toBeInTheDocument();
});

/* ── what each card wears ─────────────────────────────────────────────── */

/* THE OTHER HALF OF "too many labels": the tag chips repeated in a second
   typeface what the caption above them had usually already said, on every
   card in the grid. Tags are what the SEARCH reads, never what you filter
   by, so they lost nothing by leaving the picture alone. */
it("prints no tag chips on the cards", async () => {
  listShowcase.mockResolvedValue([
    photo({
      remoteId: "p-1",
      subject: "dataplate",
      read: true,
      caption: "Rating plate",
      tags: ["mitsubishi", "puz-m125", "install"],
    }),
  ]);
  render(<ShowcaseView />);
  await screen.findByText("Rating plate");
  expect(screen.queryByText("mitsubishi")).toBeNull();
  expect(screen.queryByText("install")).toBeNull();
});

/* Everything in here is starred by definition, which is exactly why the mark
   going quiet was odd — the gallery was the one place it wasn't shown. */
it("shows the star lit on every card, and unstars from the grid", async () => {
  listShowcase.mockResolvedValue([
    photo({ remoteId: "p-1", subject: "dataplate", read: true, caption: "Rating plate" }),
    photo({ remoteId: "p-2", subject: "ductwork", read: true, caption: "Flexible duct" }),
  ]);
  render(<ShowcaseView />);
  await screen.findByText("2 starred photos");

  const star = screen.getByRole("button", { name: "Unstar Rating plate" });
  expect(star).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByRole("button", { name: "Unstar Flexible duct" })).toBeInTheDocument();

  /* It doubles as the way OUT — a photograph you no longer want shown is
     unstarred where you noticed it, not by finding its job again. */
  await userEvent.click(star);
  expect(setJobPhotoFavourite).toHaveBeenCalledWith("job-1", "p-1", false);
  expect(await screen.findByText("1 starred photo")).toBeInTheDocument();
  expect(screen.queryByText("Rating plate")).toBeNull();
});

/* The counts on the tabs are of what is actually in the gallery, so taking a
   photo out has to move them — a tab still promising a photo that is gone is
   a filter you click into an empty grid. */
it("re-counts the tabs when a photo leaves the gallery", async () => {
  listShowcase.mockResolvedValue([
    photo({ remoteId: "p-1", subject: "dataplate", read: true, caption: "Rating plate" }),
    photo({ remoteId: "p-2", subject: "outdoor-unit", read: true, caption: "The condenser" }),
  ]);
  render(<ShowcaseView />);
  await screen.findByRole("tab", { name: /Equipment · 2/ });

  await userEvent.click(screen.getByRole("button", { name: "Unstar Rating plate" }));
  expect(await screen.findByRole("tab", { name: /Equipment · 1/ })).toBeInTheDocument();
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
  /* Scoped to the viewer: the card behind it carries a star with the same
     name now, which is the point — it is the same act on the same photo. */
  const viewer = screen.getByRole("dialog");
  await userEvent.click(within(viewer).getByRole("button", { name: "Unstar Second duct" }));

  expect(setJobPhotoFavourite).toHaveBeenCalledWith("job-1", "p-2", false);
  /* Still on the stage — the snapshot holds. */
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
  const viewer = screen.getByRole("dialog");
  await userEvent.click(within(viewer).getByRole("button", { name: "Unstar Second duct" }));

  await waitFor(() => expect(screen.getByText("3 starred photos")).toBeInTheDocument());
  expect(
    within(viewer).getByRole("button", { name: "Unstar Second duct" })
  ).toHaveAttribute("aria-pressed", "true");
});
