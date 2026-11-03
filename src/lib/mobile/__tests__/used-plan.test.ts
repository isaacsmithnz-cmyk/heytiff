/**
 * @jest-environment node
 */

/* One materials list a day, shared by the whole job (Isaac, 3 November
   2026: "if you've got three guys doing the same job and they all decide to
   do their daily wrap-up at the same time, who decides?"). Drawn on 1352,
   Mon 2 Nov: Alex says 6 m of pair coil, 2 lengths of trunking, 2 of drain
   and some wall brackets; Leonardo then says 8 m of 3/8 5/8 and a roll of
   tape; Isaac, a moment later, 2 lengths of trunking. */

import { amount, dayAllowed, foundOf, keyOf, planAdd, rankCandidates, settle, viewOf, type Candidate, type Ready, type UsedRow } from "../used-plan";

const COIL = { supplierKey: "reece", code: "PC3858", name: "Pair coil 3/8 x 5/8" };
const at = (hm: string) => `2026-11-02T${hm}:00.000Z`;
const row = (over: Partial<UsedRow>): UsedRow => ({
  id: "l1",
  sm8_job_uuid: "job-1352",
  day: "2026-11-02",
  supplier_key: null,
  code: null,
  name: "Thing",
  qty: 1,
  unit: null,
  choices: null,
  added_by: "auth0|alex",
  added_by_staff: "card-alex",
  words: "",
  open_repeat: null,
  history: [],
  removed_at: null,
  created_at: at("05:31"),
  updated_at: at("05:31"),
  ...over,
});
const ready = (over: Partial<Ready>): Ready => ({ said: "", name: "Thing", qty: 1, unit: null, supplierKey: null, code: null, choices: null, ...over });
const coilRow = row({ supplier_key: COIL.supplierKey, code: COIL.code, name: COIL.name, qty: "6.000", unit: "m", history: [{ at: at("05:31"), by: "auth0|alex", staff: "card-alex", kind: "said", qty: 6 }] });
const leo = { by: "auth0|leo", staff: "card-leo", at: at("05:33") };

test("Leonardo's Add: the new thing goes on, the one already there is a question", () => {
  const { add, asks } = planAdd([coilRow], [ready({ ...COIL, qty: 8, unit: "m", said: "8 metres of 3/8 5/8" }), ready({ name: "Tape", qty: 1, unit: "roll" })]);
  expect(add.map((a) => a.name)).toEqual(["Tape"]);
  expect(asks).toEqual([{ row: coilRow, said: 8 }]);
});

test("a thing not in the book is the same thing by its name, whatever the case", () => {
  const brackets = row({ name: "Wall brackets", qty: 2 });
  expect(planAdd([brackets], [ready({ name: " wall Brackets", qty: 2 })]).asks).toHaveLength(1);
  expect(keyOf({ supplierKey: null, code: null, name: "Wall Brackets " })).toBe("name:wall brackets");
});

test("the same thing twice in one Add is one line, both figures together", () => {
  const { add } = planAdd([], [ready({ ...COIL, qty: 4, unit: "m" }), ready({ ...COIL, qty: 2, unit: "m" })]);
  expect(add).toHaveLength(1);
  expect(add[0]!.qty).toBe(6);
});

test("settled: in total is the figure said, more is on top, leave it keeps the first", () => {
  expect(settle(coilRow, 8, "total", leo)).toMatchObject({ qty: 8, open_repeat: null });
  expect(settle(coilRow, 8, "total", leo).history.at(-1)).toMatchObject({ kind: "total", qty: 8, was: 6, said: 8, by: "auth0|leo" });
  expect(settle(coilRow, 8, "more", leo)).toMatchObject({ qty: 14 });
  expect(settle(coilRow, 8, "leave", leo).history.at(-1)).toMatchObject({ kind: "agreed", qty: 6 });
});

test("the same figure again, said as in total, is agreeing", () => {
  const trunking = row({ name: "Trunking 2.4 m", qty: 2 });
  expect(settle(trunking, 2, "total", leo)).toMatchObject({ qty: 2, history: [expect.objectContaining({ kind: "agreed" })] });
  expect(settle(trunking, 2, "more", leo)).toMatchObject({ qty: 4 });
});

test("not sure, leave it: the first figure still counts, the other is kept open until someone settles it", () => {
  const open = settle(coilRow, 8, "open", leo);
  expect(open.qty).toBe(6);
  expect(open.open_repeat).toEqual({ by: "auth0|leo", staff: "card-leo", qty: 8, at: at("05:33") });
  const later = settle({ ...coilRow, open_repeat: open.open_repeat, history: open.history }, 8, "total", { by: "auth0|isaac", staff: "card-isaac", at: at("05:40") });
  expect(later).toMatchObject({ qty: 8, open_repeat: null });
  expect(later.history.map((s) => s.kind)).toEqual(["said", "open", "total"]);
});

