/* The note a fuel docket leaves on its way from My expenses to the vehicle.

   ONE TANK, ONE RECORD. The two screens each wrote their own row for the same
   purchase and neither knew about the other, so the tax export counted it
   twice and a personal card was paid twice. The docket goes across now — the
   figures Tiff read and the photo itself — and only the vehicle log is
   written. Read once, like every other handoff in the app: a refresh comes
   back to an empty Log fuel rather than a pre-filled one nobody asked for. */

import { FUEL_HANDOFF_KEY, consumeFuelHandoff, writeFuelHandoff } from "../fuel-handoff";

const note = {
  cost: "158.40",
  gst: "14.40",
  abn: "51824753556",
  station: "BP Kingsford",
  purchasedOn: "2026-07-31",
  paidWith: "own" as const,
  receiptDocumentId: "doc-77",
};

beforeEach(() => sessionStorage.clear());

it("hands the docket over once and tears the note up", () => {
  expect(writeFuelHandoff(note)).toBe(true);

  expect(consumeFuelHandoff()).toEqual(note);
  expect(consumeFuelHandoff()).toBeNull();
  expect(sessionStorage.getItem(FUEL_HANDOFF_KEY)).toBeNull();
});

it("reads nothing when nothing was left", () => {
  expect(consumeFuelHandoff()).toBeNull();
});

it("survives a note that isn't the JSON it looks like", () => {
  sessionStorage.setItem(FUEL_HANDOFF_KEY, "{not json");
  expect(consumeFuelHandoff()).toBeNull();
});

/* A docket with nothing on it is still a docket: the fields open empty and
   the person types what the paper says. What must never arrive is a payer
   nobody chose — "company" raises no claim, so it is the safe default and the
   one the modal already starts on. */
it("keeps an unreadable note usable, and never invents a payer", () => {
  sessionStorage.setItem(FUEL_HANDOFF_KEY, JSON.stringify({ cost: 12, paidWith: "somebody" }));
  expect(consumeFuelHandoff()).toEqual({
    cost: "",
    gst: "",
    abn: "",
    station: "",
    purchasedOn: "",
    paidWith: "company",
    receiptDocumentId: null,
  });
});
