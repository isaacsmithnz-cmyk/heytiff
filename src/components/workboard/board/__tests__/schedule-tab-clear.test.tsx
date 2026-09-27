/* THE SCHEDULE HANDS A LEFTOVER'S CLEAR TO ITS INSPECTOR (two-way phase 3,
   PR D): D-8's wiring. The day's payload says whether this viewer may Clear
   here (scheduleDay's canClear), each activity whether it is a leftover;
   the tab threads both through, and a Clear that went reads the day again,
   so the booking we took out leaves it. Nothing else in the inspector
   changes: no Back to the day. */

import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { SchedulePayload } from "@/lib/workboard/schedule-query";
import type { BookingLineResult } from "@/app/actions/booking-sm8";
import { BOOKING_WORDS } from "@/lib/integrations/sm8-booking-plan";

const scheduleDay = jest.fn<Promise<SchedulePayload>, [string]>();
jest.mock("@/app/actions/workboard", () => ({
  scheduleDay: (...a: [string]) => scheduleDay(...a),
}));
const clearLeftoverBooking = jest.fn(async (_i: unknown): Promise<BookingLineResult> => ({ ok: true, line: null }));
jest.mock("@/app/actions/booking-sm8", () => ({
  clearLeftoverBooking: (...a: unknown[]) => clearLeftoverBooking(...(a as [never])),
}));

import { ScheduleTab } from "../schedule-tab";

const TODAY = "2026-10-06";
const JOB = "0b1e0b1e-0000-4000-8000-00000000d002";
const SAM = "5a0e5a0e-0000-4000-8000-00000000a001";

const payload = (over: Partial<SchedulePayload> = {}): SchedulePayload => ({
  dayISO: TODAY,
  activities: [
    {
      uuid: "7e7e7e7e-0000-4000-8000-000000000002",
      jobUuid: JOB,
      staffUuid: SAM,
      start: `${TODAY} 14:00:00`,
      end: `${TODAY} 15:00:00`,
      wasScheduled: 1,
      leftover: true,
    },
  ],
  staff: [{ uuid: SAM, name: "Sam Tester" }],
  jobs: [
    {
      remoteId: JOB,
      jobNumber: "3343",
      status: "Completed",
      paidCents: 0,
      clientName: "Sample Client Pty Ltd",
      description: null,
      suburb: "Rose Bay",
      categoryName: null,
      categoryColour: null,
      date: null,
      quoteDate: null,
      completionDate: `${TODAY} 07:00:00`,
      nextBooking: null,
      money: null,
    },
  ],
  onSite: [],
  addresses: {},
  ...over,
});

const tab = () => (
  <ScheduleTab
    today={TODAY}
    connected
    syncing={false}
    manage
    tracked={new Map()}
    dayCache={{ current: new Map() }}
    shelfItems={[]}
    onOpenJob={() => {}}
    onOpenTracked={() => {}}
  />
);

beforeEach(() => {
  scheduleDay.mockReset();
  clearLeftoverBooking.mockClear();
});

const inspect = async () => {
  await userEvent.click((await screen.findAllByRole("button", { name: /Job #3343/ }))[0]);
  return within(screen.getByRole("complementary", { name: /^Job / }));
};

it("(F) puts Clear booking on a leftover where the day says this viewer may clear, and a Clear that went reads the day again", async () => {
  scheduleDay.mockResolvedValueOnce(payload({ canClear: true })).mockResolvedValueOnce(payload({ activities: [] }));
  render(tab());
  const aside = await inspect();
  await userEvent.click(aside.getByRole("button", { name: BOOKING_WORDS.door.clearBooking }));
  await userEvent.click(
    within(aside.getByRole("group", { name: /^Take Sam Tester's booking/ })).getByRole("button", { name: BOOKING_WORDS.door.clearBooking })
  );
  expect(clearLeftoverBooking).toHaveBeenCalledWith(expect.objectContaining({ jobUuid: JOB, seen: { staffUuid: SAM, start: `${TODAY} 14:00:00` } }));
  await waitFor(() => expect(scheduleDay).toHaveBeenCalledTimes(2));
  expect(aside.queryByRole("button", { name: "Back to the day" })).toBeNull();
});

it("(F) offers none where the day doesn't say so", async () => {
  scheduleDay.mockResolvedValue(payload());
  render(tab());
  const aside = await inspect();
  expect(aside.getByText("Sam Tester")).toBeInTheDocument();
  expect(aside.queryByRole("button", { name: BOOKING_WORDS.door.clearBooking })).toBeNull();
});
