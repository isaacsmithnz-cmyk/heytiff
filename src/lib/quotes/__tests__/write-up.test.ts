import { mergedWriteUp, notPricedOf, pricedOnOf, writeUpOf } from "../write-up";

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
  expect(Object.keys(w).sort()).toEqual(["assuming", "pricedOn", "read", "sizing", "toCheck", "unpriced", "visits", "work"]);
  expect(writeUpOf({ read: [], sizing: [""] })).toBeNull();
});

it("reads her named rows, from her tool and from the stored event alike", () => {
  const rows = [{ what: "Labour", said: "  Option 1 is   12 h " }, { what: "No words", said: "" }];
  const w = writeUpOf({ priced_on: rows, to_check: [{ what: "Wall brackets", said: "May be fine" }] })!;
  expect(w.pricedOn).toEqual([{ what: "Labour", said: "Option 1 is 12 h" }]);
  expect(w.toCheck).toEqual([{ what: "Wall brackets", said: "May be fine" }]);
  expect(writeUpOf(w)).toEqual(w);
});

it("keeps an older write-up's visits and assumptions as what it's priced on, and never lists nothing as unpriced", () => {
  const old = writeUpOf({ ...first, assuming: ["5 m of pipe"] })!;
  expect(pricedOnOf(old).map((r) => r.said)).toEqual([...first.visits, "5 m of pipe"]);
  expect(pricedOnOf(old).every((r) => r.what === "")).toBe(true);
  expect(pricedOnOf(writeUpOf({ ...first, priced_on: [{ what: "Labour", said: "12 h" }] })!)).toEqual([{ what: "Labour", said: "12 h" }]);
  expect(notPricedOf(writeUpOf({ unpriced: ["Nothing unpriced."] })!)).toEqual([]);
  expect(notPricedOf(old)).toEqual(first.unpriced);
});

/* Isaac, 13 November 2026, "Tiff is quite slow between turns": an answer
   changes the sections it touches, and the rest stand */
it("changes only the sections given, each whole; an empty one is cleared; with none before, it is what she gave", () => {
  const was = writeUpOf(first)!;
  const m = mergedWriteUp(was, { unpriced: [], assuming: ["Pipe run 14 m"] })!;
  expect(m.changed).toEqual(["unpriced", "assuming"]);
  expect(m.writeUp).toEqual({ ...was, unpriced: [], assuming: ["Pipe run 14 m"] });
  expect(mergedWriteUp(was, { to_check: [{ what: "Brackets", said: "May be reused" }] })!.writeUp.toCheck).toEqual([{ what: "Brackets", said: "May be reused" }]);
  // a section not given stays; nothing given changes nothing
  expect(mergedWriteUp(was, {})!.writeUp).toEqual(was);
  expect(mergedWriteUp(null, { read: ["Luke: two systems"] })!.writeUp).toMatchObject({ read: ["Luke: two systems"], sizing: [], pricedOn: [] });
  expect(mergedWriteUp(null, {})).toBeNull();
  // what isn't a section is no change
  expect(mergedWriteUp(was, { sizing: "10 kW" })!.changed).toEqual([]);
});

