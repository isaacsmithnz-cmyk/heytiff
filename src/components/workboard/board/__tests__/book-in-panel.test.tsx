/* BOOK IN'S PANEL (two-way phase 3, PR D): D-2, D-3, D-4, D-6 and D-12.

   It asks ServiceM8 before it offers Book in and says what it found in
   sentences, warns of an overlap and never blocks on one, keeps Book in off
   until every row has a person, ticks Make it a Work Order on a Quote only,
   and a double press is one press. The actions are mocked: what they answer
   is PR C's to hold. */

import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { BookInContext, BookJobInResult, VerbView } from "@/app/actions/booking-sm8";
import { BOOKING_WORDS } from "@/lib/integrations/sm8-booking-plan";
import { pickDate } from "@/components/ui/__tests__/fixtures/pick-date";

const readBookInContext = jest.fn(async (_i: { jobUuid: string; days: string[] }): Promise<BookInContext> => context());
const bookJobIn = jest.fn(
  async (_i: {
    jobUuid: string;
    pressId: string;
    seen: { jobEditDate: string | null; readAt: string };
    makeWorkOrder: boolean;
    bookings: { staffUuid: string; day: string; start: string; minutes: number }[];
  }): Promise<BookJobInResult> => ({ ok: true, verb: VERB, rowIds: ["r-1"] })
);
jest.mock("@/app/actions/booking-sm8", () => ({
  readBookInContext: (...a: unknown[]) => readBookInContext(...(a as [never])),
  bookJobIn: (...a: unknown[]) => bookJobIn(...(a as [never])),
}));

import { BookInPanel, nextWeekday } from "../book-in-panel";

const P = BOOKING_WORDS.panel;
const JOB = "0b1e0b1e-0000-4000-8000-00000000d001";
const OTHER_JOB = "0b1e0b1e-0000-4000-8000-00000000d009";
const SAM = "5a0e5a0e-0000-4000-8000-00000000a001";
const ALEX = "5a0e5a0e-0000-4000-8000-00000000a002";
const DAY = "2026-10-07";
const VERB: VerbView = { verbId: "p", presses: ["p"], at: "2026-10-05T22:00:00.000Z", status: null, bookings: [] };

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
    ...over,
  };
}

let browserZone = "Australia/Sydney";
const realResolved = Intl.DateTimeFormat.prototype.resolvedOptions;

beforeEach(() => {
  readBookInContext.mockReset().mockImplementation(async () => context());
  bookJobIn.mockReset().mockImplementation(async () => ({ ok: true, verb: VERB, rowIds: ["r-1"] }));
  browserZone = "Australia/Sydney";
  jest.spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions").mockImplementation(function (this: Intl.DateTimeFormat) {
    return { ...realResolved.call(this), timeZone: browserZone };
  });
});
afterEach(() => jest.restoreAllMocks());

const onDone = jest.fn();
const onCancel = jest.fn();
const panel = (props: Partial<Parameters<typeof BookInPanel>[0]> = {}) =>
  render(<BookInPanel jobUuid={JOB} number="3342" zone={null} onDone={onDone} onCancel={onCancel} {...props} />);

const bookButton = () => screen.getByRole("button", { name: /^Book( \d+)? in$/ });
const who = (i = 0) => screen.getAllByLabelText(P.who)[i] as HTMLSelectElement;

