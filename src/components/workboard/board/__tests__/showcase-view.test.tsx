import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ShowcasePhoto } from "@/app/actions/job-photo-favourites";

/* THE SHOWCASE — the starred set, filed by what each picture is of.

   Both actions are mocked for their content, and would have to be mocked
   regardless: a `"use server"` module drags `next/cache` into jsdom, where
   `Request` is undefined and the suite dies at import time. */
const listShowcase = jest.fn(async (): Promise<ShowcasePhoto[]> => []);
const readShowcasePhotos = jest.fn(
  async (): Promise<{ ok: boolean; read: number; remaining: number; note: string | null }> => ({
    ok: true,
    read: 0,
    remaining: 0,
    note: null,
  })
);
jest.mock("@/app/actions/job-photo-favourites", () => ({
  listShowcase: (...a: unknown[]) => listShowcase(...(a as [])),
  readShowcasePhotos: (...a: unknown[]) => readShowcasePhotos(...(a as [])),
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
  readAt: null,
  addedAt: "2026-08-29T01:29:06Z",
  ...over,
});

beforeEach(() => {
  listShowcase.mockReset();
  readShowcasePhotos.mockReset();
  listShowcase.mockResolvedValue([]);
  readShowcasePhotos.mockResolvedValue({ ok: true, read: 0, remaining: 0, note: null });
});

it("says what the showcase is for when nothing is starred", async () => {
  render(<ShowcaseView manage />);
  expect(await screen.findByText("Nothing starred yet")).toBeInTheDocument();
  /* No filter row and no reader on an empty gallery — a row of zero chips
     and a button that would read nothing are both furniture. */
  expect(screen.queryByRole("tablist")).toBeNull();
  expect(screen.queryByRole("button", { name: /Read/ })).toBeNull();
});

it("files the photos under what they are of, and filters to one", async () => {
  listShowcase.mockResolvedValue([
    photo({ remoteId: "p-1", subject: "dataplate", readAt: "2026-08-29T02:00:00Z", caption: "Rating plate on the outdoor unit" }),
    photo({ remoteId: "p-2", subject: "ductwork", readAt: "2026-08-29T02:00:00Z", caption: "Flexible duct into a ceiling plenum" }),
    photo({ remoteId: "p-3", subject: "ductwork", readAt: "2026-08-29T02:00:00Z", caption: "Rigid duct run above the bulkhead" }),
  ]);
  render(<ShowcaseView manage />);

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

/* MONEY IS NEVER SPENT ON OPEN. Reading is behind a button somebody presses —
   a gallery that quietly billed for every photo the moment you looked at it
   would be a surprise on an invoice. */
it("does not read anything until it is asked to", async () => {
  listShowcase.mockResolvedValue([photo({ remoteId: "p-1" })]);
  render(<ShowcaseView manage />);
  await screen.findByRole("button", { name: "Read 1 photo" });
  expect(readShowcasePhotos).not.toHaveBeenCalled();
});

it("keeps reading while the outstanding count falls, and repaints as it goes", async () => {
  listShowcase.mockResolvedValue([photo({ remoteId: "p-1" }), photo({ remoteId: "p-2" })]);
  readShowcasePhotos
    .mockResolvedValueOnce({ ok: true, read: 1, remaining: 1, note: null })
    .mockResolvedValueOnce({ ok: true, read: 1, remaining: 0, note: null });

  render(<ShowcaseView manage />);
  await userEvent.click(await screen.findByRole("button", { name: "Read 2 photos" }));

  await waitFor(() => expect(readShowcasePhotos).toHaveBeenCalledTimes(2));
  /* Re-read after every round, not once at the end: a photo that has been
     placed shows its subject while the rest are still being looked at. */
  expect(listShowcase.mock.calls.length).toBeGreaterThan(2);
});

/* THE BRAKE. A server that keeps saying the same number while reading none
   would loop forever and spend real money doing it, so a count that fails to
   fall is the loop's signal to stop — not a reason to try again. */
it("stops when the outstanding count stops falling", async () => {
  listShowcase.mockResolvedValue([photo({ remoteId: "p-1" }), photo({ remoteId: "p-2" })]);
  readShowcasePhotos.mockResolvedValue({ ok: true, read: 1, remaining: 2, note: null });

  render(<ShowcaseView manage />);
  await userEvent.click(await screen.findByRole("button", { name: "Read 2 photos" }));

  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Read 2 photos" })).toBeEnabled()
  );
  expect(readShowcasePhotos.mock.calls.length).toBeLessThanOrEqual(2);
});

it("stops on a refusal and says what it was told", async () => {
  listShowcase.mockResolvedValue([photo({ remoteId: "p-1" })]);
  readShowcasePhotos.mockResolvedValue({
    ok: false,
    read: 0,
    remaining: 1,
    note: "Tiff is offline — no key.",
  });

  render(<ShowcaseView manage />);
  await userEvent.click(await screen.findByRole("button", { name: "Read 1 photo" }));

  expect(await screen.findByText("Tiff is offline — no key.")).toBeInTheDocument();
  expect(readShowcasePhotos).toHaveBeenCalledTimes(1);
});

/* A reader without `manage` sees the gallery and cannot spend on it. */
it("offers the reader only to somebody who manages the board", async () => {
  listShowcase.mockResolvedValue([photo({ remoteId: "p-1" })]);
  render(<ShowcaseView manage={false} />);
  await screen.findByText("1 starred photo");
  expect(screen.queryByRole("button", { name: /Read/ })).toBeNull();
});

/* An unread photo has no subject, and must not be filed under one. It gets
   its own way in instead, so the queue is visible rather than invisible. */
it("keeps the unread ones reachable without inventing a subject for them", async () => {
  listShowcase.mockResolvedValue([
    photo({ remoteId: "p-1", subject: "fault", readAt: "2026-08-29T02:00:00Z", caption: "Split in the insulation" }),
    photo({ remoteId: "p-2", caption: "" }),
  ]);
  render(<ShowcaseView manage />);

  const filters = await screen.findByRole("tablist", { name: "What the photo is of" });
  expect(within(filters).getByRole("tab", { name: /Damage or fault · 1/ })).toBeInTheDocument();
  await userEvent.click(within(filters).getByRole("tab", { name: "Not read yet · 1" }));
  expect(screen.queryByText("Split in the insulation")).toBeNull();
});
