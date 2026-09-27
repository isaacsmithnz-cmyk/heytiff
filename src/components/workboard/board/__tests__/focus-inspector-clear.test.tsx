/* A LEFTOVER'S CLEAR ON THE SCHEDULE (two-way phase 3, PR D): D-8.

   The inspector's crew list gives each leftover booking its own Clear
   booking — only a leftover, only where the viewer may press and bookings
   are offered (canClear) — asked in place, and each clears its own booking.
   A booking later today on a job completed this morning is a leftover,
   though the Schedule itself draws it "Done and closed": the mark is the
   server's (isLeftover), copied onto the block, never the rail's closure. */

import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { BookingLineResult } from "@/app/actions/booking-sm8";
import { BOOKING_WORDS } from "@/lib/integrations/sm8-booking-plan";

const clearLeftoverBooking = jest.fn(
  async (_i: { jobUuid: string; activityUuid: string; seen: { staffUuid: string; start: string }; pressId: string }): Promise<BookingLineResult> => ({
    ok: true,
    line: null,
  })
);
jest.mock("@/app/actions/booking-sm8", () => ({
  clearLeftoverBooking: (...a: unknown[]) => clearLeftoverBooking(...(a as [never])),
}));

import { FocusInspector } from "../focus-inspector";
import { layoutScheduleDay, type ScheduleActivity } from "@/lib/workboard/schedule";
import { focusJobOf } from "@/lib/workboard/focus";
import type { AllJobsMirrorJob } from "@/lib/workboard/all-jobs";

const DAY = "2026-10-06";
const JOB = "0b1e0b1e-0000-4000-8000-00000000d002";
const SAM = "5a0e5a0e-0000-4000-8000-00000000a001";
const ALEX = "5a0e5a0e-0000-4000-8000-00000000a002";
const MORNING = "7e7e7e7e-0000-4000-8000-000000000001";
const LATER_SAM = "7e7e7e7e-0000-4000-8000-000000000002";
const LATER_ALEX = "7e7e7e7e-0000-4000-8000-000000000003";

const job: AllJobsMirrorJob = {
  remoteId: JOB,
  jobNumber: "3343",
  status: "Completed",
  clientName: "Sample Client Pty Ltd",
  description: null,
  suburb: "Rose Bay",
  categoryName: "Service",
  categoryColour: "#e7b5ff",
  date: null,
  quoteDate: null,
  /* completed this morning */
  completionDate: `${DAY} 07:00:00`,
  nextBooking: null,
  money: null,
  paidCents: 0,
};

const a = (uuid: string, staffUuid: string, start: string, end: string, leftover?: boolean): ScheduleActivity => ({
  uuid,
  jobUuid: JOB,
  staffUuid,
  start: `${DAY} ${start}:00`,
  end: `${DAY} ${end}:00`,
  wasScheduled: 1,
  ...(leftover === undefined ? {} : { leftover }),
});

function focus() {
  const day = layoutScheduleDay({
    activities: [a(MORNING, SAM, "06:00", "07:00", false), a(LATER_SAM, SAM, "14:00", "15:00", true), a(LATER_ALEX, ALEX, "15:00", "16:00", true)],
    staff: [
      { uuid: SAM, name: "Sam Tester" },
      { uuid: ALEX, name: "Alex Sample" },
    ],
    jobs: [job],
  });
  return focusJobOf(day, JOB, { dayISO: DAY, today: DAY, nowMin: 9 * 60, tracksTime: false })!;
}

beforeEach(() => clearLeftoverBooking.mockClear());

const crew = () => within(document.querySelector(".wb2-inspcrew") as HTMLElement);
const rowOf = (who: string, time: string) =>
  within(
    [...document.querySelectorAll(".wb2-inspcrew li")].find((li) => li.textContent?.includes(who) && li.textContent.includes(time)) as HTMLElement
  );

it("(F) gives each leftover its own Clear booking, and only a leftover — a booking the rail draws Done and closed included", () => {
  const f = focus();
  /* the rail's own reading of today's later bookings on a job closed this morning */
  expect(f.marks.map((m) => m.kind)).toContain("done");
  render(<FocusInspector job={f} day={DAY} canClear onOpen={() => {}} onClose={() => {}} />);
  expect(crew().getAllByRole("button", { name: BOOKING_WORDS.door.clearBooking })).toHaveLength(2);
  expect(rowOf("Sam Tester", "6am").queryByRole("button", { name: BOOKING_WORDS.door.clearBooking })).toBeNull();
});

it("(F) offers none where the viewer may not press, or bookings aren't offered", () => {
  render(<FocusInspector job={focus()} day={DAY} onOpen={() => {}} onClose={() => {}} />);
  expect(screen.queryByRole("button", { name: BOOKING_WORDS.door.clearBooking })).toBeNull();
});

it("(F) two leftovers on one job clear each its own booking, asked in place with the focus on Keep", async () => {
  const onCleared = jest.fn();
  render(<FocusInspector job={focus()} day={DAY} canClear onCleared={onCleared} onOpen={() => {}} onClose={() => {}} />);
  await userEvent.click(rowOf("Alex Sample", "3pm–").getByRole("button", { name: BOOKING_WORDS.door.clearBooking }));
  const asked = "Take Alex Sample's booking on Tue 6 Oct, 3:00 pm off job 3343 in ServiceM8? The job is Completed. HeyTiff can't put it back.";
  expect(screen.getByRole("group", { name: asked })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: BOOKING_WORDS.door.keep })).toHaveFocus();
  await userEvent.click(within(screen.getByRole("group", { name: asked })).getByRole("button", { name: BOOKING_WORDS.door.clearBooking }));
  expect(clearLeftoverBooking).toHaveBeenCalledWith({
    jobUuid: JOB,
    activityUuid: LATER_ALEX,
    seen: { staffUuid: ALEX, start: `${DAY} 15:00:00` },
    pressId: expect.stringMatching(/^[0-9a-f-]{36}$/),
  });
  await waitFor(() => expect(onCleared).toHaveBeenCalledTimes(1));

  await userEvent.click(rowOf("Sam Tester", "2pm–").getByRole("button", { name: BOOKING_WORDS.door.clearBooking }));
  await userEvent.click(screen.getAllByRole("button", { name: BOOKING_WORDS.door.clearBooking }).find((b) => b.closest("[role=group]"))!);
  expect(clearLeftoverBooking).toHaveBeenLastCalledWith(expect.objectContaining({ activityUuid: LATER_SAM, seen: { staffUuid: SAM, start: `${DAY} 14:00:00` } }));
});

it("says a Clear that didn't go, in its colour, and Keep backs out", async () => {
  clearLeftoverBooking.mockResolvedValueOnce({ ok: false, error: BOOKING_WORDS.press.notLeftover });
  render(<FocusInspector job={focus()} day={DAY} canClear onOpen={() => {}} onClose={() => {}} />);
  await userEvent.click(rowOf("Alex Sample", "3pm–").getByRole("button", { name: BOOKING_WORDS.door.clearBooking }));
  await userEvent.click(screen.getByRole("button", { name: BOOKING_WORDS.door.keep }));
  expect(clearLeftoverBooking).not.toHaveBeenCalled();
  await userEvent.click(rowOf("Alex Sample", "3pm–").getByRole("button", { name: BOOKING_WORDS.door.clearBooking }));
  await userEvent.click(screen.getAllByRole("button", { name: BOOKING_WORDS.door.clearBooking }).find((b) => b.closest("[role=group]"))!);
  expect(await screen.findByText(BOOKING_WORDS.press.notLeftover)).toHaveClass("sw-state", "bad");
});