describe("opening (D-2)", () => {
  it("(F) says it is checking ServiceM8, with Book in off, then draws what it found", async () => {
    let answer: (c: BookInContext) => void = () => {};
    readBookInContext.mockImplementationOnce(() => new Promise((r) => (answer = r)));
    panel();
    expect(screen.getByText(P.checking)).toBeInTheDocument();
    expect(bookButton()).toBeDisabled();
    await act(async () => answer(context({ bookings: [live()] })));
    expect(screen.queryByText(P.checking)).toBeNull();
    expect(screen.getByText("Already booked: Wed 7 Oct, 8:00 am, Sam Tester.")).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Book in job 3342" })).toBeInTheDocument();
  });

  it("(F) asks about the next weekday on the account's clock, and fills the row with it", async () => {
    expect(nextWeekday("2026-10-06")).toBe("2026-10-07");
    expect(nextWeekday("2026-10-09")).toBe("2026-10-12");
    expect(nextWeekday("2026-10-10")).toBe("2026-10-12");
    /* 2 am on Friday 9 October in Sydney, still Thursday by UTC: the next
       weekday on the account's clock is Monday, where UTC's would be Friday */
    const now = jest.spyOn(Date, "now").mockReturnValue(Date.parse("2026-10-08T15:00:00Z"));
    panel({ zone: "Australia/Sydney" });
    await waitFor(() => expect(readBookInContext).toHaveBeenCalled());
    now.mockRestore();
    const [first] = readBookInContext.mock.calls[0];
    expect(first).toEqual({ jobUuid: JOB, days: ["2026-10-12"] });
    await screen.findByText(/Already booked|Pick who/);
    expect((screen.getAllByLabelText(P.start)[0] as HTMLSelectElement).value).toBe("07:00");
    expect((screen.getAllByLabelText(P.length)[0] as HTMLSelectElement).value).toBe("120");
  });

  it("(F) says each chosen person's day, and warns — never blocks — on an overlap", async () => {
    readBookInContext.mockImplementation(async () =>
      context({ days: { [DAY]: [live({ uuid: "7e7e7e7e-0000-4000-8000-000000000002", jobUuid: OTHER_JOB, staffUuid: ALEX, start: `${DAY} 08:00:00`, end: `${DAY} 10:00:00` })] } })
    );
    panel();
    await waitFor(() => expect(who().options.length).toBe(3));
    await userEvent.selectOptions(who(), ALEX);
    expect(screen.getByText("Alex Sample that day: job 3350, 8:00 to 10:00 am.")).toBeInTheDocument();
    expect(screen.getByText("That overlaps job 3350, 8:00 to 10:00 am.")).toHaveClass("sw-state", "warn");
    expect(bookButton()).toBeEnabled();
    await userEvent.selectOptions(who(), SAM);
    expect(screen.getByText("Sam Tester has nothing else that day.")).toBeInTheDocument();
    expect(screen.queryByText(/That overlaps/)).toBeNull();
  });

  it("says a day ServiceM8 couldn't read, and still offers Book in", async () => {
    readBookInContext.mockImplementation(async () => context({ days: { [DAY]: null } }));
    panel();
    await waitFor(() => expect(who().options.length).toBe(3));
    await userEvent.selectOptions(who(), SAM);
    expect(screen.getByText("HeyTiff couldn't check Sam Tester's day in ServiceM8.")).toBeInTheDocument();
    expect(bookButton()).toBeEnabled();
  });

  it("(F) says whose time the times are only when the browser's zone isn't the account's", async () => {
    panel();
    await waitFor(() => expect(who().options.length).toBe(3));
    expect(screen.queryByText("Times are Sydney time.")).toBeNull();
    browserZone = "Pacific/Auckland";
    readBookInContext.mockClear();
    panel();
    expect(await screen.findByText("Times are Sydney time.")).toBeInTheDocument();
  });

  it("calls the Who's first line Pick who, then You, then the rest", async () => {
    panel();
    await waitFor(() => expect(who().options.length).toBe(3));
    expect([...who().options].map((o) => o.textContent)).toEqual([P.pickWho, P.you, "Alex Sample"]);
  });

  it("says why it can't book when ServiceM8 couldn't be read, with Try again", async () => {
    readBookInContext.mockImplementationOnce(async () => ({ ok: false, error: P.readFailed }));
    panel();
    expect(await screen.findByText(P.readFailed)).toBeInTheDocument();
    expect(bookButton()).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: BOOKING_WORDS.door.tryAgain }));
    await waitFor(() => expect(who().options.length).toBe(3));
    expect(screen.queryByText(P.readFailed)).toBeNull();
  });

  it("says a trial run, and what holds what is booked", async () => {
    readBookInContext.mockImplementation(async () => context({ trial: true, hold: "paused" }));
    panel();
    expect(await screen.findByText(P.trial)).toBeInTheDocument();
    expect(screen.getByText(P.heldPaused)).toBeInTheDocument();
  });
});

