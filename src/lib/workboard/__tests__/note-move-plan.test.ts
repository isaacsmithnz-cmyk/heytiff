import { bookingWords, moveAskOf, moveQuestion, moveSlot, MOVE_IT, NEITHER, NOT_NOW, pickedOffer, pickMoves, spanWords, type MoveBooking } from "../note-move-plan";

/* Isaac's own test, 2 November 2026: "Move Lisa and Mossman, uh, my booking
   this afternoon to Friday, seven AM", with the chip on 3375. The real one
   was 3488, 6/40 Raglan St, Mosman, that day 3:00 to 4:00 pm. */
const today = "2026-11-02"; // a Monday
const b = (over: Partial<MoveBooking>): MoveBooking => ({
  activity: "a",
  staffUuid: "s",
  jobUuid: "j",
  number: "1",
  client: "",
  where: "",
  start: `${today} 09:00:00`,
  end: `${today} 10:00:00`,
  ...over,
});
const mosman = b({ activity: "mos", jobUuid: "j3488", number: "3488", client: "Lisa Brown", where: "6/40 Raglan St, Mosman", start: `${today} 15:00:00`, end: `${today} 16:00:00` });
const chip = b({ activity: "chip", jobUuid: "j3375", number: "3375", client: "Ann Lee", where: "12 Pacific Hwy, Gordon", start: `${today} 07:00:00`, end: `${today} 09:00:00` });
const later = b({ activity: "wed", jobUuid: "j3500", number: "3500", client: "Bob Ng", where: "3 King St, Newtown", start: "2026-11-04 08:00:00", end: "2026-11-04 12:00:00" });
const friday = "2026-11-06";

it("finds the booking named, not the chip's job", () => {
  const said = "Move Lisa and Mossman, uh, my booking this afternoon to Friday, seven AM";
  expect(pickMoves(said, [chip, mosman, later], { today, chipJob: "j3375", toDay: friday })).toEqual([mosman]);
});

it("takes the job number over everything", () => {
  expect(pickMoves("move 3500 to friday", [chip, mosman, later], { today, chipJob: null, toDay: friday })).toEqual([later]);
});

it("offers the few soonest when nothing names one", () => {
  expect(pickMoves("move my booking to friday", [later, chip, mosman], { today, chipJob: null, toDay: friday }).map((x) => x.activity)).toEqual(["chip", "mos", "wed"]);
});

it("a weekday that's where it's going doesn't pick a booking on that day", () => {
  const onFriday = b({ activity: "fri", start: `${friday} 08:00:00`, end: `${friday} 09:00:00` });
  expect(pickMoves("move it to friday, the Newtown one", [onFriday, later], { today, chipJob: null, toDay: friday })).toEqual([later]);
});

it("one booking is the one", () => {
  expect(pickMoves("move my booking", [later], { today, chipJob: null, toDay: "" })).toEqual([later]);
  expect(pickMoves("move my booking", [], { today, chipJob: null, toDay: "" })).toEqual([]);
});

it("keeps the visit's length; with no time said, its own time on the new day", () => {
  expect(moveSlot(mosman, { day: friday, start: "07:00", part: "day" })).toEqual({ start: `${friday} 07:00:00`, end: `${friday} 08:00:00` });
  expect(moveSlot(later, { day: friday, start: "", part: "day" })).toEqual({ start: `${friday} 08:00:00`, end: `${friday} 12:00:00` });
  expect(moveSlot(later, { day: "", start: "13:00", part: "day" })).toEqual({ start: "2026-11-04 13:00:00", end: "2026-11-04 17:00:00" });
  expect(moveSlot(later, { day: friday, start: "", part: "afternoon" })).toEqual({ start: `${friday} 12:00:00`, end: `${friday} 16:00:00` });
  expect(moveSlot(later, { day: friday, start: "22:00", part: "day" })).toBeNull();
});

it("says it plainly", () => {
  expect(spanWords(`${today} 15:00:00`, `${today} 16:00:00`)).toBe("3:00 to 4:00 pm");
  expect(spanWords(`${today} 11:30:00`, `${today} 13:00:00`)).toBe("11:30 am to 1:00 pm");
  expect(bookingWords(mosman, today)).toBe("3488, 6/40 Raglan St, Mosman, today 3:00 to 4:00 pm");
  expect(moveQuestion(mosman, { start: `${friday} 07:00:00`, end: `${friday} 08:00:00` }, today, null)).toBe("Move 3488, 6/40 Raglan St, Mosman, today 3:00 to 4:00 pm, to Fri 6 Nov 7:00 to 8:00 am?");
  expect(moveQuestion(mosman, { start: `${friday} 07:00:00`, end: `${friday} 08:00:00` }, today, "Leo")).toMatch(/^Move Leo's 3488/);
});

it("reads an answer: Move the visit, a booking's own words, or nothing", () => {
  const one = { offers: [{ label: "3488, Mosman, today", booking: mosman, slot: { start: `${friday} 07:00:00`, end: `${friday} 08:00:00` } }], tell: false };
  expect(pickedOffer(one, MOVE_IT)?.booking.activity).toBe("mos");
  expect(pickedOffer(one, "yes")?.booking.activity).toBe("mos");
  expect(pickedOffer(one, NOT_NOW)).toBeNull();
  const two = { offers: [...one.offers, { label: "3500, Newtown, Wed", booking: later, slot: { start: `${friday} 08:00:00`, end: `${friday} 12:00:00` } }], tell: false };
  expect(pickedOffer(two, MOVE_IT)).toBeNull();
  expect(pickedOffer(two, "3500, Newtown, Wed")?.booking.activity).toBe("wed");
  expect(pickedOffer(two, NEITHER)).toBeNull();
});

it("reads a stored ask back, and nothing else", () => {
  const offers = [{ label: "x", booking: mosman, slot: { start: `${friday} 07:00:00`, end: `${friday} 08:00:00` } }];
  expect(moveAskOf({ moveAsk: { offers, tell: true } })).toEqual({ offers, tell: true });
  expect(moveAskOf({ moveAsk: { offers: [], tell: false, undo: { do: "time" } } })?.undo).toEqual({ do: "time" });
  expect(moveAskOf({ moveAsk: null })).toBeNull();
  expect(moveAskOf({ moveAsk: { offers: [{ label: "x" }] } })).toBeNull();
  expect(moveAskOf(null)).toBeNull();
});
