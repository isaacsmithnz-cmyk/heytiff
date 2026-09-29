import { noteWithPills } from "../sm8-mentions";

const people = new Map([
  ["lukesmith", { name: "Luke" }],
  ["isaacsmith", { name: "Isaac" }],
]);

test("each person the note names becomes a pill where their handle stood", () => {
  expect(noteWithPills("@lukesmith @isaacsmith order the pump", people)).toEqual([
    { pill: "Luke", tone: 0 },
    { text: " " },
    { pill: "Isaac", tone: 1 },
    { text: " order the pump" },
  ]);
});

test("an address, an unknown @word and a full stop after a name stay as written", () => {
  expect(noteWithPills("email a@b.com or @nobody, ask @lukesmith.", people)).toEqual([
    { text: "email a@b.com or @nobody, ask " },
    { pill: "Luke", tone: 0 },
    { text: "." },
  ]);
});

test("a person named twice keeps their colour, and each new person gets the next", () => {
  const tones = noteWithPills("@lukesmith and @isaacsmith, @lukesmith again", people).flatMap((w) =>
    "pill" in w ? [w.tone] : [],
  );
  expect(tones).toEqual([0, 1, 0]);
});
