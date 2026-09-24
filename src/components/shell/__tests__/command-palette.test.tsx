/* ⌘K finds jobs as well as screens (2026-09-24). Isaac typed "job 288" into
   it and was told it only jumps between screens. It asks the whole ServiceM8
   mirror now — the same search the Workboard's own box reaches past its
   window with — and a job opens on the Workboard with its card up.

   What these pin: the word in front of the number is not asked for; nothing
   says "no match" before the jobs have answered; only the newest question
   may answer; the keys walk from the screens into the jobs; and nobody
   without the Workboard is sent to ask. */

import { act, fireEvent, render, screen } from "@testing-library/react";
import type { AllJobsMirrorJob } from "@/lib/workboard/all-jobs";
import type { Capability } from "@/lib/permissions";

const push = jest.fn();
jest.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

const close = jest.fn();
let isOpen = true;
jest.mock("../command-palette-context", () => ({
  useCommandPalette: () => ({ isOpen, close }),
}));

const searchAllJobs = jest.fn();
jest.mock("@/app/actions/workboard", () => ({
  searchAllJobs: (...a: unknown[]) => searchAllJobs(...a),
}));

import { CommandPalette } from "../command-palette";

const job = (over: Partial<AllJobsMirrorJob> = {}): AllJobsMirrorJob => ({
  remoteId: "j-288",
  jobNumber: "288",
  status: "Completed",
  clientName: "Kingsford Bakery",
  description: "Replace the split in the office",
  suburb: "Kingsford",
  categoryName: null,
  categoryColour: null,
  date: "2024-03-02 09:00:00",
  quoteDate: null,
  completionDate: "2024-03-04 15:00:00",
  nextBooking: null,
  money: null,
  paidCents: 0,
  ...over,
});

/** A promise the test resolves when it chooses — an answer still on its way. */
function later<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

const WORKBOARD: Capability[] = ["workboard"];

const palette = (caps: readonly Capability[] = WORKBOARD) =>
  render(<CommandPalette role="staff" caps={caps} />);

const box = () => screen.getByRole("textbox");
const type = (value: string) => fireEvent.change(box(), { target: { value } });
const press = (key: string) => fireEvent.keyDown(window, { key });
/** Past the pause the palette waits before asking, and past the answer. */
const settle = async () => {
  await act(async () => {
    jest.advanceTimersByTime(250);
  });
  await act(async () => {});
};

beforeEach(() => {
  jest.useFakeTimers();
  push.mockClear();
  close.mockClear();
  searchAllJobs.mockReset();
  searchAllJobs.mockResolvedValue([]);
  isOpen = true;
});
afterEach(() => jest.useRealTimers());

describe("the palette finds jobs", () => {
  it("finds job 288 asked the way people ask for it, and opens its card", async () => {
    searchAllJobs.mockResolvedValue([job()]);
    palette();

    type("job 288");
    expect(searchAllJobs).not.toHaveBeenCalled(); // not per keystroke
    await settle();

    expect(searchAllJobs).toHaveBeenCalledTimes(1);
    expect(searchAllJobs).toHaveBeenCalledWith("288");
    expect(screen.getByText("ServiceM8 jobs")).toBeInTheDocument();
    const row = screen.getByRole("button", { name: /#288 Kingsford Bakery/ });
    expect(row).toHaveTextContent("Replace the split in the office");
    expect(row).toHaveTextContent("Completed");

    press("Enter");
    expect(close).toHaveBeenCalled();
    expect(push).toHaveBeenCalledWith("/dashboard/workboard?job=j-288");
  });

  it("opens a job from a click as well", async () => {
    searchAllJobs.mockResolvedValue([job({ remoteId: "j/odd id" })]);
    palette();
    type("288");
    await settle();

    fireEvent.click(screen.getByRole("button", { name: /#288 Kingsford Bakery/ }));
    expect(push).toHaveBeenCalledWith("/dashboard/workboard?job=j%2Fodd%20id");
  });

  it("says it is searching, and never 'no match', until the jobs have answered", async () => {
    const answer = later<AllJobsMirrorJob[]>();
    searchAllJobs.mockReturnValue(answer.promise);
    palette();

    type("job 288");
    expect(screen.getByText("Searching jobs…")).toBeInTheDocument();
    await settle();
    expect(screen.getByText("Searching jobs…")).toBeInTheDocument();
    expect(screen.queryByText(/matches/)).toBeNull();

    await act(async () => answer.resolve([]));
    expect(screen.getByText(/No screen or job matches/)).toHaveTextContent(
      "No screen or job matches “job 288”"
    );
  });

  it("lets only the newest question answer", async () => {
    const first = later<AllJobsMirrorJob[]>();
    const second = later<AllJobsMirrorJob[]>();
    searchAllJobs.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    palette();

    type("job 28");
    await settle();
    type("job 288");
    await settle();

    await act(async () => second.resolve([job()]));
    // the older, slower answer lands last and must not be painted
    await act(async () => first.resolve([job({ remoteId: "j-28", jobNumber: "28" })]));

    expect(screen.getByRole("button", { name: /#288 Kingsford Bakery/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /#28 Kingsford/ })).toBeNull();
  });

  it("puts the screens first and walks the keys on into the jobs", async () => {
    searchAllJobs.mockResolvedValue([job({ remoteId: "j-9", jobNumber: "2380" })]);
    palette();
    type("workboard");
    await settle();

    const screenRow = screen.getByRole("button", { name: /^Workboard/ });
    const jobRow = screen.getByRole("button", { name: /#2380 Kingsford Bakery/ });
    expect(screenRow.compareDocumentPosition(jobRow) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screenRow).toHaveClass("on");

    press("ArrowDown");
    expect(jobRow).toHaveClass("on");
    press("Enter");
    expect(push).toHaveBeenCalledWith("/dashboard/workboard?job=j-9");
  });

  it("does not ask for one character, or for the word 'job' alone", async () => {
    palette();
    type("job 2");
    await settle();
    type("job");
    await settle();
    expect(searchAllJobs).not.toHaveBeenCalled();
  });

  it("starts clean when it opens again", async () => {
    searchAllJobs.mockResolvedValue([job()]);
    const { rerender } = palette();
    type("job 288");
    await settle();
    expect(screen.getByRole("button", { name: /#288/ })).toBeInTheDocument();

    isOpen = false;
    rerender(<CommandPalette role="staff" caps={WORKBOARD} />);
    isOpen = true;
    rerender(<CommandPalette role="staff" caps={WORKBOARD} />);

    expect(box()).toHaveValue("");
    expect(screen.queryByRole("button", { name: /#288/ })).toBeNull();
  });
});

describe("without the Workboard", () => {
  it("never asks, and says what it did look through", async () => {
    palette([]);
    expect(box()).toHaveAttribute("placeholder", "Jump to a screen…");

    type("job 288");
    await settle();

    expect(searchAllJobs).not.toHaveBeenCalled();
    expect(screen.getByText(/No screen matches/)).toHaveTextContent("No screen matches “job 288”");
  });
});
