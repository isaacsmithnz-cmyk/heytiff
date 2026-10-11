import { writeUpAgainst, writeUpOf } from "../write-up";

/* The job, written out first (Isaac, 2026-10-10), on 3377's real first answer */

const first = {
  read: ["Lead from Mitsubishi Electric: 2 storey, 6 bed, 2 bath", "Floor plan: three bedrooms upstairs, six rooms downstairs, about 84 m²"],
  sizing: ["Downstairs: 84 m² with rooms above comes to 10.35 kW, so a 12.5 kW PEAD-M125JAAD"],
  visits: ["Rough-in: 2 people, 3.5 days, 55 h", "Install and commissioning: 2 people, 1.5 days, 24 h"],
  unpriced: ["Kitchen core holes and the 200 mm sandstone core: not in your book"],
};

it("keeps what she wrote, section by section, short and trimmed; says nothing is nothing", () => {
  const w = writeUpOf({ ...first, work: ["  Downstairs:   underfloor ducted  "], nonsense: ["x"] })!;
  expect(w.work).toEqual(["Downstairs: underfloor ducted"]);
  expect(w.assuming).toEqual([]);
  expect(Object.keys(w)).toEqual(["read", "sizing", "work", "visits", "unpriced", "assuming"]);
  expect(writeUpOf({ read: [], sizing: [""] })).toBeNull();
});

it("says what changed since the last one, and strikes what's settled, once", () => {
  const before = writeUpOf(first)!;
  const after = writeUpOf({ ...first, visits: ["Rough-in: 2 people, 3.5 days, 57 h, the sandstone core at 6 h", first.visits[1]], unpriced: [] })!;
  const against = writeUpAgainst(after, before);
  expect(against.visits).toEqual([
    { text: "Rough-in: 2 people, 3.5 days, 57 h, the sandstone core at 6 h", state: "changed" },
    { text: "Install and commissioning: 2 people, 1.5 days, 24 h", state: "same" },
    { text: "Rough-in: 2 people, 3.5 days, 55 h", state: "gone" },
  ]);
  expect(against.unpriced).toEqual([{ text: "Kitchen core holes and the 200 mm sandstone core: not in your book", state: "gone" }]);
  /* the first write-up has nothing to have changed from */
  expect(writeUpAgainst(before, null).read.every((i) => i.state === "same")).toBe(true);
});
