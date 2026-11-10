/* The business's own task hours (slice 8.1): a quote's zones, outlets, pipe
   and visits counted off its lines, and what the hours make them beside the
   hours the quote carries. A check, never a price. */
import type { QuoteLine } from "../lines";
import { normaliseQuoteSettings } from "../settings";
import { hoursByPart, taskCheck, tasksOf } from "../task-hours";

const line = (o: Partial<QuoteLine>): QuoteLine => ({
  id: "x", version: 1, updatedAt: "", updatedBy: "", optionIndex: 0, system: "Upstairs", group: "Ductwork and grilles", position: 0, name: "x",
  code: null, supplierKey: null, kind: "material", qty: 1, unit: "", costCents: 0, sellCents: null, source: "assumed", why: "", duct: false, ...o,
});

const ducted = [
  line({ name: "Round ceiling diffuser 250", qty: 3 }),
  line({ name: "Return grille 600 × 400 eggcrate, filtered" }),
  line({ name: "Return box 600 × 400" }),
  line({ name: "Motorised damper 250", qty: 3 }),
  line({ name: "Pair coil 3/8 + 5/8", qty: 15, unit: "m" }),
  line({ name: "Pair coil 1/4 + 1/2, 20 m roll" }),
  line({ name: "Pipe cover, 2 m" }),
  line({ group: "Labour", kind: "labour", name: "Rough-in: 2 people", qty: 16, unit: "h" }),
  line({ group: "Labour", kind: "labour", name: "Install", qty: 8, unit: "h" }),
];

it("counts a quote's zones, outlets, metres of pipe and visits off its lines", () => {
  expect(tasksOf(ducted, 8)).toEqual({ zone: 3, grille: 4, metre: 35, visit: 2 });
});

it("sets what the business's hours make it beside the hours the quote carries", () => {
  expect(taskCheck(ducted, { zone: 1, grille: 1.5, metre: 0.2, visit: 1 }, 8)).toEqual({
    hours: 18,
    words: "3 zones, 4 outlets, 35 m of pipe and 2 visits",
    quoted: 24,
  });
  /* only what's set, and only what's on it */
  expect(taskCheck(ducted, { zone: null, grille: 1.5, metre: null, visit: null }, 8)).toMatchObject({ hours: 6, words: "4 outlets" });
  expect(taskCheck(ducted, { zone: null, grille: null, metre: null, visit: null }, 8)).toBeNull();
});

it("keeps a business's hours as it set them: none for a new one, a typo capped", () => {
  expect(normaliseQuoteSettings({}).taskHours).toEqual({ zone: null, grille: null, metre: null, visit: null });
  expect(normaliseQuoteSettings({ task_hours: { grille: "1.5", zone: 0, metre: 400, visit: "x" } }).taskHours).toEqual({ zone: null, grille: 1.5, metre: 40, visit: null });
});

/* the 3465 review, 5 November 2026: seven dampers, six sensors and the controller in one 4 h task */
it("says what each damper and outlet gets in the tasks that name them, and when no task does", () => {
  const visit = (tasks: [string, number][]) => ({ stage: "Day 2", people: 2, dayHours: 8, tasks: tasks.map(([task, hours]) => ({ task, hours, was: null, byHand: false })) });
  const parts = [line({ name: "Motorised damper 250", qty: 7 }), line({ name: "Supply grille 350 × 150", qty: 9 })];
  expect(hoursByPart(parts, [visit([["Zone controller, seven dampers and six sensors", 4], ["Nine flex runs", 8]])], 8)).toEqual([
    '7 dampers on the quote: 4 h in "Zone controller, seven dampers and six sensors", 0.6 h each',
    '9 outlets on the quote: 8 h in "Nine flex runs", 0.9 h each',
  ]);
  expect(hoursByPart(parts, [visit([["Commissioning", 3]])], 8)).toEqual(["7 dampers on the quote, and no task names them", "9 outlets on the quote, and no task names them"]);
  expect(hoursByPart([line({ name: "Indoor unit" })], [visit([["Commissioning", 3]])], 8)).toEqual([]);
});
