/* THE VISIT FORM (a job's Add › Visit, the Visits section's Book in, Home's
   To do Book in): Book in's engine (two-way phase 3, PR D: D-2, D-3, D-4,
   D-6 and D-12) in a v2 dialog. It asks ServiceM8 before it offers Book
   and says what it found in sentences, warns of an overlap and never blocks
   on one, keeps Book off until every row has a person, ticks Make it a Work
   Order on a Quote only, and a double press is one press. The job is a
   field, filled in, clearable and found again (rule 51); booking keeps you
   where you were, with a toast whose Undo takes the bookings back out. The
   actions are mocked: what they answer is PR C's to hold. */

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { BookInContext, BookJobInResult, VerbView } from "@/app/actions/booking-sm8";
import { BOOKING_WORDS } from "@/lib/integrations/sm8-booking-plan";
import { pickDate } from "@/components/ui/__tests__/fixtures/pick-date";
import { WindowsContext } from "@/components/records/records-context";

const readBookInContext = jest.fn(async (_i: { jobUuid: string; days: string[] }): Promise<BookInContext> => context());
const bookJobIn = jest.fn(
  async (_i: {
    jobUuid: string;
    pressId: string;
    seen: { jobEditDate: string | null; readAt: string };
    makeWorkOrder: boolean;
    bookings: { staffUuid: string; day: string; start: string; minutes: number }[];
  }): Promise<BookJobInResult> => ({ ok: true, verb: VERB, rowIds: ["r-1"] }),
);
const takeBackBooking = jest.fn(async (_i: { jobUuid: string; rowId: string }) => ({ ok: true as const, line: null }));
jest.mock("@/app/actions/booking-sm8", () => ({
  readBookInContext: (...a: unknown[]) => readBookInContext(...(a as [never])),
  bookJobIn: (...a: unknown[]) => bookJobIn(...(a as [never])),
  takeBackBooking: (...a: unknown[]) => takeBackBooking(...(a as [never])),
}));
jest.mock("@/app/actions/palette", () => ({
  searchPalette: jest.fn(async () => ({
    staff: [],
    clients: [],
    projects: [],
    photos: [],
    jobs: [{ remoteId: "0b1e0b1e-0000-4000-8000-00000000d009", jobNumber: "3350", clientName: "Rifkin", suburb: "Bellevue Hill" }],
  })),
}));

import { VisitForm } from "../visit-form";
import { nextWeekday } from "../book-in";

const P = BOOKING_WORDS.panel;
const JOB = "0b1e0b1e-0000-4000-8000-00000000d001";
const OTHER_JOB = "0b1e0b1e-0000-4000-8000-00000000d009";
const SAM = "5a0e5a0e-0000-4000-8000-00000000a001";
const ALEX = "5a0e5a0e-0000-4000-8000-00000000a002";
const DAY = "2026-10-07";
const VERB: VerbView = { verbId: "p", presses: ["p"], at: "2026-10-05T22:00:00.000Z", status: null, bookings: [] };
const LABEL = "Job 3342, Richards Building, North Narrabeen";

const live = (over: Partial<Extract<BookInContext, { ok: true }>["bookings"][number]> = {}) => ({
  uuid: "7e7e7e7e-0000-4000-8000-000000000001",
  jobUuid: JOB,
  staffUuid: SAM,
  start: `${DAY} 08:00:00`,
  end: `${DAY} 10:00:00`,
  scheduled: 1,
  recorded: 0,
  active: 1,
  editDate: "2026-10-01 10:00:00",
  ...over,
});

function context(over: Partial<Extract<BookInContext, { ok: true }>> = {}): BookInContext {
  return {
    ok: true,
    offered: true,
    trial: false,
    hold: null,
    zone: "Australia/Sydney",
    today: "2026-10-06",
    job: { uuid: JOB, number: "3342", status: "Quote", editDate: "2026-10-01 10:00:00" },
    bookings: [],
    days: { [DAY]: [] },
    jobNumbers: { [JOB]: "3342", [OTHER_JOB]: "3350" },
    staff: [
      { uuid: SAM, name: "Sam Tester", you: true, linked: true },
      { uuid: ALEX, name: "Alex Sample", you: false, linked: false },
    ],
    readAt: "2026-10-05T22:00:00.000Z",
    off: {},
    ...over,
  };
}

