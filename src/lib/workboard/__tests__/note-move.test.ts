import {
  MOVE_IT,
  NEITHER,
  NOT_NOW,
  bookingLabel,
  bookingsThatFit,
  moveAnswer,
  moveAskOf,
  moveFields,
  moveQuestion,
  moveTo,
  movedLine,
  movesMadeOf,
  noneFitLine,
  type MoveBooking,
  type ProposedMove,
} from "../note-move";
import { filesNothing, onlyMoves, storedProposal } from "../note-draft";
import { appliedOf, takesBack, undoSummary } from "../note-applied";

/* Isaac, 2 November 2026: "Move Lisa and Mossman, uh, my booking this
   afternoon to Friday, seven AM", on a Monday. */
const TODAY = "2026-11-02";

const booking = (over: Partial<MoveBooking> = {}): MoveBooking => ({
  uuid: "act-mosman",
  jobUuid: "job-3488",
  staffUuid: "sm8-isaac",
  staffName: "",
  start: "2026-11-02 15:00:00",
  end: "2026-11-02 16:00:00",
  place: "6/40 Raglan St, Mosman",
  match: "3488 Lisa Brown 6/40 Raglan St Mosman",
  ...over,
});

const MINE: MoveBooking[] = [
  booking({ uuid: "act-early", jobUuid: "job-3375", start: "2026-11-02 07:00:00", end: "2026-11-02 11:00:00", place: "12 Pittwater Rd, Manly", match: "3375 Hall 12 Pittwater Rd Manly" }),
  booking(),
  booking({ uuid: "act-thu", jobUuid: "job-3401", start: "2026-11-05 09:00:00", end: "2026-11-05 12:00:00", place: "3 Ocean St, Bondi", match: "3401 Ng 3 Ocean St Bondi" }),
];

const move = (over: Partial<ProposedMove> = {}): ProposedMove => ({
  whoId: null,
  whoHint: "",
  words: "Lisa in Mossman",
  fromDay: TODAY,
  fromStart: "",
  fromPart: "afternoon",
  toDay: "2026-11-06",
  toStart: "07:00",
  ...over,
});

describe("finding the booking named", () => {
  it("finds the one he said, misheard names and all, never the chip's job", () => {
    expect(bookingsThatFit(move(), MINE).map((b) => b.uuid)).toEqual(["act-mosman"]);
    // "Mossman" alone, any day: the words pick it
    expect(bookingsThatFit(move({ fromDay: "", fromPart: "day", words: "Mossman" }), MINE).map((b) => b.uuid)).toEqual(["act-mosman"]);
  });

  it("reads 'my 3pm' as the clock, and the part of the day when no clock is said", () => {
    expect(bookingsThatFit(move({ words: "", fromDay: "", fromPart: "day", fromStart: "15:00" }), MINE).map((b) => b.uuid)).toEqual(["act-mosman"]);
    expect(bookingsThatFit(move({ words: "", fromDay: "", fromPart: "day", fromStart: "03:00" }), MINE).map((b) => b.uuid)).toEqual(["act-mosman"]);
    expect(bookingsThatFit(move({ words: "", fromPart: "morning" }), MINE).map((b) => b.uuid)).toEqual(["act-early"]);
  });

  it("offers every one that fits when the words don't tell them apart, and guesses at none", () => {
    expect(bookingsThatFit(move({ words: "my booking", fromPart: "day" }), MINE).map((b) => b.uuid)).toEqual(["act-early", "act-mosman"]);
    // nothing said to tell them apart: none, rather than a guess
    expect(bookingsThatFit(move({ words: "my booking", fromDay: "", fromPart: "day" }), MINE)).toEqual([]);
    // a place nobody's booked at: the day's both still fit, so she asks which
    expect(bookingsThatFit(move({ words: "Parramatta", fromPart: "day" }), MINE)).toHaveLength(2);
  });
});

describe("where it goes", () => {
  it("keeps the visit's length, and the same day or start where none is said", () => {
    const b = booking();
    expect(moveTo(b, { toDay: "2026-11-06", toStart: "07:00" })).toEqual({ start: "2026-11-06 07:00:00", end: "2026-11-06 08:00:00" });
    expect(moveTo(b, { toDay: "2026-11-06", toStart: "" })).toEqual({ start: "2026-11-06 15:00:00", end: "2026-11-06 16:00:00" });
    expect(moveTo(b, { toDay: "", toStart: "16:30" })).toEqual({ start: "2026-11-02 16:30:00", end: "2026-11-02 17:30:00" });
    // where it is already: nothing to move
    expect(moveTo(b, { toDay: "2026-11-02", toStart: "15:00" })).toBeNull();
  });

  it("is no move with nowhere to go", () => {
    expect(moveFields({ booking: "my 3pm", to_day: "", to_start: "" })).toBeNull();
    expect(moveFields({ booking: "my 3pm", from_start: "15:00", to_day: "", to_start: "7:00" })).toBeNull(); // not a 24-hour clock
    expect(moveFields({ booking: "my 3pm", from_start: "15:00", to_day: "2026-11-06", to_start: "07:00", from_part: "arvo" })).toMatchObject({
      words: "my 3pm",
      fromStart: "15:00",
      fromPart: "day",
      toDay: "2026-11-06",
      toStart: "07:00",
    });
  });
});

