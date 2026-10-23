import { render, screen } from "@testing-library/react";
import { BookingCard } from "../schedule-board";
import type { DayBlock } from "@/lib/schedule/board";

jest.mock("next/navigation", () => ({ useRouter: () => ({ push: jest.fn(), refresh: jest.fn(), prefetch: jest.fn() }) }));
jest.mock("@/app/actions/booking-sm8", () => ({ bookJobIn: jest.fn(), readBookInContext: jest.fn(), takeBackBooking: jest.fn() }));
jest.mock("@/app/actions/schedule-panel", () => ({ loadSchedulePanel: jest.fn() }));
jest.mock("@/components/making/regular-days-off-form", () => ({ RegularDaysOffForm: () => null }));

/* A booking's card (Isaac, 23 October 2026, E of "Schedule card colour"):
   the job number in a coloured box, a coloured hairline, the rest white. */

const blk = (over: Partial<DayBlock> = {}): DayBlock => ({
  key: "a1",
  jobUuid: "job-3401",
  number: "3401",
  client: "Vix",
  suburb: "Bondi Beach",
  hue: "purple",
  startMin: 420,
  endMin: 900,
  with: ["David Hann"],
  kind: "Install",
  state: "onsite",
  ...over,
});

const draw = (b: DayBlock, clash = false) =>
  render(<BookingCard blk={b} crew={b.with.length + 1} when="7 to 3" clash={clash} className="sc-blk" style={{}} />).container.querySelector("a")!;

it("puts the job number in a box of the job's colour, and the client, suburb, type, time, crew and state on three lines", () => {
  const card = draw(blk());
  expect(card).toHaveClass("sc-card", "sc-card--purple");
  expect(card).toHaveAttribute("href", expect.stringContaining("job-3401"));
  expect(card.querySelector(".sc-cn")).toHaveTextContent("3401");
  expect(card.querySelector(".sc-c1")).toHaveTextContent("Vix");
  expect(card.querySelector(".sc-c2")).toHaveTextContent("Bondi Beach");
  const third = card.querySelector(".sc-c3") as HTMLElement;
  expect(third).toHaveTextContent("Install");
  expect(third).toHaveTextContent("7 to 3");
  expect(screen.getByLabelText("2 people booked")).toHaveTextContent("2");
  expect(screen.getByText("On site").closest(".pt-state")).toHaveClass("pt-state--good");
  /* no names of the crew on the card: the count says it */
  expect(card).not.toHaveTextContent("David");
});

it("turns a done card's colour grey, and says Done", () => {
  const card = draw(blk({ state: "done" }));
  expect(card).toHaveClass("sc-card--grey");
  expect(screen.getByText("Done")).toBeInTheDocument();
});

it("wears an orange edge when it clashes, and says nothing of state while just booked", () => {
  const card = draw(blk({ state: null, with: [] }), true);
  expect(card).toHaveClass("sc-clash");
  expect(card.querySelector(".pt-state")).toBeNull();
  expect(screen.getByLabelText("1 person booked")).toBeInTheDocument();
});

it("says a job that didn't go ahead in red", () => {
  draw(blk({ state: "unsuccessful", hue: "red" }));
  expect(screen.getByText("Didn't go ahead").closest(".pt-state")).toHaveClass("pt-state--wrong");
});
