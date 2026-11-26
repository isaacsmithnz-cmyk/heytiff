/* Check the read, one question at a time (Isaac, 26 November 2026: "make
   check the read workflow smooth", then "Yes, build it" to the mock's second
   row). Drawn on a set like the one that raised it: a window and door plan
   read as a second ground floor, and a lower ground floor holding only its
   garage. */

import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { JobPlanPage, JobPlanRead } from "@/lib/jobs/plans";
import { CheckReadDialog } from "../check-read-dialog";
import { JobDocumentsFace } from "../job-documents-face";
import type { JobMediaItem } from "@/lib/workboard/job-media";

const room = (name: string) => ({ name, named: true, kind: "room" as const, outline: [], written: "", existing: false, openTo: "", stair: "" });
const sheet = (n: number, names: string[]) => ({ sheetId: `p${n}`, spaces: names.map(room), openings: [], marks: [], furniture: [], checklist: [], flags: [], planUp: "" });
const page = (n: number, level: number, name: string, title: string): JobPlanPage => ({
  n,
  kind: "floor",
  name,
  level,
  ref: `org/o/p${n}.png`,
  preview: `org/o/p${n}.jpeg`,
  width: 2400,
  height: 1697,
  mmPerPx: 17.5,
  scale: "1:100 @ A3",
  words: [
    { text: "Sheet Name :", at: { x: 1500, y: 1641 } },
    { text: title, at: { x: 1690, y: 1640 } },
  ],
});

const SET: JobPlanRead = {
  id: "jplan_1",
  jobUuid: "job-1",
  documentId: "d-1",
  attachmentId: null,
  name: "Drawing set.pdf",
  sourceRef: "org/o/src.pdf",
  sourceKind: "pdf",
  pageCount: 20,
  pages: [
    page(6, -1, "Lower Ground Floor", "Lower Ground Floor - Proposed"),
    page(8, 0, "Ground floor", "Ground Floor Plan - Proposed"),
    page(9, 1, "Level 1", "L1 - Proposed"),
    page(18, 0, "Ground floor", "Window & Door Plans"),
  ],
  reading: {
    at: "2026-11-26T09:07:00Z",
    model: "m",
    floors: { p6: [sheet(6, ["Garage"])], p8: [sheet(8, ["Bed 1", "Lounge"])], p9: [sheet(9, ["Study", "Bed 4"])], p18: [sheet(18, ["Bed 1", "Lounge"])] },
    failed: [],
    roof: null,
    site: null,
  },
  state: "check",
  said: "Page 6 has no rooms on it, so it may not be a floor plan. Pages 8 and 18 both read as Ground floor: choose which floor each is",
  addedBy: "Isaac Smith",
  addedAt: "2026-11-26T09:04:00Z",
  readAt: "2026-11-26T09:07:00Z",
  thumbs: { 6: "https://example.invalid/t6.jpg", 8: "https://example.invalid/t8.jpg", 9: "https://example.invalid/t9.jpg", 18: "https://example.invalid/t18.jpg" },
  usedBy: 0,
};

const open = (over: Partial<Parameters<typeof CheckReadDialog>[0]> = {}) => {
  const props = { plan: SET, onAnswer: jest.fn(async () => null as string | null), onDone: jest.fn(), onClose: jest.fn(), ...over };
  render(<CheckReadDialog {...props} />);
  return { props, dialog: screen.getByRole("dialog", { name: "Check the read" }) };
};

it("asks one question, with its pages big under their titles, Tiff's pick the main button and what each answer does", () => {
  const { dialog } = open();
  expect(within(dialog).getByText("Drawing set.pdf")).toBeInTheDocument();
  expect(within(dialog).getByText("Pages 8 and 18 both read as Ground floor. Which is the Ground floor plan?")).toBeInTheDocument();
  expect(within(dialog).getByText("Page 8 is titled Ground Floor Plan - Proposed. Page 18 is titled Window & Door Plans.")).toBeInTheDocument();
  expect(within(dialog).getByRole("button", { name: "Look at page 8" })).toBeInTheDocument();
  expect(within(dialog).getByRole("button", { name: "Look at page 18" })).toBeInTheDocument();
  expect(within(dialog).getByRole("button", { name: "Page 8 is the Ground floor" })).toHaveClass("pt-btn--main");
  expect(within(dialog).getByRole("button", { name: "Page 18 is the Ground floor" })).toHaveClass("pt-btn--second");
  expect(within(dialog).getByText("Page 18 leaves the floors, its picture kept")).toBeInTheDocument();
  expect(within(dialog).getByText("1 of 2")).toBeInTheDocument();
  expect(within(dialog).queryByRole("button", { name: "Back" })).toBeNull();
});

it("saves each answer on its pages as it's given, asks the next, and is done after the last", async () => {
  const { props, dialog } = open();
  await userEvent.click(within(dialog).getByRole("button", { name: "Page 8 is the Ground floor" }));
  expect(props.onAnswer).toHaveBeenLastCalledWith({ 8: "0", 18: "none" });
  expect(await within(dialog).findByText("Page 6 has one room on it, the garage. Is it the Lower Ground Floor?")).toBeInTheDocument();
  expect(within(dialog).getByText("It's titled Lower Ground Floor - Proposed.")).toBeInTheDocument();
  expect(within(dialog).getByText("2 of 2")).toBeInTheDocument();
  await userEvent.click(within(dialog).getByRole("button", { name: "Yes, the Lower Ground Floor" }));
  expect(props.onAnswer).toHaveBeenLastCalledWith({ 6: "-1" });
  expect(props.onDone).toHaveBeenCalledWith({ 8: "0", 18: "none", 6: "-1" }, 0);
  expect(props.onClose).not.toHaveBeenCalled();
});