describe("what Tiff says", () => {
  const b = booking();
  const to = { start: "2026-11-06 07:00:00", end: "2026-11-06 08:00:00" };

  it("asks before anything moves, from and to", () => {
    expect(moveQuestion(b, to, true, TODAY)).toBe("Move your visit at 6/40 Raglan St, Mosman from today 3:00 to 4:00 pm to Friday 7:00 to 8:00 am?");
    expect(moveQuestion({ ...b, staffName: "Leo" }, to, false, TODAY)).toBe("Move Leo's visit at 6/40 Raglan St, Mosman from today 3:00 to 4:00 pm to Friday 7:00 to 8:00 am?");
    expect(bookingLabel(b, TODAY)).toBe("Today 3:00 to 4:00 pm, 6/40 Raglan St, Mosman");
  });

  it("says moved, or that it's on its way, and when nothing fits", () => {
    expect(movedLine(b, to, true, TODAY, false)).toBe("Moved. Your visit at 6/40 Raglan St, Mosman is Friday 7:00 to 8:00 am now.");
    expect(movedLine(b, to, true, TODAY, true)).toBe("Moving it. Your visit at 6/40 Raglan St, Mosman is Friday 7:00 to 8:00 am now, once ServiceM8 has it.");
    expect(noneFitLine({ words: "Parramatta" }, true, "")).toContain('I couldn\'t find "Parramatta" in your bookings');
    expect(noneFitLine({ words: "" }, false, "Leo")).toContain("which of Leo's bookings");
  });

  it("takes the button, a plain yes for one, or a plain no", () => {
    const ask = { index: 0, question: "Move …?", options: [{ label: MOVE_IT, booking: b, to }, { label: NOT_NOW, booking: null, to: null }] };
    expect(moveAnswer(ask, "Move the visit")?.booking?.uuid).toBe("act-mosman");
    expect(moveAnswer(ask, "yep")?.booking?.uuid).toBe("act-mosman");
    expect(moveAnswer(ask, "Not now")?.booking).toBeNull();
    expect(moveAnswer(ask, "no, leave it")?.booking).toBeNull();
    expect(moveAnswer(ask, "the blue one")).toBeNull();
    // two to pick from: a yes picks nothing
    const two = { ...ask, options: [{ label: "A", booking: b, to }, { label: "B", booking: b, to }, { label: NEITHER, booking: null, to: null }] };
    expect(moveAnswer(two, "yes")).toBeNull();
    expect(moveAnswer(two, "b")?.label).toBe("B");
    // stored, and read back
    expect(moveAskOf({ moveAsk: JSON.parse(JSON.stringify(ask)) })).toEqual(ask);
    expect(moveAskOf({ moveAsk: null })).toBeNull();
  });
});

describe("on the note", () => {
  it("a move alone files nothing on a job, and is still something to do", () => {
    const p = storedProposal({ tasks: [], moves: [{ whoId: null, whoHint: "", words: "my 3pm", fromDay: "", fromStart: "15:00", fromPart: "day", toDay: "2026-11-06", toStart: "07:00" }], plainNote: "", jobNote: "" })!;
    expect(p.moves).toHaveLength(1);
    expect(filesNothing(p)).toBe(false);
    expect(onlyMoves(p)).toBe(true);
    // stored before the lane: none
    expect(storedProposal({ tasks: [] })!.moves).toEqual([]);
  });

  it("is on the record with what puts it back, and Undo counts it", () => {
    const made = {
      index: 0,
      from: { uuid: "act-mosman", start: "2026-11-02 15:00:00", end: "2026-11-02 16:00:00" },
      to: { start: "2026-11-06 07:00:00", end: "2026-11-06 08:00:00" },
      undo: { do: "time", activity: "act-new", start: "2026-11-02 15:00:00", end: "2026-11-02 16:00:00" },
      line: "Moved.",
      undone: false,
    };
    expect(movesMadeOf([made, { index: "x" }])).toEqual([made]);
    const a = appliedOf({ v: 1, moves: [made] });
    expect(takesBack(a)).toBe(true);
    expect(undoSummary(a)).toBe("1 move taken back.");
    expect(takesBack(appliedOf({ v: 1, moves: [{ ...made, undone: true }] }))).toBe(false);
    // ServiceM8 never said where the new one went: nothing to put back by
    expect(takesBack(appliedOf({ v: 1, moves: [{ ...made, undo: null }] }))).toBe(false);
  });
});