let browserZone = "Australia/Sydney";
const realResolved = Intl.DateTimeFormat.prototype.resolvedOptions;

beforeEach(() => {
  readBookInContext.mockReset().mockImplementation(async () => context());
  bookJobIn.mockReset().mockImplementation(async () => ({ ok: true, verb: VERB, rowIds: ["r-1"] }));
  takeBackBooking.mockClear();
  toast.mockClear();
  onClose.mockClear();
  onBooked.mockClear();
  onUndone.mockClear();
  browserZone = "Australia/Sydney";
  jest.spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions").mockImplementation(function (this: Intl.DateTimeFormat) {
    return { ...realResolved.call(this), timeZone: browserZone };
  });
});
afterEach(() => jest.restoreAllMocks());

const toast = jest.fn();
const onClose = jest.fn();
const onBooked = jest.fn();
const onUndone = jest.fn();
type Props = Partial<Parameters<typeof VisitForm>[0]>;
const form = (props: Props = {}) =>
  render(
    <WindowsContext.Provider value={{ toast } as never}>
      <VisitForm job={{ uuid: JOB, label: LABEL }} zone={null} onClose={onClose} onBooked={onBooked} onUndone={onUndone} {...props} />
    </WindowsContext.Provider>,
  );

const bookButton = () => screen.getByRole("button", { name: /^Book( \d+ visits| visit)$/ });
const who = (i = 0) => screen.getAllByRole("combobox", { name: P.who })[i]!;
const starts = () => screen.getAllByRole("combobox", { name: P.start });
const lengths = () => screen.getAllByRole("combobox", { name: P.length });
const ready = () => waitFor(() => expect(who()).toBeEnabled());

/** Pick an option of a chooser. */
function choose(box: HTMLElement, name: string) {
  fireEvent.click(box);
  fireEvent.click(within(screen.getByRole("listbox")).getByRole("option", { name }));
}
/** Set a row's start on the wheel, then close it. */
function setStart(i: number, hour: string, minute: string, half: "AM" | "PM") {
  fireEvent.click(starts()[i]!);
  const panel = screen.getByRole("dialog", { name: P.start });
  fireEvent.click(within(within(panel).getByRole("listbox", { name: "Hour" })).getByRole("option", { name: hour }));
  fireEvent.click(within(within(panel).getByRole("listbox", { name: "Minute" })).getByRole("option", { name: minute }));
  fireEvent.click(within(within(panel).getByRole("listbox", { name: "AM/PM" })).getByRole("option", { name: half }));
  fireEvent.keyDown(panel, { key: "Escape" });
}
/** The tone a sentence is said in. */
const toneOf = (text: string) => screen.getByText(text).closest(".pt-state");

