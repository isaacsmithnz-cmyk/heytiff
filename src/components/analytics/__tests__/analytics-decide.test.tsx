/* The To decide tab: a row per question with what was read from the job,
   the answer drawn at once and put back with the action's words if it is
   refused, Undo, and no answers offered while they can't be kept. */
const refresh = jest.fn();
jest.mock("next/navigation", () => ({ useRouter: () => ({ push: jest.fn(), refresh }) }));
const decideJob = jest.fn();
jest.mock("@/app/actions/analytics-decide", () => ({ decideJob: (...a: unknown[]) => decideJob(...a) }));
const makeWorkOrder = jest.fn();
jest.mock("@/app/actions/booking-sm8", () => ({ makeWorkOrder: (...a: unknown[]) => makeWorkOrder(...a) }));

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
  makeWorkOrder.mockReset();
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

describe("the clean-up in ServiceM8", () => {
  const JOB = "3f6c0a2e-1b4d-4e8a-9c7f-2d5e8b1a0c93";
  const accepted: Ask = {
    question: "outcome",
    job: job(JOB, { status: "Quote", acceptedInHeyTiff: true, number: "3008", clientId: "co-1" }),
    answer: null,
    kind: "split",
  };

  it("offers the job card's Make it a work order once a Quote is answered won, and the change stands with no Undo", async () => {
    decideJob.mockResolvedValue({ ok: true });
    makeWorkOrder.mockResolvedValue({ ok: true, state: "sent", rowId: "row-1" });
    render(<ToDecide asks={[accepted]} names={names} canDecide workOrders="on" />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Won" }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Make it a work order in ServiceM8" }));
    });
    expect(makeWorkOrder).toHaveBeenCalledWith({ jobUuid: JOB, pressId: expect.stringMatching(/^[0-9a-f-]{36}$/) });
    expect(screen.getByText("A work order in ServiceM8 now.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Undo" })).not.toBeInTheDocument();
  });

  it("says what ServiceM8 refused, and keeps the press", async () => {
    makeWorkOrder.mockResolvedValue({ ok: false, error: "Sending bookings to ServiceM8 is paused." });
    render(<ToDecide asks={[{ ...accepted, answer: "won" }]} names={names} canDecide workOrders="on" />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Make it a work order in ServiceM8" }));
    });
    expect(screen.getByRole("alert")).toHaveTextContent("Sending bookings to ServiceM8 is paused.");
    expect(screen.getByRole("button", { name: "Make it a work order in ServiceM8" })).toBeEnabled();
  });

  it("keeps an earlier answer ServiceM8 still disagrees with in view, and opens the job there where HeyTiff can't write it", () => {
    render(<ToDecide asks={[{ ...accepted, answer: "lost" }]} names={names} canDecide workOrders="on" />);
    expect(screen.getByText(/ServiceM8 still says Quote/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open in ServiceM8" })).toHaveAttribute("href", `https://go.servicem8.com/OpenJob/${JOB}`);
    expect(screen.queryByRole("button", { name: "Make it a work order in ServiceM8" })).not.toBeInTheDocument();
  });

  it("opens the job in ServiceM8 instead when this viewer can't make work orders from here", () => {
    render(<ToDecide asks={[{ ...accepted, answer: "won" }]} names={names} canDecide workOrders={null} />);
    expect(screen.getByRole("link", { name: "Open in ServiceM8" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Make it a work order in ServiceM8" })).not.toBeInTheDocument();
  });

  it("makes every waiting work order with one press", async () => {
    const second: Ask = { ...accepted, job: { ...accepted.job, id: "9a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d" }, answer: "won" };
    makeWorkOrder.mockResolvedValue({ ok: true, state: "waiting", rowId: "r" });
    render(<ToDecide asks={[{ ...accepted, answer: "won" }, second]} names={names} canDecide workOrders="on" />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Make 2 work orders in ServiceM8" }));
    });
    expect(makeWorkOrder).toHaveBeenCalledTimes(2);
    expect(screen.getAllByText("On its way to ServiceM8.")).toHaveLength(2);
  });
});

describe("void", () => {
  it("offers Void on every question, and once void the job says so, with Undo and ServiceM8", async () => {
    decideJob.mockResolvedValue({ ok: true });
    const JOB = "5d1e2f3a-4b5c-4d6e-8f7a-9b0c1d2e3f4a";
    render(<ToDecide asks={[{ question: "quote", job: job(JOB), answer: null, kind: "ducted" }]} names={names} canDecide />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Void" }));
    });
    expect(decideJob).toHaveBeenCalledWith(JOB, "void", "void");
    expect(screen.getByText("Void. Left out of every figure.")).toBeInTheDocument();
    expect(screen.getByText("Nothing to decide. Every job is in the figures.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open in ServiceM8" })).toHaveAttribute("href", `https://go.servicem8.com/OpenJob/${JOB}`);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    });
    expect(decideJob).toHaveBeenLastCalledWith(JOB, "void", null);
    expect(screen.getByRole("button", { name: "A quote, won" })).toBeInTheDocument();
  });

  it("lists the jobs already void, folded, each with Undo", async () => {
    decideJob.mockResolvedValue({ ok: true });
    render(<ToDecide asks={[]} names={names} canDecide voided={[job("v1", { number: "3100" })]} />);
    expect(screen.getByRole("heading", { name: "Void" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show the 1 void job" }));
    expect(screen.getByRole("link", { name: "#3100 Greenway Builders" })).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    });
    expect(decideJob).toHaveBeenCalledWith("v1", "void", null);
    expect(screen.getByRole("button", { name: "Void" })).toBeInTheDocument();
  });
});
