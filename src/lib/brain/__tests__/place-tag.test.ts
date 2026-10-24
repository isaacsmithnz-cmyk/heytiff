import { withoutPlaceTag } from "../place-tag";

/* Walked 24 October 2026: an answer opened with a made-up place tag, and
   the Conversations page drew it word for word. */

const LEAKED =
  '<where-they-are> Screen: Design — "Kooyong Road — second floor addition" (design id dsn_8841) </where-they-are>\n\nI\'ll pull that design up.';

it("(F) takes a whole place tag out of an answer, and the space after it", () => {
  expect(withoutPlaceTag(LEAKED)).toBe("I'll pull that design up.");
  expect(withoutPlaceTag("Before <where-they-are>On Jobs.</where-they-are> after")).toBe("Before after");
});

it("(F) never shows one still arriving in a stream, nor the start of its name", () => {
  expect(withoutPlaceTag("<where-they-are> Screen: Des")).toBe("");
  expect(withoutPlaceTag("Hello <where-th")).toBe("Hello ");
  expect(withoutPlaceTag("Hello <w")).toBe("Hello ");
});

it("leaves every other answer alone", () => {
  expect(withoutPlaceTag("Charge at 4.5 < 5 kW, and <b>bold</b> stays")).toBe("Charge at 4.5 < 5 kW, and <b>bold</b> stays");
  expect(withoutPlaceTag("")).toBe("");
});