describe("opening (D-2)", () => {
  it("(F) says it is checking ServiceM8, with Book off, then draws what it found", async () => {
    let answer: (c: BookInContext) => void = () => {};
    readBookInContext.mockImplementationOnce(() => new Promise((r) => (answer = r)));
    form();
    expect(screen.getByRole("dialog", { name: "Book a visit" })).toBeInTheDocument();
    expect(screen.getByText(P.checking)).toBeInTheDocument();
    expect(bookButton()).toBeDisabled();
    await act(async () => answer(context({ bookings: [live()] })));
    expect(screen.queryByText(P.checking)).toBeNull();
    expect(screen.getByText("Already booked: Wed 7 Oct, 8:00 am, Sam Tester.")).toBeInTheDocument();
  });

  it("(F) asks about the next weekday on the account's clock, and fills the row with it", async () => {
    expect(nextWeekday("2026-10-06")).toBe("2026-10-07");
    expect(nextWeekday("2026-10-09")).toBe("2026-10-12");
    expect(nextWeekday("2026-10-10")).toBe("2026-10-12");
    /* 2 am on Friday 9 October in Sydney, still Thursday by UTC: the next
       weekday on the account's clock is Monday, where UTC's would be Friday */
    const now = jest.spyOn(Date, "now").mockReturnValue(Date.parse("2026-10-08T15:00:00Z"));
    form({ zone: "Australia/Sydney" });
    await waitFor(() => expect(readBookInContext).toHaveBeenCalled());
    now.mockRestore();
    const [first] = readBookInContext.mock.calls[0];
    expect(first).toEqual({ jobUuid: JOB, days: ["2026-10-12"] });
    await ready();
    expect(starts()[0]).toHaveTextContent("7:00 AM");
    expect(lengths()[0]).toHaveTextContent("2 h");
  });

  it("(F) says each chosen person's day, and warns, never blocks, on an overlap", async () => {
    readBookInContext.mockImplementation(async () =>
      context({ days: { [DAY]: [live({ uuid: "7e7e7e7e-0000-4000-8000-000000000002", jobUuid: OTHER_JOB, staffUuid: ALEX, start: `${DAY} 08:00:00`, end: `${DAY} 10:00:00` })] } }),
    );
    form();
    await ready();
    choose(who(), "Alex Sample");
    expect(screen.getByText("Alex Sample that day: job 3350, 8:00 to 10:00 am.")).toBeInTheDocument();
    expect(toneOf("That overlaps job 3350, 8:00 to 10:00 am.")).toHaveClass("pt-state--look");
    expect(bookButton()).toBeEnabled();
    choose(who(), P.you);
    expect(screen.getByText("Sam Tester has nothing else that day.")).toBeInTheDocument();
    expect(screen.queryByText(/That overlaps/)).toBeNull();
  });

  /* TIME OFF (leave to ServiceM8, part two): the row is 7:00 to 9:00 am on
     Wed 7 Oct. ServiceM8's own word for the time off is said, in the
     clash's colour, and Book stays on. */
  it("(F) warns, never blocks, when the person is off in ServiceM8 then, in the business's own word", async () => {
    const away = (over: Partial<{ uuid: string; staffUuid: string; name: string | null; start: string; end: string }>) => ({
      uuid: "av-1",
      staffUuid: ALEX,
      name: "SICK" as string | null,
      start: `${DAY} 00:00:00`,
      end: `${DAY} 23:59:59`,
      ...over,
    });
    readBookInContext.mockImplementation(async () =>
      context({
        off: {
          [DAY]: {
            away: [
              away({}),
              // Sam's TAFE is after the row: nothing to say
              away({ uuid: "av-2", staffUuid: SAM, name: "TAFE", start: `${DAY} 10:00:00`, end: `${DAY} 12:30:00` }),
            ],
            closed: [],
          },
        },
      }),
    );
    form();
    await ready();
    choose(who(), "Alex Sample");
    expect(toneOf("Alex Sample is off that day in ServiceM8: SICK.")).toHaveClass("pt-state--look");
    expect(bookButton()).toBeEnabled();
    choose(who(), P.you);
    expect(screen.queryByText(/off that day|time off/)).toBeNull();
    // moved onto the TAFE: the part of the day, on the day's clock
    setStart(0, "11", "00", "AM");
    expect(toneOf("That overlaps Sam Tester's time off in ServiceM8: TAFE, 10:00 am to 12:30 pm.")).toHaveClass("pt-state--look");
    expect(bookButton()).toBeEnabled();
  });

  it("(F) says a public holiday and a closed day, and time off the business gave no name", async () => {
    readBookInContext.mockImplementation(async () =>
      context({
        off: {
          [DAY]: {
            away: [{ uuid: "av-1", staffUuid: SAM, name: null, start: `${DAY} 06:00:00`, end: `${DAY} 08:00:00` }],
            closed: [
              { uuid: "v-1", kind: "holiday", name: "Labour Day", start: `${DAY} 00:00:00`, end: `${DAY} 23:59:59` },
              { uuid: "v-2", kind: "closed", name: null, start: `${DAY} 00:00:00`, end: `${DAY} 23:59:59` },
            ],
          },
        },
      }),
    );
    form();
    await ready();
    choose(who(), P.you);
    expect(toneOf("Wed 7 Oct is a public holiday in ServiceM8: Labour Day.")).toHaveClass("pt-state--look");
    expect(screen.getByText("ServiceM8 has the business closed then.")).toBeInTheDocument();
    expect(screen.getByText("That overlaps Sam Tester's time off in ServiceM8, 6:00 to 8:00 am.")).toBeInTheDocument();
    expect(bookButton()).toBeEnabled();
  });

  it("says nothing about time off on a day the mirror couldn't answer for", async () => {
    readBookInContext.mockImplementation(async () => context({ off: {} }));
    form();
    await ready();
    choose(who(), "Alex Sample");
    expect(screen.queryByText(/ServiceM8: |time off|closed then/)).toBeNull();
  });

  it("(F) warns of an overlap with a job the mirror can't number yet, as another job", async () => {
    readBookInContext.mockImplementation(async () =>
      context({
        jobNumbers: { [JOB]: "3342" },
        days: { [DAY]: [live({ uuid: "7e7e7e7e-0000-4000-8000-000000000002", jobUuid: OTHER_JOB, staffUuid: ALEX })] },
      }),
    );
    form();
    await ready();
    choose(who(), "Alex Sample");
    expect(toneOf("That overlaps another job, 8:00 to 10:00 am.")).toHaveClass("pt-state--look");
    expect(bookButton()).toBeEnabled();
  });

  it("offers the lengths in the plan's words, as a chooser", async () => {
    form();
    fireEvent.click(lengths()[0]!);
    expect(within(screen.getByRole("listbox")).getAllByRole("option").map((o) => o.textContent)).toEqual([
      "30 min",
      "1 h",
      "1 h 30",
      "2 h",
      "3 h",
      "4 h",
      "6 h",
      "8 h",
    ]);
  });

  it("says a day ServiceM8 couldn't read, and still offers Book", async () => {
    readBookInContext.mockImplementation(async () => context({ days: { [DAY]: null } }));
    form();
    await ready();
    choose(who(), P.you);
    expect(screen.getByText("HeyTiff couldn't check Sam Tester's day in ServiceM8.")).toBeInTheDocument();
    expect(bookButton()).toBeEnabled();
  });

  it("(F) says whose time the times are only when the browser's zone isn't the account's", async () => {
    const first = form();
    await ready();
    expect(screen.queryByText("Times are Sydney time.")).toBeNull();
    first.unmount();
    browserZone = "Pacific/Auckland";
    form();
    expect(await screen.findByText("Times are Sydney time.")).toBeInTheDocument();
  });

  it("asks Who with Pick who, then offers You, then the rest", async () => {
    form();
    await ready();
    expect(who()).toHaveTextContent(P.pickWho);
    fireEvent.click(who());
    expect(within(screen.getByRole("listbox")).getAllByRole("option").map((o) => o.textContent)).toEqual([P.you, "Alex Sample"]);
  });

  it("says why it can't book when ServiceM8 couldn't be read, with Try again", async () => {
    readBookInContext.mockImplementationOnce(async () => ({ ok: false, error: P.readFailed }));
    form();
    expect(await screen.findByText(P.readFailed)).toBeInTheDocument();
    expect(bookButton()).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: BOOKING_WORDS.door.tryAgain }));
    await ready();
    expect(screen.queryByText(P.readFailed)).toBeNull();
  });

  it("says a trial run, and what holds what is booked", async () => {
    readBookInContext.mockImplementation(async () => context({ trial: true, hold: "paused" }));
    form();
    expect(await screen.findByText(P.trial)).toBeInTheDocument();
    expect(screen.getByText(P.heldPaused)).toBeInTheDocument();
  });
});