describe("the rows (D-3)", () => {
  it("(F) keep Book in off until every row has a person", async () => {
    panel();
    await waitFor(() => expect(who().options.length).toBe(3));
    expect(bookButton()).toBeDisabled();
    await userEvent.selectOptions(who(), SAM);
    expect(bookButton()).toBeEnabled();
    await userEvent.click(screen.getByRole("button", { name: P.addAnother }));
    expect(bookButton()).toHaveTextContent("Book 2 in");
    expect(bookButton()).toBeDisabled();
    await userEvent.selectOptions(who(1), ALEX);
    expect(bookButton()).toBeEnabled();
  });

  it("(F) add up to 8, each after the first with Remove, which takes that row", async () => {
    panel();
    await waitFor(() => expect(who().options.length).toBe(3));
    await userEvent.selectOptions(who(), SAM);
    for (let i = 1; i < 8; i++) await userEvent.click(screen.getByRole("button", { name: P.addAnother }));
    expect(screen.getAllByLabelText(P.who)).toHaveLength(8);
    expect(screen.queryByRole("button", { name: P.addAnother })).toBeNull();
    expect(screen.getAllByRole("button", { name: P.remove })).toHaveLength(7);
    /* the new rows copy the day, start and length, with nobody chosen */
    expect(who(7).value).toBe("");
    await userEvent.selectOptions(who(1), ALEX);
    await userEvent.click(screen.getAllByRole("button", { name: P.remove })[0]);
    expect(screen.getAllByLabelText(P.who)).toHaveLength(7);
    expect(screen.getAllByLabelText(P.who).map((s) => (s as HTMLSelectElement).value)).toEqual([SAM, "", "", "", "", "", ""]);
    expect(screen.getByRole("button", { name: P.addAnother })).toBeInTheDocument();
  });

  it("(F) refuses a row that runs past midnight in its own place, keeps Book in off, and never shows a placeholder", async () => {
    const { container } = panel();
    await waitFor(() => expect(who().options.length).toBe(3));
    await userEvent.selectOptions(who(), SAM);
    await userEvent.selectOptions(screen.getAllByLabelText(P.start)[0], "23:00");
    expect(screen.getByText(BOOKING_WORDS.press.crossesMidnight)).toHaveClass("sw-state", "bad");
    expect(bookButton()).toBeDisabled();
    expect(container.textContent).not.toMatch(/\{\w+\}/);
    await userEvent.selectOptions(screen.getAllByLabelText(P.length)[0], "30");
    expect(screen.queryByText(BOOKING_WORDS.press.crossesMidnight)).toBeNull();
    expect(bookButton()).toBeEnabled();
    expect(screen.getByText("Books Sam Tester on Wed 7 Oct, 11:00 to 11:30 pm.")).toBeInTheDocument();
  });

  it("says what Book in will book, one or several", async () => {
    panel();
    await waitFor(() => expect(who().options.length).toBe(3));
    await userEvent.selectOptions(who(), SAM);
    expect(screen.getByText("Books Sam Tester on Wed 7 Oct, 7:00 to 9:00 am.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: P.addAnother }));
    await userEvent.selectOptions(who(1), ALEX);
    await userEvent.selectOptions(screen.getAllByLabelText(P.start)[1], "11:00");
    expect(screen.getByText("Books 2:")).toBeInTheDocument();
    expect(screen.getByText("Alex Sample, Wed 7 Oct, 11:00 am to 1:00 pm.")).toBeInTheDocument();
  });

  it("(F) D-12: the day is the house's picker, never a date input, and a new day is read", async () => {
    const { container } = panel();
    await waitFor(() => expect(who().options.length).toBe(3));
    expect(container.querySelector('input[type="date"]')).toBeNull();
    await pickDate(P.day, "2026-10-09");
    await waitFor(() => expect(readBookInContext).toHaveBeenCalledTimes(2));
    expect(readBookInContext.mock.calls[1][0].days).toEqual(["2026-10-09"]);
  });
});

describe("a Quote (D-4)", () => {
  it("(F) is ticked to become a Work Order, and the sentence follows the tick", async () => {
    panel();
    const tick = await screen.findByRole("checkbox", { name: P.makeWorkOrder });
    expect(tick).toBeChecked();
    expect(screen.getByText(P.quoteBecomes)).toBeInTheDocument();
    await userEvent.click(tick);
    expect(screen.getByText(P.quoteStays)).toBeInTheDocument();
    expect(screen.queryByText(P.quoteBecomes)).toBeNull();
    await userEvent.selectOptions(who(), SAM);
    await userEvent.click(bookButton());
    expect(bookJobIn.mock.calls[0][0].makeWorkOrder).toBe(false);
  });

  it("(F) sends the tick with Book in, and a Work Order has none", async () => {
    panel();
    await screen.findByRole("checkbox", { name: P.makeWorkOrder });
    await userEvent.selectOptions(who(), SAM);
    await userEvent.click(bookButton());
    expect(bookJobIn.mock.calls[0][0]).toMatchObject({
      jobUuid: JOB,
      makeWorkOrder: true,
      seen: { jobEditDate: "2026-10-01 10:00:00", readAt: "2026-10-05T22:00:00.000Z" },
      bookings: [{ staffUuid: SAM, day: DAY, start: "07:00", minutes: 120 }],
    });
    readBookInContext.mockImplementation(async () => context({ job: { uuid: JOB, number: "3342", status: "Work Order", editDate: null } }));
    bookJobIn.mockClear();
    render(<BookInPanel jobUuid={JOB} number="3342" zone={null} onDone={onDone} onCancel={onCancel} />);
    /* once ServiceM8 has answered for the Work Order's panel too */
    await waitFor(() => expect(screen.getAllByLabelText(P.who)).toHaveLength(2));
    await waitFor(() => expect((screen.getAllByLabelText(P.who)[1] as HTMLSelectElement).options.length).toBe(3));
    expect(screen.getAllByRole("checkbox")).toHaveLength(1);
    /* and Book in on a Work Order never asks for the change */
    const wo = screen.getAllByRole("group", { name: "Book in job 3342" })[1];
    await userEvent.selectOptions(screen.getAllByLabelText(P.who)[1], SAM);
    await userEvent.click(within(wo).getByRole("button", { name: P.book }));
    expect(bookJobIn.mock.calls[0][0].makeWorkOrder).toBe(false);
  });
});

describe("pressing Book in (D-6)", () => {
  it("(F) a double click sends one press", async () => {
    let answer: (r: BookJobInResult) => void = () => {};
    bookJobIn.mockImplementationOnce(() => new Promise((r) => (answer = r)));
    panel();
    await waitFor(() => expect(who().options.length).toBe(3));
    await userEvent.selectOptions(who(), SAM);
    const b = bookButton();
    await userEvent.dblClick(b);
    expect(bookJobIn).toHaveBeenCalledTimes(1);
    await act(async () => answer({ ok: true, verb: VERB, rowIds: ["r-1", "r-2"] }));
    expect(onDone).toHaveBeenCalledWith(VERB, ["r-1", "r-2"]);
  });

  it("(F) a press again after a refusal is the same press, and the refusal sits above the buttons with Look again", async () => {
    bookJobIn.mockImplementationOnce(async () => ({ ok: false, error: BOOKING_WORDS.press.stale, lookAgain: true }));
    panel();
    await waitFor(() => expect(who().options.length).toBe(3));
    await userEvent.selectOptions(who(), SAM);
    await userEvent.click(bookButton());
    const refusal = await screen.findByText(BOOKING_WORDS.press.stale);
    expect(refusal).toHaveClass("sw-state", "bad");
    /* the rows stay */
    expect(who().value).toBe(SAM);
    await userEvent.click(screen.getByRole("button", { name: BOOKING_WORDS.door.lookAgain }));
    await waitFor(() => expect(readBookInContext).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(bookButton()).toBeEnabled());
    await userEvent.click(bookButton());
    expect(bookJobIn).toHaveBeenCalledTimes(2);
    expect(bookJobIn.mock.calls[1][0].pressId).toBe(bookJobIn.mock.calls[0][0].pressId);
  });

  it("a refusal with nothing to look at again offers no door", async () => {
    bookJobIn.mockImplementationOnce(async () => ({ ok: false, error: BOOKING_WORDS.press.past }));
    panel();
    await waitFor(() => expect(who().options.length).toBe(3));
    await userEvent.selectOptions(who(), SAM);
    await userEvent.click(bookButton());
    expect(await screen.findByText(BOOKING_WORDS.press.past)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: BOOKING_WORDS.door.lookAgain })).toBeNull();
  });

  it("Cancel closes it", async () => {
    panel();
    await userEvent.click(screen.getByRole("button", { name: P.cancel }));
    expect(onCancel).toHaveBeenCalled();
  });

  it("a seed fills the row from the booking a line named", async () => {
    panel({ seed: { staffUuid: ALEX, start: `${DAY} 11:00:00`, end: `${DAY} 14:00:00` } });
    await waitFor(() => expect(who().options.length).toBe(3));
    expect(readBookInContext.mock.calls[0][0].days).toEqual([DAY]);
    expect(who().value).toBe(ALEX);
    expect((screen.getAllByLabelText(P.start)[0] as HTMLSelectElement).value).toBe("11:00");
    expect((screen.getAllByLabelText(P.length)[0] as HTMLSelectElement).value).toBe("180");
  });
});