test("the amount changed by hand clears an open repeat and says what it was", () => {
  const changed = amount({ ...coilRow, open_repeat: { by: "auth0|leo", staff: null, qty: 8, at: at("05:33") } }, 7, leo);
  expect(changed).toMatchObject({ qty: 7, open_repeat: null });
  expect(changed.history.at(-1)).toMatchObject({ kind: "amount", qty: 7, was: 6 });
});

test("the phone's line: names in place of ids, yours marked, an open repeat said", () => {
  const names = new Map([
    ["auth0|alex", "Alex"],
    ["auth0|leo", "Leonardo"],
  ]);
  const open = settle(coilRow, 8, "open", leo);
  const line = viewOf({ ...coilRow, ...open, qty: open.qty }, names, "auth0|leo");
  expect(line).toMatchObject({ name: "Pair coil 3/8 x 5/8", qty: 6, unit: "m", matched: true, choices: null, open: { by: "Leonardo", mine: true, qty: 8 } });
  expect(line.steps.map((s) => [s.by, s.mine, s.kind])).toEqual([
    ["Alex", false, "said"],
    ["Leonardo", true, "open"],
  ]);
});

const cand = (code: string, name: string, more: Partial<Candidate> = {}): Candidate => ({ supplierKey: "reece", code, name, uom: "EA", timesBought: null, preferred: false, ...more });

test("the book's items for a thing: one per code, preferred first, then the most bought", () => {
  const ranked = rankCandidates([
    cand("A", "Ultrafil 16 x 20 x 2", { timesBought: 3 }),
    cand("B", "Ultrafil 16 x 16 x 2", { timesBought: 9 }),
    cand("B", "Ultrafil 16 x 16 x 2", { supplierKey: "aad", timesBought: 1 }),
    cand("C", "Ultrafil 24 x 24 x 4", { preferred: true }),
  ]);
  expect(ranked.map((c) => [c.supplierKey, c.code])).toEqual([
    ["reece", "C"],
    ["reece", "B"],
    ["reece", "A"],
  ]);
});

test("found: the pick is the book's item; Which one? keeps the words and up to four choices; one choice is the pick", () => {
  const items = [cand("A", "Ultrafil 16 x 16 x 2"), cand("B", "Ultrafil 16 x 20 x 2"), cand("C", "Ultrafil 24 x 24 x 4")];
  const thing = { said: "a 400 by 400 in-line filter", name: "In-line filter 400 x 400", qty: 1, unit: "", search: ["ultrafil"] };
  expect(foundOf(thing, items, { pick: 0, choices: [] })).toMatchObject({ name: "Ultrafil 16 x 16 x 2", supplierKey: "reece", code: "A", qty: 1, unit: null, choices: null });
  const which = foundOf(thing, items, { pick: -1, choices: [{ index: 0, hint: "About 400 x 400" }, { index: 1, hint: "About 400 x 500" }, { index: 9, hint: "gone" }] });
  expect(which).toMatchObject({ name: "In-line filter 400 x 400", supplierKey: null, code: null });
  expect(which.choices).toEqual([
    { supplierKey: "reece", code: "A", name: "Ultrafil 16 x 16 x 2", hint: "About 400 x 400" },
    { supplierKey: "reece", code: "B", name: "Ultrafil 16 x 20 x 2", hint: "About 400 x 500" },
  ]);
  expect(foundOf(thing, items, { pick: -1, choices: [{ index: 2, hint: "" }] })).toMatchObject({ code: "C", choices: null });
});

test("some wall brackets: no count said is no count, and a unit only from the list", () => {
  expect(foundOf({ said: "some wall brackets", name: "Wall brackets", qty: 0, unit: "", search: ["bracket"] }, [], undefined)).toMatchObject({ name: "Wall brackets", qty: null, unit: null, choices: null });
  expect(foundOf({ said: "6 metres", name: "Pair coil", qty: 6, unit: "metres", search: [] }, [], undefined).unit).toBeNull();
  expect(foundOf({ said: "6 metres", name: "Pair coil", qty: 6, unit: "M", search: [] }, [], undefined).unit).toBe("m");
});

test("a list's day: up to tomorrow and two weeks back", () => {
  expect(dayAllowed("2026-11-03", "2026-11-03")).toBe(true);
  expect(dayAllowed("2026-11-04", "2026-11-03")).toBe(true);
  expect(dayAllowed("2026-11-05", "2026-11-03")).toBe(false);
  expect(dayAllowed("2026-10-20", "2026-11-03")).toBe(true);
  expect(dayAllowed("2026-10-19", "2026-11-03")).toBe(false);
  expect(dayAllowed("3 Nov", "2026-11-03")).toBe(false);
});