describe("the rows (D-3)", () => {
  it("(F) keep Book off until every row has a person", async () => {
    form();
    await ready();
    expect(bookButton()).toBeDisabled();
    choose(who(), P.you);
    expect(bookButton()).toBeEnabled();
    await userEvent.click(screen.getByRole("button", { name: P.addAnother }));
    expect(bookButton()).toHaveTextContent("Book 2 visits");
    expect(bookButton()).toBeDisabled();
    choose(who(1), "Alex Sample");
    expect(bookButton()).toBeEnabled();
  });

  it("(F) add up to 8, each after the first with Remove, which takes that row", async () => {
    form();
    await ready();
    choose(who(), P.you);
    for (let i = 1; i < 8; i++) await userEvent.click(screen.getByRole("button", { name: P.addAnother }));
    expect(screen.getAllByRole("combobox", { name: P.who })).toHaveLength(8);
    expect(screen.queryByRole("button", { name: P.addAnother })).toBeNull();
    expect(screen.getAllByRole("button", { name: P.remove })).toHaveLength(7);
    /* the new rows copy the day, start and length, with nobody chosen */
    expect(who(7)).toHaveTextContent(P.pickWho);
    choose(who(1), "Alex Sample");
    await userEvent.click(screen.getAllByRole("button", { name: P.remove })[0]!);
    expect(screen.getAllByRole("combobox", { name: P.who }).map((b) => b.textContent)).toEqual([P.you, ...Array(6).fill(P.pickWho)]);
    expect(screen.getByRole("button", { name: P.addAnother })).toBeInTheDocument();
  });

  it("(F) refuses a row that runs past midnight in its own place, keeps Book off, and never shows a placeholder", async () => {
    form();
    await ready();
    choose(who(), P.you);
    setStart(0, "11", "00", "PM");
    expect(toneOf(BOOKING_WORDS.press.crossesMidnight)).toHaveClass("pt-state--wrong");
    expect(bookButton()).toBeDisabled();
    expect(screen.getByRole("dialog", { name: "Book a visit" }).textContent).not.toMatch(/\{\w+\}/);
    choose(lengths()[0]!, "30 min");
    expect(screen.queryByText(BOOKING_WORDS.press.crossesMidnight)).toBeNull();
    expect(bookButton()).toBeEnabled();
    expect(screen.getByText("Books Sam Tester on Wed 7 Oct, 11:00 to 11:30 pm.")).toBeInTheDocument();
  });

  it("says what Book will book, one or several", async () => {
    form();
    await ready();
    choose(who(), P.you);
    expect(screen.getByText("Books Sam Tester on Wed 7 Oct, 7:00 to 9:00 am.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: P.addAnother }));
    choose(who(1), "Alex Sample");
    setStart(1, "11", "00", "AM");
    expect(
      screen.getByText("Books 2: Sam Tester, Wed 7 Oct, 7:00 to 9:00 am. Alex Sample, Wed 7 Oct, 11:00 am to 1:00 pm."),
    ).toBeInTheDocument();
  });

  it("(F) the start is the wheel on the quarter hour, the grid ServiceM8 is booked on, and nothing types a time", async () => {
    form();
    await ready();
    expect(screen.getByRole("dialog", { name: "Book a visit" }).querySelector('input[type="time"]')).toBeNull();
    fireEvent.click(starts()[0]!);
    const panel = screen.getByRole("dialog", { name: P.start });
    expect(within(within(panel).getByRole("listbox", { name: "Minute" })).getAllByRole("option").map((o) => o.textContent)).toEqual([
      "00",
      "15",
      "30",
      "45",
    ]);
    fireEvent.click(within(within(panel).getByRole("listbox", { name: "Minute" })).getByRole("option", { name: "45" }));
    expect(starts()[0]).toHaveTextContent("7:45 AM");
    fireEvent.keyDown(panel, { key: "Escape" });
    choose(who(), P.you);
    await userEvent.click(bookButton());
    expect(bookJobIn.mock.calls[0][0].bookings[0]).toMatchObject({ start: "07:45" });
  });

  it("(F) D-12: the day is the house's picker, never a date input, and a new day is read", async () => {
    form();
    await ready();
    expect(screen.getByRole("dialog", { name: "Book a visit" }).querySelector('input[type="date"]')).toBeNull();
    await pickDate(P.day, "2026-10-09");
    await waitFor(() => expect(readBookInContext).toHaveBeenCalledTimes(2));
    expect(readBookInContext.mock.calls[1][0].days).toEqual(["2026-10-09"]);
  });
});

describe("a Quote (D-4)", () => {
  it("(F) is ticked to become a Work Order, and the sentence follows the tick", async () => {
    form();
    const tick = await screen.findByRole("checkbox", { name: P.makeWorkOrder });
    expect(tick).toBeChecked();
    expect(screen.getByText(P.quoteBecomes)).toBeInTheDocument();
    await userEvent.click(tick);
    expect(screen.getByText(P.quoteStays)).toBeInTheDocument();
    expect(screen.queryByText(P.quoteBecomes)).toBeNull();
    choose(who(), P.you);
    await userEvent.click(bookButton());
    expect(bookJobIn.mock.calls[0][0].makeWorkOrder).toBe(false);
  });

  it("(F) sends the tick with Book, and a Work Order has none", async () => {
    const first = form();
    await screen.findByRole("checkbox", { name: P.makeWorkOrder });
    choose(who(), P.you);
    await userEvent.click(bookButton());
    expect(bookJobIn.mock.calls[0][0]).toMatchObject({
      jobUuid: JOB,
      makeWorkOrder: true,
      seen: { jobEditDate: "2026-10-01 10:00:00", readAt: "2026-10-05T22:00:00.000Z" },
      bookings: [{ staffUuid: SAM, day: DAY, start: "07:00", minutes: 120 }],
    });
    first.unmount();
    readBookInContext.mockImplementation(async () => context({ job: { uuid: JOB, number: "3342", status: "Work Order", editDate: null } }));
    bookJobIn.mockClear();
    form();
    await ready();
    expect(screen.queryByRole("checkbox")).toBeNull();
    /* and Book on a Work Order never asks for the change */
    choose(who(), P.you);
    await userEvent.click(bookButton());
    expect(bookJobIn.mock.calls[0][0].makeWorkOrder).toBe(false);
  });
});

describe("pressing Book (D-6)", () => {
  it("(F) a double click sends one press; it closes, says so, and Undo takes them back out", async () => {
    let answer: (r: BookJobInResult) => void = () => {};
    bookJobIn.mockImplementationOnce(() => new Promise((r) => (answer = r)));
    form();
    await ready();
    choose(who(), P.you);
    await userEvent.dblClick(bookButton());
    expect(bookJobIn).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Booking the visit" })).toBeDisabled();
    await act(async () => answer({ ok: true, verb: VERB, rowIds: ["r-1", "r-2"] }));
    expect(onBooked).toHaveBeenCalledWith(JOB, VERB, ["r-1", "r-2"]);
    expect(onClose).toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith("2 visits booked", expect.any(Function));
    await act(async () => toast.mock.calls[0][1]());
    expect(takeBackBooking.mock.calls.map((c) => c[0])).toEqual([
      { jobUuid: JOB, rowId: "r-1" },
      { jobUuid: JOB, rowId: "r-2" },
    ]);
    expect(onUndone).toHaveBeenCalledWith(JOB);
  });

  it("an Undo that ServiceM8 refuses says why", async () => {
    takeBackBooking.mockImplementationOnce(async () => ({ ok: false, error: BOOKING_WORDS.press.notFuture }) as never);
    form();
    await ready();
    choose(who(), P.you);
    await userEvent.click(bookButton());
    await waitFor(() => expect(toast).toHaveBeenCalledWith("Visit booked", expect.any(Function)));
    await act(async () => toast.mock.calls[0][1]());
    expect(toast).toHaveBeenLastCalledWith(BOOKING_WORDS.press.notFuture);
  });

  it("(F) a press again after a refusal is the same press, and the refusal sits above the buttons with Look again", async () => {
    bookJobIn.mockImplementationOnce(async () => ({ ok: false, error: BOOKING_WORDS.press.stale, lookAgain: true }));
    form();
    await ready();
    choose(who(), P.you);
    await userEvent.click(bookButton());
    expect((await screen.findByText(BOOKING_WORDS.press.stale)).closest(".pt-state")).toHaveClass("pt-state--wrong");
    /* the rows stay, and so does the form */
    expect(who()).toHaveTextContent(P.you);
    expect(onClose).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: BOOKING_WORDS.door.lookAgain }));
    await waitFor(() => expect(readBookInContext).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(bookButton()).toBeEnabled());
    await userEvent.click(bookButton());
    expect(bookJobIn).toHaveBeenCalledTimes(2);
    expect(bookJobIn.mock.calls[1][0].pressId).toBe(bookJobIn.mock.calls[0][0].pressId);
  });

  it("a refusal with nothing to look at again offers no door", async () => {
    bookJobIn.mockImplementationOnce(async () => ({ ok: false, error: BOOKING_WORDS.press.past }));
    form();
    await ready();
    choose(who(), P.you);
    await userEvent.click(bookButton());
    expect(await screen.findByText(BOOKING_WORDS.press.past)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: BOOKING_WORDS.door.lookAgain })).toBeNull();
  });

  it("Cancel closes it", async () => {
    form();
    await userEvent.click(screen.getByRole("button", { name: P.cancel }));
    expect(onClose).toHaveBeenCalled();
  });

  it("a seed fills the row from the booking a line named", async () => {
    form({ seed: { staffUuid: ALEX, start: `${DAY} 11:00:00`, end: `${DAY} 14:00:00` } });
    await ready();
    expect(readBookInContext.mock.calls[0][0].days).toEqual([DAY]);
    expect(who()).toHaveTextContent("Alex Sample");
    expect(starts()[0]).toHaveTextContent("11:00 AM");
    expect(lengths()[0]).toHaveTextContent("3 h");
  });
});