it("goes back to the question before, and a skipped one is counted", async () => {
  const { props, dialog } = open();
  await userEvent.click(within(dialog).getByRole("button", { name: "Skip this question" }));
  await userEvent.click(await within(dialog).findByRole("button", { name: "Back" }));
  expect(within(dialog).getByText("1 of 2")).toBeInTheDocument();
  await userEvent.click(within(dialog).getByRole("button", { name: "Skip this question" }));
  await userEvent.click(within(dialog).getByRole("button", { name: "Not a floor plan" }));
  expect(props.onDone).toHaveBeenCalledWith({ 6: "none" }, 1);
});

it("closes as it was when every question is skipped", async () => {
  const { props, dialog } = open();
  await userEvent.click(within(dialog).getByRole("button", { name: "Skip this question" }));
  await userEvent.click(within(dialog).getByRole("button", { name: "Skip this question" }));
  expect(props.onClose).toHaveBeenCalled();
  expect(props.onDone).not.toHaveBeenCalled();
});

it("stays on a question whose answer didn't save, and says why", async () => {
  const { dialog } = open({ onAnswer: jest.fn(async () => "The floors couldn't be saved. Try again.") });
  await userEvent.click(within(dialog).getByRole("button", { name: "Page 8 is the Ground floor" }));
  expect(await within(dialog).findByRole("alert")).toHaveTextContent("The floors couldn't be saved. Try again.");
  expect(within(dialog).getByText("1 of 2")).toBeInTheDocument();
});

it("shows a page at its full size from its picture, the full pictures taking the thumbnails' place once they come", async () => {
  const loadPages = jest.fn(async () => [{ n: 8, url: "https://example.invalid/full8.png" }]);
  const { dialog } = open({ loadPages });
  await waitFor(() => expect(within(dialog).getByRole("button", { name: "Look at page 8" }).querySelector("img")).toHaveAttribute("src", "https://example.invalid/full8.png"));
  expect(within(dialog).getByRole("button", { name: "Look at page 18" }).querySelector("img")).toHaveAttribute("src", "https://example.invalid/t18.jpg");
  expect(loadPages).toHaveBeenCalledTimes(1);
  await userEvent.click(within(dialog).getByRole("button", { name: "Look at page 8" }));
  expect(within(dialog).getByRole("region", { name: "Page 8" })).toBeInTheDocument();
  expect(within(dialog).queryByRole("button", { name: "Page 8 is the Ground floor" })).toBeNull();
  await userEvent.click(within(dialog).getByRole("button", { name: "Back to the question" }));
  expect(within(dialog).getByRole("button", { name: "Page 8 is the Ground floor" })).toBeInTheDocument();
});

describe("from the job's Plans", () => {
  const file: JobMediaItem = { remoteId: "doc:d-1", documentId: "d-1", name: "Drawing set.pdf", fileType: ".pdf", kind: "document", origin: null, takenAt: null, url: "https://example.invalid/set.pdf", width: null, height: null, fromClaim: null };

  it("opens the questions from Check the read, and says what changed with an Undo that puts it back", async () => {
    const onAnswerFloors = jest.fn(async () => null as string | null);
    const onToast = jest.fn();
    render(<JobDocumentsFace documents={[file]} elsewhere={[]} designs={[]} loading={false} onOpen={() => {}} plans={[SET]} part="plans" onAnswerFloors={onAnswerFloors} onToast={onToast} onChooseFloors={async () => null} />);
    await userEvent.click(screen.getByRole("button", { name: "Check the read" }));
    const dialog = await screen.findByRole("dialog", { name: "Check the read" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Page 8 is the Ground floor" }));
    expect(onAnswerFloors).toHaveBeenLastCalledWith("jplan_1", { 8: "0", 18: "none" }, "these");
    await userEvent.click(await within(dialog).findByRole("button", { name: "Yes, the Lower Ground Floor" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Check the read" })).toBeNull());
    expect(onToast).toHaveBeenCalledWith("Plans checked. Page 18 left the floors", expect.any(Function));
    const undo = onToast.mock.calls[0][1] as () => Promise<void>;
    await undo();
    expect(onAnswerFloors).toHaveBeenLastCalledWith("jplan_1", { 6: "-1", 8: "0", 18: "0" }, "undo");
  });

  it("says how many questions are left when some were skipped", async () => {
    const onToast = jest.fn();
    render(<JobDocumentsFace documents={[file]} elsewhere={[]} designs={[]} loading={false} onOpen={() => {}} plans={[SET]} part="plans" onAnswerFloors={async () => null} onToast={onToast} />);
    await userEvent.click(screen.getByRole("button", { name: "Check the read" }));
    const dialog = await screen.findByRole("dialog", { name: "Check the read" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Both, each a part of it" }));
    await userEvent.click(await within(dialog).findByRole("button", { name: "Skip this question" }));
    expect(onToast).toHaveBeenCalledWith("Floors saved. 1 question left", expect.any(Function));
  });
});
