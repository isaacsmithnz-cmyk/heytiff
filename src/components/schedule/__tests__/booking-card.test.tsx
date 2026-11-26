import { render, screen } from "@testing-library/react";
import { BookingCard, DayCard, TeamCard } from "../schedule-board";
import type { DayBlock } from "@/lib/schedule/board";

jest.mock("next/navigation", () => ({ useRouter: () => ({ push: jest.fn(), refresh: jest.fn(), prefetch: jest.fn() }) }));
jest.mock("@/app/actions/booking-sm8", () => ({ bookJobIn: jest.fn(), readBookInContext: jest.fn(), takeBackBooking: jest.fn() }));
jest.mock("@/app/actions/schedule-panel", () => ({ loadSchedulePanel: jest.fn() }));
jest.mock("@/components/making/regular-days-off-form", () => ({ RegularDaysOffForm: () => null }));
jest.mock("@/app/actions/schedule-blocks", () => ({ makeScheduleBlock: jest.fn(), placeScheduleBlock: jest.fn(), unplaceScheduleBlock: jest.fn(), removeScheduleBlock: jest.fn() }));

/* A booking's card (Isaac, 23 October 2026, E of "Schedule card colour"):
   the job number in a coloured box, a coloured hairline, the rest white. */

const blk = (over: Partial<DayBlock> = {}): DayBlock => ({
  key: "a1",
  jobUuid: "job-3401",
  number: "3401",
  client: "Val",
  suburb: "Fictonia Beach",
  hue: "purple",
  startMin: 420,
  endMin: 900,
  with: ["David Hann"],
  kind: "Install",
  street: null,
  about: null,
  state: "onsite",
  ...over,
});

const draw = (b: DayBlock, clash = false) =>
  render(<BookingCard blk={b} crew={b.with.length + 1} when="7 am" clash={clash} className="sc-blk" style={{}} />).container.querySelector("a")!;

it("puts the job number in a box of the job's colour, and the client, suburb, type, time, crew and state on three lines", () => {
  const card = draw(blk());
  expect(card).toHaveClass("sc-card", "sc-card--purple");
  expect(card).toHaveAttribute("href", expect.stringContaining("job-3401"));
  expect(card.querySelector(".sc-cn")).toHaveTextContent("3401");
  expect(card.querySelector(".sc-c1")).toHaveTextContent("Val");
  expect(card.querySelector(".sc-c2")).toHaveTextContent("Fictonia Beach");
  const third = card.querySelector(".sc-c3") as HTMLElement;
  expect(third).toHaveTextContent("Install");
  expect(third).toHaveTextContent("7 am");
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

describe("the Day's cards (the Schedule mock, 27 November 2026)", () => {
  it("starts a booking with its time, then the client, the suburb and the kind, and no hairline count", () => {
    const card = render(<DayCard blk={blk()} style={{}} />).container.querySelector("a")!;
    expect(card).toHaveClass("sc-dcard", "sc-card--purple");
    expect(card.querySelector(".sc-c0")).toHaveTextContent("7 am");
    expect(card.querySelector(".sc-c0")).toHaveTextContent("On site");
    expect(card.querySelector(".sc-c1")).toHaveTextContent("Val");
    expect(card.querySelector(".sc-c2")).toHaveTextContent("Fictonia Beach");
    expect(card.querySelector(".sc-c4")).toHaveTextContent("Install");
  });

  it("draws a team's booking once with its hours, the street whole, its people by first name and what the job is", () => {
    const team = { key: "job-3401|420|900", blk: blk({ street: "14 Example St", about: "Ducted system, rough-in of the second floor" }), staff: ["a", "b", "c"], names: ["Ava Fake", "Ben Fake", "Cal Fake"] };
    const card = render(<TeamCard team={team} style={{}} />).container.querySelector("a")!;
    expect(card).toHaveClass("sc-tcard");
    expect(card).toHaveAttribute("data-span", "3");
    expect(card.querySelector(".sc-tw")).toHaveTextContent("7 am to 3 pm");
    expect(card.querySelector(".sc-ta")).toHaveTextContent("14 Example St, Fictonia Beach");
    expect(screen.getByLabelText("3 people booked: Ava, Ben and Cal")).toHaveTextContent("3Ava, Ben and Cal");
    expect(card).toHaveTextContent("Ducted system, rough-in of the second floor");
    /* David is on the job elsewhere in the day: the team's card counts only the team */
    expect(card).not.toHaveTextContent("David");
  });
});
