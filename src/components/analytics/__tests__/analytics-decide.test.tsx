/* The To decide tab: a row per question with what was read from the job,
   the answer drawn at once and put back with the action's words if it is
   refused, Undo, and no answers offered while they can't be kept. */
const refresh = jest.fn();
jest.mock("next/navigation", () => ({ useRouter: () => ({ push: jest.fn(), refresh }) }));
const decideJob = jest.fn();
jest.mock("@/app/actions/analytics-decide", () => ({ decideJob: (...a: unknown[]) => decideJob(...a) }));

import { act, fireEvent, render, screen } from "@testing-library/react";
import type { Ask } from "@/lib/analytics/job-analytics";
import { ToDecide } from "../analytics-decide";

const job = (id: string, over: Partial<Ask["job"]> = {}): Ask["job"] => ({
  id,
  status: "Completed",
  raisedOn: "2026-08-01",
  quoteSentOn: null,
  wonOn: null,
  completedOn: null,
  valueCents: 1_840_000,
  kind: "ducted",
  number: "3187",
  suburb: "Chatswood",
  brief: "Ducted install, unit 4, as per builder's plans",
  clientId: "co-1",
  ...over,
});

const asks: Ask[] = [
  { question: "quote", job: job("a"), answer: null, kind: "ducted" },
  { question: "outcome", job: job("b", { status: "Unsuccessful", paid: true, number: "2911", clientId: "co-2" }), answer: null, kind: "split" },
  { question: "price", job: job("c", { status: "Completed", kind: "split", valueCents: 9_650_000, clientId: null, number: "2977" }), answer: null, kind: "split", median: 395_000, times: 24.4 },
  { question: "kind", job: job("d", { kind: null }), answer: "vrf", kind: "vrf" },
];
const names = { "co-1": "Greenway Builders", "co-2": "K. Ahmed" };

beforeEach(() => {
  decideJob.mockReset();
  refresh.mockReset();
});

it("asks what can't be placed, each row with the job and what was read from it", () => {
  render(<ToDecide asks={asks} names={names} canDecide />);
  expect(screen.getByText("3 jobs to decide.")).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Is it a quote?" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "#3187 Greenway Builders" })).toHaveAttribute("href", "/dashboard/workboard?job=a");
  expect(screen.getByText("Reads like ducted work, and no quote was sent.")).toBeInTheDocument();
  expect(screen.getByText("Unsuccessful in ServiceM8, but marked paid.")).toBeInTheDocument();
  expect(screen.getByText("24 times the median wall split job, $3,950.")).toBeInTheDocument();
  // answered before this visit: out of the way, a press from the list
  expect(screen.queryByRole("heading", { name: "What kind of job?" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Show what was decided, 1" }));
  expect(screen.getByText("Counted as VRF.")).toBeInTheDocument();
});

it("keeps an answer at once, says what it did, and asks the page again", async () => {
  decideJob.mockResolvedValue({ ok: true });
  render(<ToDecide asks={asks} names={names} canDecide />);
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "A quote, won" }));
  });
  expect(decideJob).toHaveBeenCalledWith("a", "quote", "quote");
  expect(screen.getByText("A quote, won.")).toBeInTheDocument();
  expect(screen.getByText("2 jobs to decide.")).toBeInTheDocument();
  expect(refresh).toHaveBeenCalled();

  decideJob.mockResolvedValue({ ok: true });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
  });
  expect(decideJob).toHaveBeenLastCalledWith("a", "quote", null);
  expect(screen.getByRole("button", { name: "A quote, won" })).toBeInTheDocument();
});

it("puts the row back, with the action's words, when the answer is refused", async () => {
  decideJob.mockResolvedValue({ ok: false, error: "That didn't save. Try again." });
  render(<ToDecide asks={asks} names={names} canDecide />);
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Won" }));
  });
  expect(screen.getByRole("alert")).toHaveTextContent("That didn't save. Try again.");
  expect(screen.getByRole("button", { name: "Won" })).toBeInTheDocument();
  expect(screen.getByText("3 jobs to decide.")).toBeInTheDocument();
  expect(refresh).not.toHaveBeenCalled();
});

it("offers no answers while they can't be kept, and says why", () => {
  render(<ToDecide asks={asks} names={names} canDecide={false} />);
  expect(screen.getByText(/can.t be kept until the database is updated/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Count it" })).toBeDisabled();
});

it("says so when there is nothing to decide", () => {
  render(<ToDecide asks={[]} names={{}} canDecide />);
  expect(screen.getByText("Nothing to decide. Every job is in the figures.")).toBeInTheDocument();
});
