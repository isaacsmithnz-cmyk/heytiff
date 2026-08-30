import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ShowcasePhoto } from "@/app/actions/job-photo-favourites";
import type { PhotoHit } from "@/app/actions/photo-search";

/* THE SHOWCASE — the starred set, drawn with what the bank knows about each
   picture. It SPENDS NOTHING: reading happens when a job card is opened, not
   here, so there is only one action to mock.

   Mocked at all for the usual reason: a `"use server"` module drags
   `next/cache` into jsdom, where `Request` is undefined and the suite dies at
   import time. */
const listShowcase = jest.fn(async (): Promise<ShowcasePhoto[]> => []);
jest.mock("@/app/actions/job-photo-favourites", () => ({
  listShowcase: (...a: unknown[]) => listShowcase(...(a as [])),
}));
const searchPhotos = jest.fn(
  async (): Promise<{ ok: boolean; hits: PhotoHit[]; banked: number; capped: boolean }> => ({
    ok: true,
    hits: [],
    banked: 0,
    capped: false,
  })
);
jest.mock("@/app/actions/photo-search", () => ({
  searchPhotos: (...a: unknown[]) => searchPhotos(...(a as [])),
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

const hit = (over: Partial<PhotoHit> & { remoteId: string }): PhotoHit => ({
  jobUuid: "job-1",
  jobNumber: "907",
  clientName: "Heuvel Construction",
  name: "Photo",
  takenAt: "2026-08-28 13:25:00",
  subject: "dataplate",
  tags: [],
  caption: "Mitsubishi outdoor unit rating plate",
  ocrText: "MODEL PUZ-M125VKA2-A SERIAL 0081 R32 230V",
  url: "https://signed/p.jpg",
  readAt: "2026-08-29T02:00:00Z",
  match: { text: false, transcript: true, caption: false, tag: false },
  ...over,
});

beforeEach(() => {
  jest.useRealTimers();
  listShowcase.mockReset();
  listShowcase.mockResolvedValue([]);
  searchPhotos.mockReset();
  searchPhotos.mockResolvedValue({ ok: true, hits: [], banked: 0, capped: false });
});

it("says what the showcase is for when nothing is starred", async () => {
  render(<ShowcaseView />);
  expect(await screen.findByText("Nothing starred yet")).toBeInTheDocument();
  /* No filter row on an empty gallery — a row of zero chips is furniture. */
  expect(screen.queryByRole("tablist")).toBeNull();
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

/* ── searching the bank ────────────────────────────────────────────────── */

/* THE BOX IS ALWAYS THERE. The bank it searches is not the starred set, so an
   empty showcase says nothing about whether there is anything to find —
   hiding the box until somebody stars a photo would hide the whole feature
   behind an unrelated act. */
it("offers the search box even when nothing has been starred", async () => {
  listShowcase.mockResolvedValue([]);
  render(<ShowcaseView />);
  expect(await screen.findByLabelText("Search photos")).toBeInTheDocument();
  expect(screen.getByText("Nothing starred yet")).toBeInTheDocument();
});

/* One character matches most of the bank and tells nobody anything. */
it("does not ask the server about a single character", async () => {
  render(<ShowcaseView />);
  await userEvent.type(await screen.findByLabelText("Search photos"), "d");
  await new Promise((r) => setTimeout(r, 400));
  expect(searchPhotos).not.toHaveBeenCalled();
});

it("searches the whole bank and replaces the curated grid", async () => {
  listShowcase.mockResolvedValue([
    photo({ remoteId: "star-1", read: true, subject: "ductwork", caption: "A starred duct" }),
  ]);
  searchPhotos.mockResolvedValue({
    ok: true,
    hits: [hit({ remoteId: "bank-1" })],
    banked: 84,
    capped: false,
  });

  render(<ShowcaseView />);
  await screen.findByText("A starred duct");
  await userEvent.type(await screen.findByLabelText("Search photos"), "PUZ-M125");

  /* The result is a photo that was never starred — the whole point. */
  expect(await screen.findByText("Mitsubishi outdoor unit rating plate")).toBeInTheDocument();
  /* And the curated set is GONE, not filtered: mixing them would leave a
     reader unable to tell which set they were looking at. */
  expect(screen.queryByText("A starred duct")).toBeNull();
});

/* "Nothing found" against a bank of twelve means something completely
   different from nothing found against four thousand. */
it("says how much has been read, so an empty result is honest", async () => {
  searchPhotos.mockResolvedValue({ ok: true, hits: [], banked: 84, capped: false });
  render(<ShowcaseView />);
  await userEvent.type(await screen.findByLabelText("Search photos"), "kangaroo");
  expect(await screen.findByText(/84 photos read so far/)).toBeInTheDocument();
  expect(screen.getByText("No photo matches that")).toBeInTheDocument();
});

/* An empty bank is a different problem with a different answer, and saying
   "no match" would send somebody hunting for a better search term when what
   they actually need is to open a job. */
it("distinguishes an empty bank from a bad query", async () => {
  searchPhotos.mockResolvedValue({ ok: true, hits: [], banked: 0, capped: false });
  render(<ShowcaseView />);
  await userEvent.type(await screen.findByLabelText("Search photos"), "ductwork");
  expect(await screen.findByText("Nothing has been read yet")).toBeInTheDocument();
});

/* A hit on a model number is otherwise invisible — the picture shows a plate
   and the words that found it are printed on it. */
it("shows the transcription that matched, not just the picture", async () => {
  searchPhotos.mockResolvedValue({
    ok: true,
    hits: [hit({ remoteId: "bank-1" })],
    banked: 84,
    capped: false,
  });
  render(<ShowcaseView />);
  await userEvent.type(await screen.findByLabelText("Search photos"), "PUZ-M125");
  expect(await screen.findByText(/PUZ-M125VKA2-A/)).toBeInTheDocument();
});

it("puts the curated set back when the box is cleared", async () => {
  listShowcase.mockResolvedValue([
    photo({ remoteId: "star-1", read: true, subject: "ductwork", caption: "A starred duct" }),
  ]);
  searchPhotos.mockResolvedValue({
    ok: true,
    hits: [hit({ remoteId: "bank-1" })],
    banked: 84,
    capped: false,
  });

  render(<ShowcaseView />);
  const input = await screen.findByLabelText("Search photos");
  await userEvent.type(input, "PUZ");
  await screen.findByText("Mitsubishi outdoor unit rating plate");

  await userEvent.click(screen.getByLabelText("Clear search"));
  expect(await screen.findByText("A starred duct")).toBeInTheDocument();
  expect(screen.queryByText("Mitsubishi outdoor unit rating plate")).toBeNull();
});

/* THE AS-YOU-TYPE RACE. A slow query for "duct" can land AFTER a fast one for
   "ductwork" and paint the wrong photos under the right word. Only the last
   query's answer may reach the screen.

   BOTH answers are held open deliberately and released in the wrong order —
   an earlier version of this test let the debounce cancel the first call
   before it was ever in flight, so it passed with the guard removed and
   proved nothing. */
it("ignores a slow answer that arrives after a newer one", async () => {
  listShowcase.mockResolvedValue([]);
  const release: Record<string, (hits: PhotoHit[]) => void> = {};
  searchPhotos.mockImplementation(
    (...args: unknown[]) =>
      new Promise((resolve) => {
        release[args[0] as string] = (hits) =>
          resolve({ ok: true, hits, banked: 84, capped: false });
      })
  );

  render(<ShowcaseView />);
  const input = await screen.findByLabelText("Search photos");

  await userEvent.type(input, "duct");
  await waitFor(() => expect(release["duct"]).toBeDefined());
  await userEvent.type(input, "work");
  await waitFor(() => expect(release["ductwork"]).toBeDefined());

  /* The NEWER query answers first... */
  release["ductwork"]([hit({ remoteId: "fresh", caption: "FRESH ANSWER" })]);
  expect(await screen.findByText("FRESH ANSWER")).toBeInTheDocument();

  /* ...and the older one only now comes back. It must not overwrite it.

     RELEASED INSIDE `act`, or the assertions below run before React has
     processed the stale update and the test passes for the wrong reason —
     which is exactly how the first version of this passed with the guard
     deleted. */
  await act(async () => {
    release["duct"]([hit({ remoteId: "stale", caption: "STALE ANSWER" })]);
    await Promise.resolve();
  });
  expect(screen.queryByText("STALE ANSWER")).toBeNull();
  expect(screen.getByText("FRESH ANSWER")).toBeInTheDocument();
});