describe("the job (rule 51)", () => {
  it("is filled in from the door, and cleared it is found again by number, client or site, and read afresh", async () => {
    form();
    await ready();
    expect(screen.getByText(LABEL)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Clear the job" }));
    expect(screen.queryByText(LABEL)).toBeNull();
    expect(bookButton()).toBeDisabled();
    await userEvent.type(screen.getByPlaceholderText("Find a job"), "Rifkin");
    await userEvent.click(await screen.findByRole("button", { name: "Job 3350, Rifkin, Bellevue Hill" }));
    expect(screen.getByText("Job 3350, Rifkin, Bellevue Hill")).toBeInTheDocument();
    await waitFor(() => expect(readBookInContext.mock.calls.at(-1)![0].jobUuid).toBe(OTHER_JOB));
    await ready();
    choose(who(), P.you);
    await userEvent.click(bookButton());
    expect(bookJobIn.mock.calls[0][0].jobUuid).toBe(OTHER_JOB);
    await waitFor(() => expect(onBooked).toHaveBeenCalledWith(OTHER_JOB, VERB, ["r-1"]));
  });

  it("opened with no job, asks for one, and Book waits on it", () => {
    form({ job: null });
    expect(screen.getByPlaceholderText("Find a job")).toBeInTheDocument();
    expect(bookButton()).toBeDisabled();
    expect(readBookInContext).not.toHaveBeenCalled();
  });
});
