import { looksLikeQuestion } from "../intent";

/* The question/note split. The asymmetry these pin: a false "question" EATS
   A NOTE — the words go to the answer loop and nothing is saved — while a
   false "note" merely shows someone their own question on a review card,
   one Discard away. So every ambiguous case below must land on note. */

describe("things that are questions", () => {
  it.each([
    ["what's outstanding at Meridian"],
    ["whats left on the smith st job"],
    ["how many open tasks does Luke have"],
    ["who's booked for Thursday"],
    ["where is the roof key at Meridian"],
    ["is there anything open on the CRAC job"],
    ["do we have a manual for the PUZ-ZM250"],
    ["has anyone looked at the E6 on RTU-2"],
    ["show me the recurring issues"],
    ["tell me about the Meridian job"],
    ["did we ever fix that compressor"],
    ["the crane is booked for tomorrow right?"],
  ])("%j asks", (text) => {
    expect(looksLikeQuestion(text)).toBe(true);
  });
});

describe("things that are notes, however question-shaped", () => {
  it.each([
    // request modals are TASKS — "can you" to the widget means "someone should"
    ["can you order the grilles for smith st"],
    ["could someone chase the supplier"],
    ["should get the belts replaced next visit"],
    // "tell Luke" is a task; only "tell me" asks
    ["tell Luke he needs to order the grilles"],
    // a question buried mid-note belongs to the note
    ["gate code changed, and ask Dane what's left on the list"],
    // plain statements that happen to open with an s-word
    ["isolated the unit and reset the board"],
    ["showed the apprentice the plant room"],
    ["the middle rooftop unit tripped again"],
    ["gate code 4417"],
    [""],
    ["   "],
  ])("%j records", (text) => {
    expect(looksLikeQuestion(text)).toBe(false);
  });
});
