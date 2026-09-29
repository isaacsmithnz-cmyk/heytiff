import { noteWithPills } from "../job-attention";

const people = new Map([
  ["lukesmith", { name: "Luke" }],
  ["isaacsmith", { name: "Isaac" }],
]);

test("each person the note names becomes a pill where their handle stood", () => {
  expect(noteWithPills("@lukesmith @isaacsmith order the pump", people)).toEqual([
    { pill: "Luke" },
    { text: " " },
    { pill: "Isaac" },
    { text: " order the pump" },
  ]);
});

test("an address, an unknown @word and a full stop after a name stay as written", () => {
  expect(noteWithPills("email a@b.com or @nobody, ask @lukesmith.", people)).toEqual([
    { text: "email a@b.com or @nobody, ask " },
    { pill: "Luke" },
    { text: "." },
  ]);
});
